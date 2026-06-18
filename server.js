require('./scripts/load-env');

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

require('./public/game-engine.js');
const { sortHand } = global.GameEngine;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Catch WebSocket server errors to prevent unhandled exceptions during port fallback attempts
wss.on('error', (err) => {
  console.log('WebSocket Server error intercepted:', err.message);
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Global state of all active rooms
const rooms = new Map();

// Suit definitions
const SUITS = {
  green: { name: 'Green', color: '#2D8A4E', emoji: '🟢' },
  blue: { name: 'Blue', color: '#1E5FAD', emoji: '🔵' },
  red: { name: 'Red', color: '#C0392B', emoji: '🔴' },
  yellow: { name: 'Yellow', color: '#D4A017', emoji: '🟡' },
  purple: { name: 'Purple', color: '#7B2D8B', emoji: '🟣' },
  indigo: { name: 'Indigo', color: '#4B0082', emoji: '🟣' } // Legacy — not used in current deck modes
};

// Thematic icons for ranks 2-14
const RANK_ICONS = {
  2: '🌱', 3: '🔥', 4: '💧', 5: '🪶', 6: '🛡️',
  7: '🌙', 8: '☀️', 9: '⚡', 10: '🏔️', 11: '👁️',
  12: '👑', 13: '🐲', 14: '🏰'
};

// Generate a random room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Generate the deck of cards
function createDeck(mode) {
  const suitsToUse = ['green', 'blue', 'red', 'yellow'];
  if (mode === 'purple') {
    suitsToUse.push('purple');
  }

  const deck = [];
  suitsToUse.forEach(suit => {
    for (let value = 1; value <= 15; value++) {
      deck.push({
        suit,
        value,
        key: `${suit}-${value}`,
        icon: RANK_ICONS[value] || (value === 1 ? '⬇️' : '⭐')
      });
    }
  });
  return deck;
}

// Shuffle deck using Fisher-Yates
function shuffle(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Evaluate the winner of a completed trick
function resolveTrick(cardsPlayed, trumpSuit) {
  if (cardsPlayed.length === 0) return null;

  // 1. Wizard Check (15s)
  // "Last 15 played wins"
  let last15 = null;
  for (const played of cardsPlayed) {
    if (played.card.value === 15) last15 = played;
  }
  if (last15) return last15;

  // 2. All 1s check
  // "If every player in a trick plays a 1, the first 1 played wins.
  // Exception: If the trump color 1 is among the 1s played, the trump 1 wins."
  const allOnes = cardsPlayed.every(p => p.card.value === 1);
  if (allOnes) {
    const trumpOne = cardsPlayed.find(p => p.card.suit === trumpSuit && p.card.value === 1);
    if (trumpOne) return trumpOne;
    return cardsPlayed[0];
  }

  // 3. Normal trick-taking
  const ledSuit = cardsPlayed[0].card.suit;

  const evaluated = cardsPlayed.map((p, index) => {
    const { card } = p;
    let score = 0;

    if (card.value === 15) {
      score = 10000;
    } else if (card.suit === trumpSuit && card.value >= 2 && card.value <= 14) {
      score = 1000 + card.value;
    } else if (card.suit === ledSuit && card.value >= 2 && card.value <= 14) {
      score = 100 + card.value;
    } else if (card.value >= 2 && card.value <= 14) {
      score = 10 + card.value; // off-suit standard card
    } else if (card.value === 1) {
      // Differentiate 1 values slightly so trump 1 > led 1 > off-suit 1
      if (card.suit === trumpSuit) {
        score = 1.5;
      } else if (card.suit === ledSuit) {
        score = 1.1;
      } else {
        score = 1.0;
      }
    }

    return { player: p, score, index };
  });

  // Sort by score descending; for ties, first played wins
  evaluated.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  });

  return evaluated[0].player;
}

// Calculate rounds count
function getRoundsCount(mode, playerCount) {
  const cardsCount = mode === 'purple' ? 75 : 60;
  return Math.floor(cardsCount / playerCount);
}

// Broadcast game state to all players in room
function broadcastToRoom(room) {
  room.players.forEach(p => {
    if (p.socket && p.socket.readyState === WebSocket.OPEN) {
      // Send custom message containing room details
      // Hands must be private - only send current player's hand
      const sanitizedPlayers = room.players.map(pl => ({
        id: pl.id,
        name: pl.name,
        active: pl.active,
        tricksWon: pl.tricksWon,
        currentBid: pl.currentBid,
        score: pl.score,
        handSize: pl.hand.length,
        roundScores: pl.roundScores
      }));

      const payload = {
        type: 'sync',
        roomCode: room.roomCode,
        mode: room.mode,
        playerCount: room.playerCount,
        hookRule: room.hookRule,
        status: room.status,
        dealerIndex: room.dealerIndex,
        currentRound: room.currentRound,
        maxRounds: room.maxRounds,
        jobCard: room.jobCard,
        trumpSuit: room.trumpSuit,
        activePlayerIndex: room.activePlayerIndex,
        currentTrick: room.currentTrick,
        players: sanitizedPlayers,
        hostVoiceLog: room.hostVoiceLog,
        hostId: room.hostId || room.players[0]?.id,
        paused: room.players.some(pl => !pl.active), // Paused if any player disconnected
        privateHand: p.hand,
        myPlayerId: p.id
      };

      p.socket.send(JSON.stringify(payload));
    }
  });
}

// Add announcement to the Host Voice Log
function announce(room, message) {
  room.hostVoiceLog.push({
    timestamp: Date.now(),
    text: message
  });
  if (room.hostVoiceLog.length > 50) {
    room.hostVoiceLog.shift();
  }
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
  let currentRoomCode = null;
  let currentPlayerId = null;

  ws.on('message', (messageStr) => {
    try {
      const msg = JSON.parse(messageStr);
      const { type, roomCode, playerId, playerName, data } = msg;

      switch (type) {
        case 'create_room': {
          const { mode, playerCount, hookRule, hostName } = data;
          let code = generateRoomCode();
          while (rooms.has(code)) {
            code = generateRoomCode();
          }

          const newPlayerId = 'p-' + Math.random().toString(36).substring(2, 9);
          const maxRounds = getRoundsCount(mode, parseInt(playerCount));

          const newRoom = {
            roomCode: code,
            mode,
            playerCount: parseInt(playerCount),
            hookRule: !!hookRule,
            hostId: newPlayerId,
            players: [{
              id: newPlayerId,
              name: hostName,
              socket: ws,
              active: true,
              tricksWon: 0,
              currentBid: null,
              hand: [],
              score: 0,
              roundScores: []
            }],
            status: 'lobby',
            dealerIndex: 0,
            currentRound: 0,
            maxRounds,
            jobCard: null,
            trumpSuit: null,
            deck: [],
            currentTrick: [],
            trickWinnerHistory: [],
            activePlayerIndex: 0,
            hostVoiceLog: [],
            scoresHistory: [],
            trickTransitionTimeout: null
          };

          rooms.set(code, newRoom);
          currentRoomCode = code;
          currentPlayerId = newPlayerId;

          announce(newRoom, `Welcome to Wizard! Room ${code} created by ${hostName}.`);
          ws.send(JSON.stringify({
            type: 'created',
            roomCode: code,
            playerId: newPlayerId,
            playerName: hostName
          }));
          broadcastToRoom(newRoom);
          break;
        }

        case 'join_room': {
          const room = rooms.get(roomCode.toUpperCase());
          if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room not found.' }));
            return;
          }

          // Case 1: Reconnecting player
          if (playerId) {
            const existingPlayer = room.players.find(p => p.id === playerId);
            if (existingPlayer) {
              existingPlayer.socket = ws;
              existingPlayer.active = true;
              currentRoomCode = room.roomCode;
              currentPlayerId = playerId;

              announce(room, `${existingPlayer.name} has reconnected.`);
              ws.send(JSON.stringify({
                type: 'joined',
                roomCode: room.roomCode,
                playerId: existingPlayer.id,
                playerName: existingPlayer.name
              }));
              broadcastToRoom(room);
              return;
            }
          }

          // Case 2: New player joining lobby
          if (room.status !== 'lobby') {
            ws.send(JSON.stringify({ type: 'error', message: 'Game already in progress.' }));
            return;
          }

          if (room.players.length >= room.playerCount) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room is already full.' }));
            return;
          }

          const newPlayerId = 'p-' + Math.random().toString(36).substring(2, 9);
          const newPlayer = {
            id: newPlayerId,
            name: playerName || `Player ${room.players.length + 1}`,
            socket: ws,
            active: true,
            tricksWon: 0,
            currentBid: null,
            hand: [],
            score: 0,
            roundScores: []
          };

          room.players.push(newPlayer);
          currentRoomCode = room.roomCode;
          currentPlayerId = newPlayerId;

          announce(room, `${newPlayer.name} joined the lobby.`);
          ws.send(JSON.stringify({
            type: 'joined',
            roomCode: room.roomCode,
            playerId: newPlayerId,
            playerName: newPlayer.name
          }));

          // If room reaches required players, notify they are ready to start
          if (room.players.length === room.playerCount) {
            announce(room, `Lobby is full! Host can now start the game.`);
          }

          broadcastToRoom(room);
          break;
        }

        case 'add_bot': {
          const room = rooms.get(currentRoomCode);
          if (!room || room.status !== 'lobby') return;
          if (room.players[0].id !== currentPlayerId) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only the host can add bots.' }));
            return;
          }
          if (room.players.length >= room.playerCount) {
            ws.send(JSON.stringify({ type: 'error', message: 'Lobby is already full.' }));
            return;
          }

          const botType = data.botType || 'neural_v7';
          if (botType !== 'heuristic' && room.mode !== 'standard') {
            ws.send(JSON.stringify({ type: 'error', message: 'Champion bots require Standard mode.' }));
            return;
          }

          const botId = 'bot-' + Math.random().toString(36).substring(2, 9);
          const botNames = ['Merlin', 'Gandalf', 'Saruman', 'Dumbledore', 'Hermione', 'Voldemort', 'Radagast', 'Alatar', 'Pallando'];
          
          let botName = '';
          for (let name of botNames) {
            const proposed = `Bot ${name}`;
            if (!room.players.some(p => p.name === proposed)) {
              botName = proposed;
              break;
            }
          }
          if (!botName) {
            botName = `Bot ${room.players.length + 1}`;
          }

          const botPlayer = {
            id: botId,
            name: botName,
            socket: null,
            active: true,
            tricksWon: 0,
            currentBid: null,
            hand: [],
            score: 0,
            roundScores: [],
            isBot: true,
            botType
          };

          room.players.push(botPlayer);
          announce(room, `${botPlayer.name} (AI) joined the lobby.`);

          if (room.players.length === room.playerCount) {
            announce(room, `Lobby is full! Host can now start the game.`);
          }

          broadcastToRoom(room);
          break;
        }

        case 'start_game': {
          const room = rooms.get(currentRoomCode);
          if (!room || room.players[0].id !== currentPlayerId) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only the host can start the game.' }));
            return;
          }
          if (room.players.length < room.playerCount) {
            ws.send(JSON.stringify({ type: 'error', message: 'Waiting for more players to join.' }));
            return;
          }

          // Game Setup: Draw Job Card
          let fullDeck = createDeck(room.mode);
          let jobCard = null;
          let jobCardIndex = -1;

          // Redraw until a 2-14 card is drawn
          while (true) {
            jobCardIndex = Math.floor(Math.random() * fullDeck.length);
            const card = fullDeck[jobCardIndex];
            if (card.value >= 2 && card.value <= 14) {
              jobCard = card;
              break;
            }
          }

          room.jobCard = jobCard;
          room.trumpSuit = jobCard.suit;
          announce(room, `The Job Card is the ${jobCard.value} of ${SUITS[jobCard.suit].name} — ${SUITS[jobCard.suit].name} is trump for this game! ${SUITS[jobCard.suit].emoji}`);

          room.status = 'deal';
          room.currentRound = 1;
          room.dealerIndex = 0; // Host is dealer initially

          // Start the round
          startRound(room);
          break;
        }

        case 'place_bid': {
          const room = rooms.get(currentRoomCode);
          if (!room || room.status !== 'bidding') return;

          const activePlayer = room.players[room.activePlayerIndex];
          if (activePlayer.id !== currentPlayerId) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not your turn to bid.' }));
            return;
          }

          const bidVal = parseInt(data.bid);
          if (isNaN(bidVal) || bidVal < 0 || bidVal > room.currentRound) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid bid amount.' }));
            return;
          }

          // Hook Rule Validation
          // "The last bidder cannot make a bid that brings total bids exactly equal to the number of available tricks"
          const totalBidsSoFar = room.players.reduce((sum, p) => sum + (p.currentBid !== null ? p.currentBid : 0), 0);
          const isLastBidder = room.players.filter(p => p.currentBid === null).length === 1;

          if (room.hookRule && isLastBidder) {
            if (totalBidsSoFar + bidVal === room.currentRound) {
              ws.send(JSON.stringify({ type: 'error', message: `Hook Rule Active! Your bid cannot be ${bidVal} because it makes total bids equal to tricks available (${room.currentRound}).` }));
              return;
            }
          }

          activePlayer.currentBid = bidVal;
          announce(room, `${activePlayer.name} bids ${bidVal}.`);

          // Rotate bidding turn clockwise
          room.activePlayerIndex = (room.activePlayerIndex + 1) % room.playerCount;

          // Check if bidding is complete
          const allBid = room.players.every(p => p.currentBid !== null);
          if (allBid) {
            room.status = 'play';
            // Start play with player to the left of dealer
            room.activePlayerIndex = (room.dealerIndex + 1) % room.playerCount;

            const bidSummary = room.players.map(p => `${p.name}: ${p.currentBid}`).join(', ');
            const totalTricksBid = room.players.reduce((sum, p) => sum + p.currentBid, 0);
            announce(room, `All bids placed! [${bidSummary}]. Total tricks bid: ${totalTricksBid} vs. ${room.currentRound} available.`);
            announce(room, `${room.players[room.activePlayerIndex].name} leads the first trick.`);
          } else {
            announce(room, `Bidding time — ${room.players[room.activePlayerIndex].name}, you go next.`);
          }

          broadcastToRoom(room);
          handleBotTurns(room);
          break;
        }

        case 'play_card': {
          const room = rooms.get(currentRoomCode);
          if (!room || room.status !== 'play') return;
          if (room.trickTransitionTimeout) return; // Prevent plays during trick resolution delay

          const activePlayer = room.players[room.activePlayerIndex];
          if (activePlayer.id !== currentPlayerId) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not your turn.' }));
            return;
          }

          const cardKey = data.cardKey;
          const cardIndex = activePlayer.hand.findIndex(c => c.key === cardKey);
          if (cardIndex === -1) {
            ws.send(JSON.stringify({ type: 'error', message: 'Card not in hand.' }));
            return;
          }

          const cardToPlay = activePlayer.hand[cardIndex];

          // Follow Suit Rule Check
          if (room.currentTrick.length > 0) {
            const ledSuit = room.currentTrick[0].card.suit;

            // Player must follow suit if they have it
            // Card 1 and 15 do have suits and must be played if they match the led suit
            const hasLedSuit = activePlayer.hand.some(c => c.suit === ledSuit);
            if (hasLedSuit && cardToPlay.suit !== ledSuit) {
              ws.send(JSON.stringify({
                type: 'error',
                message: `You must follow suit! Led suit is ${SUITS[ledSuit].name} ${SUITS[ledSuit].emoji}.`
              }));
              return;
            }
          }

          // Valid play: remove from hand and add to trick
          activePlayer.hand.splice(cardIndex, 1);
          room.currentTrick.push({
            playerId: activePlayer.id,
            playerName: activePlayer.name,
            card: cardToPlay
          });

          // Print special Host Voice lines
          if (cardToPlay.value === 15) {
            announce(room, `15 played by ${activePlayer.name}! ⭐`);
          } else {
            announce(room, `${activePlayer.name} plays ${cardToPlay.value} of ${SUITS[cardToPlay.suit].name}.`);
          }

          // Advance turn to next player
          room.activePlayerIndex = (room.activePlayerIndex + 1) % room.playerCount;

          // Check if trick is full
          if (room.currentTrick.length === room.playerCount) {
            resolveCompletedTrick(room);
          } else {
            broadcastToRoom(room);
            handleBotTurns(room);
          }
          break;
        }

        case 'next_round': {
          const room = rooms.get(currentRoomCode);
          if (!room || room.status !== 'round_end') return;

          // Increment round
          room.currentRound += 1;
          if (room.currentRound > room.maxRounds) {
            // End of game
            room.status = 'game_over';
            resolveGameWinners(room);
          } else {
            // Rotate dealer role clockwise
            room.dealerIndex = (room.dealerIndex + 1) % room.playerCount;
            room.status = 'deal';
            startRound(room);
          }
          break;
        }

        case 'restart_game': {
          const room = rooms.get(currentRoomCode);
          if (!room) return;

          // Reset scores, rounds, etc. but keep lobby players
          room.status = 'lobby';
          room.currentRound = 0;
          room.dealerIndex = 0;
          room.jobCard = null;
          room.trumpSuit = null;
          room.currentTrick = [];
          room.trickWinnerHistory = [];
          room.hostVoiceLog = [];
          room.scoresHistory = [];

          room.players.forEach(p => {
            p.score = 0;
            p.roundScores = [];
            p.hand = [];
            p.currentBid = null;
            p.tricksWon = 0;
          });

          announce(room, `Game has been reset. Ready to start again!`);
          broadcastToRoom(room);
          break;
        }
      }
    } catch (e) {
      console.error('WebSocket message parsing/processing error:', e);
    }
  });

  ws.on('close', () => {
    // If a player disconnects, mark them as inactive in their room
    if (currentRoomCode && currentPlayerId) {
      const room = rooms.get(currentRoomCode);
      if (room) {
        const player = room.players.find(p => p.id === currentPlayerId);
        if (player) {
          player.active = false;
          announce(room, `${player.name} disconnected. Game is paused.`);
          broadcastToRoom(room);
        }
      }
    }
  });
});

