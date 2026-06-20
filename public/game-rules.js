/* Rule reference copy for each deck mode */
(function (global) {
  const MODE_LABELS = {
    standard: 'Standard (Official)',
    normal: 'HOME Rules',
    purple: 'Purple Mode'
  };

  const SHARED_DECK = [
    'Each suit has ranks <strong>1–15</strong> only — no extra cards.',
    'Card <strong>1</strong> is the Jester and card <strong>15</strong> is the Wizard for that suit color.',
    'Cards <strong>2–14</strong> are normal suit cards.',
    'Playing a <strong>1</strong> or <strong>15</strong> does <strong>not</strong> set a follow-suit color. Follow-suit only applies once someone plays a <strong>2–14</strong> card.',
    'If you can follow the led suit with a <strong>2–14</strong> card, you must. <strong>1</strong> and <strong>15</strong> are always legal to play.'
  ];

  const SHARED_SCORING = [
    'Bid exactly right: <strong>+20</strong> plus <strong>+10</strong> per trick won.',
    'Miss your bid: <strong>−10</strong> per trick you were off by.'
  ];

  const MODE_RULES = {
    standard: {
      title: 'Standard (Official)',
      subtitle: '60 cards · 4 suits · for Champion ML bots',
      sections: [
        {
          heading: 'Deck',
          items: [
            ...SHARED_DECK,
            '60 cards total: Blue, Red, Green, and Yellow.'
          ]
        },
        {
          heading: 'Trump',
          items: [
            'Each round one card is <strong>flipped</strong> from the undealt pile.',
            'Colored card flipped → that suit is trump.',
            '<strong>Wizard (15)</strong> or <strong>Jester (1)</strong> flipped → <strong>no trump</strong> this round.'
          ]
        },
        {
          heading: 'Tricks',
          items: [
            'Last <strong>Wizard (15)</strong> played wins the trick.',
            'If everyone plays a <strong>1</strong>, the first <strong>1</strong> wins (trump <strong>1</strong> wins if all are <strong>1</strong>s).',
            'Otherwise highest trump <strong>2–14</strong> wins, else highest led-suit <strong>2–14</strong>.'
          ]
        },
        {
          heading: 'Bidding & scoring',
          items: [
            'Hook Rule is <strong>off</strong> in Standard mode.',
            ...SHARED_SCORING
          ]
        },
        {
          heading: 'Bots',
          items: [
            'Champion v7 (Standard) and v6 only work in <strong>Standard</strong> with Hook Rule off.',
            'Champion v7 (HOME) works in <strong>HOME Rules</strong>.',
            '3 players for v6; 3 or 4 players for v7.'
          ]
        }
      ]
    },
    normal: {
      title: 'HOME Rules',
      subtitle: '60 cards · 4 suits · our house rules',
      sections: [
        {
          heading: 'Deck',
          items: [
            ...SHARED_DECK,
            'Same 60-card deck as Standard — Blue, Red, Green, and Yellow.'
          ]
        },
        {
          heading: 'Trump (Job Card)',
          items: [
            'Each round a random <strong>Job Card</strong> is drawn from the full deck (won\'t repeat until the pool runs out).',
            'Colored Job Card (<strong>2–14</strong>) → that suit is trump for the round.',
            'Job Card <strong>1</strong> or <strong>15</strong> → <strong>no trump</strong>. The first <strong>2–14</strong> played sets the trick color.'
          ]
        },
        {
          heading: 'Tricks',
          items: [
            'Last <strong>15 (Wizard)</strong> played wins the trick.',
            'If everyone plays a <strong>1</strong>, the first <strong>1</strong> wins (trump <strong>1</strong> wins if all are <strong>1</strong>s).',
            'Otherwise highest trump <strong>2–14</strong> wins, else highest led-suit <strong>2–14</strong>.'
          ]
        },
        {
          heading: 'Bidding & scoring',
          items: [
            '<strong>Hook Rule</strong> (optional): the last bidder cannot bid so total bids equal tricks available.',
            ...SHARED_SCORING
          ]
        },
        {
          heading: 'Bots',
          items: [
            'Practice bots work in HOME Rules.',
            'Champion v7 (HOME) supports 3 or 4 players.',
            'Champion v7 (Standard) and v6 require <strong>Standard</strong> mode.'
          ]
          ]
        }
      ]
    },
    purple: {
      title: 'Purple Mode',
      subtitle: '75 cards · 5 suits · HOME rules with an extra suit',
      sections: [
        {
          heading: 'Deck',
          items: [
            ...SHARED_DECK,
            '75 cards total: Green, Blue, Red, Yellow, and <strong>Purple</strong>.',
            'With 3 players this is <strong>25 rounds</strong> — a long game!'
          ]
        },
        {
          heading: 'Trump (Job Card)',
          items: [
            'Same as <strong>HOME Rules</strong>: random Job Card each round.',
            'Colored Job Card (<strong>2–14</strong>) → that suit is trump.',
            'Job Card <strong>1</strong> or <strong>15</strong> → no trump; first <strong>2–14</strong> sets trick color.'
          ]
        },
        {
          heading: 'Tricks',
          items: [
            'Same trick rules as <strong>HOME Rules</strong>.',
            'Purple suit cards follow the same Jester / Wizard / follow-suit rules.'
          ]
        },
        {
          heading: 'Bidding & scoring',
          items: [
            '<strong>Hook Rule</strong> optional, same as HOME Rules.',
            ...SHARED_SCORING
          ]
        },
        {
          heading: 'Bots',
          items: [
            'Practice bots only. Champion bots need Standard mode.'
          ]
        }
      ]
    }
  };

  function getModeLabel(mode) {
    return MODE_LABELS[mode] || mode;
  }

  function getModeRules(mode) {
    return MODE_RULES[mode] || MODE_RULES.normal;
  }

  global.GameRules = {
    MODE_LABELS,
    MODE_RULES,
    getModeLabel,
    getModeRules
  };
})(typeof window !== 'undefined' ? window : global);
