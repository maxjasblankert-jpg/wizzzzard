let myPlayerId = null;
let myPlayerName = null;
let currentRoomCode = null;
let gameState = null;

function showFirebaseSetupBanner() {
  const lobby = document.getElementById('lobby-screen');
  if (!lobby || window.firebaseConfigured) return;
  const banner = document.createElement('div');
  banner.className = 'warning-text';
  banner.style.margin = '0 0 16px 0';
  banner.innerHTML = '⚠️ Firebase is not configured yet. Copy <code>firebase-config.example.js</code> to <code>firebase-config.js</code> and add your Firebase project keys to play online with friends.';
  lobby.querySelector('.lobby-header')?.after(banner);
}

// Suit descriptors
const SUIT_METADATA = {
  green: { name: 'Green', color: '#2D8A4E', emoji: '🟢' },
  blue: { name: 'Blue', color: '#1E5FAD', emoji: '🔵' },
  red: { name: 'Red', color: '#C0392B', emoji: '🔴' },
  yellow: { name: 'Yellow', color: '#D4A017', emoji: '🟡' },
  purple: { name: 'Purple', color: '#7B2D8B', emoji: '🟣' },
  indigo: { name: 'Indigo', color: '#4B0082', emoji: '🟣' }
};

// Map card values to thematic icon titles
const RANK_ICONS = {
  1: '⬇️', 2: '🌱', 3: '🔥', 4: '💧', 5: '🪶', 6: '🛡️',
  7: '🌙', 8: '☀️', 9: '⚡', 10: '🏔️', 11: '👁️',
  12: '👑', 13: '🐲', 14: '🏰', 15: '⭐'
};

const AVATAR_COLOR_CLASSES = ['avatar-green', 'avatar-blue', 'avatar-crimson'];

const PROFILE_EMOJIS = ['🧙', '🧝', '🧚', '🧛', '🧜', '🧞', '🦉', '🐉', '⭐', '🎩', '🃏', '👑'];

function getPlayerInitials(name) {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const word = parts[0] || '?';
  return word.slice(0, 2).toUpperCase();
}

function getPlayerAvatarClass(index) {
  return AVATAR_COLOR_CLASSES[index % AVATAR_COLOR_CLASSES.length];
}

function getPlayerEmoji(player) {
  if (player?.avatar) return player.avatar;
  if (player?.isBot) return '🤖';
  if (player?.id === myPlayerId) {
    return localStorage.getItem('wiz_avatar') || null;
  }
  return null;
}

function enrichPlayersWithAvatars(players) {
  if (!players) return players;
  return players.map(p => {
    if (p.avatar) return p;
    if (p.isBot) return { ...p, avatar: '🤖' };
    if (p.id === myPlayerId) {
      const saved = localStorage.getItem('wiz_avatar');
      if (saved) return { ...p, avatar: saved };
    }
    return p;
  });
}

function renderPlayerAvatar(player, index) {
  const emoji = getPlayerEmoji(player);
  if (emoji) {
    return `<div class="player-avatar player-avatar-emoji" aria-hidden="true">${emoji}</div>`;
  }
  const name = typeof player === 'string' ? player : player?.name;
  return `<div class="player-avatar ${getPlayerAvatarClass(index)}">${getPlayerInitials(name)}</div>`;
}

function getPlayerStatusLine(player, idx) {
  const isActive = idx === gameState.activePlayerIndex
    && (gameState.status === 'bidding' || gameState.status === 'play');
  if (!player.active) return 'Offline';
  if (player.isBot) {
    if (isActive && gameState.status === 'bidding') return 'Placing bid…';
    if (isActive && gameState.status === 'play') return 'Playing…';
    return 'Bot';
  }
  if (isActive && gameState.status === 'bidding') return 'Placing bid…';
  if (isActive && gameState.status === 'play') return 'Playing…';
  if (idx === 0) return 'Host';
  return '';
}

function setActionBanner(message, options = {}) {
  const content = document.getElementById('action-banner-content');
  const textEl = document.getElementById('action-banner-text');
  const avatarEl = document.getElementById('action-banner-avatar');
  if (!content || !textEl) return;

  content.classList.remove('state-your-turn', 'state-waiting', 'state-bidding', 'is-your-turn', 'is-waiting');
  if (options.bidding) content.classList.add('state-bidding');
  else if (options.yourTurn) content.classList.add('state-your-turn', 'is-your-turn');
  else if (options.waiting) content.classList.add('state-waiting', 'is-waiting');

  if (avatarEl) avatarEl.textContent = options.emoji || '';
  textEl.textContent = message;
}

function getMaxPlayers() {
  return gameState?.maxPlayers ?? gameState?.playerCount ?? 0;
}

function initEmojiPicker(containerId, hiddenInputId, defaultEmoji) {
  const container = document.getElementById(containerId);
  const hiddenInput = document.getElementById(hiddenInputId);
  if (!container || !hiddenInput) return;

  container.innerHTML = '';
  hiddenInput.value = defaultEmoji;

  PROFILE_EMOJIS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emoji-option' + (emoji === defaultEmoji ? ' selected' : '');
    btn.textContent = emoji;
    btn.setAttribute('aria-label', `Profile emoji ${emoji}`);
    btn.onclick = () => {
      hiddenInput.value = emoji;
      container.querySelectorAll('.emoji-option').forEach(el => el.classList.remove('selected'));
      btn.classList.add('selected');
    };
    container.appendChild(btn);
  });
}

// Initialize Firebase multiplayer
function connectWebSocket() {
  if (!window.firebaseConfigured) {
    showFirebaseSetupBanner();
    return;
  }

  WizardFirebase.init(handleSocketMsg, (message) => {
    alert(`⚠️ ERROR: ${message}`);
    if (gameState?.status === 'bidding') {
      const activePlayer = gameState.players[gameState.activePlayerIndex];
      if (activePlayer?.id === myPlayerId) {
        const bidOverlay = document.getElementById('bid-selector-overlay');
        if (bidOverlay) bidOverlay.classList.remove('hidden');
      }
    }
  }).then(() => {
    const savedRoom = localStorage.getItem('wiz_roomCode');
    const savedPlayerId = localStorage.getItem('wiz_playerId');
    const savedPlayerName = localStorage.getItem('wiz_playerName');

    if (savedRoom && savedPlayerId && savedPlayerName) {
      console.log(`Rejoining active game room: ${savedRoom}`);
      WizardFirebase.reconnectSavedRoom(savedRoom, savedPlayerId, savedPlayerName);
    }
  }).catch(err => {
    console.error('Firebase init failed:', err);
  });
}

function sendSocketMsg(type, roomCode, playerId, playerName, data = {}) {
  WizardFirebase.handleAction(type, roomCode, playerId, playerName, data);
}

let renderGameRaf = null;

function scheduleRenderGameState() {
  if (renderGameRaf) return;
  renderGameRaf = requestAnimationFrame(() => {
    renderGameRaf = null;
    renderGameState();
  });
}

// Route socket message actions
function handleSocketMsg(msg) {
  switch (msg.type) {
    case 'created':
    case 'joined': {
      myPlayerId = msg.playerId;
      myPlayerName = msg.playerName;
      currentRoomCode = msg.roomCode;
      
      // Store in localStorage for reconnection recovery
      localStorage.setItem('wiz_playerId', myPlayerId);
      localStorage.setItem('wiz_playerName', myPlayerName);
      localStorage.setItem('wiz_roomCode', currentRoomCode);
      
      showScreen('waiting-lobby');
      document.getElementById('room-code-display').innerText = currentRoomCode;
      break;
    }

    case 'sync': {
      const prevState = gameState;
      const statusChanged = prevState && prevState.status !== msg.status;
      gameState = msg;
      gameState.players = enrichPlayersWithAvatars(gameState.players);
      myPlayerId = msg.myPlayerId;
      if (statusChanged) {
        if (gameState.status === 'round_end') {
          switchSummaryTab('table');
        } else if (gameState.status === 'game_over') {
          switchGameOverTab('standings');
        }
      }
      scheduleRenderGameState();
      break;
    }

    case 'error': {
      alert(`⚠️ ERROR: ${msg.message}`);
      if (gameState?.status === 'bidding') {
        const activePlayer = gameState.players[gameState.activePlayerIndex];
        if (activePlayer?.id === myPlayerId) {
          const bidOverlay = document.getElementById('bid-selector-overlay');
          if (bidOverlay) bidOverlay.classList.remove('hidden');
        }
      }
      break;
    }

    case 'left': {
      gameState = null;
      currentRoomCode = null;
      myPlayerId = null;
      myPlayerName = null;
      document.getElementById('overlay-pause')?.classList.add('hidden');
      document.getElementById('overlay-round-summary')?.classList.add('hidden');
      document.getElementById('overlay-game-over')?.classList.add('hidden');
      switchMainTab('create');
      break;
    }

    case 'reconnect_failed': {
      gameState = null;
      currentRoomCode = null;
      myPlayerId = null;
      myPlayerName = null;
      switchMainTab('create');
      if (msg.message) {
        alert(msg.message);
      }
      break;
    }
  }
}

const MAIN_SCREEN_IDS = ['lobby-screen', 'waiting-lobby', 'game-board', 'scores-panel', 'calculator-workspace'];

function hideAllMainScreens() {
  MAIN_SCREEN_IDS.forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
}

function setActiveMainTab(tab) {
  ['create', 'join', 'ingame', 'scores'].forEach(t => {
    document.getElementById(`btn-tab-${t}`)?.classList.toggle('active', t === tab);
  });
}

function activateWaitingLobby() {
  hideAllMainScreens();
  setActiveMainTab('ingame');
  document.getElementById('waiting-lobby')?.classList.add('active');
  document.getElementById('ingame-empty')?.classList.add('hidden');
  document.getElementById('waiting-lobby-content')?.classList.remove('hidden');
}

function activateGameBoard() {
  hideAllMainScreens();
  setActiveMainTab('ingame');
  document.getElementById('game-board')?.classList.add('active');
}

// Switch between Create, Join, In Game, and Scores tabs
function switchMainTab(tab) {
  setActiveMainTab(tab);
  hideAllMainScreens();

  document.getElementById('lobby-create-form')?.classList.remove('active');
  document.getElementById('lobby-join-form')?.classList.remove('active');

  if (tab === 'create') {
    document.getElementById('lobby-screen')?.classList.add('active');
    document.getElementById('lobby-create-form')?.classList.add('active');
  } else if (tab === 'join') {
    document.getElementById('lobby-screen')?.classList.add('active');
    document.getElementById('lobby-join-form')?.classList.add('active');
  } else if (tab === 'ingame') {
    if (currentRoomCode && gameState && gameState.status !== 'lobby') {
      activateGameBoard();
    } else if (currentRoomCode) {
      activateWaitingLobby();
    } else {
      document.getElementById('waiting-lobby')?.classList.add('active');
      document.getElementById('ingame-empty')?.classList.remove('hidden');
      document.getElementById('waiting-lobby-content')?.classList.add('hidden');
    }
  } else if (tab === 'scores') {
    document.getElementById('scores-panel')?.classList.add('active');
    switchScoresSubTab('calc');
  }
}

function switchScoresSubTab(tab) {
  document.getElementById('btn-tab-calc')?.classList.toggle('active', tab === 'calc');
  document.getElementById('btn-tab-history')?.classList.toggle('active', tab === 'history');
  document.getElementById('lobby-calc-form')?.classList.toggle('active', tab === 'calc');
  document.getElementById('lobby-history-form')?.classList.toggle('active', tab === 'history');
  if (tab === 'calc') {
    generateCalcPlayerInputs();
  } else if (tab === 'history') {
    loadPastGamesList();
  }
}

// Legacy alias
function switchLobbyTab(tab) {
  if (tab === 'calc' || tab === 'history') {
    switchMainTab('scores');
    switchScoresSubTab(tab);
    return;
  }
  switchMainTab(tab);
}

function syncBotTypeSelect(mode) {
  const botTypeSelect = document.getElementById('select-bot-type');
  if (!botTypeSelect) return;

  const isPurple = mode === 'purple';

  [...botTypeSelect.options].forEach(opt => {
    opt.disabled = false;
    if (opt.value === 'neural_v7' || opt.value === 'neural_v7_house') {
      opt.hidden = isPurple;
    } else {
      opt.hidden = false;
    }
  });

  if (isPurple && botTypeSelect.value !== 'heuristic') {
    botTypeSelect.value = 'heuristic';
  }
}

