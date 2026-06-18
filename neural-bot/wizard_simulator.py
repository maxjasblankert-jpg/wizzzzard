"""Wizard card game simulator optimized for reinforcement-learning training.

This module implements the full Wizard trick-taking game (bidding, trump
selection, trick play, scoring) for an *agent* (player 0) versus a single
rule-based opponent (player 1). It is the environment only -- there is no ML
code here.

Design goals
------------
* Cards are plain integers 0..59 (no Card objects, no dicts).
* A single pre-allocated float32 observation array of shape (300,) is written
  in place every step -- no per-step heap allocations on the hot path.
* All dealing / trick evaluation uses integer arithmetic or vectorized numpy.

Card encoding (integer id 0..59)
--------------------------------
    0..12   suit 0 (Blue)   values 1..13
    13..25  suit 1 (Red)    values 1..13
    26..38  suit 2 (Green)  values 1..13
    39..51  suit 3 (Yellow) values 1..13
    52..55  Wizards   (always win; first one played takes the trick)
    56..59  Jesters   (always lose; first one played wins only if all Jesters)

Observation layout (indices into the (300,) array)
---------------------------------------------------
    [0:60]    hand of the agent (binary)
    [60:120]  cards seen this round, i.e. already played + the flipped trump
              indicator card (binary)
    [120:180] cards in the current trick (binary)
    [180:184] trump suit one-hot (all zeros if there is no trump)
    [184]     round number / 20
    [185]     position in the trick (0.0 if leading, 0.5 if second of two)
    [186]     agent bid / 20
    [187]     agent tricks taken / 20
    [188]     (agent bid - agent taken) / 20
    [189:191] opponent bids / 20   (slot 0 = player 1, slot 1 reserved)
    [191:193] opponent tricks taken / 20
    [193]     bidding-phase flag (1.0 during bidding, 0.0 during play)
    [194:300] reserved zeros for future expansion

Typical RL driving loop
-----------------------
    sim = WizardSimulator()
    sim.reset(seed=0)
    while not sim.done:
        if sim.phase == WizardSimulator.BIDDING:
            obs = sim.get_bid_observation()
            bid = policy_bid(obs, sim.legal_bids())
            sim.place_bid(bid)
        else:
            obs = sim.get_observation()
            mask = sim.get_action_mask()          # bool (60,)
            card = policy_play(obs, mask)
            reward, done = sim.play_card(card)
"""

from __future__ import annotations

import time

import numpy as np

__all__ = [
    "WizardSimulator",
    "RuleBasedOpponent",
    "evaluate_trick_winner",
    "card_suit",
    "card_value",
    "is_wizard",
    "is_jester",
]

# --------------------------------------------------------------------------- #
# Constants                                                                    #
# --------------------------------------------------------------------------- #
NUM_SUITS = 4
CARDS_PER_SUIT = 13
NUM_COLORED = NUM_SUITS * CARDS_PER_SUIT  # 52
DECK_SIZE = 60
WIZARD_LO, WIZARD_HI = 52, 56  # ids 52..55
JESTER_LO = 56                 # ids 56..59
OBS_SIZE = 300
NORM = 20.0                    # normalization divisor for round / bid / taken

