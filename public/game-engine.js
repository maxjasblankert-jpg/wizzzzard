/* Shared Wizard game logic (browser + tests) */
(function (global) {
  const SUITS = {
    green: { name: 'Green', color: '#2D8A4E', emoji: '🟢' },
    blue: { name: 'Blue', color: '#1E5FAD', emoji: '🔵' },
    red: { name: 'Red', color: '#C0392B', emoji: '🔴' },
    yellow: { name: 'Yellow', color: '#D4A017', emoji: '🟡' },
    purple: { name: 'Purple', color: '#7B2D8B', emoji: '🟣' },
    indigo: { name: 'Indigo', color: '#4B0082', emoji: '🟣' }
  };

  const RANK_ICONS = {
    2: '🌱', 3: '🔥', 4: '💧', 5: '🪶', 6: '🛡️',
    7: '🌙', 8: '☀️', 9: '⚡', 10: '🏔️', 11: '👁️',
    12: '👑', 13: '🐲', 14: '🏰'
  };

  function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  function createDeck(mode) {
    if (isStandardMode(mode) || mode === 'normal') {
      return getStandardRules().createStandardDeck();
    }
    const suitsToUse = ['green', 'blue', 'red', 'yellow'];
    if (mode === 'purple') suitsToUse.push('purple');

    const deck = [];
    suitsToUse.forEach(suit => {
      for (let value = 1; value <= 15; value++) {
        const icon = (global.CardArt && global.CardArt.getRankSymbol(suit, value))
          || RANK_ICONS[value]
          || (value === 1 ? '⬇️' : '⭐');
        deck.push({
          suit,
          value,
          key: `${suit}-${value}`,
          icon
        });
      }
    });
    return deck;
  }

  function shuffle(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * First standard card (2–14) sets the trick champ suit.
   * If the lead is 1 or 15, skip wild cards until someone plays 2–14.
   */
  function getTrickLedSuit(cardsPlayed, options = {}) {
    if (!cardsPlayed || cardsPlayed.length === 0) return null;
    if (options.mode === 'standard') {
      const SR = getStandardRules();
      const idx = SR.getTrickLeadSuit(cardsPlayed, options.trumpSuitIndex ?? -1);
      return idx >= 0 ? SR.suitNameFromIndex(idx) : null;
    }
    for (const played of cardsPlayed) {
      const { value, suit } = played.card;
      if (value >= 2 && value <= 14) return suit;
    }
    return null;
  }

  function resolveTrick(cardsPlayed, trumpSuit) {
    if (cardsPlayed.length === 0) return null;

    let last15 = null;
    for (const played of cardsPlayed) {
      if (played.card.value === 15) last15 = played;
    }
    if (last15) return last15;

    const allOnes = cardsPlayed.every(p => p.card.value === 1);
    if (allOnes) {
      if (trumpSuit) {
        const trumpOne = cardsPlayed.find(p => p.card.suit === trumpSuit && p.card.value === 1);
        if (trumpOne) return trumpOne;
      }
      return cardsPlayed[0];
    }

    const ledSuit = getTrickLedSuit(cardsPlayed);

    const evaluated = cardsPlayed.map((p, index) => {
      const { card } = p;
      let score = 0;

      if (card.value === 15) {
        score = 10000;
      } else if (trumpSuit && card.suit === trumpSuit && card.value >= 2 && card.value <= 14) {
        score = 1000 + card.value;
      } else if (ledSuit && card.suit === ledSuit && card.value >= 2 && card.value <= 14) {
        score = 100 + card.value;
      } else if (card.value >= 2 && card.value <= 14) {
        score = 10 + card.value;
      } else if (card.value === 1) {
        if (trumpSuit && card.suit === trumpSuit) score = 1.5;
        else if (ledSuit && card.suit === ledSuit) score = 1.1;
        else score = 1.0;
      }

      return { player: p, score, index };
    });

    evaluated.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });

    return evaluated[0].player;
  }

  function isStandardMode(mode) {
    return mode === 'standard';
  }

  function getStandardRules() {
    return global.StandardRules;
  }

  function getRoundsCount(mode, playerCount) {
    if (isStandardMode(mode)) {
      return getStandardRules().getRoundsCount(playerCount);
    }
    const cardsCount = mode === 'purple' ? 75 : 60;
    return Math.floor(cardsCount / playerCount);
  }

  const SUIT_ORDER = ['green', 'blue', 'red', 'yellow', 'purple'];

  function sortHand(hand) {
    const suitRank = (suit) => {
      const idx = SUIT_ORDER.indexOf(suit === 'indigo' ? 'purple' : suit);
      return idx === -1 ? 99 : idx;
    };
    const handGroup = (value) => {
      if (value === 1) return 0;
      if (value === 15) return 2;
      return 1;
    };

    return [...hand].sort((a, b) => {
      const ga = handGroup(a.value);
      const gb = handGroup(b.value);
      if (ga !== gb) return ga - gb;

      const sa = suitRank(a.suit);
      const sb = suitRank(b.suit);
      if (sa !== sb) return sa - sb;

      return a.value - b.value;
    });
  }

  function calculateScoreChange(bid, won) {
    if (bid === won) return 20 + won * 10;
    return -Math.abs(won - bid) * 10;
  }

  function hasFollowSuitCard(hand, ledSuit) {
    return hand.some(c => c.suit === ledSuit && c.value >= 2 && c.value <= 14);
  }

  function isWildRank(value) {
    return value === 1 || value === 15;
  }

  function canPlayCard(hand, cardToPlay, currentTrick, room) {
    if (!currentTrick || currentTrick.length === 0) return true;
    if (room && isStandardMode(room.mode)) {
      return getStandardRules().canPlayCard(hand, cardToPlay, currentTrick, room.trumpSuitIndex ?? -1);
    }
    const ledSuit = getTrickLedSuit(currentTrick);
    if (!ledSuit) return true;
    if (!hasFollowSuitCard(hand, ledSuit)) return true;
    if (isWildRank(cardToPlay.value)) return true;
    return cardToPlay.suit === ledSuit && cardToPlay.value >= 2 && cardToPlay.value <= 14;
  }

  function pickFollowSuitCardIndex(hand, ledSuit) {
    return hand.findIndex(c => c.suit === ledSuit && c.value >= 2 && c.value <= 14);
  }

  function announce(room, message) {
    room.hostVoiceLog.push({ timestamp: Date.now(), text: message });
    if (room.hostVoiceLog.length > 50) room.hostVoiceLog.shift();
  }

  function resolveBotType(meta, room) {
    if (!meta?.isBot) return null;
    if (meta.botType === 'heuristic') return 'heuristic';
    if (meta.botType === 'neural_v6' || meta.botType === 'neural_v7') return meta.botType;
    return isStandardMode(room?.mode) ? 'neural_v7' : 'heuristic';
  }

  function buildPlayersArray(room, handsById) {
    return room.playerIds.map((id, index) => {
      const meta = room.playersById[id];
      const hand = handsById[id] || [];
      return {
        id,
        name: meta.name,
        avatar: meta.avatar || (meta.isBot ? '🤖' : null),
        active: meta.active,
        tricksWon: meta.tricksWon,
        currentBid: meta.currentBid,
        score: meta.score,
        handSize: hand.length,
        roundScores: meta.roundScores || [],
        isBot: !!meta.isBot,
        botType: resolveBotType(meta, room),
        hand,
        order: index
      };
    });
  }

  function getSuitOrder(mode) {
    const suits = ['green', 'blue', 'red', 'yellow'];
    if (mode === 'purple') suits.push('purple');
    return suits;
  }

  /** Job cards 1 and 15 are wild — no round trump; the first non-1/15 lead sets the trick suit. */
  function resolveTrumpSuit(jobCard) {
    if (!jobCard) return null;
    if (jobCard.value === 1 || jobCard.value === 15) return null;
    return jobCard.suit;
  }

  function formatTrumpAnnouncement(jobCard) {
    const jobMeta = SUITS[jobCard.suit];
    if (jobCard.value === 1 || jobCard.value === 15) {
      return `The Job Card is the ${jobCard.value} of ${jobMeta.name} — no trump! The first standard card played sets the winning color (skip 1s and 15s).`;
    }
    const trumpMeta = SUITS[jobCard.suit];
    return `The Job Card is the ${jobCard.value} of ${jobMeta.name} — ${trumpMeta.name} is trump! ${trumpMeta.emoji}`;
  }

  function pickJobCard(deck, excludeKeys = []) {
    const excluded = new Set(excludeKeys || []);
    const candidates = deck.filter(c => c.value >= 1 && c.value <= 15 && !excluded.has(c.key));
    const pool = candidates.length > 0
      ? candidates
      : deck.filter(c => c.value >= 1 && c.value <= 15);
    if (pool.length === 0) return deck[0];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function startStandardRound(room, handsById) {
    const SR = getStandardRules();
    room.players.forEach(p => {
      p.tricksWon = 0;
      p.currentBid = null;
      handsById[p.id] = [];
    });

    room.currentTrick = [];
    room.trickTransitionUntil = null;
    room.trickWinnerHistory = [];
    room.jobCard = null;

    let deck = shuffle(SR.createStandardDeck());
    const numCards = room.currentRound;

    for (let i = 0; i < numCards; i++) {
      room.players.forEach(p => {
        handsById[p.id].push(deck.pop());
      });
    }

    let trumpCardId = -1;
    if (deck.length > 0) {
      trumpCardId = deck.pop().id;
    }

    const dealer = room.players[room.dealerIndex];
    const trumpInfo = SR.resolveTrumpFromFlip(trumpCardId, handsById[dealer.id]);
    room.trumpCard = trumpInfo.trumpCard;
    room.trumpSuitIndex = trumpInfo.trumpSuitIndex;
    room.trumpSuit = trumpInfo.trumpSuit;

    room.players.forEach(p => {
      handsById[p.id] = SR.sortStandardHand(handsById[p.id]);
    });

    room.status = 'bidding';
    room.activePlayerIndex = (room.dealerIndex + 1) % room.playerCount;

    const firstBidder = room.players[room.activePlayerIndex];
    announce(room, SR.formatTrumpAnnouncement(room.trumpCard, room.trumpSuit, room.trumpSuitIndex));
    announce(room, `Round ${room.currentRound} started. Dealer is ${dealer.name}. ${firstBidder.name}, you bid first.`);
  }

  function startRound(room, handsById) {
    if (isStandardMode(room.mode)) {
      startStandardRound(room, handsById);
      return;
    }

    room.players.forEach(p => {
      p.tricksWon = 0;
      p.currentBid = null;
      handsById[p.id] = [];
    });

    room.currentTrick = [];
    room.trickTransitionUntil = null;
    room.trickWinnerHistory = [];

    const excludedKeys = new Set([
      ...(room.jobCardHistory || []),
      room.jobCard?.key
    ].filter(Boolean));

    let deck = createDeck(room.mode);
    deck = deck.filter(c => !excludedKeys.has(c.key));
    deck = shuffle(deck);

    const numCards = room.currentRound;
    for (let i = 0; i < numCards; i++) {
      room.players.forEach(p => {
        handsById[p.id].push(deck.pop());
      });
    }

    room.players.forEach(p => {
      handsById[p.id] = sortHand(handsById[p.id]);
    });

    room.status = 'bidding';
    room.activePlayerIndex = (room.dealerIndex + 1) % room.playerCount;

    const dealer = room.players[room.dealerIndex];
    const firstBidder = room.players[room.activePlayerIndex];
    announce(room, `Round ${room.currentRound} started. Dealer is ${dealer.name}. ${firstBidder.name}, you bid first.`);
  }

  function scoreRound(room) {
    room.status = 'round_end';
    const roundScores = {};

    room.players.forEach(p => {
      let scoreChange = 0;
      if (p.currentBid === p.tricksWon) {
        scoreChange = 20 + p.tricksWon * 10;
        p.score += scoreChange;
        announce(room, `Nailed it! +${scoreChange} for ${p.name} ✓`);
      } else {
        const diff = Math.abs(p.tricksWon - p.currentBid);
        scoreChange = -diff * 10;
        p.score += scoreChange;
        announce(room, `Off by ${diff} — -${Math.abs(scoreChange)} for ${p.name}.`);
      }

      p.roundScores.push({
        round: room.currentRound,
        bid: p.currentBid,
        won: p.tricksWon,
        change: scoreChange,
        total: p.score
      });

      roundScores[p.id] = {
        bid: p.currentBid,
        won: p.tricksWon,
        change: scoreChange,
        total: p.score
      };
    });

    room.scoresHistory.push({
      roundIndex: room.currentRound,
      scores: roundScores
    });

    announce(room, `Round ${room.currentRound} finished. Dealer passes to ${room.players[(room.dealerIndex + 1) % room.playerCount].name}.`);
  }

  function resolveGameWinners(room) {
    let maxScore = -999999;
    room.players.forEach(p => {
      if (p.score > maxScore) maxScore = p.score;
    });
    const winners = room.players.filter(p => p.score === maxScore);
    const winnerNames = winners.map(w => w.name).join(' & ');
    announce(room, `🏆 GAME OVER! Winner(s): ${winnerNames} with ${maxScore} points! 🏆`);
  }

  function resolveCompletedTrick(room, handsById) {
    let winner;
    if (isStandardMode(room.mode)) {
      winner = getStandardRules().evaluateTrickWinner(room.currentTrick, room.trumpSuitIndex ?? -1);
    } else {
      winner = resolveTrick(room.currentTrick, room.trumpSuit);
    }
    const winningPlayer = room.players.find(p => p.id === winner.playerId);
    winningPlayer.tricksWon += 1;

    if (isStandardMode(room.mode)) {
      const SR = getStandardRules();
      if (SR.isWizard(winner.card.id)) {
        announce(room, `${winner.playerName} wins the trick with a Wizard! ⭐`);
      } else if (SR.isJester(winner.card.id)) {
        announce(room, `${winner.playerName} wins — all Jesters played.`);
      } else {
        announce(room, `${winner.playerName} wins the trick with ${winner.card.value} of ${SUITS[winner.card.suit].name}.`);
      }
    } else {
      const allOnes = room.currentTrick.every(p => p.card.value === 1);
      if (allOnes) {
        const trumpOne = room.trumpSuit
          ? room.currentTrick.find(p => p.card.suit === room.trumpSuit && p.card.value === 1)
          : null;
        if (trumpOne) {
          announce(room, `All 1s — but ${trumpOne.playerName}'s trump 1 takes it!`);
        } else {
          announce(room, `All 1s! First played wins — ${winner.playerName} takes it.`);
        }
      } else if (winner.card.value === 15) {
        announce(room, `15 played by ${winner.playerName} — trick won! ⭐`);
      } else {
        announce(room, `${winner.playerName} wins the trick with ${winner.card.value} of ${SUITS[winner.card.suit].name}.`);
      }
    }

    room.trickWinnerHistory.push({
      round: room.currentRound,
      trickIndex: room.trickWinnerHistory.length,
      winnerId: winner.playerId,
      winnerName: winner.playerName,
      cardsPlayed: [...room.currentTrick]
    });

    room.trickTransitionUntil = Date.now() + 2500;
    room.pendingWinnerId = winner.playerId;
  }

  function finishTrickTransition(room, handsById) {
    const winnerId = room.pendingWinnerId;
    const winningPlayer = room.players.find(p => p.id === winnerId);

    room.currentTrick = [];
    room.trickTransitionUntil = null;
    room.pendingWinnerId = null;
    room.activePlayerIndex = room.players.findIndex(p => p.id === winnerId);

    if (winningPlayer && (handsById[winnerId] || []).length === 0) {
      scoreRound(room);
    } else if (winningPlayer) {
      announce(room, `${winningPlayer.name} leads the next trick.`);
    }
  }

  function placeBid(room, playerId, bidVal) {
    if (room.status !== 'bidding') return { ok: false, message: 'Not in bidding phase.' };

    const activePlayer = room.players[room.activePlayerIndex];
    if (activePlayer.id !== playerId) return { ok: false, message: 'Not your turn to bid.' };

    if (isNaN(bidVal) || bidVal < 0 || bidVal > room.currentRound) {
      return { ok: false, message: 'Invalid bid amount.' };
    }

    const totalBidsSoFar = room.players.reduce((sum, p) => sum + (p.currentBid !== null ? p.currentBid : 0), 0);
    const isLastBidder = room.players.filter(p => p.currentBid === null).length === 1;

    if (room.hookRule && isLastBidder && totalBidsSoFar + bidVal === room.currentRound) {
      return {
        ok: false,
        message: `Hook Rule Active! Your bid cannot be ${bidVal} because it makes total bids equal to tricks available (${room.currentRound}).`
      };
    }

    activePlayer.currentBid = bidVal;
    if (activePlayer.isBot) {
      announce(room, `🤖 ${activePlayer.name} bids ${bidVal}.`);
    } else {
      announce(room, `${activePlayer.name} bids ${bidVal}.`);
    }
    room.activePlayerIndex = (room.activePlayerIndex + 1) % room.playerCount;

    const allBid = room.players.every(p => p.currentBid !== null);
    if (allBid) {
      room.status = 'play';
      room.activePlayerIndex = (room.dealerIndex + 1) % room.playerCount;
      const bidSummary = room.players.map(p => `${p.name}: ${p.currentBid}`).join(', ');
      const totalTricksBid = room.players.reduce((sum, p) => sum + p.currentBid, 0);
      announce(room, `All bids placed! [${bidSummary}]. Total tricks bid: ${totalTricksBid} vs. ${room.currentRound} available.`);
      announce(room, `${room.players[room.activePlayerIndex].name} leads the first trick.`);
    } else {
      announce(room, `${room.players[room.activePlayerIndex].name}, you're up to bid.`);
    }

    return { ok: true };
  }

  function playCard(room, handsById, playerId, cardKey) {
    if (room.status !== 'play') return { ok: false, message: 'Not in play phase.' };
    if (room.trickTransitionUntil) return { ok: false, message: 'Trick is resolving.' };

    const activePlayer = room.players[room.activePlayerIndex];
    if (activePlayer.id !== playerId) return { ok: false, message: 'Not your turn.' };

    const hand = handsById[playerId] || [];
    const cardIndex = hand.findIndex(c => c.key === cardKey);
    if (cardIndex === -1) return { ok: false, message: 'Card not in hand.' };

    const cardToPlay = hand[cardIndex];

    if (room.currentTrick.length > 0) {
      if (!canPlayCard(hand, cardToPlay, room.currentTrick, room)) {
        const ledSuit = getTrickLedSuit(room.currentTrick, {
          mode: room.mode,
          trumpSuitIndex: room.trumpSuitIndex
        });
        if (ledSuit && SUITS[ledSuit]) {
          return {
            ok: false,
            message: `You must follow suit! Led suit is ${SUITS[ledSuit].name} ${SUITS[ledSuit].emoji}.`
          };
        }
        return { ok: false, message: 'You must follow suit!' };
      }
    }

    hand.splice(cardIndex, 1);
    room.currentTrick.push({
      playerId: activePlayer.id,
      playerName: activePlayer.name,
      card: cardToPlay
    });

    if (cardToPlay.value === 15) {
      if (activePlayer.isBot) {
        announce(room, `🤖 ${activePlayer.name} plays Wizard 15! ⭐`);
      } else {
        announce(room, `15 played by ${activePlayer.name}! ⭐`);
      }
    } else if (activePlayer.isBot) {
      announce(room, `🤖 ${activePlayer.name} plays ${cardToPlay.value} of ${SUITS[cardToPlay.suit].name}.`);
    } else {
      announce(room, `${activePlayer.name} plays ${cardToPlay.value} of ${SUITS[cardToPlay.suit].name}.`);
    }

    room.activePlayerIndex = (room.activePlayerIndex + 1) % room.playerCount;

    if (room.currentTrick.length === room.playerCount) {
      resolveCompletedTrick(room, handsById);
    }

    return { ok: true };
  }

  function playBotCard(room, handsById, activePlayer) {
    const hand = handsById[activePlayer.id] || [];
    if (hand.length === 0) return null;

    let cardIndex = 0;
    if (room.currentTrick.length > 0) {
      const ledSuit = getTrickLedSuit(room.currentTrick);
      if (ledSuit) {
        const followIndex = pickFollowSuitCardIndex(hand, ledSuit);
        cardIndex = followIndex !== -1 ? followIndex : 0;
      }
    }

    return hand[cardIndex].key;
  }

  function playBotBid(room) {
    const maxBid = room.currentRound;
    const avgBid = Math.round(maxBid / Math.max(room.players.length, 1));
    let bidVal = Math.max(0, Math.min(maxBid, avgBid + Math.floor(Math.random() * 3) - 1));

    if (room.hookRule) {
      const totalBidsSoFar = room.players.reduce((sum, p) => sum + (p.currentBid !== null ? p.currentBid : 0), 0);
      const isLastBidder = room.players.filter(p => p.currentBid === null).length === 1;
      if (isLastBidder && totalBidsSoFar + bidVal === room.currentRound) {
        bidVal = (bidVal + 1) % (maxBid + 1);
        if (totalBidsSoFar + bidVal === room.currentRound) {
          bidVal = (bidVal + 1) % (maxBid + 1);
        }
      }
    }

    return bidVal;
  }

  function hydrateRoom(roomDoc, playerDocs) {
    const room = { ...roomDoc };
    room.maxPlayers = roomDoc.playerCount;
    room.playerIds = room.playerIds || [];
    room.playersById = {};
    playerDocs.forEach(doc => {
      const meta = { ...doc };
      if (meta.isBot && !meta.botType) {
        meta.botType = isStandardMode(room.mode) ? 'neural_v7' : 'heuristic';
      }
      room.playersById[doc.id] = meta;
    });
    room.players = buildPlayersArray(room, {});
    room.playerCount = room.playerIds.length;
    return room;
  }

  global.GameEngine = {
    SUITS,
    RANK_ICONS,
    generateRoomCode,
    createDeck,
    shuffle,
    isStandardMode,
    getTrickLedSuit,
    resolveTrick,
    getRoundsCount,
    sortHand,
    startStandardRound,
    calculateScoreChange,
    announce,
    hasFollowSuitCard,
    isWildRank,
    canPlayCard,
    pickFollowSuitCardIndex,
    buildPlayersArray,
    pickJobCard,
    getSuitOrder,
    resolveTrumpSuit,
    formatTrumpAnnouncement,
    startRound,
    scoreRound,
    resolveGameWinners,
    resolveCompletedTrick,
    finishTrickTransition,
    placeBid,
    playCard,
    playBotCard,
    playBotBid,
    hydrateRoom,
    resolveBotType
  };
})(typeof window !== 'undefined' ? window : global);