function updateModeWarning() {
  const selectMode = document.getElementById('select-game-mode').value;
  const warning = document.getElementById('purple-mode-warning');
  const neuralHint = document.getElementById('neural-setup-hint');
  const hookCheck = document.getElementById('check-hook-rule');

  if (selectMode === 'purple') {
    warning.classList.remove('hidden');
  } else {
    warning.classList.add('hidden');
  }

  const isStandard = selectMode === 'standard';
  const isNormal = selectMode === 'normal';
  const neuralHintStandard = document.getElementById('neural-hint-standard');
  const neuralHintHouse = document.getElementById('neural-hint-house');
  if (neuralHint) {
    neuralHint.classList.toggle('hidden', !isStandard && !isNormal);
  }
  if (neuralHintStandard) neuralHintStandard.classList.toggle('hidden', !isStandard);
  if (neuralHintHouse) neuralHintHouse.classList.toggle('hidden', !isNormal);

  if (hookCheck) {
    if (isStandard) {
      hookCheck.checked = false;
      hookCheck.disabled = true;
    } else {
      hookCheck.disabled = false;
    }
  }

  if (!gameState || gameState.status !== 'lobby') {
    syncBotTypeSelect(selectMode);
  }
}

function formatModeLabel(mode) {
  return window.GameRules?.getModeLabel?.(mode) || mode;
}

function resolveViewerMode(source) {
  if (source === 'waiting' && gameState?.mode) return gameState.mode;
  return document.getElementById('select-game-mode')?.value || 'normal';
}

function resolveDeckViewerMode(source) {
  return resolveViewerMode(source);
}

function resolveRulesViewerMode(source) {
  return resolveViewerMode(source);
}

function deckCardDescription(card) {
  const suitName = SUIT_METADATA[card.suit]?.name || card.suit;
  if (card.value === 1) return `1 (Jester) — ${suitName}`;
  if (card.value === 15) return `15 (Wizard) — ${suitName}`;
  return `${card.value} of ${suitName}`;
}

let deckViewerTabsReady = false;

function setViewerActiveTab(containerId, mode) {
  document.querySelectorAll(`#${containerId} .deck-viewer-tab`).forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function setDeckViewerActiveTab(mode) {
  setViewerActiveTab('deck-viewer-mode-tabs', mode);
}

function renderDeckViewerContent(mode) {
  const deck = GameEngine.createDeck(mode);
  const modeLabels = {
    standard: 'Standard — 60 cards: 1 (Jester), 2–14, and 15 (Wizard) in each of 4 suits',
    normal: 'HOME Rules — same 60-card deck as Standard',
    purple: 'Purple — 75 cards: 1 (Jester), 2–14, and 15 (Wizard) in each of 5 suits'
  };

  document.getElementById('deck-viewer-subtitle').innerText = modeLabels[mode] || mode;
  document.getElementById('deck-viewer-count').innerText = `${deck.length} cards total`;

  const suits = mode === 'purple'
    ? ['green', 'blue', 'red', 'yellow', 'purple']
    : ['green', 'blue', 'red', 'yellow'];

  const grid = document.getElementById('deck-viewer-grid');
  grid.innerHTML = '';

  suits.forEach(suit => {
    const section = document.createElement('div');
    section.className = 'deck-viewer-suit-section';
    const cards = deck.filter(c => c.suit === suit);
    cards.sort((a, b) => {
      const aj = CardArt.isJesterCard(a) ? 0 : (CardArt.isWizardCard(a) ? 99 : a.value);
      const bj = CardArt.isJesterCard(b) ? 0 : (CardArt.isWizardCard(b) ? 99 : b.value);
      return aj - bj;
    });

    section.innerHTML = `<h3 class="deck-viewer-suit-title">${SUIT_METADATA[suit]?.emoji || ''} ${SUIT_METADATA[suit]?.name || suit} <span class="deck-viewer-suit-count">(${cards.length})</span></h3>`;
    const row = document.createElement('div');
    row.className = 'deck-viewer-suit-row';

    cards.forEach(card => {
      const wrap = document.createElement('div');
      wrap.className = 'deck-viewer-card-wrap';
      wrap.title = deckCardDescription(card);
      wrap.innerHTML = buildMiniCardHTML(card, '');
      const cap = document.createElement('span');
      cap.className = 'deck-viewer-card-label';
      cap.innerText = String(card.value);
      wrap.appendChild(cap);
      row.appendChild(wrap);
    });

    section.appendChild(row);
    grid.appendChild(section);
  });

  const note = document.createElement('p');
  note.className = 'deck-viewer-note';
  note.innerHTML = 'Each suit has one card per rank <strong>1–15</strong>. Card <strong>1</strong> is the Jester and card <strong>15</strong> is the Wizard — they are not extra cards on top of the numbered ranks. Playing a <strong>1</strong> or <strong>15</strong> does not set a follow-suit color.';
  grid.appendChild(note);
}

function openDeckViewer(source) {
  if (!deckViewerTabsReady) {
    deckViewerTabsReady = true;
    document.querySelectorAll('#deck-viewer-mode-tabs .deck-viewer-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        setDeckViewerActiveTab(mode);
        renderDeckViewerContent(mode);
      });
    });
  }

  const mode = resolveDeckViewerMode(source);
  document.getElementById('deck-viewer-title').innerText = 'Deck Reference';
  setDeckViewerActiveTab(mode);
  renderDeckViewerContent(mode);
  document.getElementById('overlay-deck-viewer').classList.remove('hidden');
}

function closeDeckViewer() {
  document.getElementById('overlay-deck-viewer')?.classList.add('hidden');
}

let rulesViewerTabsReady = false;

function setRulesViewerActiveTab(mode) {
  setViewerActiveTab('rules-viewer-mode-tabs', mode);
}

function renderRulesViewerContent(mode) {
  const rules = window.GameRules?.getModeRules?.(mode);
  if (!rules) return;

  document.getElementById('rules-viewer-subtitle').innerText = rules.subtitle || '';
  const body = document.getElementById('rules-viewer-body');
  body.innerHTML = '';

  (rules.sections || []).forEach(section => {
    const block = document.createElement('section');
    block.className = 'rules-viewer-section';

    const heading = document.createElement('h3');
    heading.className = 'rules-viewer-section-title';
    heading.innerText = section.heading;
    block.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'rules-viewer-list';
    (section.items || []).forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = item;
      list.appendChild(li);
    });
    block.appendChild(list);
    body.appendChild(block);
  });
}

function openRulesViewer(source) {
  if (!rulesViewerTabsReady) {
    rulesViewerTabsReady = true;
    document.querySelectorAll('#rules-viewer-mode-tabs .deck-viewer-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        setRulesViewerActiveTab(mode);
        renderRulesViewerContent(mode);
      });
    });
  }

  const mode = resolveRulesViewerMode(source);
  document.getElementById('rules-viewer-title').innerText = 'Rules Reference';
  setRulesViewerActiveTab(mode);
  renderRulesViewerContent(mode);
  document.getElementById('overlay-rules-viewer').classList.remove('hidden');
}

function closeRulesViewer() {
  document.getElementById('overlay-rules-viewer')?.classList.add('hidden');
}

// Helper to toggle screens (no recursion — uses activate* helpers directly)
function showScreen(screenId) {
  if (screenId === 'lobby-screen') {
    switchMainTab('create');
    return;
  }

  if (screenId === 'waiting-lobby') {
    activateWaitingLobby();
    return;
  }

  if (screenId === 'game-board') {
    activateGameBoard();
    return;
  }

  if (screenId === 'calculator-workspace') {
    hideAllMainScreens();
    setActiveMainTab('scores');
    document.getElementById('calculator-workspace')?.classList.add('active');
  }
}

// Actions from Lobby
function createRoom() {
  if (!window.firebaseConfigured) {
    alert('Firebase is not configured yet. Add your project keys to public/firebase-config.js first.');
    return;
  }

  const hostName = document.getElementById('input-create-name').value.trim();
  if (!hostName) {
    alert('Please enter a display name.');
    return;
  }

  const avatar = document.getElementById('input-create-emoji')?.value || '🧙';
  const playerCount = document.getElementById('select-player-count').value;
  const mode = document.getElementById('select-game-mode').value;
  const hookRule = mode === 'standard' ? false : document.getElementById('check-hook-rule').checked;

  sendSocketMsg('create_room', null, null, hostName, {
    hostName,
    avatar,
    playerCount,
    mode,
    hookRule
  });
  localStorage.setItem('wiz_avatar', avatar);
  WizardAudio.primeAudio();
}

function joinRoom() {
  if (!window.firebaseConfigured) {
    alert('Firebase is not configured yet. Add your project keys to public/firebase-config.js first.');
    return;
  }

  const code = document.getElementById('input-join-code').value.trim().toUpperCase();
  const name = document.getElementById('input-join-name').value.trim();

  if (!code || code.length !== 4) {
    alert('Please enter a valid 4-letter room code.');
    return;
  }
  if (!name) {
    alert('Please enter a display name.');
    return;
  }

  const avatar = document.getElementById('input-join-emoji')?.value || '🧝';
  localStorage.setItem('wiz_avatar', avatar);
  sendSocketMsg('join_room', code, null, name, { avatar });
  WizardAudio.primeAudio();
}

