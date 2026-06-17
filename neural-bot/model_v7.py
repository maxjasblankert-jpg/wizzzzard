"""Actor-critic for v7: player-count-agnostic attention + dual heads + aux bid head
+ centralized oracle critic.

Key change from v6: opponents are *tokens* (a variable, padded set) rather than two
fixed observation slots, so one model handles 3 AND 4 players. The encoder attends over
[global token | 60 card tokens | up to 3 opponent tokens], with absent opponents masked
out via the transformer's key-padding mask.

Heads:
  * play  -- per-card logit over the 60 card embeddings
  * bid   -- global token -> bid distribution
  * aux   -- global token -> predicted trick-count distribution (auxiliary supervision;
             trained on realized round outcomes to sharpen hand-strength representation)
Critic: a centralized MLP over the padded all-hands global state (training only).
"""

import numpy as np
import torch
import torch.nn as nn
from torch.distributions import Categorical

import obs_v7 as O

ILLEGAL_LOGIT = -1e8

# obs unpacking offsets (must match obs_v7 layout)
_C = O.CARDS                         # 300
_G = O.GLOB_F                        # 14
_K = O.K_OPP                         # 3
_OF = O.OPP_F                        # 5
BIDDING_FLAG_IDX = _C + 5            # glob[5] in the flat obs
N_ACTIONS = O.N_ACTIONS             # 60
MAX_BID = O.MAX_BID                 # 21


def _ortho(layer, gain=np.sqrt(2)):
    nn.init.orthogonal_(layer.weight, gain)
    nn.init.constant_(layer.bias, 0.0)
    return layer


def _static_card_features():
    suit = np.zeros((60, 4), dtype=np.float32)
    value = np.zeros((60, 1), dtype=np.float32)
    is_wiz = np.zeros((60, 1), dtype=np.float32)
    is_jes = np.zeros((60, 1), dtype=np.float32)
    for c in range(60):
        if c < 52:
            suit[c, c // 13] = 1.0
            value[c, 0] = ((c % 13) + 1) / 13.0
        elif c < 56:
            is_wiz[c, 0] = 1.0
        else:
            is_jes[c, 0] = 1.0
    return np.concatenate([suit, value, is_wiz, is_jes], axis=1)   # (60, 7)


class ActorCritic(nn.Module):
    def __init__(self, d=64, n_heads=4, n_layers=2):
        super().__init__()
        self.register_buffer("static_feats", torch.tensor(_static_card_features()))  # (60,7)
        n_card_in = O.CARD_DYN + 7        # 5 dynamic + 7 static
        self.card_proj = _ortho(nn.Linear(n_card_in, d))
        self.global_proj = _ortho(nn.Linear(_G, d))
        self.opp_proj = _ortho(nn.Linear(_OF, d))
        layer = nn.TransformerEncoderLayer(d_model=d, nhead=n_heads, dim_feedforward=2 * d,
                                           dropout=0.0, batch_first=True)
        # enable_nested_tensor=False: we always pass a key-padding mask; the nested-tensor
        # fast path only emits a noisy prototype warning here and isn't needed.
        self.encoder = nn.TransformerEncoder(layer, num_layers=n_layers, enable_nested_tensor=False)

        self.play_head = _ortho(nn.Linear(d, 1), gain=0.01)
        self.bid_head = nn.Sequential(_ortho(nn.Linear(d, d)), nn.ReLU(),
                                      _ortho(nn.Linear(d, N_ACTIONS), gain=0.01))
        self.aux_head = nn.Sequential(_ortho(nn.Linear(d, d)), nn.ReLU(),
                                      _ortho(nn.Linear(d, MAX_BID), gain=0.01))

        self.critic = nn.Sequential(
            _ortho(nn.Linear(O.GSTATE_DIM, 256)), nn.ReLU(),
            _ortho(nn.Linear(256, 256)), nn.ReLU(),
            _ortho(nn.Linear(256, 1), gain=1.0),
        )

    # ---- encoder ---------------------------------------------------------- #
    def _encode(self, obs):
        b = obs.shape[0]
        cards_dyn = obs[:, 0:_C].reshape(b, 60, O.CARD_DYN)
        glob = obs[:, _C:_C + _G]
        opp = obs[:, _C + _G:_C + _G + _K * _OF].reshape(b, _K, _OF)
        opp_mask = obs[:, _C + _G + _K * _OF:]                       # (b, K) 1=real

        static = self.static_feats.unsqueeze(0).expand(b, -1, -1)
        card_tok = self.card_proj(torch.cat([cards_dyn, static], dim=-1))  # (b,60,d)
        glob_tok = self.global_proj(glob).unsqueeze(1)                     # (b,1,d)
        opp_tok = self.opp_proj(opp)                                       # (b,K,d)

        tokens = torch.cat([glob_tok, card_tok, opp_tok], dim=1)          # (b,61+K,d)
        # key padding mask: True = ignore. Global + cards always attended; opp by mask.
        pad = torch.zeros(b, 1 + 60, dtype=torch.bool, device=obs.device)
        opp_pad = opp_mask < 0.5
        key_pad = torch.cat([pad, opp_pad], dim=1)
        enc = self.encoder(tokens, src_key_padding_mask=key_pad)
        return enc[:, 0], enc[:, 1:61]            # global summary, card embeddings

    def _logits(self, obs, action_mask):
        global_emb, card_emb = self._encode(obs)
        play_logits = self.play_head(card_emb).squeeze(-1)           # (b,60)
        bid_logits = self.bid_head(global_emb)                       # (b,60)
        is_bidding = (obs[:, BIDDING_FLAG_IDX] > 0.5).unsqueeze(-1)
        logits = torch.where(is_bidding, bid_logits, play_logits)
        return logits.masked_fill(~action_mask, ILLEGAL_LOGIT)

    def aux_logits(self, obs):
        """Trick-count prediction from the global token (auxiliary supervision)."""
        global_emb, _ = self._encode(obs)
        return self.aux_head(global_emb)                             # (b, MAX_BID)

    # ---- critic ----------------------------------------------------------- #
    def critic_value(self, global_state):
        return self.critic(global_state).squeeze(-1)

    # ---- training / inference API ----------------------------------------- #
    def forward(self, obs, action_mask, global_state):
        logits = self._logits(obs, action_mask)
        dist = Categorical(logits=logits)
        action = dist.sample()
        value = self.critic_value(global_state)
        return action, dist.log_prob(action), dist.entropy(), value

    def evaluate_actions(self, obs, action_mask, actions, global_state):
        logits = self._logits(obs, action_mask)
        dist = Categorical(logits=logits)
        return dist.log_prob(actions), dist.entropy(), self.critic_value(global_state)

    @torch.no_grad()
    def act_greedy(self, obs, action_mask):
        return torch.argmax(self._logits(obs, action_mask), dim=-1)

    # opponent/inference helper: (features unused, logits) -- mirrors v4/v6 for league reuse
    def _features_and_logits(self, obs, action_mask):
        return None, self._logits(obs, action_mask)
