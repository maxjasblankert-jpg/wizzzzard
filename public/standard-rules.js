/* Standard Wizard rules — 4 suits × 15 cards (1 = Jester, 2–14, 15 = Wizard) */
(function (global) {
  const DECK_SIZE = 60;
  const CARDS_PER_SUIT = 15;
  const NUM_SUITS = 4;

  /** Suit index → UI suit name */
  const SUIT_FROM_INDEX = ['blue', 'red', 'green', 'yellow'];
  const SUIT_TO_INDEX = { blue: 0, red: 1, green: 2, yellow: 3 };

  function cardSuit(id) {
    if (id < 0 || id >= DECK_SIZE) return -1;
    return Math.floor(id / CARDS_PER_SUIT);
  }

  function cardValue(id) {
    if (id < 0 || id >= DECK_SIZE) return 0;
    return (id % CARDS_PER_SUIT) + 1;
  }

  function isWizard(id) {
    return cardValue(id) === 15;
  }

  function isJester(id) {
    return cardValue(id) === 1;
  }

  function suitNameFromIndex(idx) {
    return idx >= 0 && idx < NUM_SUITS ? SUIT_FROM_INDEX[idx] : null;
  }

  function createStandardDeck() {
    const deck = [];
    for (let id = 0; id < DECK_SIZE; id++) {
      deck.push(cardObjectFromId(id));
    }
    return deck;
  }

  function cardObjectFromId(id) {
    const suitIdx = cardSuit(id);
    const suit = SUIT_FROM_INDEX[suitIdx] || 'blue';
    const value = cardValue(id);
    let cardKind = 'colored';
    if (value === 1) cardKind = 'jester';
    else if (value === 15) cardKind = 'wizard';
    const icon = value === 1
      ? '🃏'
      : value === 15
        ? '⭐'
        : ((global.CardArt && global.CardArt.getRankSymbol(suit, value)) || '◆');
    return { id, suit, value, cardKind, key: `std-${id}`, icon };
  }

  function getRoundsCount(playerCount) {
    return Math.floor(DECK_SIZE / playerCount);
  }

  function dealerChooseTrump(dealerHand) {
    const counts = [0, 0, 0, 0];
    dealerHand.forEach(c => {
      const v = c.value != null ? c.value : cardValue(c.id);
      if (v >= 2 && v <= 14) {
        const idx = c.id != null ? cardSuit(c.id) : SUIT_TO_INDEX[c.suit];
        if (idx >= 0) counts[idx]++;
      }
    });
    let best = 0;
    for (let i = 1; i < NUM_SUITS; i++) {
      if (counts[i] > counts[best]) best = i;
    }
    return best;
  }

  function resolveTrumpFromFlip(trumpCardId, dealerHand) {
    if (trumpCardId < 0 || trumpCardId >= DECK_SIZE) {
      return { trumpSuitIndex: -1, trumpCard: null, trumpSuit: null };
    }
    const trumpCard = cardObjectFromId(trumpCardId);
    if (isWizard(trumpCardId)) {
      const idx = dealerChooseTrump(dealerHand);
      return {
        trumpSuitIndex: idx,
        trumpCard,
        trumpSuit: suitNameFromIndex(idx)
      };
    }
    if (isJester(trumpCardId)) {
      return { trumpSuitIndex: -1, trumpCard, trumpSuit: null };
    }
    const idx = cardSuit(trumpCardId);
    return {
      trumpSuitIndex: idx,
      trumpCard,
      trumpSuit: suitNameFromIndex(idx)
    };
  }

  function getTrickLeadSuit(trick, trumpSuitIndex) {
    for (const entry of trick) {
      const id = entry.card.id != null ? entry.card.id : -1;
      if (id < 0) continue;
      const v = cardValue(id);
      if (v === 1 || v === 15) continue;
      return cardSuit(id);
    }
    return -1;
  }

  function evaluateTrickWinner(trick, trumpSuitIndex) {
    if (!trick || trick.length === 0) return null;
    const trump = trumpSuitIndex != null ? trumpSuitIndex : -1;

    let lastWizard = null;
    for (let i = 0; i < trick.length; i++) {
      if (isWizard(trick[i].card.id)) lastWizard = trick[i];
    }
    if (lastWizard) return lastWizard;

    const allOnes = trick.every(t => cardValue(t.card.id) === 1);
    if (allOnes) {
      if (trump >= 0) {
        const trumpOne = trick.find(t => cardSuit(t.card.id) === trump);
        if (trumpOne) return trumpOne;
      }
      return trick[0];
    }

    let lead = -1;
    for (let i = 0; i < trick.length; i++) {
      const v = cardValue(trick[i].card.id);
      if (v >= 2 && v <= 14) {
        lead = cardSuit(trick[i].card.id);
        break;
      }
    }
    if (lead === -1) return trick[0];

    let best = trick[0];
    let bestValue = -1;
    let bestIsTrump = false;

    for (let i = 0; i < trick.length; i++) {
      const id = trick[i].card.id;
      const v = cardValue(id);
      if (v === 1 || v === 15) continue;
      const s = cardSuit(id);
      if (trump >= 0 && s === trump) {
        if (!bestIsTrump || v > bestValue) {
          bestIsTrump = true;
          bestValue = v;
          best = trick[i];
        }
      } else if (!bestIsTrump && s === lead) {
        if (v > bestValue) {
          bestValue = v;
          best = trick[i];
        }
      }
    }
    return best;
  }

  function getLegalBidValues(round) {
    const bids = [];
    for (let b = 0; b <= round; b++) bids.push(b);
    return bids;
  }

  function getLegalCardIds(hand, trick, trumpSuitIndex) {
    const ids = hand.map(c => c.id).filter(id => id != null && id >= 0 && id < DECK_SIZE);
    if (!trick || trick.length === 0) return ids;

    const lead = getTrickLeadSuit(trick, trumpSuitIndex);
    if (lead < 0) return ids;

    const followSuit = ids.filter(id => {
      const v = cardValue(id);
      return v >= 2 && v <= 14 && cardSuit(id) === lead;
    });
    if (followSuit.length > 0) {
      const wizards = ids.filter(isWizard);
      const jesters = ids.filter(isJester);
      return [...followSuit, ...wizards, ...jesters];
    }
    return ids;
  }

  function canPlayCard(hand, card, trick, trumpSuitIndex) {
    const legal = getLegalCardIds(hand, trick, trumpSuitIndex);
    return legal.includes(card.id);
  }

  function sortStandardHand(hand) {
    const group = (c) => {
      const v = c.value != null ? c.value : cardValue(c.id);
      if (v === 1) return 0;
      if (v === 15) return 2;
      return 1;
    };
    return [...hand].sort((a, b) => {
      const ga = group(a);
      const gb = group(b);
      if (ga !== gb) return ga - gb;
      if (ga === 1) {
        const sa = cardSuit(a.id);
        const sb = cardSuit(b.id);
        if (sa !== sb) return sa - sb;
        return a.value - b.value;
      }
      const sa = cardSuit(a.id);
      const sb = cardSuit(b.id);
      if (sa !== sb) return sa - sb;
      return a.id - b.id;
    });
  }

  function collectSeenCardIds(room, handsById) {
    const seen = new Set();
    const round = room.currentRound;
    if (room.trumpCard && room.trumpCard.id != null && room.trumpCard.id >= 0) {
      seen.add(room.trumpCard.id);
    }
    (room.trickWinnerHistory || []).forEach(t => {
      if (t.round !== round) return;
      (t.cardsPlayed || []).forEach(p => {
        if (p.card && p.card.id != null) seen.add(p.card.id);
      });
    });
    (room.currentTrick || []).forEach(p => {
      if (p.card && p.card.id != null) seen.add(p.card.id);
    });
    return [...seen];
  }

  function stripUndefined(obj) {
    if (obj == null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(stripUndefined);
    const out = {};
    Object.keys(obj).forEach(k => {
      const v = stripUndefined(obj[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }

  function formatTrumpAnnouncement(trumpCard, trumpSuit, trumpSuitIndex) {
    if (!trumpCard || trumpCard.id == null || trumpCard.id < 0) {
      return 'Final round — no trump card flipped.';
    }
    if (isWizard(trumpCard.id)) {
      const name = suitNameFromIndex(trumpSuitIndex) || 'unknown';
      return `Wizard flipped for trump — dealer chose ${name} as trump suit.`;
    }
    if (isJester(trumpCard.id)) {
      return 'Jester flipped — no trump this round.';
    }
    return `Trump card: ${trumpCard.value} of ${trumpSuit} — ${trumpSuit} is trump.`;
  }

  global.StandardRules = {
    DECK_SIZE,
    CARDS_PER_SUIT,
    SUIT_FROM_INDEX,
    SUIT_TO_INDEX,
    isWizard,
    isJester,
    cardSuit,
    cardValue,
    suitNameFromIndex,
    createStandardDeck,
    cardObjectFromId,
    getRoundsCount,
    dealerChooseTrump,
    resolveTrumpFromFlip,
    getTrickLeadSuit,
    evaluateTrickWinner,
    getLegalBidValues,
    getLegalCardIds,
    canPlayCard,
    sortStandardHand,
    collectSeenCardIds,
    stripUndefined,
    formatTrumpAnnouncement
  };
})(typeof window !== 'undefined' ? window : global);