async function loadPastGamesList() {
  const container = document.getElementById('past-games-list');
  const searchInput = document.getElementById('input-history-search');
  if (!container) return;

  if (!window.firebaseConfigured) {
    container.innerHTML = '<p class="empty-state-text">Configure Firebase to save and view past games.</p>';
    return;
  }

  container.innerHTML = '<p class="empty-state-text">Loading…</p>';

  try {
    const filter = searchInput ? searchInput.value : '';
    const games = await WizardFirebase.listPastGames(filter);

    if (games.length === 0) {
      container.innerHTML = '<p class="empty-state-text">No games found yet. Finish a multiplayer game and it will appear here.</p>';
      return;
    }

    container.innerHTML = '';
    games.forEach(game => {
      const row = document.createElement('div');
      row.className = 'player-stat-row';
      row.style.cursor = 'pointer';
      row.style.marginBottom = '8px';

      const dateStr = game.completedAt && game.completedAt.toDate
        ? game.completedAt.toDate().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
        : 'Recent';

      const winners = (game.winners || []).join(' & ') || '—';
      const names = (game.playerNames || []).join(', ');

      row.innerHTML = `
        <div class="player-stat-info" style="flex: 1;">
          <div class="player-stat-name">Room ${game.roomCode} · ${dateStr}</div>
          <div class="empty-state-text" style="font-size: 12px; margin-top: 2px;">${names}</div>
          <div class="empty-state-text" style="font-size: 12px; color: var(--gold); margin-top: 2px;">Winner: ${winners}</div>
        </div>
        <div class="player-stat-scores-box">
          <span class="player-stat-score-total score-positive">${game.topScore ?? '—'}</span>
        </div>
      `;

      row.onclick = () => openPastGame(game.gameId || game.id);
      container.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p style="color: #ff6b6b; padding: 12px;">Could not load games. Check Firebase setup.</p>';
  }
}

let pastGameViewPlayers = null;

function computePlayerBidAccuracy(player) {
  const rounds = (player.roundScores || []).filter(rs =>
    rs && rs.bid != null && rs.won != null && !Number.isNaN(Number(rs.bid)) && !Number.isNaN(Number(rs.won))
  );
  if (rounds.length === 0) {
    return { exact: 0, total: 0, pct: 0 };
  }
  const exact = rounds.filter(rs => Number(rs.bid) === Number(rs.won)).length;
  return {
    exact,
    total: rounds.length,
    pct: Math.round((exact / rounds.length) * 100)
  };
}

function renderPastGameBidAccuracy(players) {
  const summary = document.getElementById('past-game-accuracy-summary');
  const body = document.getElementById('past-game-accuracy-body');
  if (!summary || !body) return;

  body.innerHTML = '';
  const stats = (players || []).map(p => ({
    player: p,
    ...computePlayerBidAccuracy(p)
  }));

  if (stats.length === 0) {
    summary.innerHTML = '<p class="past-game-accuracy-note">No round data available for bid accuracy.</p>';
    return;
  }

  const best = [...stats].sort((a, b) => b.pct - a.pct || b.exact - a.exact)[0];
  summary.innerHTML = `
    <p class="past-game-accuracy-note">
      Bid accuracy is the share of rounds where a player's bid matched tricks won exactly.
      ${best.total > 0 ? `Best: <strong>${best.player.name}</strong> at ${best.pct}% (${best.exact}/${best.total}).` : ''}
    </p>
  `;

  stats.forEach(({ player, exact, total, pct }) => {
    const tr = document.createElement('tr');
    const pctClass = pct >= 70 ? 'positive' : (pct < 40 ? 'negative' : '');
    tr.innerHTML = `
      <td>${player.name}</td>
      <td>${total}</td>
      <td>${exact}</td>
      <td class="${pctClass}">${total > 0 ? `${pct}%` : '—'}</td>
    `;
    body.appendChild(tr);
  });
}

function switchPastGameTab(tab) {
  const tabs = ['rounds', 'chart', 'accuracy'];
  tabs.forEach(name => {
    const btn = document.getElementById(`btn-past-game-tab-${name}`);
    const panel = document.getElementById(`past-game-tab-${name}`);
    const active = name === tab;
    if (btn) {
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    if (panel) {
      panel.classList.toggle('active', active);
      panel.style.display = active ? 'block' : 'none';
    }
  });

  if (tab === 'chart' && pastGameViewPlayers) {
    renderScoreProgressionChart('past-game-chart', pastGameViewPlayers);
  }
}

async function openPastGame(gameId) {
  const game = await WizardFirebase.getPastGame(gameId);
  if (!game) {
    alert('Could not load that game.');
    return;
  }

  const dateStr = game.completedAt && game.completedAt.toDate
    ? game.completedAt.toDate().toLocaleString()
    : '';

  document.getElementById('past-game-title').innerText = `Room ${game.roomCode}`;
  document.getElementById('past-game-subtitle').innerText =
    `${dateStr} · ${game.mode} mode · Winners: ${(game.winners || []).join(' & ')}`;

  pastGameViewPlayers = game.players || [];

  const head = document.getElementById('past-game-table-head');
  const body = document.getElementById('past-game-table-body');
  head.innerHTML = '<tr><th>Rnd</th>' + pastGameViewPlayers.map(p =>
    `<th>${p.name}</th>`
  ).join('') + '</tr>';
  body.innerHTML = '';

  const maxRound = game.maxRounds || 1;
  for (let r = 1; r <= maxRound; r++) {
    const tr = document.createElement('tr');
    let cells = `<td>${r}</td>`;
    pastGameViewPlayers.forEach(p => {
      const rs = (p.roundScores || []).find(x => x.round === r);
      if (rs) {
        const changeClass = rs.change >= 0 ? 'positive' : 'negative';
        const exactMark = Number(rs.bid) === Number(rs.won) ? ' ✓' : '';
        cells += `<td class="${changeClass}">${rs.bid}/${rs.won}${exactMark}<span class="past-game-change"> (${rs.change >= 0 ? '+' : ''}${rs.change})</span></td>`;
      } else {
        cells += `<td class="past-game-empty">—</td>`;
      }
    });
    tr.innerHTML = cells;
    body.appendChild(tr);
  }

  renderPastGameBidAccuracy(pastGameViewPlayers);
  switchPastGameTab('rounds');
  document.getElementById('overlay-past-game').classList.remove('hidden');
}

function closePastGameOverlay() {
  document.getElementById('overlay-past-game').classList.add('hidden');
  pastGameViewPlayers = null;
  if (activeCharts['past-game-chart']) {
    activeCharts['past-game-chart'].destroy();
    delete activeCharts['past-game-chart'];
  }
}

// Waiting Room Actions
function copyRoomCode() {
  const code = document.getElementById('room-code-display').innerText;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.getElementById('btn-copy-code');
    btn.innerText = '✓';
    setTimeout(() => btn.innerText = '📋', 2000);
  });
}

function startGame() {
  WizardAudio.primeAudio();
  sendSocketMsg('start_game', currentRoomCode, myPlayerId, myPlayerName, {});
}

function addBot() {
  const botType = document.getElementById('select-bot-type')?.value || 'neural_v7';
  if (gameState && botType !== 'heuristic' && window.BotClient) {
    const check = BotClient.neuralSetupValid({
      mode: gameState.mode,
      hookRule: gameState.hookRule,
      playerCount: gameState.playerCount || gameState.maxPlayers
    }, botType);
    if (!check.ok) {
      alert(check.message);
      return;
    }
  }
  sendSocketMsg('add_bot', currentRoomCode, myPlayerId, myPlayerName, { botType });
}

// Game Board Actions
function placeBid(bidAmount) {
  sendSocketMsg('place_bid', currentRoomCode, myPlayerId, myPlayerName, { bid: bidAmount });
}

function playCard(cardKey) {
  WizardAudio.primeAudio();
  sendSocketMsg('play_card', currentRoomCode, myPlayerId, myPlayerName, { cardKey });
}

function triggerNextRound() {
  sendSocketMsg('next_round', currentRoomCode, myPlayerId, myPlayerName, {});
}

function restartGame() {
  // Clear modal displays
  document.getElementById('overlay-game-over').classList.add('hidden');
  document.getElementById('overlay-round-summary').classList.add('hidden');
  document.getElementById('overlay-pause')?.classList.add('hidden');
  sendSocketMsg('restart_game', currentRoomCode, myPlayerId, myPlayerName, {});
}

function returnEveryoneToLobby() {
  if (!gameState || gameState.hostId !== myPlayerId) return;
  const ok = confirm('Return everyone to the lobby? Current game progress will be reset.');
  if (!ok) return;
  restartGame();
}

function leaveCurrentGame() {
  const ok = confirm('Leave this game and return to the main menu?');
  if (!ok) return;
  WizardFirebase.leaveGame();
}

function isHostOffline() {
  if (!gameState?.hostId) return false;
  const host = gameState.players.find(p => p.id === gameState.hostId);
  return !!(host && !host.isBot && !host.active);
}

function abandonStuckGame() {
  if (!gameState || gameState.hostId === myPlayerId) return;
  if (!isHostOffline()) {
    alert('The host is still connected. Wait for them to start the next round, or use Leave game.');
    return;
  }
  const ok = confirm('Return everyone to the lobby? Current game progress will be reset.');
  if (!ok) return;
  document.getElementById('overlay-round-summary')?.classList.add('hidden');
  sendSocketMsg('abandon_game', currentRoomCode, myPlayerId, myPlayerName, {});
}

function endGameEarly() {
  if (!gameState || gameState.hostId !== myPlayerId) return;
  if (gameState.status === 'lobby' || gameState.status === 'game_over') return;
  const ok = confirm('End the game now? Final scores will be calculated from the current standings.');
  if (!ok) return;
  sendSocketMsg('end_game', currentRoomCode, myPlayerId, myPlayerName, {});
}

function buildCardFaceHTML(card, options = {}) {
  if (window.CardArt) {
    return CardArt.renderCardInnerHTML(card, options);
  }
  const symbol = card.icon || (card.value === 1 ? '⬇️' : card.value === 15 ? '⭐' : '◆');
  const label = card.value === 1 ? 'Jester' : (card.value === 15 ? 'Wizard' : SUIT_METADATA[card.suit].name);
  const showSpecialLabel = (card.value === 1 || card.value === 15) && options.showLabel !== false;
  return `
    <div class="card-inner-border" aria-hidden="true"></div>
    <div class="card-corner card-corner-tl">
      <span class="card-num">${card.value}</span>
    </div>
    <div class="card-center-icon">${symbol}</div>
    ${showSpecialLabel ? `<div class="card-label-bottom">${label}</div>` : ''}
    <div class="card-corner card-corner-br">
      <span class="card-num">${card.value}</span>
    </div>
  `;
}

function buildMiniCardHTML(card, extraClass = '') {
  const suit = card.suit;
  const meta = SUIT_METADATA[suit];
  const title = `${card.value} of ${meta.name}`;
  const themeClass = window.CardArt?.getSuitThemeClass?.(card) || `suit-${suit}`;
  const mysticClass = window.CardArt?.getMysticCardClasses?.(card) || `mystic-card grimoire-card game-card ${themeClass}`;
  const isTrumpDisplay = extraClass.includes('is-trump') || extraClass.includes('trump');
  const trumpDisplayClass = isTrumpDisplay ? ' trump-card-display' : '';
  return `
    <div class="mini-card ${themeClass} suit-${suit} card-val-${card.value} ${mysticClass}${trumpDisplayClass} ${extraClass}" title="${title}">
      ${buildCardFaceHTML(card, { showLabel: false })}
    </div>
  `;
}

function getBotPodiumType(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('merlin')) return 'wizard';
  if (n.includes('sarum') || n.includes('saruman')) return 'skeleton';
  return 'generic';
}

function buildBotPodiumHTML(podiumType) {
  if (podiumType === 'wizard') {
    return `
      <div class="bot-podium bot-podium-wizard" aria-hidden="true">
        <div class="bot-podium-figure">
          <span class="bot-staff"></span>
          <span class="bot-orb"></span>
        </div>
        <div class="bot-podium-base"></div>
      </div>`;
  }
  if (podiumType === 'skeleton') {
    return `
      <div class="bot-podium bot-podium-skeleton" aria-hidden="true">
        <div class="bot-podium-figure">
          <span class="bot-gear-halo"></span>
          <span class="bot-skull-eyes"><span></span><span></span></span>
          <span class="bot-ribcage"></span>
        </div>
        <div class="bot-podium-base"></div>
      </div>`;
  }
  return `
    <div class="bot-podium bot-podium-generic" aria-hidden="true">
      <div class="bot-podium-figure"></div>
      <div class="bot-podium-base"></div>
    </div>`;
}

function mysticCardShellClass(card) {
  return window.CardArt?.getMysticCardClasses?.(card) || 'mystic-card';
}

/** Champ color: round trump 2–14, or trick led suit when there is no round trump — never 1 or 15. */
function isChampColorCard(card) {
  if (!card || card.value === 1 || card.value === 15) return false;
  if (card.value < 2 || card.value > 14) return false;
  if (gameState?.trumpSuit) {
    return card.suit === gameState.trumpSuit;
  }
  const ledSuit = GameEngine.getTrickLedSuit(gameState?.currentTrick || []);
  return !!ledSuit && card.suit === ledSuit;
}

function jobCardHighlightClass(jobCard) {
  if (!jobCard || jobCard.value === 1 || jobCard.value === 15) return '';
  return 'is-trump';
}

// Core game state renderer
function renderGameState() {
  if (!gameState) return;

  // 1. Connection Recovery / Paused Overlay
  const pauseOverlay = document.getElementById('overlay-pause');
  if (gameState.paused) {
    const inactivePlayers = gameState.players.filter(p => !p.active && !p.isBot);
    const names = inactivePlayers.map(p => p.name).join(', ');
    document.getElementById('pause-overlay-text').innerText = names
      ? `${names} disconnected.`
      : 'A player disconnected.';
    const isHost = gameState.hostId === myPlayerId;
    document.getElementById('pause-overlay-hint').innerText = isHost
      ? 'Wait for them to rejoin, or return everyone to the lobby.'
      : 'Wait for them to rejoin, or leave and start a new game.';
    document.getElementById('btn-pause-return-lobby')?.classList.toggle('hidden', !isHost);
    pauseOverlay.classList.remove('hidden');
  } else {
    pauseOverlay.classList.add('hidden');
  }

  // 2. Main View Selection
  if (gameState.status === 'lobby') {
    lastDealRoundAnnounced = 0;
    showScreen('waiting-lobby');
    renderWaitingLobby();
    return;
  } else {
    showScreen('game-board');
  }

  // 3. Status Bar Elements
  document.getElementById('txt-room-code').innerText = gameState.roomCode;
  document.getElementById('txt-round-number').innerText = `Round ${gameState.currentRound} of ${gameState.maxRounds}`;
  const modeBadge = document.getElementById('txt-mode-badge');
  modeBadge.innerText = formatModeLabel(gameState.mode);
  modeBadge.className = `badge-mini ${gameState.mode}`;

  // 4. Job Card (Trump) — table center + sidebar rail (visible while bidding)
  renderTrumpCards();

  // 5. Sidebar: Players status, Bids, Tricks & Scoreboard
  renderSidebarPanel();

  // 5b. Seating & Dynamic felt seats
  renderTableSeats();

  // Update center table trump (legacy hook — trump card is in table center)
  const tableTrumpEmoji = document.getElementById('table-trump-emoji');
  if (tableTrumpEmoji) {
    if (gameState.trumpSuit && SUIT_METADATA[gameState.trumpSuit]) {
      tableTrumpEmoji.innerText = SUIT_METADATA[gameState.trumpSuit].emoji;
    } else {
      tableTrumpEmoji.innerText = '—';
    }
  }
  document.querySelectorAll('.table-trump-label').forEach(el => {
    el.textContent = gameState.trumpSuit ? 'Trump' : 'No trump';
  });

  // 6. Action Alert Banner & Turn Guidance
  renderActionBanner();

  // 7. Overlays visibility checks
  renderOverlays();

  // 8. Play Area & Cards in current trick
  renderTrickArena();

  // 9. Private Player Hand
  renderPlayerHand();

  // Deal sound when a new round's cards arrive
  if (gameState.status === 'bidding' && gameState.currentRound !== lastDealRoundAnnounced) {
    const handSize = (gameState.privateHand || []).length;
    if (handSize > 0) {
      WizardAudio.playDealSound();
      lastDealRoundAnnounced = gameState.currentRound;
    }
  }
}

