/* Firebase Firestore multiplayer layer for Wizard */
(function (global) {
  const Engine = () => global.GameEngine;

  let db = null;
  let auth = null;
  let uid = null;
  let myPlayerName = null;
  let currentRoomCode = null;
  let privateHand = [];
  let onMessage = null;
  let onError = null;
  let unsubRoom = null;
  let unsubPlayers = null;
  let unsubHand = null;
  let latestRoomDoc = null;
  let latestPlayers = [];
  let botActionInFlight = false;
  let botTimer = null;
  let trickTimer = null;
  let hostTickTimer = null;
  let processingHost = false;
  let actionInFlight = false;
  let syncRaf = null;
  let cachedHostHands = null;
  let cachedHostHandsVersion = -1;
  let optimisticVersion = 0;
  let seatPlayerId = null;

  function emit(msg) {
    if (onMessage) onMessage(msg);
  }

  function fail(message) {
    if (onError) onError(message);
    else alert(`⚠️ ERROR: ${message}`);
  }

  function schedulePublishSync() {
    if (syncRaf) return;
    syncRaf = requestAnimationFrame(() => {
      syncRaf = null;
      publishLocalSync();
    });
  }

  function requireCachedState() {
    if (!latestRoomDoc || !latestPlayers.length || !currentRoomCode) {
      throw new Error('Game is still syncing — try again in a moment.');
    }
    return { roomDoc: latestRoomDoc, playerDocs: latestPlayers, code: currentRoomCode };
  }

  function playerDocFromRuntime(p, room) {
    const storedMeta = room.playersById?.[p.id] || {};
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar || storedMeta.avatar || (p.isBot ? '🤖' : null),
      active: p.active,
      tricksWon: p.tricksWon,
      currentBid: p.currentBid,
      score: p.score,
      roundScores: p.roundScores || [],
      isBot: !!p.isBot,
      order: room.playerIds.indexOf(p.id),
      handSize: p.handSize != null ? p.handSize : (p.hand || []).length
    };
  }

  function applyLocalRuntime(room) {
    latestRoomDoc = roomDocFromRuntime(room);
    latestPlayers = room.players.map(p => playerDocFromRuntime(p, room));
    optimisticVersion = latestRoomDoc.version || 0;
    schedulePublishSync();
  }

  function invalidateHostHandsCache() {
    cachedHostHands = null;
    cachedHostHandsVersion = -1;
  }

  function updateHostHandsCache(handsById, version) {
    cachedHostHands = handsById;
    cachedHostHandsVersion = version;
  }

  async function getHostHands(code, playerIds) {
    const version = latestRoomDoc?.version || 0;
    if (cachedHostHands && cachedHostHandsVersion === version) {
      return cachedHostHands;
    }
    const handsById = await loadAllHands(code, playerIds);
    updateHostHandsCache(handsById, version);
    return handsById;
  }

  function mySeatId() {
    return seatPlayerId || uid;
  }

  function handsForLocalPlay(roomDoc) {
    const handsById = {};
    (roomDoc.playerIds || []).forEach(id => { handsById[id] = []; });
    handsById[mySeatId()] = [...privateHand];
    return handsById;
  }

  async function persistBidFast(code, room, bidPlayerId) {
    const batch = db.batch();
    batch.set(roomDocRef(code), roomDocFromRuntime(room), { merge: true });
    const bidder = room.players.find(p => p.id === bidPlayerId);
    if (bidder) {
      batch.set(playersCol(code).doc(bidPlayerId), {
        currentBid: bidder.currentBid
      }, { merge: true });
    }
    await batch.commit();
  }

  async function persistBotPlayFast(code, room, botHand, botId, affectedPlayerIds) {
    const batch = db.batch();
    batch.set(roomDocRef(code), roomDocFromRuntime(room), { merge: true });
    batch.set(handDocRef(code, botId), { cards: botHand }, { merge: true });

    const ids = new Set(affectedPlayerIds);
    ids.add(botId);
    ids.forEach(id => {
      const p = room.players.find(pl => pl.id === id);
      if (!p) return;
      batch.set(playersCol(code).doc(id), {
        tricksWon: p.tricksWon,
        score: p.score,
        roundScores: p.roundScores || [],
        handSize: id === botId ? botHand.length : (p.handSize ?? 0)
      }, { merge: true });
    });

    await batch.commit();
  }

  async function persistPlayFast(code, room, ownHand, affectedPlayerIds) {
    const seatId = mySeatId();
    const batch = db.batch();
    batch.set(roomDocRef(code), roomDocFromRuntime(room), { merge: true });
    batch.set(handDocRef(code, seatId), { cards: ownHand }, { merge: true });

    const ids = new Set(affectedPlayerIds);
    ids.add(seatId);
    ids.forEach(id => {
      const p = room.players.find(pl => pl.id === id);
      if (!p) return;
      batch.set(playersCol(code).doc(id), {
        tricksWon: p.tricksWon,
        score: p.score,
        roundScores: p.roundScores || [],
        handSize: id === seatId ? ownHand.length : (p.handSize ?? 0)
      }, { merge: true });
    });

    await batch.commit();
  }

  function roomDocRef(code) {
    return db.collection('rooms').doc(code);
  }

  function playersCol(code) {
    return roomDocRef(code).collection('players');
  }

  function handDocRef(code, playerId) {
    return roomDocRef(code).collection('hands').doc(playerId);
  }

  async function uniqueRoomCode() {
    for (let i = 0; i < 12; i++) {
      const code = Engine().generateRoomCode();
      const snap = await roomDocRef(code).get();
      if (!snap.exists) return code;
    }
    throw new Error('Could not generate a unique room code.');
  }

  async function loadPlayerDocs(code) {
    const snap = await playersCol(code).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function loadAllHands(code, playerIds) {
    const handsById = {};
    await Promise.all(playerIds.map(async (id) => {
      const snap = await handDocRef(code, id).get();
      handsById[id] = snap.exists ? (snap.data().cards || []) : [];
    }));
    return handsById;
  }

  /** Host loads every hand; other players use the live private-hand snapshot. */
  async function loadHandsForAction(code, playerIds, roomDoc) {
    const isHost = roomDoc?.hostId === uid;
    if (isHost) {
      return getHostHands(code, playerIds);
    }
    return handsForLocalPlay(roomDoc);
  }

  function buildRuntimeRoom(roomDoc, playerDocs, handsById) {
    const room = Engine().hydrateRoom(roomDoc, playerDocs);
    room.players = Engine().buildPlayersArray(room, handsById);
    return room;
  }

  function roomDocFromRuntime(room) {
    const doc = {
      roomCode: room.roomCode,
      mode: room.mode,
      playerCount: room.maxPlayers,
      hookRule: room.hookRule,
      hostId: room.hostId,
      status: room.status,
      dealerIndex: room.dealerIndex,
      currentRound: room.currentRound,
      maxRounds: room.maxRounds,
      jobCard: room.jobCard,
      trumpSuit: room.trumpSuit,
      trumpCard: room.trumpCard || null,
      trumpSuitIndex: room.trumpSuitIndex != null ? room.trumpSuitIndex : null,
      jobCardHistory: room.jobCardHistory || [],
      activePlayerIndex: room.activePlayerIndex,
      currentTrick: room.currentTrick || [],
      hostVoiceLog: room.hostVoiceLog || [],
      scoresHistory: room.scoresHistory || [],
      trickWinnerHistory: room.trickWinnerHistory || [],
      trickTransitionUntil: room.trickTransitionUntil || null,
      pendingWinnerId: room.pendingWinnerId || null,
      playerIds: room.playerIds,
      version: room.version || 0
    };
    return global.StandardRules ? global.StandardRules.stripUndefined(doc) : doc;
  }

  async function persistRoomState(code, room, handsById, options = {}) {
    const writeHands = options.writeHands || 'all';
    const batch = db.batch();
    const roomRef = roomDocRef(code);
    batch.set(roomRef, roomDocFromRuntime(room), { merge: true });

    room.players.forEach(p => {
      const playerRef = playersCol(code).doc(p.id);
      const storedMeta = room.playersById[p.id] || {};
      const fromHand = (handsById[p.id] || []).length;
      const handSize = writeHands === 'all'
        ? fromHand
        : (p.id === uid && writeHands === 'own')
          ? fromHand
          : (storedMeta.handSize ?? p.handSize ?? fromHand);

      batch.set(playerRef, {
        id: p.id,
        name: p.name,
        avatar: p.avatar || storedMeta.avatar || (p.isBot ? '🤖' : null),
        active: p.active,
        tricksWon: p.tricksWon,
        currentBid: p.currentBid,
        score: p.score,
        roundScores: p.roundScores || [],
        isBot: !!p.isBot,
        botType: p.botType || Engine().resolveBotType({ isBot: p.isBot, botType: storedMeta.botType }, room),
        order: room.playerIds.indexOf(p.id),
        handSize
      }, { merge: true });

      const shouldWriteHand = writeHands === 'all'
        || (writeHands === 'own' && p.id === uid)
        || (writeHands === 'host-or-bot' && (room.hostId === uid || p.isBot));

      if (shouldWriteHand) {
        const handRef = handDocRef(code, p.id);
        batch.set(handRef, { cards: handsById[p.id] || [] }, { merge: true });
      }
    });

    await batch.commit();
    if (writeHands === 'all' && room.hostId === uid) {
      updateHostHandsCache(handsById, room.version || 0);
    }
  }

  function buildSyncPayload(room) {
    const docById = {};
    latestPlayers.forEach(p => { docById[p.id] = p; });

    const sanitizedPlayers = room.players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar || docById[p.id]?.avatar || (p.isBot ? '🤖' : null),
      active: p.active,
      tricksWon: p.tricksWon,
      currentBid: p.currentBid,
      score: p.score,
      handSize: p.handSize != null ? p.handSize : (p.hand || []).length,
      roundScores: p.roundScores || [],
      isBot: !!p.isBot,
      botType: docById[p.id]?.botType || p.botType || Engine().resolveBotType({ isBot: p.isBot, botType: null }, room),
    }));

    return {
      type: 'sync',
      roomCode: room.roomCode,
      mode: room.mode,
      maxPlayers: room.maxPlayers,
      playerCount: room.maxPlayers,
      hookRule: room.hookRule,
      status: room.status,
      dealerIndex: room.dealerIndex,
      currentRound: room.currentRound,
      maxRounds: room.maxRounds,
      jobCard: room.jobCard,
      trumpSuit: room.trumpSuit,
      trumpCard: room.trumpCard || null,
      trumpSuitIndex: room.trumpSuitIndex != null ? room.trumpSuitIndex : null,
      activePlayerIndex: room.activePlayerIndex,
      currentTrick: room.currentTrick || [],
      players: sanitizedPlayers,
      hostVoiceLog: room.hostVoiceLog || [],
      paused: room.players.some(pl => !pl.active && !pl.isBot),
      hostId: room.hostId,
      privateHand,
      myPlayerId: mySeatId()
    };
  }

  function publishLocalSync() {
    if (!latestRoomDoc || !latestPlayers.length) return;
    const handsById = {};
    latestPlayers.forEach(p => { handsById[p.id] = p.id === mySeatId() ? privateHand : []; });
    const room = buildRuntimeRoom(latestRoomDoc, latestPlayers, handsById);
    emit(buildSyncPayload(room));

    if (latestRoomDoc.status === 'game_over' && !latestRoomDoc.historySaved && latestRoomDoc.hostId === uid) {
      saveCompletedGame(latestRoomDoc, latestPlayers).catch(err => console.error('Save game history failed:', err));
    }
  }

  async function resetGameToLobby(code, roomDoc, playerDocs, logMessage) {
    const handsById = {};
    roomDoc.playerIds.forEach(id => { handsById[id] = []; });
    const room = buildRuntimeRoom(roomDoc, playerDocs, handsById);

    room.status = 'lobby';
    room.currentRound = 0;
    room.dealerIndex = 0;
    room.jobCard = null;
    room.trumpSuit = null;
    room.jobCardHistory = [];
    room.currentTrick = [];
    room.trickWinnerHistory = [];
    room.hostVoiceLog = [{ timestamp: Date.now(), text: logMessage }];
    room.scoresHistory = [];
    room.trickTransitionUntil = null;
    room.pendingWinnerId = null;
    room.pendingAction = null;
    room.activePlayerIndex = 0;

    room.players.forEach(p => {
      p.score = 0;
      p.roundScores = [];
      p.currentBid = null;
      p.tricksWon = 0;
    });

    room.version = (roomDoc.version || 0) + 1;
    await persistRoomState(code, room, handsById);
    invalidateHostHandsCache();
  }

  async function saveCompletedGame(roomDoc, playerDocs) {
    if (roomDoc.historySaved || roomDoc.status !== 'game_over') return;

    const participants = playerDocs.filter(p => !p.isBot && !String(p.id).startsWith('bot-')).map(p => p.id);
    let maxScore = -999999;
    playerDocs.forEach(p => { if (p.score > maxScore) maxScore = p.score; });
    const winners = playerDocs.filter(p => p.score === maxScore).map(p => p.name);

    const gameId = `${roomDoc.roomCode}-${Date.now()}`;
    const completedAt = global.firebase.firestore.FieldValue.serverTimestamp();

    const fullRecord = {
      gameId,
      roomCode: roomDoc.roomCode,
      completedAt,
      mode: roomDoc.mode,
      hookRule: roomDoc.hookRule,
      maxRounds: roomDoc.maxRounds,
      playerNames: playerDocs.map(p => p.name),
      participants,
      scoresHistory: roomDoc.scoresHistory || [],
      players: playerDocs.map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        roundScores: p.roundScores || [],
        isBot: !!p.isBot
      })),
      winners
    };

    const batch = db.batch();
    batch.set(db.collection('completedGames').doc(gameId), fullRecord);

    const summary = {
      gameId,
      roomCode: roomDoc.roomCode,
      completedAt,
      playerNames: fullRecord.playerNames,
      winners,
      topScore: maxScore,
      mode: roomDoc.mode
    };

    participants.forEach(participantId => {
      batch.set(db.collection('users').doc(participantId).collection('gameHistory').doc(gameId), summary);
    });

    batch.set(roomDocRef(roomDoc.roomCode), { historySaved: true }, { merge: true });
    await batch.commit();
  }

  async function executeNextRound(code, roomDoc) {
    const playerDocs = await loadPlayerDocs(code);
    const handsById = await loadAllHands(code, roomDoc.playerIds);
    const room = buildRuntimeRoom(roomDoc, playerDocs, handsById);

    room.currentRound += 1;
    if (room.currentRound > room.maxRounds) {
      room.status = 'game_over';
      Engine().resolveGameWinners(room);
    } else {
      room.dealerIndex = (room.dealerIndex + 1) % room.playerCount;
      if (Engine().isStandardMode(room.mode)) {
        Engine().startRound(room, handsById);
      } else {
        room.jobCardHistory = room.jobCardHistory || [];
        if (room.jobCard?.key && !room.jobCardHistory.includes(room.jobCard.key)) {
          room.jobCardHistory.push(room.jobCard.key);
        }

        const fullDeck = Engine().createDeck(room.mode);
        const newJobCard = Engine().pickJobCard(fullDeck, room.jobCardHistory);
        room.jobCard = newJobCard;
        room.trumpSuit = Engine().resolveTrumpSuit(newJobCard);
        if (!room.jobCardHistory.includes(newJobCard.key)) {
          room.jobCardHistory.push(newJobCard.key);
        }

        Engine().announce(room, `Round ${room.currentRound} — ${Engine().formatTrumpAnnouncement(newJobCard)}`);
        Engine().startRound(room, handsById);
      }
    }

    room.pendingAction = null;
    room.version = (room.version || 0) + 1;
    await persistRoomState(code, room, handsById);
    updateHostHandsCache(handsById, room.version);
  }

  async function processPendingRoomAction(roomDoc) {
    if (!roomDoc?.pendingAction || roomDoc.hostId !== uid || processingHost) return;

    processingHost = true;
    try {
      if (roomDoc.pendingAction.type === 'next_round' && roomDoc.status === 'round_end') {
        await executeNextRound(currentRoomCode, roomDoc);
      }
    } finally {
      processingHost = false;
    }
  }

  async function runHostAutomation() {
    if (!currentRoomCode || !latestRoomDoc || latestRoomDoc.hostId !== uid || processingHost) return;

    if (latestRoomDoc.pendingAction) {
      await processPendingRoomAction(latestRoomDoc);
      return;
    }

    if (['lobby', 'game_over', 'round_end'].includes(latestRoomDoc.status)) return;

    const playerDocs = latestPlayers;
    const handsById = await getHostHands(currentRoomCode, latestRoomDoc.playerIds);
    const room = buildRuntimeRoom(latestRoomDoc, playerDocs, handsById);

    if (room.players.some(p => !p.active && !p.isBot)) return;

    processingHost = true;
    try {
      if (room.trickTransitionUntil && Date.now() >= room.trickTransitionUntil) {
        const mutableRoom = buildRuntimeRoom(latestRoomDoc, playerDocs, handsById);
        Engine().finishTrickTransition(mutableRoom, handsById);
        mutableRoom.version = (mutableRoom.version || 0) + 1;
        await persistRoomState(currentRoomCode, mutableRoom, handsById);
        updateHostHandsCache(handsById, mutableRoom.version);
        await maybeRunBots(mutableRoom, handsById);
        return;
      }

      if (room.status === 'bidding' || room.status === 'play') {
        await maybeRunBots(room, handsById);
      }
    } finally {
      processingHost = false;
    }
  }

  async function maybeRunBots(room, handsById) {
    if (room.trickTransitionUntil) return;
    const active = room.players[room.activePlayerIndex];
    if (!active || !active.isBot) return;
    if (botActionInFlight) return;

    botActionInFlight = true;
    try {
      await new Promise(resolve => setTimeout(resolve, 280));

      if (!currentRoomCode || !latestRoomDoc) return;
      const freshPlayers = latestPlayers;
      const freshRoomDoc = latestRoomDoc;
      const freshHands = await getHostHands(currentRoomCode, freshRoomDoc.playerIds);
      const freshRoom = buildRuntimeRoom(freshRoomDoc, freshPlayers, freshHands);
      const activeNow = freshRoom.players[freshRoom.activePlayerIndex];
      if (!activeNow || !activeNow.isBot || activeNow.id !== active.id) return;
      if (freshRoom.trickTransitionUntil) return;

      if (freshRoom.status === 'bidding') {
        let bidVal;
        if (global.BotClient && global.BotClient.isNeuralBot(activeNow, freshRoom)) {
          try {
            bidVal = await global.BotClient.playNeuralBotBid(freshRoom, freshHands, activeNow.id);
          } catch (err) {
            console.warn('Neural bid failed, using heuristic:', err);
            bidVal = Engine().playBotBid(freshRoom);
          }
        } else {
          bidVal = Engine().playBotBid(freshRoom);
        }
        const result = Engine().placeBid(freshRoom, activeNow.id, bidVal);
        if (!result.ok) return;
        freshRoom.version = (freshRoom.version || 0) + 1;
        applyLocalRuntime(freshRoom);
        await persistBidFast(currentRoomCode, freshRoom, activeNow.id);
      } else if (freshRoom.status === 'play') {
        let cardKey;
        if (global.BotClient && global.BotClient.isNeuralBot(activeNow, freshRoom)) {
          try {
            cardKey = await global.BotClient.playNeuralBotCard(freshRoom, freshHands, activeNow.id);
          } catch (err) {
            console.warn('Neural play failed, using heuristic:', err);
            cardKey = Engine().playBotCard(freshRoom, freshHands, activeNow);
          }
        } else {
          cardKey = Engine().playBotCard(freshRoom, freshHands, activeNow);
        }
        if (!cardKey) return;
        const result = Engine().playCard(freshRoom, freshHands, activeNow.id, cardKey);
        if (!result.ok) return;
        freshRoom.version = (freshRoom.version || 0) + 1;
        const affected = [activeNow.id];
        if (freshRoom.pendingWinnerId) affected.push(freshRoom.pendingWinnerId);
        applyLocalRuntime(freshRoom);
        updateHostHandsCache(freshHands, freshRoom.version);
        await persistBotPlayFast(currentRoomCode, freshRoom, freshHands[activeNow.id], activeNow.id, affected);
      }
    } finally {
      botActionInFlight = false;
    }
  }

  function startHostLoop() {
    clearInterval(hostTickTimer);
    hostTickTimer = setInterval(() => {
      runHostAutomation().catch(err => console.error('Host automation error:', err));
    }, 250);
  }

  function stopHostLoop() {
    clearInterval(hostTickTimer);
    clearTimeout(botTimer);
    hostTickTimer = null;
    botTimer = null;
  }

  function subscribeToRoom(code) {
    unsubscribeFromRoom();

    unsubRoom = roomDocRef(code).onSnapshot({ includeMetadataChanges: false }, (snap) => {
      if (!snap.exists) return;
      latestRoomDoc = snap.data();
      if ((latestRoomDoc.version || 0) >= optimisticVersion) {
        optimisticVersion = 0;
      }
      schedulePublishSync();
      if (latestRoomDoc.hostId === uid) {
        runHostAutomation().catch(console.error);
      }
    });

    unsubPlayers = playersCol(code).onSnapshot({ includeMetadataChanges: false }, (snap) => {
      latestPlayers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      schedulePublishSync();
      if (latestRoomDoc?.hostId === uid) {
        runHostAutomation().catch(console.error);
      }
    });

    unsubHand = handDocRef(code, seatPlayerId || uid).onSnapshot({ includeMetadataChanges: false }, (snap) => {
      privateHand = Engine().sortHand(snap.exists ? (snap.data().cards || []) : []);
      schedulePublishSync();
    });
  }

  function unsubscribeFromRoom() {
    if (unsubRoom) unsubRoom();
    if (unsubPlayers) unsubPlayers();
    if (unsubHand) unsubHand();
    unsubRoom = unsubPlayers = unsubHand = null;
    latestRoomDoc = null;
    latestPlayers = [];
    privateHand = [];
    invalidateHostHandsCache();
    optimisticVersion = 0;
  }

  async function markActive(code, active) {
    const playerId = seatPlayerId || uid;
    if (!code || !playerId) return;
    await playersCol(code).doc(playerId).set({ active }, { merge: true });
  }

  function clearSavedSession() {
    localStorage.removeItem('wiz_roomCode');
    localStorage.removeItem('wiz_playerId');
    localStorage.removeItem('wiz_playerName');
  }

  function detachFromRoom() {
    unsubscribeFromRoom();
    currentRoomCode = null;
    myPlayerName = null;
    seatPlayerId = null;
  }

  const WizardFirebase = {
    init(onMsg, onErr) {
      onMessage = onMsg;
      onError = onErr;

      if (!global.firebaseConfigured) {
        fail('Firebase is not configured. Edit public/firebase-config.js with your project keys.');
        return Promise.reject(new Error('Firebase not configured'));
      }

      if (!global.firebase.apps.length) {
        global.firebase.initializeApp(global.firebaseConfig);
      }

      db = global.firebase.firestore();
      auth = global.firebase.auth();

      db.enablePersistence({ synchronizeTabs: false }).catch(() => {});

      window.addEventListener('beforeunload', () => {
        if (currentRoomCode) markActive(currentRoomCode, false);
      });

      return auth.signInAnonymously().then(cred => {
        uid = cred.user.uid;
        startHostLoop();
        return uid;
      });
    },

    getUid() {
      return uid;
    },

    async handleAction(type, roomCode, playerId, playerName, data = {}) {
      if (!db || !uid) {
        fail('Not connected to Firebase yet.');
        return;
      }

      try {
        switch (type) {
          case 'create_room':
            await this.createRoom(data);
            break;
          case 'join_room':
            await this.joinRoom(roomCode, playerId, playerName, data.avatar);
            break;
          case 'add_bot':
            await this.addBot(data);
            break;
          case 'start_game':
            await this.startGame();
            break;
          case 'place_bid':
            await this.placeBid(data.bid);
            break;
          case 'play_card':
            await this.playCard(data.cardKey);
            break;
          case 'next_round':
            await this.nextRound();
            break;
          case 'restart_game':
            await this.restartGame();
            break;
          case 'abandon_game':
            await this.abandonToLobby();
            break;
          case 'end_game':
            await this.endGameEarly();
            break;
          default:
            fail(`Unknown action: ${type}`);
        }
      } catch (err) {
        console.error(err);
        fail(err.message || 'Something went wrong.');
      }
    },

    async createRoom(data) {
      const { mode, playerCount, hookRule, hostName, avatar } = data;
      const maxPlayers = parseInt(playerCount, 10);
      const effectiveHook = mode === 'standard' ? false : !!hookRule;
      const code = await uniqueRoomCode();
      const maxRounds = Engine().getRoundsCount(mode, maxPlayers);

      myPlayerName = hostName;
      currentRoomCode = code;
      seatPlayerId = uid;

      await roomDocRef(code).set({
        roomCode: code,
        mode,
        playerCount: maxPlayers,
        hookRule: effectiveHook,
        hostId: uid,
        status: 'lobby',
        dealerIndex: 0,
        currentRound: 0,
        maxRounds,
        jobCard: null,
        trumpSuit: null,
        trumpCard: null,
        trumpSuitIndex: null,
        jobCardHistory: [],
        activePlayerIndex: 0,
        currentTrick: [],
        hostVoiceLog: [{ timestamp: Date.now(), text: `Welcome to Wizard! Room ${code} created by ${hostName}.` }],
        scoresHistory: [],
        trickWinnerHistory: [],
        trickTransitionUntil: null,
        pendingWinnerId: null,
        playerIds: [uid],
        version: 1
      });

      await playersCol(code).doc(uid).set({
        id: uid,
        name: hostName,
        avatar: avatar || '🧙',
        active: true,
        tricksWon: 0,
        currentBid: null,
        score: 0,
        roundScores: [],
        isBot: false,
        order: 0
      });

      await handDocRef(code, uid).set({ cards: [] });

      subscribeToRoom(code);
      emit({ type: 'created', roomCode: code, playerId: uid, playerName: hostName });
    },

    async joinRoom(roomCode, reconnectId, playerName, avatar) {
      const code = roomCode.toUpperCase();
      const snap = await roomDocRef(code).get();
      if (!snap.exists) {
        fail('Room not found.');
        return;
      }

      const roomDoc = snap.data();
      currentRoomCode = code;

      if (reconnectId) {
        const existing = await playersCol(code).doc(reconnectId).get();
        if (existing.exists) {
          myPlayerName = existing.data().name;
          seatPlayerId = reconnectId;
          await playersCol(code).doc(reconnectId).set({ active: true }, { merge: true });
          const roomRef = roomDocRef(code);
          const fresh = (await roomRef.get()).data();
          fresh.hostVoiceLog = fresh.hostVoiceLog || [];
          fresh.hostVoiceLog.push({ timestamp: Date.now(), text: `${myPlayerName} has reconnected.` });
          await roomRef.set({ hostVoiceLog: fresh.hostVoiceLog }, { merge: true });
          subscribeToRoom(code);
          emit({ type: 'joined', roomCode: code, playerId: reconnectId, playerName: myPlayerName });
          return;
        }
      }

      if (roomDoc.status !== 'lobby') {
        fail('Game already in progress.');
        return;
      }

      if ((roomDoc.playerIds || []).length >= roomDoc.playerCount) {
        fail('Room is already full.');
        return;
      }

      myPlayerName = playerName || `Player ${(roomDoc.playerIds || []).length + 1}`;
      const order = roomDoc.playerIds.length;
      seatPlayerId = uid;

      await playersCol(code).doc(uid).set({
        id: uid,
        name: myPlayerName,
        avatar: avatar || '🧝',
        active: true,
        tricksWon: 0,
        currentBid: null,
        score: 0,
        roundScores: [],
        isBot: false,
        order
      });

      await handDocRef(code, uid).set({ cards: [] });

      const updatedIds = [...roomDoc.playerIds, uid];
      const log = roomDoc.hostVoiceLog || [];
      log.push({ timestamp: Date.now(), text: `${myPlayerName} joined the lobby.` });
      if (updatedIds.length === roomDoc.playerCount) {
        log.push({ timestamp: Date.now(), text: 'Lobby is full! Host can now start the game.' });
      }

      await roomDocRef(code).set({
        playerIds: updatedIds,
        hostVoiceLog: log,
        version: (roomDoc.version || 0) + 1
      }, { merge: true });

      subscribeToRoom(code);
      emit({ type: 'joined', roomCode: code, playerId: uid, playerName: myPlayerName });
    },

    async addBot(data = {}) {
      const botType = data.botType || 'neural_v7';
      const code = currentRoomCode;
      const roomDoc = (await roomDocRef(code).get()).data();
      if (!roomDoc || roomDoc.status !== 'lobby') return;
      if (roomDoc.hostId !== uid) {
        fail('Only the host can add bots.');
        return;
      }
      if (roomDoc.playerIds.length >= roomDoc.playerCount) {
        fail('Lobby is already full.');
        return;
      }

      if (botType !== 'heuristic' && global.BotClient) {
        const check = global.BotClient.neuralSetupValid({
          mode: roomDoc.mode,
          hookRule: roomDoc.hookRule,
          playerCount: roomDoc.playerCount
        }, botType);
        if (!check.ok) {
          fail(check.message);
          return;
        }
      }

      const playerDocs = await loadPlayerDocs(code);
      const botNames = ['Merlin', 'Gandalf', 'Saruman', 'Dumbledore', 'Hermione', 'Voldemort', 'Radagast', 'Alatar', 'Pallando'];
      let botName = '';
      for (const name of botNames) {
        const proposed = `Bot ${name}`;
        if (!playerDocs.some(p => p.name === proposed)) {
          botName = proposed;
          break;
        }
      }
      if (!botName) botName = `Bot ${roomDoc.playerIds.length + 1}`;

      const botId = `bot-${Math.random().toString(36).substring(2, 9)}`;
      const order = roomDoc.playerIds.length;
      const updatedIds = [...roomDoc.playerIds, botId];
      const log = roomDoc.hostVoiceLog || [];
      const label = Engine().botTypeLabel(botType);
      log.push({ timestamp: Date.now(), text: `${botName} (${label} AI) joined the lobby.` });
      if (updatedIds.length === roomDoc.playerCount) {
        log.push({ timestamp: Date.now(), text: 'Lobby is full! Host can now start the game.' });
      }

      await playersCol(code).doc(botId).set({
        id: botId,
        name: botName,
        avatar: '🤖',
        active: true,
        tricksWon: 0,
        currentBid: null,
        score: 0,
        roundScores: [],
        isBot: true,
        botType,
        order
      });
      await handDocRef(code, botId).set({ cards: [] });
      await roomDocRef(code).set({ playerIds: updatedIds, hostVoiceLog: log, version: (roomDoc.version || 0) + 1 }, { merge: true });
    },

    async startGame() {
      const code = currentRoomCode;
      const roomDoc = (await roomDocRef(code).get()).data();
      if (!roomDoc || roomDoc.hostId !== uid) {
        fail('Only the host can start the game.');
        return;
      }
      if (roomDoc.playerIds.length < roomDoc.playerCount) {
        fail('Waiting for more players to join.');
        return;
      }

      const playerDocs = await loadPlayerDocs(code);
      const handsById = await loadAllHands(code, roomDoc.playerIds);
      const room = buildRuntimeRoom(roomDoc, playerDocs, handsById);

      room.status = 'deal';
      room.currentRound = 1;
      room.dealerIndex = 0;

      if (Engine().isStandardMode(room.mode)) {
        room.jobCard = null;
        room.trumpSuit = null;
        room.trumpCard = null;
        room.trumpSuitIndex = null;
        room.jobCardHistory = [];
        Engine().announce(room, 'Standard official rules — Champion bots ready.');
        Engine().startRound(room, handsById);
      } else {
        const fullDeck = Engine().createDeck(room.mode);
        const jobCard = Engine().pickJobCard(fullDeck, []);
        room.jobCard = jobCard;
        room.trumpSuit = Engine().resolveTrumpSuit(jobCard);
        room.jobCardHistory = [jobCard.key];
        Engine().announce(room, Engine().formatTrumpAnnouncement(jobCard));
        Engine().startRound(room, handsById);
      }
      room.version = (room.version || 0) + 1;

      await persistRoomState(code, room, handsById);
      updateHostHandsCache(handsById, room.version);
    },

    async placeBid(bidAmount) {
      if (actionInFlight) return;
      actionInFlight = true;
      try {
        const { roomDoc, playerDocs, code } = requireCachedState();
        const room = buildRuntimeRoom(roomDoc, playerDocs, {});
        const result = Engine().placeBid(room, mySeatId(), parseInt(bidAmount, 10));
        if (!result.ok) {
          fail(result.message);
          return;
        }

        room.version = (roomDoc.version || 0) + 1;
        applyLocalRuntime(room);
        await persistBidFast(code, room, mySeatId());
      } catch (err) {
        console.error(err);
        fail(err.message || 'Failed to place bid.');
      } finally {
        actionInFlight = false;
      }
    },

    async playCard(cardKey) {
      if (actionInFlight) return;
      actionInFlight = true;
      try {
        const { roomDoc, playerDocs, code } = requireCachedState();
        const handsById = handsForLocalPlay(roomDoc);
        const room = buildRuntimeRoom(roomDoc, playerDocs, handsById);

        const result = Engine().playCard(room, handsById, mySeatId(), cardKey);
        if (!result.ok) {
          fail(result.message);
          return;
        }

        privateHand = handsById[mySeatId()];
        room.version = (roomDoc.version || 0) + 1;

        const affected = [mySeatId()];
        if (room.pendingWinnerId) affected.push(room.pendingWinnerId);

        applyLocalRuntime(room);
        await persistPlayFast(code, room, privateHand, affected);
        if (roomDoc.hostId === uid && cachedHostHands) {
          cachedHostHands[mySeatId()] = [...privateHand];
          updateHostHandsCache(cachedHostHands, room.version);
        }
      } catch (err) {
        console.error(err);
        fail(err.message || 'Failed to play card.');
      } finally {
        actionInFlight = false;
      }
    },

    async nextRound() {
      const code = currentRoomCode;
      const roomDoc = (await roomDocRef(code).get()).data();
      if (roomDoc.status !== 'round_end') return;

      if (roomDoc.hostId !== uid) {
        await roomDocRef(code).set({
          pendingAction: { type: 'next_round', requestedBy: uid, at: Date.now() },
          version: (roomDoc.version || 0) + 1
        }, { merge: true });
        return;
      }

      await executeNextRound(code, roomDoc);
    },

    async endGameEarly() {
      const code = currentRoomCode;
      const roomDoc = (await roomDocRef(code).get()).data();
      if (!roomDoc || roomDoc.hostId !== uid) {
        fail('Only the host can end the game.');
        return;
      }
      if (roomDoc.status === 'lobby' || roomDoc.status === 'game_over') return;

      const playerDocs = await loadPlayerDocs(code);
      const handsById = await loadAllHands(code, roomDoc.playerIds);
      const room = buildRuntimeRoom(roomDoc, playerDocs, handsById);

      room.status = 'game_over';
      Engine().announce(room, 'The host has ended the game early.');
      Engine().resolveGameWinners(room);
      room.version = (room.version || 0) + 1;
      await persistRoomState(code, room, handsById);
    },

    async restartGame() {
      const code = currentRoomCode;
      const roomDoc = (await roomDocRef(code).get()).data();
      if (!roomDoc || roomDoc.hostId !== uid) {
        fail('Only the host can return everyone to the lobby.');
        return;
      }
      const playerDocs = await loadPlayerDocs(code);
      await resetGameToLobby(code, roomDoc, playerDocs, 'Game has been reset. Ready to start again!');
    },

    async abandonToLobby() {
      const { roomDoc, playerDocs, code } = requireCachedState();
      const host = playerDocs.find(p => p.id === roomDoc.hostId);
      if (!host || host.isBot || host.active) {
        fail('The host is still connected. Wait for them to continue the game.');
        return;
      }

      const me = playerDocs.find(p => p.id === mySeatId());
      if (!me?.active) {
        fail('You must be connected to reset the game.');
        return;
      }

      if (!['round_end', 'bidding', 'play'].includes(roomDoc.status)) {
        fail('The game cannot be reset right now.');
        return;
      }

      await resetGameToLobby(
        code,
        roomDoc,
        playerDocs,
        `${me.name} returned everyone to the lobby (host was offline).`
      );
    },

    async reconnectSavedRoom(savedRoom, savedPlayerId, savedPlayerName) {
      try {
        const code = savedRoom.toUpperCase();
        const snap = await roomDocRef(code).get();
        if (!snap.exists) {
          clearSavedSession();
          emit({ type: 'reconnect_failed', message: 'That room no longer exists.' });
          return;
        }

        const roomDoc = snap.data();
        if (roomDoc.status === 'game_over') {
          clearSavedSession();
          emit({ type: 'reconnect_failed', message: 'That game has already finished.' });
          return;
        }

        const existing = await playersCol(code).doc(savedPlayerId).get();
        if (!existing.exists) {
          clearSavedSession();
          emit({ type: 'reconnect_failed', message: 'Your seat in that game is no longer available.' });
          return;
        }

        await this.joinRoom(savedRoom, savedPlayerId, savedPlayerName);
      } catch (err) {
        console.error(err);
        clearSavedSession();
        emit({ type: 'reconnect_failed', message: err.message || 'Could not rejoin the game.' });
      }
    },

    async leaveGame() {
      const code = currentRoomCode;
      try {
        if (code) await markActive(code, false);
      } catch (err) {
        console.warn('Could not mark player inactive:', err);
      }
      clearSavedSession();
      detachFromRoom();
      emit({ type: 'left' });
    },

    async listPastGames(roomCodeFilter = '') {
      if (!db || !uid) return [];
      const snap = await db.collection('users').doc(uid).collection('gameHistory')
        .orderBy('completedAt', 'desc')
        .limit(40)
        .get();

      let games = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const filter = roomCodeFilter.trim().toUpperCase();
      if (filter) {
        games = games.filter(g => (g.roomCode || '').includes(filter));
      }
      return games;
    },

    async getPastGame(gameId) {
      if (!db || !uid) return null;
      const snap = await db.collection('completedGames').doc(gameId).get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data.participants || !data.participants.includes(uid)) return null;
      return data;
    },

    destroy() {
      stopHostLoop();
      unsubscribeFromRoom();
    }
  };

  global.WizardFirebase = WizardFirebase;
})(window);
