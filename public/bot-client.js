(function (global) {
  const Engine = () => global.GameEngine;
  const SR = () => global.StandardRules;
  const Config = () => global.BotConfig;
  const IdMap = () => global.BotIdMap;

  function isNeuralBot(player, room) {
    if (!player?.isBot) return false;
    const botType = room && global.GameEngine?.resolveBotType
      ? global.GameEngine.resolveBotType(player, room)
      : (player.botType || 'neural_v7');
    return botType === 'neural_v6' || botType === 'neural_v7' || botType === 'neural_v7_house';
  }

  function modelForBotType(botType) {
    if (botType === 'neural_v6') return 'v6';
    // Render currently serves v7 only; house mode uses v7 with HOME trump mapping until v7_house is deployed.
    if (botType === 'neural_v7_house') return 'v7';
    if (botType === 'neural_v7') return 'v7';
    return 'v7';
  }

  function neuralSetupValid(room, botType) {
    const n = room.playerCount || room.players?.length || 0;
    if (botType === 'neural_v7_house') {
      if (!room || room.mode !== 'normal') {
        return { ok: false, message: 'Champion v7 HOME requires HOME Rules mode.' };
      }
      if (n !== 3 && n !== 4) {
        return { ok: false, message: 'Champion v7 HOME supports 3 or 4 players.' };
      }
      return { ok: true };
    }
    if (!room || room.mode !== 'standard') {
      return { ok: false, message: 'Champion bots require Standard (Official) mode.' };
    }
    if (room.hookRule) return { ok: false, message: 'Champion bots require Hook Rule off.' };
    if (botType === 'neural_v6' && n !== 3) {
      return { ok: false, message: 'Champion v6 supports exactly 3 players.' };
    }
    if (botType === 'neural_v7' && n !== 3 && n !== 4) {
      return { ok: false, message: 'Champion v7 supports 3 or 4 players.' };
    }
    return { ok: true };
  }

  function seatIndex(room, playerId) {
    return room.players.findIndex(p => p.id === playerId);
  }

  function resolveTrumpForPayload(room) {
    if (room.mode === 'standard') {
      return {
        trump: room.trumpSuitIndex ?? -1,
        trumpCard: IdMap().appCardIdToBotId(room.trumpCard?.id ?? -1)
      };
    }
    const job = room.jobCard;
    if (!job || job.id == null) return { trump: -1, trumpCard: -1 };
    const trump = (job.value >= 2 && job.value <= 14) ? job.suit : -1;
    return {
      trump,
      trumpCard: IdMap().appCardIdToBotId(job.id)
    };
  }

  function collectSeenForPayload(room, handsById) {
    const rules = SR();
    const seen = new Set(rules.collectSeenCardIds(room, handsById));
    if (room.mode === 'normal' && room.jobCard?.id != null) {
      seen.add(room.jobCard.id);
    }
    return [...seen];
  }

  function getLegalCardIdsForBot(room, hand) {
    if (room.mode === 'standard') {
      return IdMap().mapAppIds(
        SR().getLegalCardIds(hand, room.currentTrick, room.trumpSuitIndex ?? -1)
      );
    }
    const legal = hand.filter(c => Engine().canPlayCard(hand, c, room.currentTrick || [], room));
    return IdMap().mapAppIds(legal.map(c => c.id));
  }

  function buildActPayload(room, handsById, playerId, phase) {
    const player = room.players.find(p => p.id === playerId);
    const botType = global.GameEngine?.resolveBotType?.(player, room) || player?.botType || 'neural_v7';
    if (botType === 'neural_v7_house') {
      if (room.mode !== 'normal') {
        throw new Error('Champion v7 (HOME) requires HOME Rules mode');
      }
    } else if (room.mode !== 'standard') {
      throw new Error('Champion bots require Standard (Official) mode');
    }

    const seat = seatIndex(room, playerId);
    const hand = handsById[playerId] || [];
    const rules = SR();
    const trumpInfo = resolveTrumpForPayload(room);

    const bids = room.players.map(p => p.currentBid);
    const taken = room.players.map(p => p.tricksWon);

    const trick = (room.currentTrick || []).map(entry => ({
      seat: seatIndex(room, entry.playerId),
      card: IdMap().appCardIdToBotId(entry.card.id)
    }));

    const legalActions = phase === 'bid'
      ? (room.hookRule && Engine().getLegalBotBids
        ? Engine().getLegalBotBids(room)
        : rules.getLegalBidValues(room.currentRound))
      : getLegalCardIdsForBot(room, hand);

    const playerCount = room.maxPlayers || room.playerCount || room.players?.length || 3;

    const handsPayload = {};
    handsPayload[String(seat)] = IdMap().mapAppIds(hand.map(c => c.id));

    return {
      protocol: 1,
      model: modelForBotType(botType),
      num_players: playerCount,
      seat,
      phase,
      round: room.currentRound,
      trump: trumpInfo.trump,
      trump_card: trumpInfo.trumpCard,
      dealer: room.dealerIndex,
      starter: (room.dealerIndex + 1) % playerCount,
      hands: handsPayload,
      bids,
      taken,
      trick,
      seen: IdMap().mapAppIds(collectSeenForPayload(room, handsById)),
      legal_actions: legalActions
    };
  }

  async function callBotService(payload, timeoutMs = 15000) {
    const url = `${Config().serviceUrl.replace(/\/$/, '')}/act`;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller?.signal
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bot service error (${res.status}): ${text}`);
      }
      return res.json();
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error(`Bot service timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function playNeuralBotBid(room, handsById, playerId) {
    const payload = buildActPayload(room, handsById, playerId, 'bid');
    const result = await callBotService(payload);
    const legal = Engine().getLegalBotBids(room);
    if (legal.includes(result.action)) return result.action;
    return legal[Math.floor(Math.random() * legal.length)];
  }

  async function playNeuralBotCard(room, handsById, playerId) {
    const payload = buildActPayload(room, handsById, playerId, 'play');
    const result = await callBotService(payload);
    const appCardId = IdMap().botCardIdToAppId(result.action);
    const hand = handsById[playerId] || [];
    const card = hand.find(c => c.id === appCardId);
    if (!card) {
      throw new Error(`Neural bot chose bot id ${result.action} (app id ${appCardId}) not in hand`);
    }
    return card.key;
  }

  global.BotClient = {
    isNeuralBot,
    modelForBotType,
    neuralSetupValid,
    buildActPayload,
    playNeuralBotBid,
    playNeuralBotCard,
    callBotService
  };
})(typeof window !== 'undefined' ? window : global);