// Lobby rendering details
function renderWaitingLobby() {
  document.getElementById('room-code-display').innerText = currentRoomCode || '----';

  const maxPlayers = getMaxPlayers();
  const seated = gameState.players.length;

  const modeBadge = document.getElementById('badge-game-mode');
  modeBadge.innerText = formatModeLabel(gameState.mode);
  modeBadge.className = gameState.mode === 'purple' ? 'badge badge-purple' : 'badge';

  document.getElementById('badge-hook-rule').innerText = `Hook Rule: ${gameState.hookRule ? 'ON' : 'OFF'}`;
  document.getElementById('current-player-ratio').innerText = `${seated}/${maxPlayers}`;

  const playersList = document.getElementById('lobby-players-list');
  playersList.innerHTML = '';

  gameState.players.forEach((p, idx) => {
    const isMe = p.id === myPlayerId;
    const isHost = idx === 0;

    const pill = document.createElement('div');
    pill.className = 'player-pill';
    pill.innerHTML = `
      ${renderPlayerAvatar(p, idx)}
      <span class="player-pill-name">${p.name}${isMe ? ' (You)' : ''}</span>
      ${isHost ? '<span class="badge">Host</span>' : ''}
      ${p.isBot ? '<span class="badge badge-purple">Bot</span>' : ''}
      ${!p.active ? '<span class="badge badge-purple">Offline</span>' : ''}
    `;
    playersList.appendChild(pill);
  });

  // Host button controls toggle
  const isHost = gameState.players[0].id === myPlayerId;
  const readyToStart = seated === maxPlayers;

  syncBotTypeSelect(gameState.mode);

  if (isHost) {
    document.getElementById('host-controls').classList.remove('hidden');
    document.getElementById('non-host-waiting').classList.add('hidden');
    document.getElementById('btn-start-game').disabled = !readyToStart;

    const addBotBtn = document.getElementById('btn-add-bot');
    if (addBotBtn) {
      addBotBtn.disabled = seated >= maxPlayers;
    }
  } else {
    document.getElementById('host-controls').classList.add('hidden');
    document.getElementById('non-host-waiting').classList.remove('hidden');
  }
}

// Player stats and scores list (Sidebar)
function renderSidebarPanel() {
  const board = document.getElementById('game-board');
  const playerCount = gameState.players.length;
  if (board) {
    board.dataset.players = String(Math.max(2, Math.min(6, playerCount)));
    board.style.setProperty('--sidebar-players', String(playerCount));
  }

  const container = document.getElementById('players-stats-list');
  container.innerHTML = '';

  gameState.players.forEach((p, idx) => {
    const isActive = idx === gameState.activePlayerIndex && (gameState.status === 'bidding' || gameState.status === 'play');
    const isDealer = idx === gameState.dealerIndex;
    const isYou = p.id === myPlayerId;

    const row = document.createElement('div');
    row.className = `player-item ${isYou ? 'is-you' : ''} ${isActive ? 'is-active' : ''} ${!p.active ? 'inactive' : ''}`;

    let rolesHTML = '';
    if (isDealer) rolesHTML += '<span title="Dealer">⭐</span>';
    if (idx === 0) rolesHTML += '<span title="Host">👑</span>';

    const bidText = p.currentBid === null ? '—' : p.currentBid;
    const bidPending = p.currentBid === null;
    const totalClass = p.score >= 0 ? 'score-positive' : 'score-negative';
    const statusLine = getPlayerStatusLine(p, idx);
    const statusClass = isActive ? 'is-thinking' : '';

    row.innerHTML = `
      ${renderPlayerAvatar(p, idx)}
      <div class="player-info">
        <div class="player-name">${p.name}${isYou ? '<span class="you-tag">(You)</span>' : ''}</div>
        <div class="player-status-line ${statusClass}">${statusLine}</div>
        <div class="player-role-icons">${rolesHTML}</div>
      </div>
      <div class="player-stats">
        <div class="player-stat">
          <div class="player-stat-value ${bidPending ? 'pending' : ''}">${bidText}</div>
          <div class="player-stat-label">Bid</div>
        </div>
        <div class="player-stats-divider"></div>
        <div class="player-stat">
          <div class="player-stat-value">${p.tricksWon}</div>
          <div class="player-stat-label">Won</div>
        </div>
        <div class="player-stats-divider"></div>
        <div class="player-stat">
          <div class="player-stat-value ${totalClass}">${p.score}</div>
          <div class="player-stat-label">Total</div>
        </div>
      </div>
    `;

    container.appendChild(row);
  });

  const hostEndSec = document.getElementById('host-end-game-section');
  if (hostEndSec) {
    const isHost = gameState.hostId === myPlayerId
      || (!gameState.hostId && gameState.players[0]?.id === myPlayerId);
    const inProgress = ['bidding', 'play', 'round_end'].includes(gameState.status);
    hostEndSec.classList.toggle('hidden', !(isHost && inProgress));
  }

  scheduleSidebarFit();
}

let sidebarFitObserver = null;

function ensureSidebarFitObserver() {
  if (sidebarFitObserver) return;
  const scalable = document.querySelector('#game-board.active .sidebar-scalable');
  const sidebar = document.querySelector('#game-board.active .sidebar-panel');
  const observeTarget = scalable || sidebar;
  if (!observeTarget || typeof ResizeObserver === 'undefined') return;
  sidebarFitObserver = new ResizeObserver(() => scheduleSidebarFit());
  sidebarFitObserver.observe(observeTarget);
  if (sidebar && sidebar !== observeTarget) sidebarFitObserver.observe(sidebar);
}

function scheduleSidebarFit() {
  requestAnimationFrame(() => fitSidebarPanel());
}

/** Shrink sidebar uniformly so players + scoreboard fit without scrolling. */
function fitSidebarPanel() {
  const board = document.getElementById('game-board');
  const sidebar = board?.querySelector('.sidebar-panel');
  if (!board?.classList.contains('active') || !sidebar) return;

  ensureSidebarFitObserver();
  sidebar.style.setProperty('--sidebar-fit-scale', '1');

  requestAnimationFrame(() => {
    const scalable = sidebar.querySelector('.sidebar-scalable');
    const hostEndSec = sidebar.querySelector('#host-end-game-section');
    const hostEndVisible = hostEndSec && !hostEndSec.classList.contains('hidden');
    const hostEndHeight = hostEndVisible ? hostEndSec.offsetHeight : 0;
    const available = Math.max(sidebar.clientHeight - hostEndHeight - 4, 1);
    const natural = scalable ? scalable.scrollHeight : sidebar.scrollHeight;
    let scale = 1;
    if (available > 0 && natural > available) {
      scale = Math.max(0.58, available / natural);
    }
    sidebar.style.setProperty('--sidebar-fit-scale', scale.toFixed(3));
  });
}

// Alert banner message
function renderActionBanner() {
  const activePlayer = gameState.players[gameState.activePlayerIndex];
  const activeEmoji = getPlayerEmoji(activePlayer) || '';

  if (gameState.paused) {
    setActionBanner('Game paused — a player disconnected', { waiting: true });
    return;
  }

  if (gameState.status === 'bidding') {
    if (activePlayer.id === myPlayerId) {
      setActionBanner(`Your turn — place your bid for round ${gameState.currentRound}`, { yourTurn: true, bidding: true });
    } else {
      setActionBanner(`${activePlayer.name} is placing their bid`, { waiting: true, emoji: activeEmoji });
    }
  } else if (gameState.status === 'play') {
    if (activePlayer.id === myPlayerId) {
      setActionBanner('Your turn — play a card', { yourTurn: true });
    } else {
      setActionBanner(`${activePlayer.name} is playing...`, { waiting: true, emoji: activeEmoji });
    }
  } else if (gameState.status === 'round_end') {
    setActionBanner(`Round ${gameState.currentRound} complete — review scores`, {});
  } else if (gameState.status === 'game_over') {
    setActionBanner('Game complete — winner announced', {});
  }
}

// Bidding & scoreboard modal visibility
function renderOverlays() {
  const activePlayer = gameState.players[gameState.activePlayerIndex];

  // 1. Bidding overlay — only while it is your turn and you have not bid yet
  const bidOverlay = document.getElementById('bid-selector-overlay');
  const myPlayer = gameState.players.find(p => p.id === myPlayerId);
  const isMyBidTurn = gameState.status === 'bidding'
    && activePlayer.id === myPlayerId
    && !gameState.paused
    && myPlayer?.currentBid === null;

  if (isMyBidTurn) {
    bidOverlay.classList.remove('hidden');
    setupBidStepper();
  } else {
    bidOverlay.classList.add('hidden');
  }

  // 2. Round End summary overlay
  const summaryOverlay = document.getElementById('overlay-round-summary');
  if (gameState.status === 'round_end') {
    summaryOverlay.classList.remove('hidden');
    renderRoundSummary();
  } else {
    summaryOverlay.classList.add('hidden');
  }

  // 3. Game Over summary overlay
  const gameOverOverlay = document.getElementById('overlay-game-over');
  if (gameState.status === 'game_over') {
    gameOverOverlay.classList.remove('hidden');
    renderGameOver();
  } else {
    gameOverOverlay.classList.add('hidden');
  }
}

let selectedBidVal = 0;

// Setup stepper bidding controls
function setupBidStepper() {
  const totalCards = gameState.currentRound;

  // Calculate bids details for Hook Rule
  const totalBidsSoFar = gameState.players.reduce((sum, p) => sum + (p.currentBid !== null ? p.currentBid : 0), 0);
  const nullBidsCount = gameState.players.filter(p => p.currentBid === null).length;
  const isLastBidder = nullBidsCount === 1;
  const hookValue = isLastBidder && gameState.hookRule ? (totalCards - totalBidsSoFar) : -1;

  if (selectedBidVal > totalCards) selectedBidVal = totalCards;
  if (selectedBidVal < 0) selectedBidVal = 0;

  // Bypass hook value if selected
  if (selectedBidVal === hookValue) {
    if (selectedBidVal + 1 <= totalCards) {
      selectedBidVal++;
    } else if (selectedBidVal - 1 >= 0) {
      selectedBidVal--;
    }
  }

  // Render current selection
  document.getElementById('txt-bid-selection').innerText = selectedBidVal;

  const hookMsg = document.getElementById('bid-warning-msg');
  if (hookValue >= 0 && hookValue <= totalCards) {
    hookMsg.innerText = `⚠️ Hook Rule: You CANNOT bid ${hookValue} (makes total bids equal to ${totalCards} tricks).`;
    hookMsg.classList.remove('hidden');
  } else {
    hookMsg.classList.add('hidden');
  }

  // Update button states
  document.getElementById('btn-bid-dec').disabled = selectedBidVal <= 0;
  document.getElementById('btn-bid-inc').disabled = selectedBidVal >= totalCards;

  // Disable confirmation button if the selection is somehow matching the hook value
  document.getElementById('btn-confirm-bid').disabled = selectedBidVal === hookValue;
}

function changeBidSelection(delta) {
  const totalCards = gameState.currentRound;
  
  // Calculate bids details for Hook Rule
  const totalBidsSoFar = gameState.players.reduce((sum, p) => sum + (p.currentBid !== null ? p.currentBid : 0), 0);
  const nullBidsCount = gameState.players.filter(p => p.currentBid === null).length;
  const isLastBidder = nullBidsCount === 1;
  const hookValue = isLastBidder && gameState.hookRule ? (totalCards - totalBidsSoFar) : -1;

  let target = selectedBidVal + delta;
  
  // Skip hook value on clicks
  if (target === hookValue) {
    target += delta;
  }

  if (target >= 0 && target <= totalCards) {
    selectedBidVal = target;
    setupBidStepper();
  }
}

// Synchronized slider function
function changeBidSlider(val) {
  let target = parseInt(val);
  const totalCards = gameState.currentRound;

  // Calculate bids details for Hook Rule
  const totalBidsSoFar = gameState.players.reduce((sum, p) => sum + (p.currentBid !== null ? p.currentBid : 0), 0);
  const nullBidsCount = gameState.players.filter(p => p.currentBid === null).length;
  const isLastBidder = nullBidsCount === 1;
  const hookValue = isLastBidder && gameState.hookRule ? (totalCards - totalBidsSoFar) : -1;

  if (target === hookValue) {
    // Automatically skip hook value based on drag direction
    if (target > selectedBidVal) {
      target = target + 1 <= totalCards ? target + 1 : target - 1;
    } else {
      target = target - 1 >= 0 ? target - 1 : target + 1;
    }
  }

  if (target >= 0 && target <= totalCards) {
    selectedBidVal = target;
    setupBidStepper();
  }
}

function confirmBidSelection() {
  // Hide the bidding overlay instantly on confirm to clear the table view
  const bidOverlay = document.getElementById('bid-selector-overlay');
  if (bidOverlay) {
    bidOverlay.classList.add('hidden');
  }
  placeBid(selectedBidVal);
}

/** Polar layout: position 0 = bottom (you), going counter-clockwise */
function polarTableStyle(relativePos, nPlayers, radiusPercent) {
  const angle = (Math.PI / 2) + (relativePos * 2 * Math.PI / nPlayers);
  const x = 50 + radiusPercent * Math.cos(angle);
  const y = 50 + radiusPercent * Math.sin(angle);
  return {
    left: `${x}%`,
    top: `${y}%`,
    transform: 'translate(-50%, -50%)'
  };
}

