const assert = require('assert');

require('./public/game-engine.js');
const Engine = global.GameEngine;
const resolveTrick = Engine.resolveTrick;
const canPlayCard = Engine.canPlayCard;
const calculateScoreChange = Engine.calculateScoreChange;
const sortHand = Engine.sortHand;

console.log('--- WIZARD APP TEST RUNNER ---');

try {
  // Test Case 1: Standard trick without trumps
  const trick1 = [
    { playerId: 'p1', card: { suit: 'green', value: 4 } },
    { playerId: 'p2', card: { suit: 'green', value: 10 } },
    { playerId: 'p3', card: { suit: 'red', value: 12 } }
  ];
  const win1 = resolveTrick(trick1, 'blue');
  assert.strictEqual(win1.playerId, 'p2', 'Standard high of led suit should win');
  console.log('✅ Test Case 1 Passed: Standard led suit high wins.');

  // Test Case 2: Trump beats led suit
  const trick2 = [
    { playerId: 'p1', card: { suit: 'green', value: 12 } },
    { playerId: 'p2', card: { suit: 'blue', value: 2 } },
    { playerId: 'p3', card: { suit: 'red', value: 14 } }
  ];
  const win2 = resolveTrick(trick2, 'blue');
  assert.strictEqual(win2.playerId, 'p2', 'Trump 2 should beat led 12');
  console.log('✅ Test Case 2 Passed: Trump beats led suit.');

  // Test Case 3: Last 15 Wins
  const trick3 = [
    { playerId: 'p1', card: { suit: 'blue', value: 14 } },
    { playerId: 'p2', card: { suit: 'red', value: 15 } },
    { playerId: 'p3', card: { suit: 'green', value: 15 } }
  ];
  const win3 = resolveTrick(trick3, 'blue');
  assert.strictEqual(win3.playerId, 'p3', 'Last 15 played wins');
  console.log('✅ Test Case 3 Passed: Last 15 played wins over high trump and earlier 15.');

  // Test Case 4: All 1s played (First 1 wins)
  const trick4 = [
    { playerId: 'p1', card: { suit: 'green', value: 1 } },
    { playerId: 'p2', card: { suit: 'red', value: 1 } },
    { playerId: 'p3', card: { suit: 'yellow', value: 1 } }
  ];
  const win4 = resolveTrick(trick4, 'blue');
  assert.strictEqual(win4.playerId, 'p1', 'First 1 wins when all are 1s');
  console.log('✅ Test Case 4 Passed: All 1s - first played wins.');

  // Test Case 5: All 1s played with Trump 1
  const trick5 = [
    { playerId: 'p1', card: { suit: 'green', value: 1 } },
    { playerId: 'p2', card: { suit: 'blue', value: 1 } },
    { playerId: 'p3', card: { suit: 'yellow', value: 1 } }
  ];
  const win5 = resolveTrick(trick5, 'blue');
  assert.strictEqual(win5.playerId, 'p2', 'Trump 1 wins when all are 1s');
  console.log('✅ Test Case 5 Passed: All 1s with Trump 1 - trump 1 wins.');

  // Test Case 6: Lead 1 — second player's standard card sets champ
  const trick6 = [
    { playerId: 'p1', card: { suit: 'green', value: 1 } },
    { playerId: 'p2', card: { suit: 'green', value: 2 } },
    { playerId: 'p3', card: { suit: 'red', value: 14 } }
  ];
  const win6 = resolveTrick(trick6, 'blue');
  assert.strictEqual(win6.playerId, 'p2', 'Second player sets champ; led green 2 beats off-suit 14');
  assert.strictEqual(Engine.getTrickLedSuit(trick6), 'green');
  console.log('✅ Test Case 6 Passed: Lead 1 — second player sets champ.');

  // Test Case 7: Scoring
  assert.strictEqual(calculateScoreChange(3, 3), 50, 'Bid 3, won 3 => +50');
  assert.strictEqual(calculateScoreChange(0, 0), 20, 'Bid 0, won 0 => +20');
  assert.strictEqual(calculateScoreChange(2, 4), -20, 'Bid 2, won 4 => -20');
  assert.strictEqual(calculateScoreChange(3, 1), -20, 'Bid 3, won 1 => -20');
  console.log('✅ Test Case 7 Passed: Scoring computations match rules.');

  // Test Case 8: Hand sorting — 1s left, 2–14 middle, 15s right
  const hand = [
    { suit: 'blue', value: 15 },
    { suit: 'green', value: 12 },
    { suit: 'blue', value: 1 },
    { suit: 'green', value: 3 },
    { suit: 'red', value: 15 },
    { suit: 'yellow', value: 1 }
  ];
  const sorted = sortHand(hand);
  assert.strictEqual(sorted[0].value, 1, 'All 1s on the left');
  assert.strictEqual(sorted[1].value, 1, 'All 1s on the left');
  assert.strictEqual(sorted[0].suit, 'blue', '1s sorted by suit order');
  assert.strictEqual(sorted[1].suit, 'yellow', '1s sorted by suit order');
  assert.strictEqual(sorted[2].value, 3, 'Standard cards in the middle');
  assert.strictEqual(sorted[3].value, 12, 'Standard cards ascending within suit');
  assert.strictEqual(sorted[4].value, 15, 'All 15s on the right');
  assert.strictEqual(sorted[5].value, 15, 'All 15s on the right');
  console.log('✅ Test Case 8 Passed: Hand sorting (1s left, 15s right, suit order).');

  // Test Case 9: Follow suit — 1/15 lead has no champ; wild ranks never force suit
  const trickLedBlue = [{ card: { suit: 'blue', value: 5 } }];
  const handOnlyBlueOne = [{ suit: 'blue', value: 1 }, { suit: 'red', value: 8 }];
  assert.strictEqual(canPlayCard(handOnlyBlueOne, { suit: 'red', value: 8 }, trickLedBlue), true, 'Blue 1 does not force following blue');
  assert.strictEqual(canPlayCard(handOnlyBlueOne, { suit: 'blue', value: 1 }, trickLedBlue), true, 'Blue 1 may be sloughed when led blue');

  const handHasBlueStandard = [{ suit: 'blue', value: 1 }, { suit: 'blue', value: 9 }, { suit: 'red', value: 8 }];
  assert.strictEqual(canPlayCard(handHasBlueStandard, { suit: 'blue', value: 9 }, trickLedBlue), true, 'Must follow with standard blue card');
  assert.strictEqual(canPlayCard(handHasBlueStandard, { suit: 'red', value: 8 }, trickLedBlue), false, 'Cannot play off-suit when holding standard led suit');
  assert.strictEqual(canPlayCard(handHasBlueStandard, { suit: 'blue', value: 1 }, trickLedBlue), true, 'May still slough a 1 even when holding led suit');
  assert.strictEqual(canPlayCard(handHasBlueStandard, { suit: 'green', value: 15 }, trickLedBlue), true, '15 is always playable');

  const trickLedOne = [{ playerId: 'p1', card: { suit: 'green', value: 1 } }];
  assert.strictEqual(canPlayCard(handHasBlueStandard, { suit: 'red', value: 8 }, trickLedOne), true, 'Lead 1 alone — champ not set yet');
  const trickLeadOneSecondGreen = [
    { playerId: 'p1', card: { suit: 'green', value: 1 } },
    { playerId: 'p2', card: { suit: 'green', value: 9 } }
  ];
  assert.strictEqual(Engine.getTrickLedSuit(trickLeadOneSecondGreen), 'green');
  const handHasGreenStandard = [{ suit: 'green', value: 1 }, { suit: 'green', value: 9 }, { suit: 'red', value: 8 }];
  assert.strictEqual(canPlayCard(handHasGreenStandard, { suit: 'red', value: 8 }, trickLeadOneSecondGreen), false, 'Must follow after second player sets champ');
  console.log('✅ Test Case 9 Passed: Follow suit skips 1/15 until a standard card sets champ.');

  assert.strictEqual(Engine.resolveTrumpSuit({ suit: 'green', value: 1 }), null, 'Job 1 => no trump');
  assert.strictEqual(Engine.resolveTrumpSuit({ suit: 'yellow', value: 15 }), null, 'Job 15 => no trump');
  assert.strictEqual(Engine.resolveTrumpSuit({ suit: 'red', value: 10 }), 'red', 'Standard job card uses its suit');

  const noTrumpTrick = [
    { playerId: 'p1', card: { suit: 'green', value: 5 } },
    { playerId: 'p2', card: { suit: 'blue', value: 14 } }
  ];
  assert.strictEqual(Engine.resolveTrick(noTrumpTrick, null).playerId, 'p1', 'No trump: led suit wins over off-suit high card');
  assert.strictEqual(Engine.getTrickLedSuit(noTrumpTrick), 'green', 'First standard card sets trick champ');

  const noTrumpLeadOne = [
    { playerId: 'p1', card: { suit: 'green', value: 1 } },
    { playerId: 'p2', card: { suit: 'blue', value: 14 } }
  ];
  assert.strictEqual(Engine.getTrickLedSuit(noTrumpLeadOne), 'blue', 'Second player sets trick champ after lead 1');
  assert.strictEqual(Engine.resolveTrick(noTrumpLeadOne, null).playerId, 'p2', 'Champ suit wins in no-trump round');

  const skipWildsTrick = [
    { playerId: 'p1', card: { suit: 'green', value: 15 } },
    { playerId: 'p2', card: { suit: 'red', value: 1 } },
    { playerId: 'p3', card: { suit: 'yellow', value: 8 } },
    { playerId: 'p4', card: { suit: 'blue', value: 14 } }
  ];
  assert.strictEqual(Engine.getTrickLedSuit(skipWildsTrick), 'yellow', 'Skip lead 15 and second 1 — third player sets champ');
  assert.strictEqual(Engine.resolveTrick(skipWildsTrick, null).playerId, 'p1', 'Last 15 still wins the trick');
  console.log('✅ Test Case 10 Passed: Champ skips 1/15 leads to next standard card.');

  require('./public/standard-rules.js');
  const SR = global.StandardRules;

  assert.strictEqual(Engine.getRoundsCount('standard', 3), 20, 'Standard 3p => 20 rounds');
  assert.strictEqual(Engine.getRoundsCount('standard', 4), 15, 'Standard 4p => 15 rounds');
  assert.strictEqual(SR.createStandardDeck().length, 60, 'Standard deck has 60 cards');

  const wizard = SR.cardObjectFromId(14);
  const blueFive = SR.cardObjectFromId(4);
  const trickStd = [
    { playerId: 'p1', playerName: 'A', card: blueFive },
    { playerId: 'p2', playerName: 'B', card: wizard }
  ];
  assert.strictEqual(SR.evaluateTrickWinner(trickStd, 0).playerId, 'p2', 'Wizard wins trick');

  const blueJester = SR.cardObjectFromId(0);
  assert.strictEqual(blueJester.suit, 'blue', 'Blue Jester is id 0');
  assert.strictEqual(blueJester.value, 1, 'Jester is card number 1');
  const redWizard = SR.cardObjectFromId(29);
  assert.strictEqual(redWizard.suit, 'red', 'Red Wizard is id 29');
  assert.strictEqual(redWizard.value, 15, 'Wizard is card number 15');

  const blueTwo = SR.cardObjectFromId(1);
  const blueFourteen = SR.cardObjectFromId(13);
  assert.strictEqual(blueTwo.value, 2, 'Standard id 1 is rank 2');
  assert.strictEqual(blueFourteen.value, 14, 'Standard id 13 is rank 14');

  const wizardFlip = SR.resolveTrumpFromFlip(29, [blueTwo, blueFourteen]);
  assert.strictEqual(wizardFlip.trumpSuitIndex, -1, 'Wizard flip => no trump');
  assert.strictEqual(wizardFlip.trumpSuit, null, 'Wizard flip has no trump suit');
  assert.strictEqual(wizardFlip.trumpCard.value, 15, 'Flipped wizard card is still recorded');

  const jesterFlip = SR.resolveTrumpFromFlip(0, []);
  assert.strictEqual(jesterFlip.trumpSuitIndex, -1, 'Jester flip => no trump');

  const blueCards = SR.createStandardDeck().filter(c => c.suit === 'blue');
  assert.strictEqual(blueCards.length, 15, 'One card per rank in blue suit');
  assert.strictEqual(blueCards.filter(c => c.value === 1).length, 1, 'Only one Jester (1) per suit');

  const trickLeadJester = [{ playerId: 'p1', playerName: 'A', card: blueJester }];
  assert.strictEqual(SR.getTrickLeadSuit(trickLeadJester, 0), -1, 'Jester lead has no follow color');

  const trickLeadRankTwo = [{ playerId: 'p1', playerName: 'A', card: blueTwo }];
  assert.strictEqual(SR.getTrickLeadSuit(trickLeadRankTwo, 0), 0, 'Rank-2 colored sets follow color');

  console.log('✅ Test Case 11 Passed: Standard rules (deck, rounds, trick winner, wild suits).');

  require('./public/bot-id-map.js');
  const IdMap = global.BotIdMap;
  const SR2 = global.StandardRules;

  for (let appId = 0; appId < 60; appId++) {
    const botId = IdMap.appCardIdToBotId(appId);
    const roundTrip = IdMap.botCardIdToAppId(botId);
    assert.strictEqual(roundTrip, appId, `Bot id round-trip for app id ${appId}`);
  }

  assert.strictEqual(IdMap.appCardIdToBotId(0), 56, 'Blue Jester (app 0) → bot jester 56');
  assert.strictEqual(IdMap.appCardIdToBotId(14), 52, 'Blue Wizard (app 14) → bot wizard 52');
  assert.strictEqual(IdMap.appCardIdToBotId(1), 0, 'Blue 2 (app 1) → bot colored 0');
  assert.strictEqual(IdMap.botCardIdToAppId(59), 45, 'Bot jester 59 → yellow Jester app 45');

  const blueWizardApp = SR2.cardObjectFromId(14);
  assert.strictEqual(blueWizardApp.value, 15);
  assert.strictEqual(IdMap.appCardIdToBotId(blueWizardApp.id), 52);

  console.log('✅ Test Case 12 Passed: Neural bot card id translation (app ↔ training).');

  const seenRoom = {
    currentRound: 7,
    trumpCard: { id: 30 },
    trickWinnerHistory: [
      { round: 6, cardsPlayed: [{ card: { id: 1 } }, { card: { id: 2 } }] },
      { round: 7, cardsPlayed: [{ card: { id: 3 } }, { card: { id: 4 } }] },
      { cardsPlayed: [{ card: { id: 99 } }] }
    ],
    currentTrick: [{ card: { id: 5 } }]
  };
  const seenIds = SR2.collectSeenCardIds(seenRoom, {});
  assert.ok(seenIds.includes(30), 'Trump card in seen');
  assert.ok(seenIds.includes(3) && seenIds.includes(4), 'Current round tricks in seen');
  assert.ok(seenIds.includes(5), 'Current trick in seen');
  assert.ok(!seenIds.includes(1) && !seenIds.includes(2), 'Prior round tricks excluded from seen');
  assert.ok(!seenIds.includes(99), 'Untagged legacy tricks excluded from seen');

  assert.strictEqual(Engine.resolveBotType({ isBot: true }, { mode: 'standard' }), 'neural_v7');
  assert.strictEqual(Engine.resolveBotType({ isBot: true, botType: 'heuristic' }, { mode: 'standard' }), 'heuristic');

  console.log('✅ Test Case 13 Passed: collectSeenCardIds scoped to current round only.');

  console.log('\n🌟 ALL UNIT TESTS PASSED SUCCESSFULLY! 🌟');
} catch (e) {
  console.error('❌ TEST FAILED:', e);
  process.exit(1);
}