# Pre-computed per-card property tables (indexed by card id) for vectorized use.
_IDS = np.arange(DECK_SIZE, dtype=np.int64)
CARD_IS_WIZARD = (_IDS >= WIZARD_LO) & (_IDS < WIZARD_HI)
CARD_IS_JESTER = _IDS >= JESTER_LO
# Colored cards expose a suit (0..3) and value (1..13); specials get -1 / 0.
CARD_SUIT_ARR = np.where(_IDS < NUM_COLORED, _IDS // CARDS_PER_SUIT, -1).astype(np.int64)
CARD_VALUE_ARR = np.where(_IDS < NUM_COLORED, (_IDS % CARDS_PER_SUIT) + 1, 0).astype(np.int64)


# --------------------------------------------------------------------------- #
# Single-card helper functions (pure integer arithmetic)                       #
# --------------------------------------------------------------------------- #
def card_suit(c: int) -> int:
    """Suit 0..3 for a colored card, or -1 for a Wizard/Jester (no suit)."""
    return c // CARDS_PER_SUIT if c < NUM_COLORED else -1


def card_value(c: int) -> int:
    """Face value 1..13 for a colored card, or 0 for a Wizard/Jester."""
    return (c % CARDS_PER_SUIT) + 1 if c < NUM_COLORED else 0


def is_wizard(c: int) -> bool:
    return WIZARD_LO <= c < WIZARD_HI


def is_jester(c: int) -> bool:
    return c >= JESTER_LO


def _strength(c: int, trump: int) -> int:
    """Total ordering used by the opponent to pick 'highest' / 'lowest' cards.

    Jester < any colored card (by value) < any trump card (by value) < Wizard.
    """
    if is_jester(c):
        return 0
    if is_wizard(c):
        return 1000
    v = card_value(c)
    if trump >= 0 and card_suit(c) == trump:
        return 100 + v
    return v


def _count_beaters(card: int, unseen: np.ndarray, trump: int) -> int:
    """Number of still-unseen cards that would beat ``card`` in a contested trick.

    Used to detect a 'boss' card -- one that no unseen card can beat, i.e. a
    guaranteed trick winner if led. A non-trump card can be beaten by a Wizard,
    ANY trump (the opponent might be void and ruff), or a higher card of its suit.
    """
    if is_wizard(card):
        return 0  # nothing beats a Wizard
    v = card_value(card)
    s = card_suit(card)
    if trump >= 0 and s == trump:
        mask = unseen & (CARD_IS_WIZARD | ((CARD_SUIT_ARR == trump) & (CARD_VALUE_ARR > v)))
    elif trump >= 0:
        mask = unseen & (CARD_IS_WIZARD | (CARD_SUIT_ARR == trump) | ((CARD_SUIT_ARR == s) & (CARD_VALUE_ARR > v)))
    else:
        mask = unseen & (CARD_IS_WIZARD | ((CARD_SUIT_ARR == s) & (CARD_VALUE_ARR > v)))
    return int(np.count_nonzero(mask))


# --------------------------------------------------------------------------- #
# Trick winner evaluation (works directly on integer card ids)                 #
# --------------------------------------------------------------------------- #
def evaluate_trick_winner(trick_order, trick_players, trick_len, trump):
    """Return the player id that wins a (possibly partial) trick.

    Parameters use parallel arrays in play order:
        trick_order[i]   -> card id played i-th
        trick_players[i] -> player id who played it
        trick_len        -> number of valid entries
        trump            -> trump suit 0..3, or -1 for no trump

    Wizard / Jester rules:
      1. The FIRST Wizard played always wins (it has no suit and beats all).
      2. Otherwise the lead suit is set by the first non-Jester card. If every
         card is a Jester, the leader (first card) wins.
      3. Among the remaining cards, trump beats the lead suit beats everything
         else; ties broken by face value. Off-suit non-trump cards cannot win.

    The loop runs over at most `num_players` cards (2 here), so a small explicit
    loop over integers is faster than numpy's per-call overhead.
    """
    # 1. First Wizard wins outright.
    for i in range(trick_len):
        if is_wizard(int(trick_order[i])):
            return int(trick_players[i])

    # 2. Lead suit = suit of the first non-Jester card.
    lead = -1
    for i in range(trick_len):
        c = int(trick_order[i])
        if not is_jester(c):
            lead = card_suit(c)
            break
    if lead == -1:
        # All cards were Jesters -> the leader wins.
        return int(trick_players[0])

    # 3. Highest trump wins; else highest lead-suit card.
    best_player = int(trick_players[0])
    best_value = -1
    best_is_trump = False
    for i in range(trick_len):
        c = int(trick_order[i])
        if is_jester(c):
            continue  # Jesters can never win a contested trick
        s = card_suit(c)
        v = card_value(c)
        if trump >= 0 and s == trump:
            if not best_is_trump or v > best_value:
                best_is_trump = True
                best_value = v
                best_player = int(trick_players[i])
        elif not best_is_trump and s == lead:
            if v > best_value:
                best_value = v
                best_player = int(trick_players[i])
    return best_player


# --------------------------------------------------------------------------- #
# Rule-based opponent                                                          #
# --------------------------------------------------------------------------- #
class RuleBasedOpponent:
    """Heuristic opponent with card-counting bids and trick-by-trick control.

    Two ideas drive its strength (both validated empirically against a random
    agent: ~37% exact-bid rate vs. ~12% for a naive strong-card-count player):

    Bidding -- "average domination".
        Expected tricks ~ (1 / U) * sum over my cards of (# unseen cards that
        card beats), where U is the size of the unseen pool. Under random
        matching of my cards against the single opponent's hand this is the
        expected number of tricks I take. For a random hand it centers on
        round/2 -- the correct anchor for a 2-player game -- and shifts up or
        down with hand strength. A naive "count Wizards + high trumps" estimate
        is tuned for many players and badly *under*-bids heads-up.

    Playing -- minimal-commitment trick control.
        When it still needs tricks it wins as cheaply as possible (lowest
        sufficient card; leads a counted 'boss' card if it has one, otherwise
        its strongest card while saving Wizards). When it has met its bid it
        sheds toward losing (Jester first, then the highest card that still
        loses, dumping danger safely).

    All methods receive the live simulator plus the player id they control and
    read game state directly; the (300,) observation array is agent-centric and
    is *not* used here. ``sim.bids`` / ``sim.taken`` are public information in
    Wizard, so reading them is fair play.
    """

    def choose_bid(self, sim: "WizardSimulator", player: int) -> int:
        hand = sim.hands[player]
        trump = sim.trump
        r = sim.round
        unseen = ~hand & ~sim.seen  # cards in the opponent's hand or the stock
        U = int(np.count_nonzero(unseen))
        if U == 0:  # degenerate; only Wizards are sure things
            return min(r, int(np.count_nonzero(hand & CARD_IS_WIZARD)))

        # Category counts over the unseen pool, computed once.
        n_jest = int(np.count_nonzero(unseen & CARD_IS_JESTER))
        n_wiz = int(np.count_nonzero(unseen & CARD_IS_WIZARD))
        if trump >= 0:
            u_trump = unseen & (CARD_SUIT_ARR == trump)
            u_nontrump_colored = unseen & (CARD_SUIT_ARR >= 0) & (CARD_SUIT_ARR != trump)
        else:
            u_trump = np.zeros_like(unseen)
            u_nontrump_colored = unseen & (CARD_SUIT_ARR >= 0)
        n_nontrump_colored = int(np.count_nonzero(u_nontrump_colored))

        # A card that beats fraction f = dominated/U of the unseen pool wins its trick
        # only if it beats every one of the N-1 opponents in that trick, ~ f**(N-1).
        # Summing that over the hand self-calibrates to round/N for an average hand
        # (E[f**(N-1)] = 1/N for f ~ Uniform[0,1]). For 2 players (exponent 1) this is
        # exactly the original sum/U, so heads-up bidding is unchanged.
        n_opp = sim.num_players - 1
        dom_sum = 0.0       # used for the exact 2-player path
        powered = 0.0       # used for 3+ players
        for c in np.flatnonzero(hand):
            c = int(c)
            if is_wizard(c):
                dom_c = U - 0.5 * n_wiz             # beats everything, ties other Wizards
            elif is_jester(c):
                dom_c = 0.5 * n_jest                # only ties other Jesters
            else:
                v = card_value(c)
                s = card_suit(c)
                if trump >= 0 and s == trump:
                    lower_trump = int(np.count_nonzero(u_trump & (CARD_VALUE_ARR < v)))
                    dom_c = n_jest + n_nontrump_colored + lower_trump
                else:
                    lower_same = int(np.count_nonzero(unseen & (CARD_SUIT_ARR == s) & (CARD_VALUE_ARR < v)))
                    same_suit = int(np.count_nonzero(u_nontrump_colored & (CARD_SUIT_ARR == s)))
                    # Beats lower same-suit & all Jesters; off-suit colored is a coin flip.
                    dom_c = n_jest + lower_same + 0.5 * (n_nontrump_colored - same_suit)
            dom_sum += dom_c
            if n_opp != 1:
                powered += (dom_c / U) ** n_opp

        expected_tricks = (dom_sum / U) if n_opp == 1 else powered
        return max(0, min(int(round(expected_tricks)), r))

    def choose_card(self, sim: "WizardSimulator", player: int) -> int:
        legal = sim.legal_cards()
        trump = sim.trump
        want_to_win = (sim.bids[player] - sim.taken[player]) > 0

        if sim.trick_len == 0:
            return self._lead(sim, player, legal, want_to_win, trump)

        # Following: in a 2-player trick the outcome of each candidate is exact.
        if want_to_win:
            winners = [c for c in legal if sim._would_win(player, c)]
            if winners:
                non_wizard = [c for c in winners if not is_wizard(c)]
                pool = non_wizard if non_wizard else winners
                return min(pool, key=lambda c: _strength(c, trump))   # cheapest sufficient win
            return min(legal, key=lambda c: _strength(c, trump))       # can't win -> shed lowest

        losers = [c for c in legal if not sim._would_win(player, c)]
        if losers:
            return max(losers, key=lambda c: _strength(c, trump))      # shed highest SAFE card
        return min(legal, key=lambda c: _strength(c, trump))           # forced to win -> cheapest

    def _lead(self, sim: "WizardSimulator", player: int, legal, want_to_win: bool, trump: int) -> int:
        """Choose a card to lead a fresh trick."""
        if want_to_win:
            unseen = ~sim.hands[player] & ~sim.seen
            # A 'boss' card no unseen card can beat is a guaranteed trick.
            guaranteed = [c for c in legal if not is_jester(c) and _count_beaters(c, unseen, trump) == 0]
            if guaranteed:
                non_wizard = [c for c in guaranteed if not is_wizard(c)]
                pool = non_wizard if non_wizard else guaranteed
                return min(pool, key=lambda c: _strength(c, trump))   # cheapest sure winner
            # No sure winner -> lead strong to maximize the chance, but save Wizards.
            colored = [c for c in legal if not is_wizard(c) and not is_jester(c)]
            if colored:
                return max(colored, key=lambda c: _strength(c, trump))
            wiz = [c for c in legal if is_wizard(c)]
            return wiz[0] if wiz else legal[0]

        # Met the bid: lead toward losing.
        jesters = [c for c in legal if is_jester(c)]
        if jesters:
            return jesters[0]
        return min(legal, key=lambda c: _strength(c, trump))


# --------------------------------------------------------------------------- #
# The game engine                                                              #
# --------------------------------------------------------------------------- #
class WizardSimulator:
    """Internal Wizard engine: agent (player 0) vs. a rule-based opponent.

    The engine auto-plays the opponent's bids and cards so the external RL loop
    only ever makes decisions for the agent. ``play_card`` / ``place_bid`` drive
    the opponent internally until it is the agent's turn again.
    """

    BIDDING = 0
    PLAYING = 1

    def __init__(self, num_players: int = 2, opponent: RuleBasedOpponent | None = None,
                 max_rounds: int | None = None, seed: int | None = None,
                 misere: bool = False, random_dealer: bool = False):
        assert num_players >= 2
        self.num_players = num_players
        self.deck_size = DECK_SIZE
        # Standard Wizard plays deck_size // num_players rounds (30 for 2 players).
        # Features that divide by NORM=20 may exceed 1.0 in late rounds; pass a
        # smaller ``max_rounds`` to keep every normalized feature within [0, 1].
        self.max_rounds = max_rounds if max_rounds is not None else self.deck_size // num_players
        # Official-rule options (off by default so v1-v5 stay reproducible):
        #   misere        -- the dealer may not bid the number that makes total bids
        #                    equal the trick count ("someone must be wrong").
        #   random_dealer -- round 1's dealer is random (then rotates), vs. always seat 0.
        self.misere = misere
        self.random_dealer = random_dealer
        self.first_dealer = 0
        self.opponent = opponent if opponent is not None else RuleBasedOpponent()
        self.rng = np.random.default_rng(seed)

        # ---- pre-allocated buffers (never re-allocated during a rollout) ---- #
        self.obs = np.zeros(OBS_SIZE, dtype=np.float32)
        self.hands = np.zeros((num_players, DECK_SIZE), dtype=bool)  # in-hand mask
        self.seen = np.zeros(DECK_SIZE, dtype=bool)                  # played + trump card
        self.trick_mask = np.zeros(DECK_SIZE, dtype=bool)           # cards in current trick
        self._action_mask = np.zeros(DECK_SIZE, dtype=bool)
        self.deck = np.arange(DECK_SIZE, dtype=np.int64)            # shuffled in place
        self.trick_order = np.zeros(num_players, dtype=np.int64)    # cards in play order
        self.trick_players = np.zeros(num_players, dtype=np.int64)
        self.bids = np.zeros(num_players, dtype=np.int64)
        self.taken = np.zeros(num_players, dtype=np.int64)
        self.scores = np.zeros(num_players, dtype=np.int64)         # cumulative game score

        # ---- mutable scalar state (set up in reset) ---- #
        self.round = 0
        self.trump = -1
        self.trump_card = -1
        self.phase = self.BIDDING
        self.done = False
        self.current_player = 0
        self.current_bidder = 0
        self.trick_len = 0
        self.tricks_played = 0
        self.dealer = 0
        self.starter = 0
        self._bids_placed = 0

    # ------------------------------------------------------------------ #
    # Episode lifecycle                                                  #
    # ------------------------------------------------------------------ #
    def reset(self, seed: int | None = None) -> None:
        """Start a fresh game. Deals round 1 and runs any pre-agent bidding."""
        if seed is not None:
            self.rng = np.random.default_rng(seed)
        self.scores[:] = 0
        self.round = 0
        self.done = False
        # Round 1's dealer; clockwise rotation each round is applied from here.
        self.first_dealer = int(self.rng.integers(self.num_players)) if self.random_dealer else 0
        self._next_round()

    def _next_round(self) -> None:
        """Advance to the next round, or end the game once all rounds are done."""
        self.round += 1
        if self.round > self.max_rounds:
            self.done = True
            return
        self._deal_and_setup()

    def _deal_and_setup(self) -> None:
        """Shuffle, deal ``round`` cards each, flip trump, and open bidding."""
        r = self.round
        self.rng.shuffle(self.deck)  # in-place Fisher-Yates, no allocation

        self.hands[:] = False
        self.seen[:] = False
        self.trick_mask[:] = False

        idx = 0
        for p in range(self.num_players):
            self.hands[p, self.deck[idx:idx + r]] = True
            idx += r

        # Trump indicator = next card off the deck (if any remain).
        if idx < self.deck_size:
            trump_card = int(self.deck[idx])
            self.seen[trump_card] = True  # the flipped card is public information
            self.trump_card = trump_card
            if is_wizard(trump_card) or is_jester(trump_card):
                self.trump = -1                            # explicit no-trump round
            else:
                self.trump = card_suit(trump_card)
        else:
            # Final round: every card dealt, nothing left to flip -> no trump.
            self.trump = -1
            self.trump_card = -1

        self.bids[:] = 0
        self.taken[:] = 0
        self.tricks_played = 0
        self.dealer = (self.first_dealer + self.round - 1) % self.num_players
        self.starter = (self.dealer + 1) % self.num_players  # left of dealer starts
        self.phase = self.BIDDING
        self.current_bidder = self.starter
        self._bids_placed = 0
        self._auto_bid()  # let opponents who bid before the agent act now

    def _dealer_choose_trump(self) -> int:
        """Heuristic used when a Wizard is flipped: dealer names its longest suit."""
        dealer_hand = self.hands[self.dealer]
        counts = [int(np.count_nonzero(dealer_hand & (CARD_SUIT_ARR == s))) for s in range(NUM_SUITS)]
        return int(np.argmax(counts))

    # ------------------------------------------------------------------ #
    # Bidding phase                                                      #
    # ------------------------------------------------------------------ #
    def legal_bids(self) -> list[int]:
        """Legal bids 0..round, minus the dealer's forbidden 'balancing' bid (Misère).

        The dealer bids last, so when it is the dealer's turn every other bid is in;
        the forbidden value is the one that would make the bids total the trick count.
        """
        bids = list(range(self.round + 1))
        if self.misere and self.current_bidder == self.dealer:
            forbidden = self.round - int(self.bids.sum())  # dealer's own bid is still 0
            if 0 <= forbidden <= self.round:
                bids.remove(forbidden)
        return bids

    def place_bid(self, bid: int) -> None:
        """Record the agent's bid, then drive remaining opponent bids / play."""
        assert self.phase == self.BIDDING and self.current_bidder == 0
        assert bid in self.legal_bids()
        self._record_bid(0, bid)
        self._auto_bid()  # opponents seated after the agent bid now

    def _record_bid(self, player: int, bid: int) -> None:
        self.bids[player] = bid
        self._bids_placed += 1
        self.current_bidder = (self.current_bidder + 1) % self.num_players
        if self._bids_placed == self.num_players:
            self._begin_play()

    def _auto_bid(self) -> None:
        """Let every opponent whose turn comes before the agent bid automatically."""
        while self.phase == self.BIDDING and self.current_bidder != 0:
            b = self.opponent.choose_bid(self, self.current_bidder)
            legal = self.legal_bids()
            if b not in legal:                       # respect the Misère restriction
                b = min(legal, key=lambda x: abs(x - b))
            self._record_bid(self.current_bidder, b)

    # ------------------------------------------------------------------ #
    # Play phase                                                         #
    # ------------------------------------------------------------------ #
    def _begin_play(self) -> None:
        self.phase = self.PLAYING
        self.trick_len = 0
        self.trick_mask[:] = False
        self.current_player = self.starter
        # If the opponent leads the first trick, play its lead so the agent sees
        # it before deciding. (For 2 players this never resolves a trick here.)
        self._auto_play()

    def _lead_suit(self) -> int:
        """Suit the current player must follow, or -1 if free to play anything.

        A Wizard lead frees everyone; Jesters are skipped until a colored card
        establishes the lead suit.
        """
        for i in range(self.trick_len):
            c = int(self.trick_order[i])
            if is_wizard(c):
                return -1
            if is_jester(c):
                continue
            return card_suit(c)
        return -1

    def legal_cards(self) -> list[int]:
        """Legal card ids for the current player (must follow suit if able)."""
        return np.flatnonzero(self._legal_mask()).tolist()

    def get_action_mask(self) -> np.ndarray:
        """Bool array (60,) marking legal cards for the current player (no copy)."""
        np.copyto(self._action_mask, self._legal_mask())
        return self._action_mask

    def _legal_mask(self) -> np.ndarray:
        """Vectorized legality: follow-suit cards plus Wizards/Jesters always legal."""
        hand = self.hands[self.current_player]
        lead = self._lead_suit()
        if lead < 0:
            return hand
        suit_mask = hand & (CARD_SUIT_ARR == lead)
        if suit_mask.any():
            # Must follow suit, but Wizards and Jesters may always be played.
            return suit_mask | (hand & CARD_IS_WIZARD) | (hand & CARD_IS_JESTER)
        return hand  # void in the lead suit -> anything goes

    def _would_win(self, player: int, card: int) -> bool:
        """Whether ``player`` would win the trick by playing ``card`` right now.

        Writes into the scratch slot at index ``trick_len`` (valid because the
        trick is not yet full); ``trick_len`` itself is left unchanged.
        """
        n = self.trick_len
        self.trick_order[n] = card
        self.trick_players[n] = player
        return evaluate_trick_winner(self.trick_order, self.trick_players, n + 1, self.trump) == player

    def play_card(self, card_id: int) -> tuple[float, bool]:
        """Play the agent's card, auto-resolve, drive the opponent, return reward.

        Returns ``(reward, done)`` where ``reward`` is shaped from the agent's
        perspective and accumulates everything that happens until control returns
        to the agent (the opponent's response, trick resolution, round scoring).
        """
        assert not self.done
        assert self.phase == self.PLAYING and self.current_player == 0
        assert self.hands[0, card_id], "illegal card: not in hand"

        reward = self._apply_and_resolve(0, card_id)
        reward += self._auto_play()
        return reward, self.done

    def _auto_play(self) -> float:
        """Play opponent cards until it is the agent's turn (or the game ends)."""
        reward = 0.0
        while (not self.done) and self.phase == self.PLAYING and self.current_player != 0:
            c = self.opponent.choose_card(self, self.current_player)
            reward += self._apply_and_resolve(self.current_player, c)
        return reward

    def _apply_and_resolve(self, player: int, card: int) -> float:
        """Place one card; if the trick (and maybe round) completes, settle it.

        Returns the agent-perspective shaped reward generated by this play.
        """
        # Move the card from hand -> trick, and mark it seen.
        self.hands[player, card] = False
        self.seen[card] = True
        self.trick_mask[card] = True
        self.trick_order[self.trick_len] = card
        self.trick_players[self.trick_len] = player
        self.trick_len += 1

        if self.trick_len < self.num_players:
            self.current_player = (player + 1) % self.num_players
            return 0.0  # trick not complete yet

        # ---- trick complete: determine the winner ---- #
        winner = evaluate_trick_winner(self.trick_order, self.trick_players, self.trick_len, self.trump)

        reward = 0.0
        if winner == 0:
            # Shaping: did taking this trick move the agent toward or past its bid?
            before = abs(self.bids[0] - self.taken[0])
            self.taken[0] += 1
            after = abs(self.bids[0] - self.taken[0])
            if after < before:
                reward += 0.1
            elif after > before:
                reward -= 0.1
        else:
            self.taken[winner] += 1

        # Reset trick state; the winner leads the next trick.
        self.trick_mask[:] = False
        self.trick_len = 0
        self.tricks_played += 1
        self.current_player = winner

        if self.tricks_played == self.round:
            reward += self._end_round()
        return reward

    def _end_round(self) -> float:
        """Score the finished round, advance to the next, return shaped reward."""
        b = int(self.bids[0])
        t = int(self.taken[0])
        if b == t:
            reward = 1.0
        else:
            reward = -0.1 * abs(b - t)

        # Standard Wizard scoring for the game scoreboard (all players).
        for p in range(self.num_players):
            if self.bids[p] == self.taken[p]:
                self.scores[p] += 20 + 10 * int(self.taken[p])
            else:
                self.scores[p] += -10 * abs(int(self.bids[p]) - int(self.taken[p]))

        self._next_round()  # sets up bidding for the next round, or ends the game
        return reward

    # ------------------------------------------------------------------ #
    # Observations                                                       #
    # ------------------------------------------------------------------ #
    def _write_obs(self, player: int, position: float, bidding_flag: float) -> np.ndarray:
        """Fill the shared (300,) buffer from ``player``'s perspective and return it.

        For ``player == 0`` this is byte-identical to the original 2-player encoding;
        for other seats it swaps in that seat's hand/bid/taken and lists the remaining
        seats (in turn order) in the opponent slots -- enabling self-play, where a
        single policy must act from every seat.
        """
        o = self.obs
        o[0:60] = self.hands[player]
        o[60:120] = self.seen
        o[120:180] = self.trick_mask
        o[180:184] = 0.0
        if self.trump >= 0:
            o[180 + self.trump] = 1.0
        o[184] = self.round / NORM
        o[185] = position
        o[186] = self.bids[player] / NORM
        o[187] = self.taken[player] / NORM
        o[188] = (self.bids[player] - self.taken[player]) / NORM
        o[189:193] = 0.0
        # Opponent slots: the next seats in turn order after `player` (up to 2 fit).
        for slot in range(min(self.num_players - 1, 2)):
            q = (player + 1 + slot) % self.num_players
            o[189 + slot] = self.bids[q] / NORM    # 189, 190
            o[191 + slot] = self.taken[q] / NORM   # 191, 192
        o[193] = bidding_flag
        return o

    def get_observation(self, player: int = 0) -> np.ndarray:
        """Play-phase observation from ``player``'s perspective (bidding flag off)."""
        position = self.trick_len / self.num_players  # how many already played this trick
        return self._write_obs(player, position, 0.0)

    def get_bid_observation(self, player: int = 0) -> np.ndarray:
        """Bidding-phase observation from ``player``'s perspective (bidding flag on)."""
        position = ((player - self.starter) % self.num_players) / self.num_players
        return self._write_obs(player, position, 1.0)


# --------------------------------------------------------------------------- #
# Benchmark: 100 random games                                                  #
# --------------------------------------------------------------------------- #
def _run_benchmark(num_games: int = 100) -> None:
    sim = WizardSimulator()
    policy_rng = np.random.default_rng(0)  # random agent policy (separate stream)

    total_steps = 0      # one step per agent decision (bid or card)
    total_reward = 0.0
    t0 = time.perf_counter()

    for g in range(num_games):
        sim.reset(seed=g)
        while not sim.done:
            if sim.phase == WizardSimulator.BIDDING:
                bids = sim.legal_bids()
                sim.place_bid(int(policy_rng.choice(bids)))
                total_steps += 1
            else:
                sim.get_observation()           # exercise the hot path
                sim.get_action_mask()
                legal = sim.legal_cards()
                reward, _ = sim.play_card(int(policy_rng.choice(legal)))
                total_reward += reward
                total_steps += 1

    elapsed = time.perf_counter() - t0
    print(f"Games:              {num_games}")
    print(f"Average steps/game: {total_steps / num_games:.1f}")
    print(f"Average reward:     {total_reward / num_games:.3f}")
    print(f"Total time:         {elapsed:.3f} s")
    print(f"Steps per second:   {total_steps / elapsed:,.0f}")


if __name__ == "__main__":
    _run_benchmark()