function getSeatStyle(relativePos, nPlayers) {
  let radius = nPlayers <= 3 ? 62 : 56;
  const angle = (Math.PI / 2) + (relativePos * 2 * Math.PI / nPlayers);
  const sin = Math.sin(angle);
  // Pull top-side seats inward so they do not overlap the action banner
  if (sin < -0.2) radius -= 8;
  if (sin < -0.75) radius -= 6;

  const style = polarTableStyle(relativePos, nPlayers, radius);
  if (sin < -0.45) {
    const y = parseFloat(style.top);
    style.top = `${Math.min(y + 10, 44)}%`;
  }
  return style;
}

function getCardStyle(relativePos, nPlayers) {
  // Radius tuned so cards sit on green felt, clear of trump, and fully inside the circle
  let radius = 33;
  if (nPlayers <= 3) radius = 38;
  else if (nPlayers >= 6) radius = 29;
  else if (nPlayers >= 5) radius = 30;
  else if (nPlayers >= 4) radius = 31;
  if (relativePos === 0) radius -= 3;
  return polarTableStyle(relativePos, nPlayers, radius);
}

function applyPolarPosition(el, style) {
  el.style.left = style.left;
  el.style.top = style.top;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.transform = style.transform;
}

// Client-side trick winner resolution (uses shared game engine)
function evaluateWinningCardInTrick(trick, trumpSuit) {
  if (!trick || trick.length === 0) return null;
  const winner = GameEngine.resolveTrick(trick, trumpSuit || null);
  return winner?.card?.key ?? null;
}

// Seating positions round felt card table renderer
function renderTableSeats() {
  const container = document.getElementById('table-seats-container');
  if (!container || !gameState) return;
  container.innerHTML = '';

  const nPlayers = gameState.players.length;
  const myIndex = gameState.players.findIndex(p => p.id === myPlayerId);

  gameState.players.forEach((p, idx) => {
    const relativePos = (idx - myIndex + nPlayers) % nPlayers;

    // Your seat is at the bottom — hide your name pill; you see your hand below
    if (relativePos === 0) return;

    const seatStyle = getSeatStyle(relativePos, nPlayers);

    const isActive = idx === gameState.activePlayerIndex && (gameState.status === 'bidding' || gameState.status === 'play');
    const isDealer = idx === gameState.dealerIndex;
    const isHost = idx === 0;

    const wrapDiv = document.createElement('div');
    wrapDiv.className = 'table-seat-wrap';
    applyPolarPosition(wrapDiv, seatStyle);

    const seatDiv = document.createElement('div');
    seatDiv.className = `table-seat ${p.isBot ? 'is-bot' : ''} ${isActive ? 'active-turn' : ''} ${!p.active ? 'inactive' : ''}`;

    let rolesText = '';
    if (isDealer) rolesText += '⭐';
    if (isHost) rolesText += '👑';
    
    let avatarIcon = getPlayerEmoji(p) || '🧙';

    const botTagHTML = p.isBot ? '<span class="bot-tag table-seat-bot-tag">Bot</span>' : '';
    const displayName = p.name;

    let bidTrickHTML = '';
    if (gameState.status === 'lobby') {
      bidTrickHTML = `<span class="table-seat-bidwon">Lobby</span>`;
    } else if (gameState.status === 'bidding') {
      if (p.currentBid === null) {
        bidTrickHTML = `<span class="table-seat-bidwon bidding">Bidding…</span>`;
      } else {
        bidTrickHTML = `<span class="table-seat-bidwon">Bid ${p.currentBid}</span>`;
      }
    } else {
      const bidText = p.currentBid === null ? '—' : p.currentBid;
      bidTrickHTML = `<span class="table-seat-bidwon">${p.tricksWon} / ${bidText}</span>`;
    }

    // Lead player indicator
    let leadBadge = '';
    let ledPlayerId = null;
    if (gameState.currentTrick && gameState.currentTrick.length > 0) {
      ledPlayerId = gameState.currentTrick[0].playerId;
    } else if (gameState.status === 'play') {
      ledPlayerId = gameState.players[gameState.activePlayerIndex]?.id;
    }
    if (ledPlayerId && p.id === ledPlayerId) {
      leadBadge = `<span class="lead-wax-seal lead-badge">Lead</span>`;
    }

    seatDiv.innerHTML = `
      <div class="table-seat-avatar">${avatarIcon}${rolesText ? ` <span class="table-seat-roles">${rolesText}</span>` : ''}</div>
      ${botTagHTML}
      <div class="table-seat-name opponent-name">${displayName}</div>
      ${bidTrickHTML}
      ${leadBadge}
    `;

    if (p.isBot) {
      wrapDiv.insertAdjacentHTML('afterbegin', buildBotPodiumHTML(getBotPodiumType(displayName)));
    }
    wrapDiv.appendChild(seatDiv);
    container.appendChild(wrapDiv);
  });
}

function trickCardTilt(cardKey) {
  let hash = 0;
  for (let i = 0; i < cardKey.length; i++) {
    hash = (hash + cardKey.charCodeAt(i) * (i + 3)) % 360;
  }
  return -6 + (hash % 13);
}

let lastTrumpBadgeJobKey = null;

// Render Trick arena: seating position mapping perspective
function renderTrickArena() {
  const container = document.getElementById('trick-cards-grid');
  if (!container) return;
  container.innerHTML = '';

  const myIndex = gameState.players.findIndex(p => p.id === myPlayerId);
  const nPlayers = gameState.players.length;

  container.className = `trick-cards-grid players-${nPlayers}`;

  const winningCardKey = evaluateWinningCardInTrick(gameState.currentTrick, gameState.trumpSuit);
  const trickLen = gameState.currentTrick.length;

  gameState.currentTrick.forEach((played, trickIndex) => {
    const pIndex = gameState.players.findIndex(pl => pl.id === played.playerId);
    const relativePos = (pIndex - myIndex + nPlayers) % nPlayers;

    const cardStyle = getCardStyle(relativePos, nPlayers);

    const slot = document.createElement('div');
    const isWinner = played.card.key === winningCardKey;
    slot.className = `played-card-slot ${isWinner ? 'winner-card' : ''}`;

    const card = played.card;
    const isTrump = isChampColorCard(card);
    const isNewPlay = trickIndex === trickLen - 1;
    const tilt = trickCardTilt(card.key);

    const themeClass = window.CardArt?.getSuitThemeClass?.(card) || `suit-${card.suit}`;
    slot.innerHTML = `
      <div class="card-unit ${themeClass} suit-${card.suit} card-val-${card.value} ${mysticCardShellClass(card)} ${isTrump ? 'is-trump-color' : ''} ${isNewPlay ? 'card-play-settle' : ''}" style="cursor: default; margin: 0; --table-card-tilt: ${tilt}deg;">
        ${buildCardFaceHTML(card, { isTrump })}
      </div>
    `;

    applyPolarPosition(slot, cardStyle);
    slot.style.opacity = '0';
    slot.style.transform = `${cardStyle.transform} scale(0.88)`;

    container.appendChild(slot);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        slot.style.transform = `${cardStyle.transform} scale(1)`;
        slot.style.opacity = '1';
      });
    });
  });
}

let lastDealRoundAnnounced = 0;

const WizardAudio = {
  sfxEnabled: true,
  audioCtx: null,
  primed: false,

  getAudioCtx() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      if (!this.audioCtx) this.audioCtx = new AudioCtx();
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      return this.audioCtx;
    } catch (err) {
      console.debug('AudioContext unavailable:', err);
      return null;
    }
  },

  primeAudio() {
    this.getAudioCtx();
    this.primed = true;
  },

  playDealSound() {
    if (!this.sfxEnabled) return;
    try {
      const ctx = this.getAudioCtx();
      if (!ctx) return;
      const now = ctx.currentTime;
      for (let i = 0; i < 6; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220 + Math.random() * 180, now + i * 0.05);
        gain.gain.setValueAtTime(0.0001, now + i * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.06, now + i * 0.05 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.05 + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.05);
        osc.stop(now + i * 0.05 + 0.06);
      }
    } catch (err) {
      console.debug('Deal sound skipped:', err);
    }
  }
};

document.addEventListener('click', () => WizardAudio.primeAudio(), { once: true });

function renderTrumpCards() {
  const trumpCard = gameState.trumpCard || gameState.jobCard;
  const isNoTrumpFlip = trumpCard && (trumpCard.value === 1 || trumpCard.value === 15);
  const html = !trumpCard
    ? '<div class="mini-card empty">?</div>'
    : isNoTrumpFlip
      ? '<div class="mini-card empty no-trump-display">No trump</div>'
      : buildMiniCardHTML(trumpCard, jobCardHighlightClass(trumpCard));

  ['job-card-container', 'bid-trump-container'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });

  const centerTrump = document.querySelector('.table-center-trump');
  const jobKey = trumpCard?.key || null;
  if (centerTrump && jobKey !== lastTrumpBadgeJobKey) {
    lastTrumpBadgeJobKey = jobKey;
    centerTrump.classList.remove('trump-badge-enter');
    void centerTrump.offsetWidth;
    centerTrump.classList.add('trump-badge-enter');
  }
}

let lastHandDealKey = null;

// Private hand renderer + validation rules
function renderPlayerHand() {
  const container = document.getElementById('player-hand-container');
  container.innerHTML = '';

  const isStandard = GameEngine.isStandardMode(gameState.mode);
  const hand = isStandard
    ? StandardRules.sortStandardHand(gameState.privateHand || [])
    : GameEngine.sortHand(gameState.privateHand || []);
  if (hand.length === 0) {
    container.innerHTML = '<div class="empty-hand-placeholder">Cards will be dealt here.</div>';
    lastHandDealKey = null;
    return;
  }

  const dealKey = `${gameState.currentRound}-${hand.map(c => c.key).join('|')}`;
  const shouldDealAnimate = dealKey !== lastHandDealKey;
  lastHandDealKey = dealKey;

  const activePlayer = gameState.players[gameState.activePlayerIndex];
  const isMyTurn = gameState.status === 'play' && activePlayer.id === myPlayerId && !gameState.paused;

  const ledSuit = GameEngine.getTrickLedSuit(gameState.currentTrick || [], {
    mode: gameState.mode,
    trumpSuitIndex: gameState.trumpSuitIndex
  });

  const hasFollowSuit = isStandard
    ? (ledSuit != null && hand.some(c => c.id != null && !StandardRules.isWizard(c.id) && !StandardRules.isJester(c.id)
        && StandardRules.cardValue(c.id) >= 2
        && StandardRules.suitNameFromIndex(StandardRules.cardSuit(c.id)) === ledSuit))
    : (ledSuit
      ? hand.some(c => c.suit === ledSuit && c.value >= 2 && c.value <= 14)
      : false);

  hand.forEach((card, idx) => {
    // Check if card is playable
    let isPlayable = isMyTurn;
    if (isMyTurn && gameState.currentTrick.length > 0) {
      if (isStandard) {
        const legalIds = StandardRules.getLegalCardIds(hand, gameState.currentTrick, gameState.trumpSuitIndex ?? -1);
        isPlayable = legalIds.includes(card.id);
      } else if (hasFollowSuit) {
        const isWild = card.value === 1 || card.value === 15;
        const followsSuit = card.suit === ledSuit && card.value >= 2 && card.value <= 14;
        isPlayable = followsSuit || isWild;
      }
    }

    const isTrump = isChampColorCard(card);
    const themeClass = window.CardArt?.getSuitThemeClass?.(card) || `suit-${card.suit}`;
    const cardDiv = document.createElement('div');
    cardDiv.className = `card-unit ${themeClass} suit-${card.suit} card-val-${card.value} ${mysticCardShellClass(card)} ${shouldDealAnimate ? 'card-deal-in' : ''} ${isTrump ? 'is-trump-color' : ''} ${!isPlayable && isMyTurn ? 'invalid-play' : ''}`;
    if (shouldDealAnimate) {
      cardDiv.style.animationDelay = `${idx * 40}ms`;
    }

    if (isPlayable) {
      cardDiv.dataset.cardKey = card.key;
      cardDiv.classList.add('playable-card', 'playable');
      if (isMyTurn) cardDiv.classList.add('turn-ready');
    } else if (isMyTurn) {
      cardDiv.classList.add('invalid-play', 'not-playable');
    }

    cardDiv.innerHTML = buildCardFaceHTML(card, { isTrump });

    container.appendChild(cardDiv);
  });

  schedulePlayerHandLayout();
  ensureHandHoverHandlers();
}

function handRowSpan(cardW, overlap, count) {
  if (count <= 1) return cardW;
  return cardW + (count - 1) * (cardW - overlap);
}

function applyHandCardTransforms(container, count, rotStep) {
  container.querySelectorAll('.card-unit').forEach((cardDiv, idx) => {
    const rotation = (idx - (count - 1) / 2) * rotStep;
    const lift = Math.abs(rotation) * 0.4;
    cardDiv.style.setProperty('--fan-rot', `${rotation}deg`);
    cardDiv.style.setProperty('--fan-y', `${lift}px`);
    cardDiv.style.zIndex = idx;
  });
}

