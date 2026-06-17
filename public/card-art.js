/* Wizard — suit-themed card faces (emoji by color; wild 1/15 per suit) */
(function (global) {
  const SUIT_THEMES = {
    blue:   { label: 'Water',   name: 'Blue',   element: 'water' },
    red:    { label: 'Fire',    name: 'Red',    element: 'fire' },
    green:  { label: 'Nature',  name: 'Green',  element: 'nature' },
    yellow: { label: 'Light',   name: 'Yellow', element: 'light' },
    purple: { label: 'Arcane',  name: 'Purple', element: 'arcane' }
  };

  /** One iconic emoji per suit (used for 1s and 15s) */
  const SUIT_PRIMARY_EMOJI = {
    blue: '🌊',
    red: '🔥',
    green: '🌲',
    yellow: '☀️',
    purple: '🔮'
  };

  /** Emojis themed by suit — standard cards 2–14 */
  const SUIT_THEME_EMOJIS = {
    blue:   ['🌊', '💧', '💦', '🌀', '⛈️', '🌧️', '🐚', '🧊', '〰️', '🐋', '⚓', '🏔️'],
    red:    ['🔥', '☄️', '🌋', '⚡', '🕯️', '💥', '🌅', '🔱', '🐉', '✨', '🌞', '💢'],
    green:  ['🌲', '🍃', '🌿', '🌳', '🦋', '🍀', '🌸', '🦌', '🌾', '🍄', '🏕️', '⛰️'],
    yellow: ['☀️', '⭐', '✨', '💫', '🌙', '🌈', '⚡', '🌠', '👑', '🦅', '🌤️', '🏛️'],
    purple: ['🔮', '✨', '🌙', '🕯️', '🦉', '👁️', '📜', '⚗️', '🪄', '🏰', '⚔️', '💜']
  };

  const ILLUSTRATIONS = {
    'trump-tree': `<svg viewBox="0 0 100 100" class="card-svg-art" aria-hidden="true"><defs><linearGradient id="art-ttg" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#4a3020"/><stop offset="100%" stop-color="#7a5030"/></linearGradient><linearGradient id="art-tfol" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#9ae06a"/><stop offset="55%" stop-color="#3d7a2a"/><stop offset="100%" stop-color="#1a4018"/></linearGradient></defs><path d="M50 94 L50 56" stroke="url(#art-ttg)" stroke-width="11" stroke-linecap="round"/><path d="M50 56 C32 50 18 36 16 22 C14 8 30 2 50 0 C70 2 86 8 84 22 C82 36 68 50 50 56Z" fill="url(#art-tfol)"/><path d="M26 38 C20 48 18 58 22 66 C28 58 32 48 26 38Z" fill="#5a9838"/><path d="M74 38 C80 48 82 58 78 66 C72 58 68 48 74 38Z" fill="#5a9838"/><ellipse cx="50" cy="16" rx="18" ry="22" fill="#7ecf5a"/><path d="M42 94 Q50 88 58 94 Q54 98 50 98 Q46 98 42 94Z" fill="#2a1810"/><path d="M38 72 Q50 78 62 72" fill="none" stroke="#3d2817" stroke-width="2" opacity=".5"/></svg>`
  };

  const SUIT_ART_CLASS = {
    blue: 'mystic-art-water',
    red: 'mystic-art-fire',
    green: 'mystic-art-nature',
    yellow: 'mystic-art-light',
    purple: 'mystic-art-arcane'
  };

  function normalizeSuit(suit) {
    return suit === 'indigo' ? 'purple' : suit;
  }

  /** Wild 1/15 use suit primary emoji; 2–14 use themed pool */
  function getRankSymbol(suit, value) {
    const s = normalizeSuit(suit);
    if (value === 1 || value === 15) {
      return SUIT_PRIMARY_EMOJI[s] || '◆';
    }
    const pool = SUIT_THEME_EMOJIS[s];
    if (!pool || !pool.length) return '◆';
    const idx = Math.max(0, value - 2) % pool.length;
    return pool[idx];
  }

  function getSuitEmoji(suit, value) {
    return getRankSymbol(suit, value);
  }

  function getSuitLabel(suit) {
    return SUIT_THEMES[normalizeSuit(suit)]?.label || suit;
  }

  function getSuitName(suit) {
    return SUIT_THEMES[normalizeSuit(suit)]?.name || suit;
  }

  function getCardLabel(suit, value) {
    if (value === 1) return 'Jester';
    if (value === 15) return 'Wizard';
    return getSuitLabel(suit);
  }

  function getMysticArtClass(suit, value) {
    const s = normalizeSuit(suit);
    const base = SUIT_ART_CLASS[s] || 'mystic-art-standard';
    if (value === 1) return `mystic-art-jester ${base}`;
    if (value === 15) return `mystic-art-wizard ${base}`;
    return base;
  }

  function getIllustrationKey(suit, value, options = {}) {
    if (options.trumpTree) return 'trump-tree';
    return null;
  }

  function getCardIllustrationHTML(suit, value, options = {}) {
    const key = getIllustrationKey(suit, value, options);
    if (!key || !ILLUSTRATIONS[key]) return '';
    return `<div class="card-illustration card-ill-${key.replace(/[^a-z0-9-]/g, '')}">${ILLUSTRATIONS[key]}</div>`;
  }

  function getMysticCardClasses(card) {
    let cls = 'mystic-card grimoire-card';
    if (card.value === 1) cls += ' wild-one';
    if (card.value === 15) cls += ' wild-wizard';
    return cls;
  }

  function renderCardInnerHTML(card, options = {}) {
    const value = card.value;
    const suit = normalizeSuit(card.suit);
    const symbol = card.icon || getRankSymbol(suit, value);
    const label = getCardLabel(suit, value);
    const showSpecialLabel = (value === 1 || value === 15) && options.showLabel !== false;
    const labelClass = value === 1
      ? 'card-label-bottom card-label-jester'
      : 'card-label-bottom card-label-wizard';
    const artClass = getMysticArtClass(suit, value);
    const illustration = getCardIllustrationHTML(suit, value, options);
    const hideEmoji = !!illustration;
    const wildClass = value === 1 ? ' card-center-wild-one' : (value === 15 ? ' card-center-wild-wizard' : '');

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
      <div class="card-center-icon${hideEmoji ? ' card-center-icon-hidden' : ''}${wildClass}" aria-hidden="true">${symbol}</div>
      ${showSpecialLabel ? `<div class="${labelClass}">${label}</div>` : ''}
      <div class="card-corner card-corner-br">
        <span class="card-num">${value}</span>
      </div>
    `;
  }

  global.CardArt = {
    SUIT_THEMES,
    SUIT_PRIMARY_EMOJI,
    SUIT_THEME_EMOJIS,
    SUIT_RANK_SYMBOLS: SUIT_THEME_EMOJIS,
    normalizeSuit,
    getRankSymbol,
    getSuitEmoji,
    getSuitLabel,
    getSuitName,
    getCardLabel,
    getMysticArtClass,
    getMysticCardClasses,
    getIllustrationKey,
    renderCardInnerHTML
  };
})(typeof window !== 'undefined' ? window : global);
