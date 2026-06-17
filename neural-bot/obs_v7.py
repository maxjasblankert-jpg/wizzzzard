"""v7 observation: player-count-agnostic, token-structured.

Unlike the v6 flat 300-vector (hard-capped at 3 players by its 2 opponent slots), v7
encodes opponents as a *variable, padded* set so one model handles 3 AND 4 players.

Everything is packed into a single flat float32 vector per decision (so the rollout
buffer stays simple); model_v7 unpacks it back into tokens. Two builders:

  build_actor_obs(sim, seat)  -> (obs[OBS_DIM], legal_mask[60])   # decentralized actor
  build_global_state(sim, seat) -> gstate[GSTATE_DIM]             # centralized oracle critic

Layout (actor obs, OBS_DIM = 332):
  [0:300]    60 card tokens x 5 dynamic feats  [in_hand, seen, in_trick, would_win, is_trump]
  [300:314]  14 global scalars
  [314:329]  3 opponent tokens x 5 feats  [bid, taken, bid-taken, seat_offset, has_bid]
  [329:332]  3 opponent presence flags (1 = real opponent, 0 = padding)

Global state (critic, GSTATE_DIM = 258):
  [0:240]    4 player hand multi-hots (row 0 = acting seat, then opponents in turn order;
             absent players are zero rows)
  [240:244]  4 player presence flags
  [244:258]  the same 14 global scalars
"""

import numpy as np
from wizard_simulator import (
    WizardSimulator, CARD_SUIT_ARR, _count_beaters, NORM, DECK_SIZE,
)

MAX_PLAYERS = 4
K_OPP = MAX_PLAYERS - 1          # 3 opponent token slots
CARD_DYN = 5
GLOB_F = 14
OPP_F = 5

CARDS = DECK_SIZE * CARD_DYN     # 300
OBS_DIM = CARDS + GLOB_F + K_OPP * OPP_F + K_OPP            # 300+14+15+3 = 332
GSTATE_DIM = MAX_PLAYERS * DECK_SIZE + MAX_PLAYERS + GLOB_F  # 240+4+14 = 258
N_ACTIONS = 60
MAX_BID = 21                     # aux trick-count classes: 0..20


def _global_scalars(sim, seat):
    g = np.zeros(GLOB_F, dtype=np.float32)
    np_ = sim.num_players
    bidding = sim.phase == WizardSimulator.BIDDING
    if bidding:
        position = ((seat - sim.starter) % np_) / np_
    else:
        position = sim.trick_len / np_
    g[0] = sim.round / NORM
    g[1] = position
    g[2] = sim.bids[seat] / NORM
    g[3] = sim.taken[seat] / NORM
    g[4] = (sim.bids[seat] - sim.taken[seat]) / NORM
    g[5] = 1.0 if bidding else 0.0
    g[6] = 1.0 if (not bidding and sim.trick_len > 0) else 0.0          # following flag
    if sim.trump >= 0:
        g[7 + sim.trump] = 1.0                                          # trump one-hot (7:11)
    g[11] = np_ / MAX_PLAYERS
    others = [p for p in range(np_) if p != seat]
    g[12] = float(sum(int(sim.bids[p]) for p in others)) / NORM
    g[13] = (sim.round - sim.tricks_played) / NORM                      # tricks left this round
    return g


def _card_dynamic(sim, seat):
    """(60,5): in_hand, seen, in_trick, would_win, is_trump."""
    c = np.zeros((DECK_SIZE, CARD_DYN), dtype=np.float32)
    hand = sim.hands[seat]
    c[:, 0] = hand
    c[:, 1] = sim.seen
    c[:, 2] = sim.trick_mask
    if sim.trump >= 0:
        c[:, 4] = (CARD_SUIT_ARR == sim.trump).astype(np.float32)       # colored trump cards
    # would_win: following -> exact resolution now; leading/bidding -> boss (unbeatable) card
    following = sim.phase == WizardSimulator.PLAYING and sim.trick_len > 0
    unseen = ~hand & ~sim.seen
    for cid in np.flatnonzero(hand):
        cid = int(cid)
        win = sim._would_win(seat, cid) if following else (_count_beaters(cid, unseen, sim.trump) == 0)
        if win:
            c[cid, 3] = 1.0
    return c


def _legal_mask(sim, seat):
    mask = np.zeros(N_ACTIONS, dtype=bool)
    if sim.phase == WizardSimulator.BIDDING:
        mask[sim.legal_bids()] = True
    else:
        mask[:] = sim._legal_mask()        # legal cards for the current player
    return mask


def build_actor_obs(sim, seat):
    obs = np.zeros(OBS_DIM, dtype=np.float32)
    obs[0:CARDS] = _card_dynamic(sim, seat).reshape(-1)
    obs[CARDS:CARDS + GLOB_F] = _global_scalars(sim, seat)
    # opponent tokens, in turn order after `seat`
    np_ = sim.num_players
    base = CARDS + GLOB_F
    mbase = base + K_OPP * OPP_F
    for k in range(K_OPP):
        if k < np_ - 1:
            p = (seat + 1 + k) % np_
            o = base + k * OPP_F
            obs[o + 0] = sim.bids[p] / NORM
            obs[o + 1] = sim.taken[p] / NORM
            obs[o + 2] = (sim.bids[p] - sim.taken[p]) / NORM
            obs[o + 3] = ((p - seat) % np_) / np_
            # has_bid: a seat has bid if bidding is over, or it bid before `seat` this round
            bid_done = sim.phase != WizardSimulator.BIDDING
            obs[o + 4] = 1.0 if (bid_done or sim._bids_placed > ((p - sim.starter) % np_)) else 0.0
            obs[mbase + k] = 1.0
    return obs, _legal_mask(sim, seat)


def build_global_state(sim, seat=0):
    gs = np.zeros(GSTATE_DIM, dtype=np.float32)
    np_ = sim.num_players
    # hands ordered: row 0 = acting seat, then opponents in turn order
    order = [seat] + [(seat + 1 + k) % np_ for k in range(np_ - 1)]
    for row, p in enumerate(order):
        gs[row * DECK_SIZE:(row + 1) * DECK_SIZE] = sim.hands[p].astype(np.float32)
        gs[MAX_PLAYERS * DECK_SIZE + row] = 1.0
    gs[MAX_PLAYERS * DECK_SIZE + MAX_PLAYERS:] = _global_scalars(sim, seat)
    return gs