function pickHandCardByX(container, clientX) {
  const cards = [...container.querySelectorAll('.card-unit')];
  if (!cards.length) return null;

  const first = cards[0].getBoundingClientRect();
  const last = cards[cards.length - 1].getBoundingClientRect();
  const start = first.left;
  const end = last.right;
  if (end <= start) return cards[0];

  const slotW = (end - start) / cards.length;
  const idx = Math.min(cards.length - 1, Math.max(0, Math.floor((clientX - start) / slotW)));
  return cards[idx];
}

let handHoverBound = false;

function ensureHandHoverHandlers() {
  const container = document.getElementById('player-hand-container');
  if (!container || handHoverBound) return;
  handHoverBound = true;

  let rafId = 0;
  let hoveredCard = null;

  function setHovered(card) {
    if (card === hoveredCard) return;
    if (hoveredCard) hoveredCard.classList.remove('hand-card-hovered');
    hoveredCard = card;
    if (card) card.classList.add('hand-card-hovered');
  }

  container.addEventListener('mousemove', (e) => {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      setHovered(pickHandCardByX(container, e.clientX));
    });
  });

  container.addEventListener('mouseleave', () => setHovered(null));

  container.addEventListener('click', (e) => {
    const card = pickHandCardByX(container, e.clientX);
    if (!card) return;
    const key = card.dataset.cardKey;
    if (key) playCard(key);
  });
}

let handLayoutObserver = null;

function ensureHandLayoutObserver() {
  if (handLayoutObserver) return;
  const footer = document.querySelector('#game-board.active .game-hand-footer');
  const panel = document.querySelector('#game-board.active .my-hand-panel');
  const target = footer || panel;
  if (!target || typeof ResizeObserver === 'undefined') return;
  handLayoutObserver = new ResizeObserver(() => schedulePlayerHandLayout());
  handLayoutObserver.observe(target);
  if (panel && panel !== target) handLayoutObserver.observe(panel);
}

function schedulePlayerHandLayout() {
  requestAnimationFrame(() => {
    sizePlayerHandRow();
    requestAnimationFrame(sizePlayerHandRow);
  });
}

/** Minimum overlap (px hidden per card step) needed so the row fits targetSpan. */
function overlapToFitSpan(cardW, count, targetSpan) {
  if (count <= 1) return 0;
  return cardW - (targetSpan - cardW) / (count - 1);
}

function rotationPadding(cardW, count, rotStep, aspect) {
  if (count <= 1) return 0;
  const maxRot = ((count - 1) / 2) * rotStep;
  const cardH = cardW * aspect;
  return Math.ceil(Math.sin(maxRot * Math.PI / 180) * cardH * 0.35 + cardW * 0.05);
}

/** Largest card width that fits; uses minOverlap fan spacing unless tighter fit is required. */
function bestHandFit(targetSpan, count, minW, maxW, minVisible, minOverlap) {
  if (count <= 1) {
    const cardW = Math.floor(Math.max(minW, Math.min(maxW, targetSpan)));
    return { cardW, overlap: 0 };
  }

  for (let cardW = Math.floor(maxW); cardW >= minW; cardW--) {
    const needOverlap = overlapToFitSpan(cardW, count, targetSpan);
    const maxOverlap = cardW - minVisible;
    const overlap = Math.max(minOverlap, Math.min(Math.max(0, needOverlap), maxOverlap));
    if (handRowSpan(cardW, overlap, count) <= targetSpan) {
      return { cardW, overlap };
    }
  }

  const cardW = minW;
  const overlap = Math.max(
    minOverlap,
    Math.min(overlapToFitSpan(cardW, count, targetSpan), cardW - minVisible)
  );
  return { cardW, overlap: Math.max(0, overlap) };
}

/** Hand cards slightly larger than table cards — capped to fit the footer. */
const HAND_CARD_SCALE = 1.35;

function scaleHandMetric(value) {
  return Math.round(value * HAND_CARD_SCALE);
}

function handMaxWidth(count, availW, footerH, aspect, profileMaxW) {
  const maxByHeight = Math.floor(Math.max(72, (footerH || 110) - 8) / aspect);
  const maxByWidth = Math.floor(availW / Math.max(2.8, count * 0.62));
  return Math.min(profileMaxW, maxByHeight, maxByWidth);
}

/** Layout tiers: minVisible caps overlap; minOverlap keeps a light fan when space allows. */
function handLayoutProfile(count) {
  if (count > 11) {
    return {
      minVisible: scaleHandMetric(30),
      minOverlap: scaleHandMetric(5),
      maxW: scaleHandMetric(72),
      minW: scaleHandMetric(44),
      rotStep: 0.85
    };
  }
  if (count > 7) {
    return {
      minVisible: scaleHandMetric(28),
      minOverlap: scaleHandMetric(4),
      maxW: scaleHandMetric(72),
      minW: scaleHandMetric(42),
      rotStep: 1.2
    };
  }
  return {
    minVisible: scaleHandMetric(24),
    minOverlap: scaleHandMetric(3),
    maxW: scaleHandMetric(72),
    minW: scaleHandMetric(40),
    rotStep: count > 5 ? 1.5 : 2
  };
}

function handFooterBudget() {
  return Math.floor(Math.min(window.innerHeight * 0.195, 168));
}

function sizePlayerHandRow() {
  const container = document.getElementById('player-hand-container');
  const board = document.getElementById('game-board');
  if (!container || !board?.classList.contains('active')) return;

  ensureHandLayoutObserver();

  const count = container.querySelectorAll('.card-unit').length;
  if (count === 0) return;

  const panel = container.closest('.my-hand-panel');
  const footer = panel?.closest('.game-hand-footer');
  const availW = Math.max(40, footer?.clientWidth ?? panel?.clientWidth ?? container.clientWidth);
  const footerCap = handFooterBudget();
  const footerH = Math.min(footer?.clientHeight ?? panel?.clientHeight ?? 110, footerCap);
  const aspect = 152 / 108;
  const profile = handLayoutProfile(count);
  const { minVisible, minOverlap, maxW: profileMaxW, minW, rotStep } = profile;
  const maxW = handMaxWidth(count, availW, footerH, aspect, profileMaxW);

  let rotPad = rotationPadding(maxW, count, rotStep, aspect);
  let targetSpan = Math.max(40, availW - rotPad * 2);
  const needsScroll = count > 1 && handRowSpan(minW, Math.max(minOverlap, minW - minVisible), count) > targetSpan;

  container.classList.toggle('hand-scrollable', needsScroll);
  container.style.width = needsScroll ? '' : '100%';
  container.style.margin = '0';
  container.style.transform = '';

  let cardW;
  let overlap;

  if (needsScroll) {
    const scrollMaxW = handMaxWidth(count, availW, footerH, aspect, scaleHandMetric(88));
    cardW = Math.floor(Math.min(
      scrollMaxW,
      Math.max(scaleHandMetric(52), Math.min(scaleHandMetric(76), availW * 0.12))
    ));
    overlap = Math.max(minOverlap, cardW - minVisible);
  } else {
    ({ cardW, overlap } = bestHandFit(targetSpan, count, minW, maxW, minVisible, minOverlap));

    const fittedRotPad = rotationPadding(cardW, count, rotStep, aspect);
    if (fittedRotPad !== rotPad) {
      rotPad = fittedRotPad;
      targetSpan = Math.max(40, availW - fittedRotPad * 2);
      ({ cardW, overlap } = bestHandFit(targetSpan, count, minW, maxW, minVisible, minOverlap));
    }
  }

  if (count <= 3) {
    const overlapCap = cardW * (count <= 2 ? 0.2 : 0.3);
    overlap = Math.min(overlap, Math.max(minOverlap, overlapCap));
  }

  const sidePad = Math.ceil(overlap / 2 + rotPad);
  const cardH = Math.floor(cardW * aspect);
  board.style.setProperty('--hand-card-width', `${cardW}px`);
  board.style.setProperty('--hand-card-height', `${cardH}px`);
  board.style.setProperty('--hand-overlap', `${(overlap / 2).toFixed(1)}px`);
  board.style.setProperty('--hand-side-pad', `${sidePad}px`);
  applyHandCardTransforms(container, count, rotStep);
}

if (!window.__wizHandResizeBound) {
  window.__wizHandResizeBound = true;
  window.addEventListener('resize', () => {
    schedulePlayerHandLayout();
    scheduleSidebarFit();
  });
}

// Score sheet overlay for copy transposition
function renderRoundSummary() {
  document.getElementById('summary-round-title').innerText = `Round ${gameState.currentRound} Finished`;
  const body = document.getElementById('summary-table-body');
  body.innerHTML = '';

  gameState.players.forEach(p => {
    const roundScore = p.roundScores[p.roundScores.length - 1];
    if (!roundScore) return;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.name} ${p.id === myPlayerId ? '(You)' : ''}</td>
      <td>${roundScore.bid}</td>
      <td>${roundScore.won}</td>
      <td class="score-delta ${roundScore.change >= 0 ? 'positive' : 'negative'}">${roundScore.change >= 0 ? '+' : ''}${roundScore.change}</td>
      <td style="font-weight: bold;">${roundScore.total}</td>
    `;
    body.appendChild(tr);
  });

  // Host buttons reveal to start next round
  const isHost = gameState.hostId === myPlayerId;
  const hostOffline = isHostOffline();
  const hostNextSec = document.getElementById('host-next-round-section');
  const nonHostNextSec = document.getElementById('non-host-next-round-section');
  const waitingNote = document.getElementById('round-end-waiting-note');
  const waitingSpinner = document.getElementById('round-end-waiting-spinner');
  const stuckHint = document.getElementById('round-end-stuck-hint');
  const abandonBtn = document.getElementById('btn-round-end-abandon');

  if (isHost) {
    hostNextSec.classList.remove('hidden');
    nonHostNextSec.classList.add('hidden');
    document.getElementById('btn-next-round').innerText = gameState.currentRound === gameState.maxRounds ? 'Finish Game' : 'Start Next Round';
  } else {
    hostNextSec.classList.add('hidden');
    nonHostNextSec.classList.remove('hidden');

    const waitingText = gameState.currentRound === gameState.maxRounds
      ? 'Waiting for Host to finish the game...'
      : 'Waiting for Host to start the next round...';

    if (hostOffline) {
      if (waitingNote) {
        waitingNote.classList.add('hidden');
      }
      waitingSpinner?.classList.add('hidden');
      stuckHint?.classList.remove('hidden');
      stuckHint.innerText = 'The host appears to be offline. Return everyone to the lobby, or leave on your own.';
      abandonBtn?.classList.remove('hidden');
    } else {
      if (waitingNote) {
        waitingNote.classList.remove('hidden');
        waitingNote.innerText = waitingText;
      }
      waitingSpinner?.classList.remove('hidden');
      stuckHint?.classList.add('hidden');
      abandonBtn?.classList.add('hidden');
    }
  }
}

// Copy matrix summary to clipboard for Excel
function copyRoundSummaryData() {
  if (!gameState) return;

  // Build spreadsheet string (TSV)
  let text = 'Player\tBid\tWon\tScore Change\tTotal Score\n';
  
  gameState.players.forEach(p => {
    const roundScore = p.roundScores[p.roundScores.length - 1];
    if (roundScore) {
      text += `${p.name}\t${roundScore.bid}\t${roundScore.won}\t${roundScore.change}\t${roundScore.total}\n`;
    }
  });

  navigator.clipboard.writeText(text).then(() => {
    const successMsg = document.getElementById('copy-summary-success');
    successMsg.classList.remove('hidden');
    setTimeout(() => successMsg.classList.add('hidden'), 3000);
  });
}

// Game completion screens
function renderGameOver() {
  // Find highest score
  let maxScore = -999999;
  gameState.players.forEach(p => {
    if (p.score > maxScore) maxScore = p.score;
  });

  const winners = gameState.players.filter(p => p.score === maxScore).map(p => p.name).join(' & ');
  document.getElementById('txt-game-winners').innerText = `🏆 ${winners} wins with ${maxScore} points! 🏆`;

  const body = document.getElementById('final-scoreboard-body');
  body.innerHTML = '';

  const sorted = [...gameState.players].sort((a, b) => b.score - a.score);
  sorted.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td style="font-weight: ${p.id === myPlayerId ? '600' : 'normal'}">${p.name}</td>
      <td style="font-weight: bold;">${p.score}</td>
    `;
    body.appendChild(tr);
  });
}

// Execute connection on load
connectWebSocket();
updateModeWarning();
initEmojiPicker('create-emoji-picker', 'input-create-emoji', '🧙');
initEmojiPicker('join-emoji-picker', 'input-join-emoji', '🧝');

// ============================================================================
// WIZARD SCORE PROGRESSION GRAPH MODULE (CHART.JS INTEGRATION)
// ============================================================================