// Setup a new round: shuffle, deal cards, start bidding
function startRound(room) {
  // Clear trick counts, bids
  room.players.forEach(p => {
    p.tricksWon = 0;
    p.currentBid = null;
    p.hand = [];
  });

  room.currentTrick = [];
  room.trickWinnerHistory = [];

  // Generate and shuffle fresh deck (excluding the Job Card which was removed from deck)
  let deck = createDeck(room.mode);
  deck = deck.filter(c => c.key !== room.jobCard.key);
  room.deck = shuffle(deck);

  // Deal currentRound cards to each player
  const numCards = room.currentRound;
  for (let i = 0; i < numCards; i++) {
    room.players.forEach(p => {
      p.hand.push(room.deck.pop());
    });
  }

  // Sort hands: 1s left, 2–14 middle, 15s right (by suit within each group)
  room.players.forEach(p => {
    p.hand = sortHand(p.hand);
  });

  room.status = 'bidding';
  // Bidding starts with the player to the left of the dealer
  room.activePlayerIndex = (room.dealerIndex + 1) % room.playerCount;

  announce(room, `Round ${room.currentRound} started. Dealer is ${room.players[room.dealerIndex].name}.`);
  announce(room, `Bidding time — ${room.players[room.activePlayerIndex].name}, you go first.`);

  broadcastToRoom(room);
  handleBotTurns(room);
}

