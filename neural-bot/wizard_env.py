"""Gymnasium wrapper around WizardSimulator.

The agent always controls player 0 and faces the rule-based opponent. Bidding and
trick-play are two different kinds of decisions, but the env hides that behind a
single Discrete(60) action space:

  * During the PLAY phase, action `a` means "play card id `a`" (0..59).
  * During the BID phase, action `a` means "bid `a` tricks" (0..round). Bid values
    fit inside 0..59 because a round never exceeds 20 here, so we reuse the low
    action indices for bids.

The action mask tells the policy which indices are legal for the current phase, and
obs[193] (the simulator's bidding flag) lets the network tell the two phases apart.
"""

import numpy as np
import gymnasium as gym
from gymnasium import spaces

from wizard_simulator import WizardSimulator, RuleBasedOpponent, _count_beaters

# Cap rounds at 20 so every /20-normalized observation feature stays within [0, 1],
# consistent with the declared observation_space bounds.
MAX_ROUNDS = 20

# Tactical features (v3) live in the observation's reserved zone [194:300], which is
# zeros for v1/v2. Keeping the shape at 300 means v1/v2 checkpoints stay loadable.
TAKES_TRICK_START = 194          # [194:254] per-card "playing this card takes the trick"
FOLLOWING_FLAG = 254             # 1.0 when the player is responding (not leading/bidding)


def write_tactical(sim, player, obs):
    """Fill reserved obs slots with ``player``'s core play signal, in place.

    For each card in ``player``'s hand we mark whether playing it would currently
    take the trick -- the expensive combinatorial fact a policy otherwise has to
    rediscover from raw card vectors:
      * Following -> the simulator's exact resolution against the cards already
        played (with >2 players this means "winning so far", which is honest:
        later seats may still beat it -- no future cards are leaked).
      * Leading / bidding (no trick yet) -> "boss" cards no unseen card can beat.
    """
    hand = sim.hands[player]
    trump = sim.trump
    following = sim.phase == WizardSimulator.PLAYING and sim.trick_len > 0
    unseen = ~hand & ~sim.seen
    for c in np.flatnonzero(hand):
        c = int(c)
        takes = sim._would_win(player, c) if following else (_count_beaters(c, unseen, trump) == 0)
        if takes:
            obs[TAKES_TRICK_START + c] = 1.0
    obs[FOLLOWING_FLAG] = 1.0 if following else 0.0


def build_observation(sim, player, tactical_features):
    """Observation + legal-action mask for ``player`` (must be the seat to act).

    A copy is returned because the simulator writes into pre-allocated buffers in
    place. Used both for the learning agent (seat 0) and, in self-play, for the
    league opponents acting from other seats.
    """
    if sim.phase == WizardSimulator.BIDDING:
        obs = sim.get_bid_observation(player)
        mask = np.zeros(60, dtype=bool)
        mask[sim.legal_bids()] = True              # 0..round (minus the Misère bid if dealer)
    else:
        obs = sim.get_observation(player)
        mask = sim.get_action_mask().copy()        # legal cards for the seat to act
    obs = obs.astype(np.float32).copy()
    if tactical_features:
        write_tactical(sim, player, obs)
    return obs, mask


class WizardEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, seed=None, tactical_features=False, num_players=2, opponent=None):
        super().__init__()
        self.observation_space = spaces.Box(low=0.0, high=1.0, shape=(300,), dtype=np.float32)
        self.action_space = spaces.Discrete(60)

        # When True, the env fills the reserved obs slots with derived tactical signals.
        # Off by default so v1/v2 see their original observation.
        self.tactical_features = tactical_features
        self.num_players = num_players

        # The learning agent is always seat 0; `opponent` plays the other seats. The
        # default is the rule-based heuristic; self-play injects a league player.
        opp = opponent if opponent is not None else RuleBasedOpponent()
        self.sim = WizardSimulator(opponent=opp, max_rounds=MAX_ROUNDS,
                                   num_players=num_players, seed=seed)

        # Per-episode bookkeeping (returned in info on episode end).
        self._ep_reward = 0.0
        self._ep_len = 0
        self._ep_rounds = 0       # rounds completed this game
        self._ep_hits = 0         # rounds where seat 0's bid exactly matched tricks taken

    # ------------------------------------------------------------------ #
    # Observation / mask plumbing                                        #
    # ------------------------------------------------------------------ #
    def _obs_and_mask(self):
        """Observation + legal-action mask for the agent (seat 0)."""
        return build_observation(self.sim, 0, self.tactical_features)

    def get_global_state(self):
        """Privileged global state for a centralized (oracle) critic: every player's
        hand plus the public scalars. Used only during training; never by the actor."""
        hands = self.sim.hands.astype(np.float32).reshape(-1)          # (num_players * 60,)
        o = self.sim.get_observation(0)                               # writes the shared buffer
        scalars = np.concatenate([o[180:194], o[254:255]]).astype(np.float32)  # (15,)
        return np.concatenate([hands, scalars])

    # ------------------------------------------------------------------ #
    # Gym API                                                            #
    # ------------------------------------------------------------------ #
    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        # Let a league opponent re-sample which policy plays each seat for the new game.
        on_reset = getattr(self.sim.opponent, "on_new_game", None)
        if on_reset is not None:
            on_reset()
        self.sim.reset(seed=seed)
        self._ep_reward = 0.0
        self._ep_len = 0
        self._ep_rounds = 0
        self._ep_hits = 0
        obs, mask = self._obs_and_mask()
        return obs, {"action_mask": mask}

    def step(self, action):
        action = int(action)
        # The chosen action must be legal for the current phase. The policy masks
        # illegal actions, so a violation means a bug somewhere upstream.
        _, mask = self._obs_and_mask()
        if not mask[action]:
            phase = "bidding" if self.sim.phase == WizardSimulator.BIDDING else "play"
            raise ValueError(f"illegal action {action} during {phase} phase; legal={np.flatnonzero(mask).tolist()}")

        if self.sim.phase == WizardSimulator.BIDDING:
            # Bidding yields no immediate reward and never ends the game; placing the
            # bid advances the simulator into the play phase (opponent auto-bids/leads).
            self.sim.place_bid(action)
            reward = 0.0
            terminated = False
        else:
            # Track bid accuracy: a round just ended if the round counter advanced.
            # The simulator's scoring is strictly positive on a correct bid and
            # strictly negative on a wrong one, so the score delta reveals the result.
            prev_round = self.sim.round
            prev_score = int(self.sim.scores[0])
            reward, done = self.sim.play_card(action)
            if self.sim.round != prev_round:
                self._ep_rounds += 1
                if int(self.sim.scores[0]) - prev_score > 0:
                    self._ep_hits += 1
            terminated = bool(done)

        self._ep_reward += reward
        self._ep_len += 1
        truncated = False

        info = {}
        if terminated:
            # No action is taken in a terminal state, so we return a zeros placeholder
            # (within Box bounds) and an all-True mask. The vectorized runner discards
            # both and resets before the policy acts again.
            obs = np.zeros(300, dtype=np.float32)
            mask = np.ones(60, dtype=bool)
            bid_acc = self._ep_hits / self._ep_rounds if self._ep_rounds else 0.0
            info["episode"] = {"r": self._ep_reward, "l": self._ep_len, "bid_acc": bid_acc}
        else:
            obs, mask = self._obs_and_mask()
        info["action_mask"] = mask
        return obs, reward, terminated, truncated, info