const activeCharts = {};

/**
 * Draws a gorgeous, responsive, smooth line chart representing players' score progression.
 * @param {string} canvasId - Element ID of the HTML Canvas
 * @param {Array} playersList - List of players containing cumulative scores history
 */
function getChartTheme(canvasId) {
  const canvas = document.getElementById(canvasId);
  const onParchment = canvas?.closest('.modal-card, .parchment-card, .sidebar-panel, .glass-panel');
  const highContrast = canvasId === 'multiplayer-summary-chart'
    || canvasId === 'multiplayer-gameover-chart'
    || canvasId === 'past-game-chart';
  if (onParchment) {
    return {
      legendColor: highContrast ? '#1a1208' : '#1a1208',
      tickColor: highContrast ? '#3d3020' : '#6b5a3a',
      gridColor: highContrast ? 'rgba(60, 45, 25, 0.22)' : 'rgba(107, 90, 58, 0.15)',
      pointBorder: '#1a1208',
      tooltipBg: 'rgba(247, 237, 213, 0.98)',
      tooltipTitle: '#1a1208',
      tooltipBody: '#3d3020',
      tooltipBorder: 'rgba(120, 90, 40, 0.5)'
    };
  }
  return {
    legendColor: '#f0e2c0',
    tickColor: '#d4c090',
    gridColor: 'rgba(255, 255, 255, 0.05)',
    pointBorder: '#0a1628',
    tooltipBg: 'rgba(18, 20, 32, 0.95)',
    tooltipTitle: '#fff',
    tooltipBody: '#dcdde1',
    tooltipBorder: 'rgba(255, 255, 255, 0.1)'
  };
}

function renderScoreProgressionChart(canvasId, playersList) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.error(`Chart canvas with ID ${canvasId} not found.`);
    return;
  }

  const ctx = canvas.getContext('2d');

  // Destroy previous Chart.js instance to prevent overlapping rendering bugs
  if (activeCharts[canvasId]) {
    activeCharts[canvasId].destroy();
  }

  // Determine the highest round reached so far
  let maxRoundsPlayed = 0;
  playersList.forEach(p => {
    const scoresArray = p.roundScores || [];
    if (scoresArray.length > maxRoundsPlayed) {
      maxRoundsPlayed = scoresArray.length;
    }
  });

  // Prepare X-axis labels: Start (Lobby) followed by R1, R2, etc.
  const labels = ['Lobby'];
  for (let r = 1; r <= maxRoundsPlayed; r++) {
    labels.push(`R${r}`);
  }

  const theme = getChartTheme(canvasId);

  // High-contrast palette — easy to tell players apart on parchment
  const themeColors = canvasId === 'multiplayer-summary-chart' || canvasId === 'multiplayer-gameover-chart'
    ? ['#047857', '#1d4ed8', '#b91c1c', '#b45309', '#7e22ce', '#0e7490']
    : ['#059669', '#2563eb', '#dc2626', '#d97706', '#9333ea', '#0891b2'];

  const datasets = playersList.map((player, index) => {
    const dataPoints = [0];
    const scoresArray = player.roundScores || [];
    scoresArray.forEach(rs => {
      dataPoints.push(rs.total);
    });

    const color = themeColors[index % themeColors.length];

    return {
      label: player.name,
      data: dataPoints,
      borderColor: color,
      backgroundColor: color + '18',
      borderWidth: canvasId === 'multiplayer-summary-chart' || canvasId === 'multiplayer-gameover-chart' ? 3.5 : 3,
      tension: 0.25,
      pointRadius: 5,
      pointHoverRadius: 7,
      pointBackgroundColor: color,
      pointBorderColor: '#ffffff',
      pointBorderWidth: 1.5,
      pointHoverBorderWidth: 2,
      fill: false
    };
  });

  activeCharts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: theme.legendColor,
            font: {
              family: 'Inter',
              size: 12,
              weight: '600'
            },
            padding: 15,
            usePointStyle: true,
            pointStyle: 'circle',
            boxWidth: 8,
            boxHeight: 8,
            generateLabels(chart) {
              const defaults = Chart.defaults.plugins.legend.labels.generateLabels(chart);
              return defaults.map((item, index) => ({
                ...item,
                fontColor: theme.legendColor,
                fillStyle: themeColors[index % themeColors.length],
                strokeStyle: themeColors[index % themeColors.length],
                lineWidth: 3
              }));
            }
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          padding: 12,
          backgroundColor: theme.tooltipBg,
          titleColor: theme.tooltipTitle,
          titleFont: { family: 'Inter', size: 13, weight: 'bold' },
          bodyColor: theme.tooltipBody,
          bodyFont: { family: 'Inter', size: 12 },
          borderColor: theme.tooltipBorder,
          borderWidth: 1,
          cornerRadius: 10
        }
      },
      scales: {
        x: {
          grid: {
            color: theme.gridColor
          },
          ticks: {
            color: theme.tickColor,
            font: { family: 'Inter', size: 11, weight: '500' }
          }
        },
        y: {
          grid: {
            color: theme.gridColor
          },
          ticks: {
            color: theme.tickColor,
            font: { family: 'Inter', size: 11, weight: '500' }
          }
        }
      },
      interaction: {
        mode: 'index',
        intersect: false
      }
    }
  });
}

// Multiplayer Summary Tab toggler
function switchSummaryTab(tab) {
  const btnTable = document.getElementById('btn-summary-tab-table');
  const btnChart = document.getElementById('btn-summary-tab-chart');
  const divTable = document.getElementById('summary-tab-table-content');
  const divChart = document.getElementById('summary-tab-chart-content');

  if (!btnTable || !btnChart || !divTable || !divChart) return;

  btnTable.classList.remove('active');
  btnChart.classList.remove('active');
  btnTable.setAttribute('aria-selected', 'false');
  btnChart.setAttribute('aria-selected', 'false');
  divTable.style.display = 'none';
  divChart.style.display = 'none';

  if (tab === 'table') {
    btnTable.classList.add('active');
    btnTable.setAttribute('aria-selected', 'true');
    divTable.style.display = 'block';
  } else {
    btnChart.classList.add('active');
    btnChart.setAttribute('aria-selected', 'true');
    divChart.style.display = 'block';
    
    // Draw the line chart inside multiplayer modal
    if (gameState && gameState.players) {
      renderScoreProgressionChart('multiplayer-summary-chart', gameState.players);
    }
  }
}

// Multiplayer Game Over Tab toggler
function switchGameOverTab(tab) {
  const btnStandings = document.getElementById('btn-gameover-tab-standings');
  const btnChart = document.getElementById('btn-gameover-tab-chart');
  const divStandings = document.getElementById('gameover-tab-standings-content');
  const divChart = document.getElementById('gameover-tab-chart-content');

  if (!btnStandings || !btnChart || !divStandings || !divChart) return;

  btnStandings.classList.remove('active');
  btnChart.classList.remove('active');
  divStandings.style.display = 'none';
  divChart.style.display = 'none';

  if (tab === 'standings') {
    btnStandings.classList.add('active');
    divStandings.style.display = 'block';
  } else {
    btnChart.classList.add('active');
    divChart.style.display = 'block';

    // Draw the final line chart inside multiplayer overlay
    if (gameState && gameState.players) {
      renderScoreProgressionChart('multiplayer-gameover-chart', gameState.players);
    }
  }
}

// ============================================================================
// OFFLINE SCORE SHEET CALCULATOR MODULE
// ============================================================================

let calcState = {
  players: [], // Array of { name, score, roundScores: [] }
  currentRound: 1,
  maxRounds: 25,
  mode: 'normal',
  hookRule: true,
  history: [], // Snapshot history for Undos
  dealerIndex: 0,
  activeTab: 'stats', // Sidebar active tab: 'stats' or 'graph'
  currentRoundBids: {}, // playerId -> bid
  currentRoundTricks: {}, // playerId -> tricks won
  chartInstance: null
};

// Populate player name input boxes dynamically in lobby setup form
function generateCalcPlayerInputs() {
  const countSelect = document.getElementById('select-calc-player-count');
  const container = document.getElementById('calc-player-names-container');
  if (!countSelect || !container) return;

  const count = parseInt(countSelect.value);
  container.innerHTML = '';

  const suggestions = ["Gandalf", "Saruman", "Merlin", "Dumbledore", "Hermione", "Voldemort"];

  for (let i = 0; i < count; i++) {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '12px';
    wrapper.innerHTML = `
      <span style="font-weight: 700; color: var(--primary); min-width: 25px; font-family: var(--font-display);">P${i+1}</span>
      <input type="text" id="calc-player-name-${i}" value="${suggestions[i] || 'Player ' + (i+1)}" placeholder="Enter name" style="flex: 1; padding: 10px 14px;" maxlength="12">
    `;
    container.appendChild(wrapper);
  }
}

// Manage Purple mode warning for offline setup
function updateCalcModeWarning() {
  const selectMode = document.getElementById('select-calc-game-mode').value;
  const warning = document.getElementById('calc-purple-mode-warning');
  if (!warning) return;

  if (selectMode === 'purple') {
    warning.classList.remove('hidden');
  } else {
    warning.classList.add('hidden');
  }
}

// Starts the offline scorecard session
function startCalculator() {
  const countSelect = document.getElementById('select-calc-player-count');
  const modeSelect = document.getElementById('select-calc-game-mode');
  const hookCheck = document.getElementById('check-calc-hook-rule');

  if (!countSelect || !modeSelect || !hookCheck) return;

  const count = parseInt(countSelect.value);
  const mode = modeSelect.value;
  const hookRule = hookCheck.checked;

  const players = [];
  for (let i = 0; i < count; i++) {
    const inputEl = document.getElementById(`calc-player-name-${i}`);
    const name = inputEl ? inputEl.value.trim() : `Player ${i+1}`;
    players.push({
      name: name || `Player ${i+1}`,
      score: 0,
      roundScores: []
    });
  }

  // HOME / Standard: 4 suits × 15 = 60 cards. Purple: 5 suits × 15 = 75 cards.
  const cardsCount = mode === 'purple' ? 75 : 60;
  const maxRounds = Math.floor(cardsCount / count);

  calcState = {
    players: players,
    currentRound: 1,
    maxRounds: maxRounds,
    mode: mode,
    hookRule: hookRule,
    history: [],
    dealerIndex: 0,
    activeTab: 'stats',
    currentRoundBids: {},
    currentRoundTricks: {},
    chartInstance: null
  };

  // Reset core control buttons
  const undoBtn = document.getElementById('btn-calc-undo');
  if (undoBtn) undoBtn.disabled = true;

  switchCalcSidebarTab('stats');
  showScreen('calculator-workspace');

  // Re-generate history column names
  const headerRow = document.getElementById('calc-history-headers');
  if (headerRow) {
    headerRow.innerHTML = '<th style="padding: 6px 8px;">Rnd</th>';
    players.forEach(p => {
      const th = document.createElement('th');
      th.style.padding = '6px 8px';
      th.style.textAlign = 'right';
      th.innerText = p.name;
      headerRow.appendChild(th);
    });
  }

  initCalcRoundUI();
  renderCalcLeaderboard();
  renderCalcHistoryTable();
}

