/* Official Wizard rules — matches neural-bot/wizard_simulator.py (card ids 0–59) */
(function (global) {
  const DECK_SIZE = 60;
  const CARDS_PER_SUIT = 13;
  const NUM_COLORED = 52;
  const WIZARD_LO = 52;
  const WIZARD_HI = 56;
  const JESTER_LO = 56;

  /** Simulator suit index → UI suit name */
  const SUIT_FROM_INDEX = ['blue', 'red', 'green', 'yellow'];
  const SUIT_TO_INDEX = { blue: 0, red: 1, green: 2, yellow: 3 };

  function isWizard(id) {
    return id >= WIZARD_LO && id < WIZARD_HI;
  }

  function isJester(id) {
    return id >= JESTER_LO;
  }

  function cardSuit(id) {
    return id < NUM_COLORED ? Math.floor(id / CARDS_PER_SUIT) : -1;
  }

  function cardValue(id) {
    return id < NUM_COLORED ? (id % CARDS_PER_SUIT) + 1 : 0;
  }

  function suitNameFromIndex(idx) {
    return idx >= 0 && idx < 4 ? SUIT_FROM_INDEX[idx] : null;
  }

  function createStandardDeck() {
    const deck = [];
    for (let id = 0; id < DECK_SIZE; id++) {
      deck.push(cardObjectFromId(id));
    }
    return deck;
  }

  function cardObjectFromId(id) {
    if (isWizard(id)) {
      return {
        id,
        suit: 'yellow',
        value: 15,
        cardKind: 'wizard',
        key: `std-${id}`,
        icon: '⭐'
      };
    }
    if (isJester(id)) {
      return {
        id,
        suit: 'purple',
        value: 1,
        cardKind: 'jester',
        key: `std-${id}`,
        icon: '🃏'
      };
    }
    const suitIdx = cardSuit(id);
    const suit = SUIT_FROM_INDEX[suitIdx];
    const value = cardValue(id);
    const icon = (global.CardArt && global.CardArt.getRankSymbol(suit, value)) || '◆';
    return { id, suit, value, cardKind: 'colored', key: `std-${id}`, icon };
  }

  function getRoundsCount(playerCount) {
    return Math.floor(DECK_SIZE / playerCount);
  }

  function dealerChooseTrump(dealerHand) {
    const counts = [0, 0, 0, 0];
    dealerHand.forEach(c => {
      if (c.cardKind === 'colored' || (c.id != null && c.id < NUM_COLORED)) {
        const idx = cardSuit(c.id != null ? c.id : -1);
        if (idx >= 0) counts[idx]++;
      }
    });
    let best = 0;
    for (let i = 1; i < 4; i++) {
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
      if (isWizard(id)) return -1;
      if (isJester(id)) continue;
      return cardSuit(id);
    }
    return -1;
  }

  function evaluateTrickWinner(trick, trumpSuitIndex) {
    if (!trick || trick.length === 0) return null;
    const trump = trumpSuitIndex != null ? trumpSuitIndex : -1;

    for (let i = 0; i < trick.length; i++) {
      const id = trick[i].card.id;
      if (isWizard(id)) return trick[i];
    }

    let lead = -1;
    for (let i = 0; i < trick.length; i++) {
      const id = trick[i].card.id;
      if (!isJester(id)) {
        lead = cardSuit(id);
        break;
      }
    }
    if (lead === -1) return trick[0];

    let best = trick[0];
    let bestValue = -1;
    let bestIsTrump = false;

    for (let i = 0; i < trick.length; i++) {
      const id = trick[i].card.id;
      if (isJester(id)) continue;
      const s = cardSuit(id);
      const v = cardValue(id);
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

    const followSuit = ids.filter(id => !isWizard(id) && !isJester(id) && cardSuit(id) === lead);
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
      if (c.cardKind === 'jester' || isJester(c.id)) return 0;
      if (c.cardKind === 'wizard' || isWizard(c.id)) return 2;
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
      return a.id - b.id;
    });
  }

  function collectSeenCardIds(room, handsById) {
    const seen = new Set();
    if (room.trumpCard && room.trumpCard.id != null && room.trumpCard.id >= 0) {
      seen.add(room.trumpCard.id);
    }
    (room.trickWinnerHistory || []).forEach(t => {
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
