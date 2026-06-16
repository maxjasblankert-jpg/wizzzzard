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

  // Test Case 8: Hand sorting
  const hand = [
    { suit: 'blue', value: 5 },
    { suit: 'green', value: 12 },
    { suit: 'blue', value: 14 },
    { suit: 'green', value: 3 }
  ];
  const sorted = sortHand(hand);
  assert.strictEqual(sorted[0].suit, 'blue', 'Blue comes before Green alphabetically');
  assert.strictEqual(sorted[0].value, 5, 'Blue cards sorted ascending (low on left)');
  assert.strictEqual(sorted[1].value, 14, 'Blue cards sorted ascending (high on right)');
  assert.strictEqual(sorted[2].suit, 'green', 'Green comes second');
  assert.strictEqual(sorted[2].value, 3, 'Green cards sorted ascending');
  assert.strictEqual(sorted[3].value, 12, 'Green cards sorted ascending');
  console.log('✅ Test Case 8 Passed: Hand sorting works correctly (suit then ascending value).');

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

  console.log('\n🌟 ALL UNIT TESTS PASSED SUCCESSFULLY! 🌟');
} catch (e) {
  console.error('❌ TEST FAILED:', e);
  process.exit(1);
}