// Initialize player card items for bids & trick selections (using select dropdowns)
function initCalcRoundUI() {
  document.getElementById('calc-txt-round').innerText = `Round ${calcState.currentRound} of ${calcState.maxRounds}`;
  const modeBadge = document.getElementById('calc-txt-mode-badge');
  modeBadge.innerText = formatModeLabel(calcState.mode);
  modeBadge.className = `badge-mini ${calcState.mode}`;

  const bannerText = document.getElementById('calc-action-banner-text');
  const dealer = calcState.players[calcState.dealerIndex];
  bannerText.innerText = `Round ${calcState.currentRound}: Place Bids & Tricks (Dealer is ${dealer.name} ⭐)`;

  const container = document.getElementById('calc-inputs-container');
  if (!container) return;
  container.innerHTML = '';

  calcState.players.forEach((player, idx) => {
    const isDealer = idx === calcState.dealerIndex;

    const card = document.createElement('div');
    card.className = 'calc-player-card';

    // Header info
    const header = document.createElement('div');
    header.className = 'calc-player-card-header';
    header.innerHTML = `
      <span class="calc-player-card-title">
        ${isDealer ? '⭐' : '🧙‍♂️'} ${player.name}
      </span>
      <span class="calc-player-card-score">${player.score} pts</span>
    `;
    card.appendChild(header);

    // Bidding Dropdown
    const bidRow = document.createElement('div');
    bidRow.className = 'calc-input-section';
    bidRow.innerHTML = `<span class="calc-input-label">Bid</span>`;

    // Compute Hook rule restricted bid dynamically if last bidder
    let hookBid = -1;
    if (calcState.hookRule) {
      // Last bidder in clockwise order is the dealer
      const isDealerLast = idx === calcState.dealerIndex;
      const otherBids = [];
      let everyoneElseBid = true;

      calcState.players.forEach((p, pIdx) => {
        if (pIdx !== idx) {
          const bidVal = calcState.currentRoundBids[pIdx];
          if (bidVal !== undefined && bidVal !== null) {
            otherBids.push(bidVal);
          } else {
            everyoneElseBid = false;
          }
        }
      });

      if (isDealerLast && everyoneElseBid) {
        const totalOtherBids = otherBids.reduce((sum, val) => sum + val, 0);
        hookBid = calcState.currentRound - totalOtherBids;
      }
    }

    const bidSelect = document.createElement('select');
    bidSelect.style.flex = '1';
    bidSelect.style.padding = '8px 12px';
    bidSelect.style.background = 'rgba(255, 255, 255, 0.05)';
    bidSelect.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    bidSelect.style.color = '#fff';
    bidSelect.style.borderRadius = '8px';
    bidSelect.id = `calc-bid-select-${idx}`;
    
    // Add default blank option
    const defaultBidOpt = document.createElement('option');
    defaultBidOpt.value = '';
    defaultBidOpt.innerText = 'Select bid...';
    bidSelect.appendChild(defaultBidOpt);

    for (let b = 0; b <= calcState.currentRound; b++) {
      const opt = document.createElement('option');
      opt.value = b;
      opt.innerText = b === hookBid ? `${b} (Hook Rule Blocked)` : b;
      if (b === hookBid) opt.disabled = true;
      if (calcState.currentRoundBids[idx] === b) opt.selected = true;
      bidSelect.appendChild(opt);
    }

    bidSelect.onchange = (e) => {
      const val = e.target.value;
      calcState.currentRoundBids[idx] = val === '' ? null : parseInt(val);
      initCalcRoundUI(); // Reload controls to refresh hook rule blocks
      validateCalcInputs();
    };
    bidRow.appendChild(bidSelect);
    card.appendChild(bidRow);

    // Trick Wins Dropdown
    const trickRow = document.createElement('div');
    trickRow.className = 'calc-input-section';
    trickRow.innerHTML = `<span class="calc-input-label">Won</span>`;

    const trickSelect = document.createElement('select');
    trickSelect.style.flex = '1';
    trickSelect.style.padding = '8px 12px';
    trickSelect.style.background = 'rgba(255, 255, 255, 0.05)';
    trickSelect.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    trickSelect.style.color = '#fff';
    trickSelect.style.borderRadius = '8px';
    trickSelect.id = `calc-trick-select-${idx}`;

    const defaultTrickOpt = document.createElement('option');
    defaultTrickOpt.value = '';
    defaultTrickOpt.innerText = 'Select tricks won...';
    trickSelect.appendChild(defaultTrickOpt);

    for (let t = 0; t <= calcState.currentRound; t++) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.innerText = t;
      if (calcState.currentRoundTricks[idx] === t) opt.selected = true;
      trickSelect.appendChild(opt);
    }

    trickSelect.onchange = (e) => {
      const val = e.target.value;
      calcState.currentRoundTricks[idx] = val === '' ? null : parseInt(val);
      validateCalcInputs();
    };
    trickRow.appendChild(trickSelect);
    card.appendChild(trickRow);

    container.appendChild(card);
  });

  validateCalcInputs();
}

// Form validation routines (trick calculations checks)
function validateCalcInputs() {
  const count = calcState.players.length;
  let bidsEntered = 0;
  let tricksEntered = 0;
  let tricksTotal = 0;

  for (let i = 0; i < count; i++) {
    const b = calcState.currentRoundBids[i];
    if (b !== undefined && b !== null) {
      bidsEntered++;
    }

    const t = calcState.currentRoundTricks[i];
    if (t !== undefined && t !== null) {
      tricksEntered++;
      tricksTotal += t;
    }
  }

  const validationEl = document.getElementById('calc-validation-msg');
  const saveBtn = document.getElementById('btn-calc-save-round');

  if (!validationEl || !saveBtn) return;

  if (bidsEntered < count) {
    validationEl.innerHTML = `⚠️ Bidding phase incomplete. Set bids for all players.`;
    validationEl.style.borderColor = 'rgba(241, 196, 15, 0.3)';
    validationEl.style.background = 'rgba(241, 196, 15, 0.1)';
    validationEl.style.color = 'var(--warning)';
    saveBtn.disabled = true;
  } else if (tricksEntered < count) {
    validationEl.innerHTML = `⚠️ Tricks incomplete. Assign trick counts won for all players.`;
    validationEl.style.borderColor = 'rgba(241, 196, 15, 0.3)';
    validationEl.style.background = 'rgba(241, 196, 15, 0.1)';
    validationEl.style.color = 'var(--warning)';
    saveBtn.disabled = true;
  } else if (tricksTotal !== calcState.currentRound) {
    validationEl.innerHTML = `⚠️ Total tricks won must equal <strong>${calcState.currentRound}</strong> (currently: ${tricksTotal}).`;
    validationEl.style.borderColor = 'rgba(192, 57, 43, 0.3)';
    validationEl.style.background = 'rgba(192, 57, 43, 0.1)';
    validationEl.style.color = '#ff6b6b';
    saveBtn.disabled = true;
  } else {
    validationEl.innerHTML = `✓ Verification successful! Bids and trick wins are balanced.`;
    validationEl.style.borderColor = 'rgba(39, 174, 96, 0.3)';
    validationEl.style.background = 'rgba(39, 174, 96, 0.1)';
    validationEl.style.color = '#57e389';
    saveBtn.disabled = false;
  }
}

// Saves score calculations of the current round
function saveCalcRound() {
  const count = calcState.players.length;

  // Snapshot for Undoing entries
  const snapHistory = {
    round: calcState.currentRound,
    dealerIndex: calcState.dealerIndex,
    bids: { ...calcState.currentRoundBids },
    tricks: { ...calcState.currentRoundTricks },
    playerScores: calcState.players.map(p => ({
      score: p.score,
      roundScores: [...p.roundScores]
    }))
  };
  calcState.history.push(snapHistory);

  const undoBtn = document.getElementById('btn-calc-undo');
  if (undoBtn) undoBtn.disabled = false;

  // Score adjustments
  calcState.players.forEach((player, idx) => {
    const bid = calcState.currentRoundBids[idx];
    const won = calcState.currentRoundTricks[idx];

    let change = 0;
    if (bid === won) {
      change = 20 + won * 10;
    } else {
      change = -10 * Math.abs(won - bid);
    }

    player.score += change;
    player.roundScores.push({
      round: calcState.currentRound,
      bid: bid,
      won: won,
      change: change,
      total: player.score
    });
  });

  calcState.currentRound++;
  calcState.dealerIndex = (calcState.dealerIndex + 1) % count;

  calcState.currentRoundBids = {};
  calcState.currentRoundTricks = {};

  if (calcState.currentRound > calcState.maxRounds) {
    // Session completed!
    renderCalcLeaderboard();
    renderCalcHistoryTable();

    document.getElementById('calc-inputs-container').innerHTML = `
      <div class="text-center" style="padding: 40px; background: rgba(39, 174, 96, 0.05); border: 1.5px solid var(--success); border-radius: 15px; margin: 20px 0;">
        <h2 class="shine" style="font-family: var(--font-display); font-size: 2.2rem; margin-bottom: 10px;">🏆 GAME OVER 🏆</h2>
        <p style="font-size: 1.1rem; color: #dcdde1; margin-bottom: 20px;">All ${calcState.maxRounds} rounds calculated. Final scores recorded.</p>
        <button class="btn btn-primary" onclick="exitCalculator()" style="padding: 14px 28px;">Exit Tracker</button>
      </div>
    `;

    document.getElementById('calc-action-banner-text').innerText = `🏆 Tracker Complete! Leaderboard finalized.`;
    document.getElementById('calc-validation-msg').classList.add('hidden');
    document.getElementById('btn-calc-save-round').classList.add('hidden');
  } else {
    initCalcRoundUI();
    renderCalcLeaderboard();
    renderCalcHistoryTable();
  }

  if (calcState.activeTab === 'graph') {
    renderCalcChart();
  }
}

// Revert last scored round
function undoCalcRound() {
  if (calcState.history.length === 0) return;

  const last = calcState.history.pop();
  calcState.currentRound = last.round;
  calcState.dealerIndex = last.dealerIndex;
  calcState.currentRoundBids = last.bids;
  calcState.currentRoundTricks = last.tricks;

  calcState.players.forEach((player, idx) => {
    const snap = last.playerScores[idx];
    player.score = snap.score;
    player.roundScores = snap.roundScores;
  });

  const undoBtn = document.getElementById('btn-calc-undo');
  if (undoBtn && calcState.history.length === 0) {
    undoBtn.disabled = true;
  }

  // Restore validation controls if game ended overlay was shown
  document.getElementById('calc-validation-msg').classList.remove('hidden');
  document.getElementById('btn-calc-save-round').classList.remove('hidden');

  initCalcRoundUI();
  renderCalcLeaderboard();
  renderCalcHistoryTable();

  if (calcState.activeTab === 'graph') {
    renderCalcChart();
  }
}

// Left Sidebar: Leaderboard listings
function renderCalcLeaderboard() {
  const container = document.getElementById('calc-leaderboard-container');
  if (!container) return;
  container.innerHTML = '';

  const sorted = [...calcState.players].sort((a, b) => b.score - a.score);

  sorted.forEach((player, idx) => {
    const row = document.createElement('div');
    row.className = 'player-stat-row';
    row.style.background = 'rgba(255, 255, 255, 0.02)';
    row.style.borderColor = 'rgba(255, 255, 255, 0.05)';

    let rankAvatar = '🧙‍♂️';
    if (idx === 0) rankAvatar = '👑';
    else if (idx === sorted.length - 1) rankAvatar = '🛡️';

    row.innerHTML = `
      <div class="player-stat-avatar" style="font-size: 1.3rem;">
        ${rankAvatar}
      </div>
      <div class="player-stat-info">
        <div class="player-stat-name">${player.name}</div>
        <div class="player-stat-role-icons" style="font-size: 0.75rem; color: var(--accent); font-weight: 700; text-transform: uppercase;">
          Rank #${idx+1}
        </div>
      </div>
      <div class="player-stat-scores-box">
        <span style="font-family: var(--font-display); font-size: 1.1rem; font-weight: bold; color: var(--primary);">
          ${player.score} pts
        </span>
      </div>
    `;
    container.appendChild(row);
  });
}

// Left Sidebar: Round history sheet values
function renderCalcHistoryTable() {
  const tbody = document.getElementById('calc-history-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const maxRoundsPlayed = calcState.players[0].roundScores.length;

  for (let r = 0; r < maxRoundsPlayed; r++) {
    const tr = document.createElement('tr');
    tr.style.background = r % 2 === 0 ? 'rgba(255, 255, 255, 0.01)' : 'none';

    // Round number
    const rTd = document.createElement('td');
    rTd.style.padding = '6px 8px';
    rTd.style.fontWeight = 'bold';
    rTd.innerText = r + 1;
    tr.appendChild(rTd);

    // Players round changes
    calcState.players.forEach(p => {
      const rs = p.roundScores[r];
      const pTd = document.createElement('td');
      pTd.style.padding = '6px 8px';
      pTd.style.textAlign = 'right';

      if (rs) {
        pTd.innerHTML = `
          <div style="font-weight: 600;">${rs.total}</div>
          <div style="font-size: 0.7rem; color: #b2bec3;">${rs.won}/${rs.bid} (${rs.change >= 0 ? '+' : ''}${rs.change})</div>
        `;
      } else {
        pTd.innerText = '-';
      }
      tr.appendChild(pTd);
    });

    tbody.appendChild(tr);
  }
}

// Exit Tracker
function exitCalculator() {
  if (confirm("Are you sure you want to close the Score Tracker? Your current progress will be lost.")) {
    showScreen('lobby-screen');
    switchLobbyTab('create');
  }
}

// Sidebar subtab switching: Leaderboard vs Chart
function switchCalcSidebarTab(tab) {
  const btnStats = document.getElementById('btn-calc-tab-stats');
  const btnGraph = document.getElementById('btn-calc-tab-graph');
  const divStats = document.getElementById('calc-sidebar-stats');
  const divGraph = document.getElementById('calc-sidebar-graph');

  if (!btnStats || !btnGraph || !divStats || !divGraph) return;

  btnStats.classList.remove('active');
  btnGraph.classList.remove('active');
  divStats.style.display = 'none';
  divGraph.style.display = 'none';

  calcState.activeTab = tab;

  if (tab === 'stats') {
    btnStats.classList.add('active');
    divStats.style.display = 'flex';
  } else {
    btnGraph.classList.add('active');
    divGraph.style.display = 'flex';
    renderCalcChart();
  }
}

// Render graph tracker details
function renderCalcChart() {
  renderScoreProgressionChart('calc-progression-chart', calcState.players);
}
