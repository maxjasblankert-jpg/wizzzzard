"""Actor-critic for v6: attention encoder, dual heads, centralized oracle critic.

Three upgrades over v4's factored MLP, each grounded in imperfect-information RL research:

  1. Attention encoder (Set-Transformer style). Each card is a token; a small
     self-attention stack lets cards attend to one another, so the policy can reason
     about interactions (voids, "I hold the boss trump AND a singleton") that v4's
     independent per-card scorer cannot. A global token (token 0) summarizes the
     public scalars and pools the hand.

  2. Separate bid and play heads on the shared encoder. Bidding is a global
     hand-strength decision (from the global token); play is a per-card decision
     (from the card tokens). The env's phase flag (obs[193]) selects the head.

  3. Centralized "oracle" critic (CTDE / MAPPO / Suphx oracle-guiding). During
     TRAINING the critic sees every player's hand -> a low-variance value estimate,
     which is the dominant difficulty in imperfect-information RL. At inference only
     the actor (which sees legal info) is used; the critic is discarded.
"""

import numpy as np
import torch
import torch.nn as nn
from torch.distributions import Categorical

ILLEGAL_LOGIT = -1e8

HAND, SEEN, TRICK = slice(0, 60), slice(60, 120), slice(120, 180)
TRUMP_ONEHOT = slice(180, 184)
GLOBAL_SCALARS = slice(180, 194)
TAKES_TRICK = slice(194, 254)
FOLLOWING = slice(254, 255)
BIDDING_FLAG = 193


def _ortho(layer, gain=np.sqrt(2)):
    nn.init.orthogonal_(layer.weight, gain)
    nn.init.constant_(layer.bias, 0.0)
    return layer


def _static_card_features():
    suit_onehot = np.zeros((60, 4), dtype=np.float32)
    value_norm = np.zeros((60, 1), dtype=np.float32)
    is_wizard = np.zeros((60, 1), dtype=np.float32)
    is_jester = np.zeros((60, 1), dtype=np.float32)
    for c in range(60):
        if c < 52:
            suit_onehot[c, c // 13] = 1.0
            value_norm[c, 0] = ((c % 13) + 1) / 13.0
        elif c < 56:
            is_wizard[c, 0] = 1.0
        else:
            is_jester[c, 0] = 1.0
    static = np.concatenate([suit_onehot, value_norm, is_wizard, is_jester], axis=1)
    return static, suit_onehot


class ActorCritic(nn.Module):
    def __init__(self, obs_dim=300, n_actions=60, num_players=3, d=64, n_heads=4, n_layers=2):
        super().__init__()
        self.num_players = num_players
        static, colored_suit = _static_card_features()
        self.register_buffer("static_feats", torch.tensor(static))      # (60, 7)
        self.register_buffer("colored_suit", torch.tensor(colored_suit))  # (60, 4)

        n_dynamic, n_static, n_global = 5, 7, 15
        self.card_proj = _ortho(nn.Linear(n_dynamic + n_static, d))
        self.global_proj = _ortho(nn.Linear(n_global, d))
        layer = nn.TransformerEncoderLayer(d_model=d, nhead=n_heads, dim_feedforward=2 * d,
                                           dropout=0.0, batch_first=True)
        self.encoder = nn.TransformerEncoder(layer, num_layers=n_layers)

        self.play_head = _ortho(nn.Linear(d, 1), gain=0.01)             # per-card logit
        self.bid_head = nn.Sequential(_ortho(nn.Linear(d, d)), nn.ReLU(),
                                      _ortho(nn.Linear(d, n_actions), gain=0.01))

        # Centralized critic: sees ALL hands (num_players * 60) plus public scalars.
        critic_in = num_players * 60 + n_global
        self.critic = nn.Sequential(
            _ortho(nn.Linear(critic_in, 256)), nn.ReLU(),
            _ortho(nn.Linear(256, 256)), nn.ReLU(),
            _ortho(nn.Linear(256, 1), gain=1.0),
        )

    # -- actor -------------------------------------------------------------- #
    def _encode(self, obs):
        b = obs.shape[0]
        is_trump = obs[:, TRUMP_ONEHOT] @ self.colored_suit.t()        # (b, 60)
        dynamic = torch.stack(
            [obs[:, HAND], obs[:, SEEN], obs[:, TRICK], obs[:, TAKES_TRICK], is_trump], dim=-1)
        static = self.static_feats.unsqueeze(0).expand(b, -1, -1)
        card_tokens = self.card_proj(torch.cat([dynamic, static], dim=-1))  # (b, 60, d)

        global_in = torch.cat([obs[:, GLOBAL_SCALARS], obs[:, FOLLOWING]], dim=-1)
        global_token = self.global_proj(global_in).unsqueeze(1)         # (b, 1, d)

        tokens = torch.cat([global_token, card_tokens], dim=1)          # (b, 61, d)
        enc = self.encoder(tokens)
        return enc[:, 0], enc[:, 1:]                                    # global summary, card embeddings

    def _logits(self, obs, action_mask):
        global_emb, card_emb = self._encode(obs)
        play_logits = self.play_head(card_emb).squeeze(-1)             # (b, 60)
        bid_logits = self.bid_head(global_emb)                        # (b, 60)
        is_bidding = (obs[:, BIDDING_FLAG] > 0.5).unsqueeze(-1)
        logits = torch.where(is_bidding, bid_logits, play_logits)
        return logits.masked_fill(~action_mask, ILLEGAL_LOGIT)

    # -- critic ------------------------------------------------------------- #
    def critic_value(self, global_state):
        return self.critic(global_state).squeeze(-1)

    # -- API used by training / inference ----------------------------------- #
    def forward(self, obs, action_mask, global_state):
        logits = self._logits(obs, action_mask)
        dist = Categorical(logits=logits)
        action = dist.sample()
        value = self.critic_value(global_state)
        return action, dist.log_prob(action), dist.entropy(), value

    def evaluate_actions(self, obs, action_mask, actions, global_state):
        logits = self._logits(obs, action_mask)
        dist = Categorical(logits=logits)
        value = self.critic_value(global_state)
        return dist.log_prob(actions), dist.entropy(), value

    @torch.no_grad()
    def act_greedy(self, obs, action_mask):
        """Inference: actor only (no global state needed)."""
        return torch.argmax(self._logits(obs, action_mask), dim=-1)

    # audit.py compatibility (expects (_, logits))
    def _features_and_logits(self, obs, action_mask):
        return None, self._logits(obs, action_mask)