// Resolve trick winner, allocate tricks won, rotate turn, check if round end
function resolveCompletedTrick(room) {
  const winner = resolveTrick(room.currentTrick, room.trumpSuit);
  const winningPlayer = room.players.find(p => p.id === winner.playerId);

  winningPlayer.tricksWon += 1;

  // Print Host Announcements
  const allOnes = room.currentTrick.every(p => p.card.value === 1);
  if (allOnes) {
    const trumpOne = room.currentTrick.find(p => p.card.suit === room.trumpSuit && p.card.value === 1);
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

  // Record history
  room.trickWinnerHistory.push({
    round: room.currentRound,
    trickIndex: room.trickWinnerHistory.length,
    winnerId: winner.playerId,
    winnerName: winner.playerName,
    cardsPlayed: [...room.currentTrick]
  });

  // Set timeout delay of 2.5 seconds so players can see the completed trick
  // State remains 'play' but block plays using room.trickTransitionTimeout
  room.trickTransitionTimeout = setTimeout(() => {
    room.trickTransitionTimeout = null;
    room.currentTrick = [];

    // Winner leads next trick
    room.activePlayerIndex = room.players.findIndex(p => p.id === winner.playerId);

    // If hands are empty, the round is complete. Score the round.
    if (winningPlayer.hand.length === 0) {
      scoreRound(room);
    } else {
      announce(room, `${winningPlayer.name} leads the next trick.`);
      broadcastToRoom(room);
      handleBotTurns(room);
    }
  }, 2500);

  // Broadcast trick state before starting transition timeout
  broadcastToRoom(room);
}

// Calculate score adjustments at end of round
function scoreRound(room) {
  room.status = 'round_end';

  const roundScores = {};

  room.players.forEach(p => {
    let scoreChange = 0;
    if (p.currentBid === p.tricksWon) {
      // Exact bid: +20 + 10 per trick won
      scoreChange = 20 + p.tricksWon * 10;
      p.score += scoreChange;
      announce(room, `Nailed it! +${scoreChange} for ${p.name} ✓`);
    } else {
      // Over or under: -10 per trick off
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
  broadcastToRoom(room);
}

// Resolve game winners at game end
function resolveGameWinners(room) {
  // Find highest score
  let maxScore = -999999;
  room.players.forEach(p => {
    if (p.score > maxScore) {
      maxScore = p.score;
    }
  });

  const winners = room.players.filter(p => p.score === maxScore);
  const winnerNames = winners.map(w => w.name).join(' & ');

  announce(room, `🏆 GAME OVER! Winner(s): ${winnerNames} with ${maxScore} points! 🏆`);
  broadcastToRoom(room);
}

// Automation and turn resolution for Bot (AI) players
function handleBotTurns(room) {
  // If lobby, game end, round end or paused, do not process bot turns
  if (room.status === 'lobby' || room.status === 'game_over' || room.status === 'round_end' || room.status === 'deal') return;
  if (room.players.some(pl => !pl.active)) return; // Paused if any human player disconnected

  const activePlayer = room.players[room.activePlayerIndex];
  if (!activePlayer || !activePlayer.isBot) return;

  // Simulate a slight natural delay (e.g. 800ms) for AI actions
  setTimeout(() => {
    // Re-verify phase/player hasn't changed or disconnected during delay
    if (room.status === 'lobby' || room.status === 'game_over' || room.status === 'round_end' || room.status === 'deal') return;
    const delayedActive = room.players[room.activePlayerIndex];
    if (!delayedActive || delayedActive.id !== activePlayer.id) return;

    if (room.status === 'bidding') {
      // AI bid selection heuristic
      const maxBid = room.currentRound;
      let bidVal = Math.floor(Math.random() * (maxBid + 1));

      // Hook Rule Enforcement
      if (room.hookRule) {
        const totalBidsSoFar = room.players.reduce((sum, p) => sum + (p.currentBid !== null ? p.currentBid : 0), 0);
        const isLastBidder = room.players.filter(p => p.currentBid === null).length === 1;
        if (isLastBidder && totalBidsSoFar + bidVal === room.currentRound) {
          // Choose a different bid if blocked by hook rule
          bidVal = (bidVal + 1) % (maxBid + 1);
          if (totalBidsSoFar + bidVal === room.currentRound) {
            bidVal = (bidVal + 1) % (maxBid + 1); // fallback
          }
        }
      }

      activePlayer.currentBid = bidVal;
      announce(room, `🤖 ${activePlayer.name} bids ${bidVal}.`);

      // Rotate turn
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
        announce(room, `Bidding time — ${room.players[room.activePlayerIndex].name}, you go next.`);
      }

      broadcastToRoom(room);
      handleBotTurns(room); // Recursive call if the next player is also a bot

    } else if (room.status === 'play') {
      if (room.trickTransitionTimeout) return; // Wait if resolving a trick

      const hand = activePlayer.hand;
      if (hand.length === 0) return;

      let cardIndex = 0;

      // Follow Suit Enforcement check
      if (room.currentTrick.length > 0) {
        const ledSuit = room.currentTrick[0].card.suit;
        const hasLedSuit = hand.some(c => c.suit === ledSuit);
        if (hasLedSuit) {
          cardIndex = hand.findIndex(c => c.suit === ledSuit);
        } else {
          cardIndex = 0; // Discard first card
        }
      }

      const cardToPlay = hand[cardIndex];
      hand.splice(cardIndex, 1);

      room.currentTrick.push({
        playerId: activePlayer.id,
        playerName: activePlayer.name,
        card: cardToPlay
      });

      if (cardToPlay.value === 15) {
        announce(room, `🤖 ${activePlayer.name} plays Wizard 15! ⭐`);
      } else {
        announce(room, `🤖 ${activePlayer.name} plays ${cardToPlay.value} of ${SUITS[cardToPlay.suit].name}.`);
      }

      // Rotate turn
      room.activePlayerIndex = (room.activePlayerIndex + 1) % room.playerCount;

      if (room.currentTrick.length === room.playerCount) {
        resolveCompletedTrick(room);
      } else {
        broadcastToRoom(room);
        handleBotTurns(room); // Recursive call if the next player is also a bot
      }
    }
  }, 800);
}

// Listen on port with automatic fallback if the port is already in use
const PORT = parseInt(process.env.PORT) || 3001;

function startServer(port) {
  server.listen(port, '0.0.0.0', () => {
    console.log(`Wizard multiplayer game server running at http://localhost:${port}`);
  });
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`⚠️ Port ${e.port} is already in use. Trying port ${e.port + 1}...`);
    startServer(e.port + 1);
  } else {
    console.error('Server error:', e);
  }
});

startServer(PORT);
