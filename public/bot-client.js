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
    return botType === 'neural_v6' || botType === 'neural_v7';
  }

  function modelForBotType(botType) {
    if (botType === 'neural_v6') return 'v6';
    if (botType === 'neural_v7') return 'v7';
    return 'v7';
  }

  function neuralSetupValid(room, botType) {
    if (!room || room.mode !== 'standard') return { ok: false, message: 'Champion bots require Standard (Official) mode.' };
    if (room.hookRule) return { ok: false, message: 'Champion bots require Hook Rule off.' };
    const n = room.playerCount || room.players?.length || 0;
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

  function buildActPayload(room, handsById, playerId, phase) {
    if (room.mode !== 'standard') {
      throw new Error('neural bots require standard mode');
    }
    const player = room.players.find(p => p.id === playerId);
    const seat = seatIndex(room, playerId);
    const hand = handsById[playerId] || [];
    const rules = SR();

    const bids = room.players.map(p => p.currentBid);
    const taken = room.players.map(p => p.tricksWon);

    const trick = (room.currentTrick || []).map(entry => ({
      seat: seatIndex(room, entry.playerId),
      card: IdMap().appCardIdToBotId(entry.card.id)
    }));

    const legalActions = phase === 'bid'
      ? rules.getLegalBidValues(room.currentRound)
      : IdMap().mapAppIds(rules.getLegalCardIds(hand, room.currentTrick, room.trumpSuitIndex ?? -1));

    const handsPayload = {};
    handsPayload[String(seat)] = IdMap().mapAppIds(hand.map(c => c.id));

    return {
      protocol: 1,
      model: modelForBotType(
        (global.GameEngine?.resolveBotType?.(player, room) || player?.botType || 'neural_v7')
      ),
      num_players: room.playerCount,
      seat,
      phase,
      round: room.currentRound,
      trump: room.trumpSuitIndex ?? -1,
      trump_card: IdMap().appCardIdToBotId(room.trumpCard?.id ?? -1),
      dealer: room.dealerIndex,
      starter: (room.dealerIndex + 1) % room.playerCount,
      hands: handsPayload,
      bids,
      taken,
      trick,
      seen: IdMap().mapAppIds(rules.collectSeenCardIds(room, handsById)),
      legal_actions: legalActions
    };
  }

  async function callBotService(payload) {
    const url = `${Config().serviceUrl.replace(/\/$/, '')}/act`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bot service error (${res.status}): ${text}`);
    }
    return res.json();
  }

  async function playNeuralBotBid(room, handsById, playerId) {
    const payload = buildActPayload(room, handsById, playerId, 'bid');
    const result = await callBotService(payload);
    return result.action;
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
