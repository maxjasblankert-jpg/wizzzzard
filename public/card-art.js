/* Wizard — dark fantasy card faces with illustrated rank art */
(function (global) {
  const SUIT_THEMES = {
    blue:   { label: 'Water',   name: 'Blue',   element: 'water' },
    red:    { label: 'Fire',    name: 'Red',    element: 'fire' },
    green:  { label: 'Nature',  name: 'Green',  element: 'nature' },
    yellow: { label: 'Light',   name: 'Yellow', element: 'light' },
    purple: { label: 'Arcane',  name: 'Purple', element: 'arcane' },
    indigo: { label: 'Void',    name: 'Indigo', element: 'void' }
  };

  const SUIT_RANK_SYMBOLS = {
    blue: {
      1: '💧', 2: '〰️', 3: '🌊', 4: '🌀', 5: '⛈️',
      6: '🌧️', 7: '🧊', 8: '💦', 9: '🐚', 10: '🦑',
      11: '🌙', 12: '⚓', 13: '🐋', 14: '🏔️', 15: '🌊'
    },
    red: {
      1: '✨', 2: '🔥', 3: '🕯️', 4: '🪵', 5: '🏕️',
      6: '🌋', 7: '☄️', 8: '🔥', 9: '⚡', 10: '🐉',
      11: '👁️', 12: '⚒️', 13: '🐲', 14: '🔱', 15: '☀️'
    },
    green: {
      1: '🌱', 2: '🌿', 3: '🍃', 4: '🌸', 5: '🌳',
      6: '🌲', 7: '🍀', 8: '🦋', 9: '🌾', 10: '🦌',
      11: '🍄', 12: '🏕️', 13: '🌲', 14: '⛰️', 15: '🌍'
    },
    yellow: {
      1: '✨', 2: '⭐', 3: '☁️', 4: '🌤️', 5: '⚡',
      6: '🌈', 7: '🌙', 8: '☀️', 9: '🌠', 10: '✦',
      11: '🔭', 12: '👑', 13: '🦅', 14: '🏛️', 15: '💫'
    },
    purple: {
      1: '🔮', 2: '🌙', 3: '✨', 4: '🕯️', 5: '📜',
      6: '⚗️', 7: '🪄', 8: '🌟', 9: '🦉', 10: '🐉',
      11: '👁️', 12: '⚔️', 13: '🐲', 14: '🏰', 15: '💜'
    },
    indigo: {
      1: '🌑', 2: '✨', 3: '🌌', 4: '💫', 5: '🪐',
      6: '🌠', 7: '🔭', 8: '🌙', 9: '⚡', 10: '🦇',
      11: '👁️', 12: '🗝️', 13: '🐉', 14: '🏴', 15: '🌌'
    }
  };

  const ILLUSTRATIONS = {
    'water-3': `<svg viewBox="0 0 100 100" class="card-svg-art" aria-hidden="true"><defs><linearGradient id="art-wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5ec8e8"/><stop offset="100%" stop-color="#0a3d5c"/></linearGradient></defs><path d="M0 72 Q25 58 50 68 T100 62 L100 100 L0 100Z" fill="url(#art-wg)" opacity=".95"/><path d="M0 78 Q30 64 55 74 T100 70 L100 100 L0 100Z" fill="#1a6a8a" opacity=".7"/><path d="M8 68 Q22 52 38 60 Q52 48 68 58 Q82 50 94 62" fill="none" stroke="#dff6ff" stroke-width="2.5" opacity=".85"/><circle cx="72" cy="48" r="3" fill="#fff" opacity=".6"/></svg>`,
    'nature-3': `<svg viewBox="0 0 100 100" class="card-svg-art" aria-hidden="true"><defs><linearGradient id="art-lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#8fdc7a"/><stop offset="100%" stop-color="#1a4a22"/></linearGradient></defs><path d="M28 62 C22 48 26 34 36 28 C42 38 40 52 32 60 C30 66 28 64 28 62Z" fill="url(#art-lg)"/><path d="M72 58 C78 44 74 30 64 24 C58 34 60 48 68 56 C70 62 72 60 72 58Z" fill="url(#art-lg)"/><path d="M32 58 Q36 44 40 32" fill="none" stroke="#2d5018" stroke-width="2"/><path d="M68 54 Q64 40 60 28" fill="none" stroke="#2d5018" stroke-width="2"/><path d="M30 36 Q36 30 42 34 Q48 28 54 32" fill="none" stroke="#6ecf6a" stroke-width="1.2" opacity=".8"/></svg>`,
    'fire-7': `<svg viewBox="0 0 100 100" class="card-svg-art" aria-hidden="true"><defs><radialGradient id="art-fg" cx="50%" cy="35%"><stop offset="0%" stop-color="#fff4c2"/><stop offset="45%" stop-color="#ff8c2a"/><stop offset="100%" stop-color="#6b1208"/></radialGradient></defs><ellipse cx="52" cy="38" rx="22" ry="24" fill="url(#art-fg)"/><path d="M52 62 Q46 78 40 92 Q52 84 52 72 Q52 84 64 92 Q58 78 52 62Z" fill="#ff5a1f" opacity=".85"/><path d="M20 88 Q35 72 52 76 Q69 72 84 88" fill="none" stroke="#ffb347" stroke-width="2" opacity=".5"/><circle cx="30" cy="80" r="1.5" fill="#ffd56a" opacity=".8"/><circle cx="70" cy="76" r="1.2" fill="#ffd56a" opacity=".7"/></svg>`,
    'serpent-10': `<svg viewBox="0 0 100 100" class="card-svg-art" aria-hidden="true"><defs><linearGradient id="art-sg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#4ecdc4"/><stop offset="100%" stop-color="#0d3d42"/></linearGradient></defs><path d="M72 28 C58 18 42 22 34 36 C26 50 30 66 44 72 C58 78 72 70 76 56 C80 42 84 34 72 28Z" fill="url(#art-sg)" stroke="#1a6a62" stroke-width="1.5"/><circle cx="66" cy="36" r="3" fill="#ffe066"/><circle cx="67" cy="36" r="1.2" fill="#1a1a1a"/><path d="M34 36 C22 44 18 58 24 70 C30 82 44 86 56 80" fill="none" stroke="#2a8a80" stroke-width="8" stroke-linecap="round"/><path d="M24 70 L18 78 M56 80 L62 88" stroke="#2a8a80" stroke-width="4" stroke-linecap="round"/></svg>`,
    'cosmic-11': `<svg viewBox="0 0 100 100" class="card-svg-art" aria-hidden="true"><defs><radialGradient id="art-eg" cx="50%" cy="50%"><stop offset="0%" stop-color="#c4b5fd"/><stop offset="35%" stop-color="#6366f1"/><stop offset="70%" stop-color="#312e81"/><stop offset="100%" stop-color="#0f0a1e"/></radialGradient></defs><ellipse cx="50" cy="50" rx="34" ry="26" fill="#1a1030" stroke="#8b7cb8" stroke-width="2"/><ellipse cx="50" cy="50" rx="22" ry="16" fill="url(#art-eg)"/><circle cx="50" cy="50" r="7" fill="#0a0818"/><circle cx="52" cy="48" r="2.5" fill="#fff" opacity=".9"/><circle cx="22" cy="28" r="1" fill="#fff" opacity=".5"/><circle cx="78" cy="32" r=".8" fill="#fff" opacity=".4"/><circle cx="70" cy="72" r="1.2" fill="#fff" opacity=".35"/></svg>`,
    jester: `<svg viewBox="0 0 100 100" class="card-svg-art" aria-hidden="true"><path d="M18 28 L32 18 L50 24 L68 18 L82 28 L76 38 L82 48 L50 42 L18 48 L24 38Z" fill="#c0392b"/><path d="M24 38 L18 48 L14 58 L24 52Z" fill="#2980b9"/><path d="M76 38 L82 48 L86 58 L76 52Z" fill="#27ae60"/><circle cx="38" cy="58" r="3" fill="#f1c40f"/><circle cx="62" cy="58" r="3" fill="#f1c40f"/><ellipse cx="50" cy="62" rx="22" ry="26" fill="#e8c4a0" stroke="#8b6914" stroke-width="1.5"/><ellipse cx="42" cy="60" rx="3" ry="4" fill="#2c1810"/><ellipse cx="58" cy="60" rx="3" ry="4" fill="#2c1810"/><path d="M44 72 Q50 78 56 72" fill="none" stroke="#8b4513" stroke-width="2"/><path d="M50 48 L50 38" stroke="#f1c40f" stroke-width="2"/><circle cx="50" cy="36" r="4" fill="#f1c40f"/></svg>`,
    wizard: `<svg viewBox="0 0 100 100" class="card-svg-art" aria-hidden="true"><defs><linearGradient id="art-tg" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#3d2817"/><stop offset="100%" stop-color="#6b4423"/></linearGradient><linearGradient id="art-fol" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7ecf5a"/><stop offset="100%" stop-color="#1a4a18"/></linearGradient></defs><path d="M50 88 L50 52" stroke="url(#art-tg)" stroke-width="8" stroke-linecap="round"/><path d="M50 52 C38 48 28 38 26 28 C24 18 34 12 50 8 C66 12 76 18 74 28 C72 38 62 48 50 52Z" fill="url(#art-fol)"/><ellipse cx="38" cy="32" rx="12" ry="16" fill="#4a9a3a" transform="rotate(-20 38 32)"/><ellipse cx="62" cy="32" rx="12" ry="16" fill="#4a9a3a" transform="rotate(20 62 32)"/><ellipse cx="50" cy="22" rx="14" ry="18" fill="#5cb848"/><path d="M42 88 Q50 82 58 88 Q50 94 42 88Z" fill="#2a1810"/></svg>`,
    'trump-tree': `<svg viewBox="0 0 100 100" class="card-svg-art" aria-hidden="true"><defs><linearGradient id="art-ttg" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#4a3020"/><stop offset="100%" stop-color="#7a5030"/></linearGradient><linearGradient id="art-tfol" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#9ae06a"/><stop offset="55%" stop-color="#3d7a2a"/><stop offset="100%" stop-color="#1a4018"/></linearGradient></defs><path d="M50 94 L50 56" stroke="url(#art-ttg)" stroke-width="11" stroke-linecap="round"/><path d="M50 56 C32 50 18 36 16 22 C14 8 30 2 50 0 C70 2 86 8 84 22 C82 36 68 50 50 56Z" fill="url(#art-tfol)"/><path d="M26 38 C20 48 18 58 22 66 C28 58 32 48 26 38Z" fill="#5a9838"/><path d="M74 38 C80 48 82 58 78 66 C72 58 68 48 74 38Z" fill="#5a9838"/><ellipse cx="50" cy="16" rx="18" ry="22" fill="#7ecf5a"/><path d="M42 94 Q50 88 58 94 Q54 98 50 98 Q46 98 42 94Z" fill="#2a1810"/><path d="M38 72 Q50 78 62 72" fill="none" stroke="#3d2817" stroke-width="2" opacity=".5"/></svg>`
  };

  function getRankSymbol(suit, value) {
    const suitMap = SUIT_RANK_SYMBOLS[suit];
    if (suitMap && suitMap[value]) return suitMap[value];
    if (value === 1) return '⬇️';
    if (value === 15) return '⭐';
    return '◆';
  }

  function getSuitLabel(suit) {
    return SUIT_THEMES[suit]?.label || suit;
  }

  function getSuitName(suit) {
    return SUIT_THEMES[suit]?.name || suit;
  }

  function getCardLabel(suit, value) {
    if (value === 1) return 'Jester';
    if (value === 15) return 'Wizard';
    return getSuitLabel(suit);
  }

  function getMysticArtClass(suit, value) {
    if (value === 1) return 'mystic-art-jester';
    if (value === 15) return 'mystic-art-wizard';
    if (value === 3 && suit === 'blue') return 'mystic-art-water-3';
    if (value === 3 && suit === 'green') return 'mystic-art-nature-3';
    if (value === 7 && suit === 'red') return 'mystic-art-fire-7';
    if (value === 10) return 'mystic-art-serpent-10';
    if (value === 11) return 'mystic-art-cosmic-11';
    return 'mystic-art-standard';
  }

  function getIllustrationKey(suit, value, options = {}) {
    if (options.trumpTree) return 'trump-tree';
    if (value === 1) return 'jester';
    if (value === 15) return 'wizard';
    if (value === 3 && suit === 'blue') return 'water-3';
    if (value === 3 && suit === 'green') return 'nature-3';
    if (value === 7 && suit === 'red') return 'fire-7';
    if (value === 10) return 'serpent-10';
    if (value === 11) return 'cosmic-11';
    return null;
  }

  function getCardIllustrationHTML(suit, value, options = {}) {
    const key = getIllustrationKey(suit, value, options);
    if (!key || !ILLUSTRATIONS[key]) return '';
    return `<div class="card-illustration card-ill-${key.replace(/[^a-z0-9-]/g, '')}">${ILLUSTRATIONS[key]}</div>`;
  }

  function getMysticCardClasses(/* card */) {
    return 'mystic-card grimoire-card';
  }

  function renderCardInnerHTML(card, options = {}) {
    const value = card.value;
    const suit = card.suit;
    const symbol = card.icon || getRankSymbol(suit, value);
    const label = getCardLabel(suit, value);
    const showSpecialLabel = (value === 1 || value === 15) && options.showLabel !== false;
    const labelClass = value === 1
      ? 'card-label-bottom card-label-jester'
      : 'card-label-bottom card-label-wizard';
    const artClass = getMysticArtClass(suit, value);
    const illustration = getCardIllustrationHTML(suit, value, options);
    const hideEmoji = !!illustration;

    return `
      <div class="card-vignette" aria-hidden="true"></div>
      <div class="card-filigree-frame" aria-hidden="true">
        <span class="corner-ornament corner-ornament-tl"></span>
        <span class="corner-ornament corner-ornament-tr"></span>
        <span class="corner-ornament corner-ornament-bl"></span>
        <span class="corner-ornament corner-ornament-br"></span>
      </div>
      <div class="card-inner-border" aria-hidden="true"></div>
      <div class="card-art-layer ${artClass}" aria-hidden="true"></div>
      ${illustration}
      <div class="card-corner card-corner-tl">
        <span class="card-num">${value}</span>
      </div>
      <div class="card-center-icon${hideEmoji ? ' card-center-icon-hidden' : ''}" aria-hidden="true">${symbol}</div>
      ${showSpecialLabel ? `<div class="${labelClass}">${label}</div>` : ''}
      <div class="card-corner card-corner-br">
        <span class="card-num">${value}</span>
      </div>
    `;
  }

  global.CardArt = {
    SUIT_THEMES,
    SUIT_RANK_SYMBOLS,
    getRankSymbol,
    getSuitLabel,
    getSuitName,
    getCardLabel,
    getMysticArtClass,
    getMysticCardClasses,
    getIllustrationKey,
    renderCardInnerHTML
  };
})(typeof window !== 'undefined' ? window : global);
