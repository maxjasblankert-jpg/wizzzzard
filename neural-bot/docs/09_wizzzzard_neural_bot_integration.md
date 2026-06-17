# Guide: integrating v6 and v7 neural bots into wizzzzard

This document is a **step-by-step implementation guide** for wiring the trained neural
Wizard bots into the playable **wizzzzard** web app in this repository.

It assumes your starting artifacts are exactly these two checkpoint files:

| File | Model | Players | Size (approx.) |
|---|---|---|---|
| [`models/v6_final.pt`](../models/v6_final.pt) | v6 attention MAPPO agent | **3 only** | ~787 KB |
| [`models/v7_final.pt`](../models/v7_final.pt) | v7 player-count-agnostic agent | **3 and 4** | ~876 KB |

Everything else in this guide is code you add or modify **in this repo** so the browser
game can call those checkpoints at runtime.

For the low-level observation/math contract, also see
[08_bot_integration.md](08_bot_integration.md). This guide is the **wizzzzard-specific
recipe**.

> **Important:** neural bots do **not** plug into the existing Normal or Purple house
> rules. You must add a **new, separate game mode** — `standard` — that implements
> **official Wizard tournament rules** and exists primarily so the trained models can play
> correctly. Humans can sit at a Standard table too, but Champion bots are **only** allowed
> there.

---

## 1. What you are building

```
┌─────────────────────┐      HTTP POST /act       ┌──────────────────────┐
│  wizzzzard (browser)│  ───────────────────────► │  bot_service.py      │
│  Firebase multiplayer│      JSON game snapshot   │  (FastAPI, port 8001) │
└─────────────────────┘                           └──────────┬───────────┘
        │                                                      │
        │  mode === 'standard' only                    │  PyTorch inference
        │  official deck (card ids 0–59)                 ▼
        │  via standard-rules.js               ┌──────────────────────┐
        │                                           ┌──────────────────────┐
        └─ human UI, lobby, tricks                  │ v6_final.pt  (3p)    │
                                                    │ v7_final.pt  (3p+4p) │
                                                    └──────────────────────┘
```

**Key idea:** the browser owns UI and multiplayer sync. The Python service owns
**rules parity + observation encoding + inference**. Never re-implement the observation
vector in JavaScript — silent drift makes the bot play randomly without errors.

You are **not** bolting bots onto Normal mode. You are adding a **third deck/mode option**
alongside the existing ones, with its own rules module and engine branches, and wiring
neural inference only into that path.

---

## 2. Standard mode — official ruleset for ML bots

Before touching the model files, understand what **Standard** is in this project.

### 2.1 Three modes in wizzzzard

wizzzzard already had house-rule variants. Bot integration adds a **new mode** that is
**not** a reskin of Normal:

| Lobby value | UI label | Who it is for | Neural bots? |
|---|---|---|---|
| `normal` | Normal (60 Cards, 4 Suits) | Casual house rules — job card trump, 1/15 wildcards | **No** — different deck and trick logic |
| `purple` | Purple Mode (75 Cards, 5 Suits) | Extended house rules | **No** |
| `standard` | **Standard (Official — ML bots)** | Official Wizard rules, matches training | **Yes** — v6 / v7 **only** work here |

Standard is stored on every room as `room.mode === 'standard'` in Firestore and in the
client `gameState.mode`.

### 2.2 What makes Standard “official” (and different from Normal)

Standard mode must mirror [`wizard_simulator.py`](../wizard_simulator.py) — the same
rules the models were trained on:

| Rule area | Normal / Purple (house) | **Standard (official, for bots)** |
|---|---|---|
| Deck | 4–5 suits × values 1–15 | **60 cards**, integer ids **0–59** |
| Wizards / Jesters | Value 15 / 1 in each suit | **Separate** wizard (52–55) and jester (56–59) cards |
| Trump | **Job card** each round | **Flip** one card from the undealt pile |
| Trick winner | `GameEngine.resolveTrick` | `StandardRules.evaluateTrickWinner` |
| Follow suit | 1/15 wildcards | Colored cards only; wizards/jesters per official rules |
| Hook rule | Optional | **Forced off** — not in training distribution |
| Rounds | varies | `floor(60 / players)` → 20 @ 3p, 15 @ 4p |

Implementation lives in [`wizzzzard/public/standard-rules.js`](../wizzzzard/public/standard-rules.js).
The main engine delegates when `GameEngine.isStandardMode(room.mode)` is true
([`game-engine.js`](../wizzzzard/public/game-engine.js)).

### 2.3 Bots vs humans in Standard mode

| Bot type | `botType` | Works in Normal/Purple? | Works in Standard? |
|---|---|---|---|
| Practice (heuristic) | `heuristic` | Yes | Yes |
| Champion v6 | `neural_v6` | **No** — blocked in UI and server | Yes, **3 players only** |
| Champion v7 | `neural_v7` | **No** — blocked in UI and server | Yes, **3 or 4 players** |

**Enforcement you must implement** (already in this repo):

1. **Lobby deck selector** — add `standard` as its own option, labeled for ML bots
2. **`bot-client.js`** — throws if `room.mode !== 'standard'` when building `/act` payload
3. **`addBot` guards** — reject `neural_v6` / `neural_v7` unless mode is standard
4. **`updateModeWarning()` in `app.js`** — disable Champion options when not Standard;
   auto-uncheck hook rule
5. **Fallback** — if neural `/act` fails, fall back to heuristic bot (never silently use
   Normal rules for a neural seat)

Humans **can** create a Standard room and play without bots, but the mode exists so
bot observation parity is guaranteed. Do not try to run Champion bots in Normal “by
mapping cards” — the id spaces and trick rules do not align.

### 2.4 What you add to the codebase for Standard mode

These files are **part of bot integration**, not optional polish:

| File | Role |
|---|---|
| `standard-rules.js` | Official deck, trump flip, bidding, tricks, follow-suit |
| `game-engine.js` | `isStandardMode()`, `startRound()` → `startStandardRound()`, play/bid branches |
| `app.js` | Trump UI reads `trumpCard`; Standard-aware highlighting |
| `firebase-game.js` | Persists `trumpCard`, `trumpSuitIndex` (not just `jobCard`) |
| `index.html` | Default deck = Standard; neural setup hint |

Without Standard mode, the two `.pt` files have **nowhere valid to run** in wizzzzard.

---

## 3. Hard requirements (both models)

Neural bots only work in **Standard mode** when the table matches training:

| Setting | Required value |
|---|---|
| Game mode | **`standard` only** — not `normal`, not `purple` |
| Deck | Official 60-card deck (ids 0–59) via `standard-rules.js` |
| Hook rule | **Off** (forced off in lobby when Standard or Champion selected) |
| v6 player count | **3** |
| v7 player count | **3 or 4** |
| Bot service | Running at `http://127.0.0.1:8001` (or override, see §10) |

If a player creates a **Normal** room and adds a Practice bot, that still works. If they
try to add a **Champion** bot, the app must refuse until they recreate the room in
**Standard (Official — ML bots)**.

---

## 4. Model differences (pick the right one)

| | **v6** (`v6_final.pt`) | **v7** (`v7_final.pt`) |
|---|---|---|
| Players | 3 only | 3 **and** 4 |
| Observation | `float32[300]` via `build_observation(..., tactical_features=True)` | `float32[332]` via `obs_v7.build_actor_obs` |
| Python loader | `model_v6.ActorCritic(num_players=3)` | `model_v7.ActorCritic()` (no player-count arg) |
| Strength (vs rule bot) | ~85% win / ~64% bid acc @ 3p | ~97% @ 3p, ~85% @ 4p |
| App bot type id | `neural_v6` | `neural_v7` (**recommended default**) |

Config sidecars (optional reference, not loaded at runtime):

- [`models/v6_config.json`](../models/v6_config.json)
- [`models/v7_config.json`](../models/v7_config.json)

---

## 5. Place the two model files

From the **wizard_ml repo root** (parent of `wizzzzard/`):

```text
wizard_ml/
├── models/
│   ├── v6_final.pt    ← 3-player champion
│   └── v7_final.pt    ← 3+4-player champion
├── model_v6.py        ← inference code (already in repo)
├── model_v7.py
├── obs_v7.py
├── wizard_simulator.py
├── wizard_env.py      ← v6 observation builder
├── bot_service.py     ← you create / copy this (§6)
└── wizzzzard/         ← the web game
```

If you only have the `.pt` files, copy them into `models/`. The Python modules listed
above must also be present — they define how to load and feed each checkpoint.

---

## 6. Python bot service

### 6.1 Dependencies

Create [`requirements-bot.txt`](../requirements-bot.txt) at repo root:

```text
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
```

Install into the project venv (torch/numpy are already needed for training code):

```bash
cd wizard_ml
.venv/bin/pip install -r requirements-bot.txt
```

### 6.2 Service implementation

The full service lives in [`bot_service.py`](../bot_service.py). It exposes:

| Endpoint | Purpose |
|---|---|
| `GET /health` | `{ ok, models: { v6, v7 }, players: { v6: [3], v7: [3,4] } }` |
| `POST /act` | Given a game snapshot → returns `{ action, model, kind, latency_ms }` |

**Request body** (`POST /act`) — the browser sends this on every bot turn:

```json
{
  "protocol": 1,
  "model": "v7",
  "num_players": 3,
  "seat": 1,
  "phase": "bid",
  "round": 5,
  "trump": 2,
  "trump_card": 28,
  "dealer": 0,
  "starter": 1,
  "hands": { "1": [0, 13, 52] },
  "bids": [null, null, null],
  "taken": [0, 0, 0],
  "trick": [],
  "seen": [28],
  "legal_actions": [0, 1, 2, 3, 4, 5]
}
```

| Field | Meaning |
|---|---|
| `model` | `"v6"`, `"v7"`, or `"auto"` |
| `phase` | `"bid"` or `"play"` |
| `trump` | suit index 0–3, or `-1` (no trump) |
| `trump_card` | flipped card id 0–59, or `-1` |
| `hands` | map of **seat index → list of card ids** (only acting bot's hand required) |
| `legal_actions` | bid values or card ids the bot may choose |
| `action` (response) | during bidding: bid integer; during play: **card id** 0–59 |

**Inference routing inside the service:**

```python
# v6 — 3 players only
obs, mask = build_observation(sim, seat, tactical_features=True)  # (300,), (60,)
model_v6.ActorCritic(num_players=3).act_greedy(obs, mask)

# v7 — 3 or 4 players
obs, mask = obs_v7.build_actor_obs(sim, seat)                     # (332,), (60,)
model_v7.ActorCritic().act_greedy(obs, mask)
```

The service rebuilds a `WizardSimulator` from the JSON snapshot, runs the correct
observation builder, and returns the greedy action.

### 6.3 Run the service

```bash
cd wizard_ml
.venv/bin/python -m uvicorn bot_service:app --port 8001
```

Verify:

```bash
curl http://127.0.0.1:8001/health
# → {"ok":true,"models":{"v6":true,"v7":true},...}
```

### 6.4 Validate before touching the UI

```bash
cd wizard_ml
.venv/bin/python validate_bot_integration.py
```

This checks `/health`, v6/v7 parity against in-process `act_greedy`, and that v6 is
rejected at 4 players.

---

## 7. Browser integration (wizzzzard)

All paths below are under [`wizzzzard/public/`](../wizzzzard/public/) unless noted.

### 7.1 Script load order

In [`wizzzzard/public/index.html`](../wizzzzard/public/index.html), load bot scripts
**after** the game engine and **before** `firebase-game.js`:

```html
<script src="standard-rules.js"></script>
<script src="game-engine.js"></script>
<script src="bot-config.js"></script>
<script src="bot-client.js"></script>
<script src="firebase-game.js"></script>
<script src="app.js"></script>
```

### 7.2 Bot service URL — `bot-config.js`

[`bot-config.js`](../wizzzzard/public/bot-config.js) resolves the service URL:

1. `window.BOT_SERVICE_URL` (if set)
2. `localStorage.wiz_bot_service_url`
3. default `http://127.0.0.1:8001`

### 7.3 HTTP client — `bot-client.js`

[`bot-client.js`](../wizzzzard/public/bot-client.js) is the bridge. It **refuses** to run
if `room.mode !== 'standard'` — Champion bots cannot be called from Normal/Purple rooms.

1. **Build** the `/act` JSON payload from a live `room` + `handsById`
2. **POST** to the bot service
3. **Map** the returned card id back to a `card.key` for the game engine

Bot type → model mapping:

| `player.botType` | `model` in payload | Valid table sizes |
|---|---|---|
| `neural_v7` | `"v7"` | 3 or 4 |
| `neural_v6` | `"v6"` | 3 only |

Key functions exported as `window.BotClient`:

```javascript
BotClient.isNeuralBot(player)           // neural_v6 or neural_v7
BotClient.neuralSetupValid(room, type)  // standard + hook off + player count
BotClient.playNeuralBotBid(room, hands, playerId)
BotClient.playNeuralBotCard(room, hands, playerId)
```

Payload construction highlights (must match `bot_service.py`):

```javascript
{
  model: 'v7',                              // from botType
  num_players: room.playerCount,            // 3 or 4
  seat: seatIndex(room, playerId),
  phase: room.status === 'bidding' ? 'bid' : 'play',
  trump: room.trumpSuitIndex ?? -1,
  trump_card: room.trumpCard?.id ?? -1,
  hands: { [String(seat)]: hand.map(c => c.id) },
  legal_actions: /* from StandardRules */,
  seen: /* trump + played + current trick card ids */
}
```

### 7.4 Bot turns — `firebase-game.js`

In [`firebase-game.js`](../wizzzzard/public/firebase-game.js), the host automation loop
(`maybeRunBots`) checks each active bot:

```javascript
if (BotClient.isNeuralBot(activeNow)) {
  bidVal = await BotClient.playNeuralBotBid(freshRoom, freshHands, activeNow.id);
  // on failure → fall back to Engine().playBotBid()
} else {
  bidVal = Engine().playBotBid(freshRoom);
}
```

Same pattern for play phase with `playNeuralBotCard` → `Engine().playCard(...)`.

**Firestore:** room documents must persist `trumpCard`, `trumpSuit`, `trumpSuitIndex`
(see `roomDocFromRuntime` and `buildSyncPayload`). Cards written to Firestore must not
contain `undefined` fields — use `stripUndefined()`.

### 7.5 WebSocket path — `server.js` (optional local dev)

[`wizzzzard/server.js`](../wizzzzard/public/server.js) mirrors the same bot-turn logic
for non-Firebase WebSocket play. At the top:

```javascript
require('./public/standard-rules.js');
require('./public/game-engine.js');
require('./public/bot-config.js');
require('./public/bot-client.js');
```

### 7.6 Lobby UI — `index.html` + `app.js`

**Deck mode selector** — add Standard as a **separate** option (not a tweak to Normal):

```html
<select id="select-game-mode">
  <option value="standard">Standard (Official — ML bots)</option>
  <option value="normal">Normal (60 Cards, 4 Suits)</option>
  <option value="purple">Purple Mode (75 Cards, 5 Suits)</option>
</select>
```

Set **Standard as the default** when the goal is bot play. The label should make clear
this is the official ruleset for ML bots, not the casual house-rules deck.

**Setup hint** (show when Standard or Champion is selected):

```html
<div id="neural-setup-hint">
  Champion bots need <strong>Standard (Official)</strong> mode and <strong>Hook Rule off</strong>.
  v7: 3 or 4 players. v6: 3 players only.
</div>
```

**Bot picker** ([`index.html`](../wizzzzard/public/index.html)):

```html
<select id="select-bot-type">
  <option value="heuristic">Practice Bot</option>
  <option value="neural_v7" selected>Champion (v7)</option>
  <option value="neural_v6">Champion (v6, 3p)</option>
</select>
```

**Deck default:** `standard` (Official — ML bots).

**Validation** ([`app.js`](../wizzzzard/public/app.js)):

- `validateNeuralSetup(room, botType)` before `addBot()` — **must** be `mode === 'standard'`
- `updateModeWarning()`:
  - shows neural hint when Standard or Champion selected
  - **disables** Champion options if deck ≠ Standard or player count wrong
  - **forces hook rule off** and disables the checkbox for Standard / neural
- `createRoom()` passes `mode: 'standard'` from the selector into Firebase

**Add bot** sends `{ botType: 'neural_v7' }` via Firebase `add_bot` message. Server
rejects Champion types unless the room was created in Standard mode.

### 7.7 Adding a bot in Firebase — `firebase-game.js`

`WizardFirebase.addBot` validates setup, writes player doc with `botType`, and logs:

```javascript
{ isBot: true, botType: 'neural_v7', avatar: '🏆', ... }
```

Guards:

```javascript
// v6
roomDoc.mode === 'standard' && roomDoc.playerCount === 3 && !roomDoc.hookRule

// v7
roomDoc.mode === 'standard' && !roomDoc.hookRule
  && (roomDoc.playerCount === 3 || roomDoc.playerCount === 4)
```

---

## 8. Standard rules implementation (see also §2)

Section §2 explains **why** Standard mode exists. This section is the **implementation
pointer** — the code paths that must exist before any `.pt` file will work.

Neural models were **not** trained on Normal mode. There is no supported path to run
Champion bots there.

| Normal / Purple (house) | Standard (`mode === 'standard'`) |
|---|---|
| `jobCard` sets trump | `trumpCard` flipped from deck |
| card values 1–15 per suit | card ids **0–59** |
| `GameEngine.resolveTrick` | `StandardRules.evaluateTrickWinner` |
| Champion bots allowed | **No** |
| Practice bot allowed | Yes |

Files:

- [`standard-rules.js`](../wizzzzard/public/standard-rules.js) — deck, trump flip, trick logic
- [`game-engine.js`](../wizzzzard/public/game-engine.js) — `isStandardMode()` branches
- UI reads `gameState.trumpCard` (not only `jobCard`) for trump display

Round counts: `floor(60 / playerCount)` → 20 rounds @ 3p, 15 @ 4p.

---

## 9. End-to-end checklist

Use this when integrating from scratch:

### Standard mode (do this before bot service)

- [ ] `standard-rules.js` added — official deck + trump + tricks
- [ ] `game-engine.js` branches on `mode === 'standard'`
- [ ] Lobby has **separate** `standard` deck option (not Normal with a flag)
- [ ] Champion bot options **disabled** unless Standard is selected
- [ ] Hook rule forced **off** for Standard / neural
- [ ] `addBot` / `add_bot` rejects `neural_v6` / `neural_v7` in Normal/Purple rooms
- [ ] Trump UI uses `trumpCard` in Standard mode

### Models & Python

- [ ] `models/v6_final.pt` and `models/v7_final.pt` in place
- [ ] `model_v6.py`, `model_v7.py`, `obs_v7.py`, `wizard_simulator.py`, `wizard_env.py` present
- [ ] `bot_service.py` and `requirements-bot.txt` at repo root
- [ ] `python validate_bot_integration.py` passes
- [ ] `uvicorn bot_service:app --port 8001` running

### wizzzzard JS

- [ ] `standard-rules.js` + `game-engine.js` standard branches
- [ ] `bot-config.js` + `bot-client.js` loaded in `index.html`
- [ ] `firebase-game.js`: `maybeRunBots` calls `BotClient` for neural bots
- [ ] `firebase-game.js`: `buildSyncPayload` includes `trumpCard`, `trumpSuitIndex`
- [ ] `app.js`: lobby validation for `neural_v6` / `neural_v7`
- [ ] `index.html`: bot type selector with v7 default

### Firebase / env

- [ ] `wizzzzard/.env` or parent `.env` with `FIREBASE_*` keys
- [ ] `npm run config:firebase` generates `public/firebase-config.js`
- [ ] Anonymous auth enabled in Firebase console

### Smoke test

1. Start bot service (terminal 1) and `npm start` in `wizzzzard/` (terminal 2)
2. Open http://localhost:3001
3. Create room: deck **Standard (Official — ML bots)**, **3 or 4 players**
4. Confirm hook rule is off; add **Champion (v7)** bots (not Practice if you want neural)
5. Start Game — bots bid/play; bot service logs `POST /act` 200s

**Negative test:** create a **Normal** room → Champion option should be disabled or
`addBot` should error. Practice bots should still work.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Bot service error: connection refused` | Service not running | Start uvicorn on 8001 |
| Champion option greyed out | Room not in Standard mode | Recreate room with **Standard (Official — ML bots)** |
| `neural bots require standard` error | `bot-client.js` guard tripped | Switch deck mode; do not use Champion in Normal |
| `neural_v6 supports exactly 3 players` | v6 bot in 4p game | Use `neural_v7` for 4p |
| `Unsupported field value: undefined` (Firestore) | Card missing `icon` | `standard-rules.js` + `stripUndefined()` |
| Trump shows `?` in Standard mode | UI reads `jobCard` only | Use `trumpCard \|\| jobCard` in `renderTrumpCards()` |
| Bot plays legal but weak/random | Observation drift | Never build obs in JS; fix payload fields |
| CORS errors | Service missing CORS | `CORSMiddleware` in `bot_service.py` (already there) |

Override bot service URL in browser console:

```javascript
BotConfig.setBotServiceUrl('http://192.168.1.10:8001');
location.reload();
```

---

## 11. File map (everything touched for this integration)

```text
wizard_ml/
├── models/
│   ├── v6_final.pt          ★ starting artifact
│   └── v7_final.pt          ★ starting artifact
├── model_v6.py              inference (v6)
├── model_v7.py              inference (v7)
├── obs_v7.py                observation (v7)
├── wizard_simulator.py      rules engine (shared)
├── wizard_env.py            observation (v6)
├── bot_service.py           FastAPI service
├── requirements-bot.txt
├── validate_bot_integration.py
└── wizzzzard/
    ├── BOTS.md              quick reference
    └── public/
        ├── standard-rules.js    ★ official mode (bots require this)
        ├── game-engine.js       mode === 'standard' branches
        ├── bot-config.js        service URL
        ├── bot-client.js        HTTP bridge ★
        ├── firebase-game.js     bot turn automation ★
        ├── server.js              WebSocket bot path
        ├── app.js                 lobby validation ★
        └── index.html             bot picker ★
```

★ = primary integration surface between the web app and the two `.pt` files.

---

## 12. Quick commands

```bash
# Terminal 1 — bot service
cd wizard_ml
.venv/bin/pip install -r requirements-bot.txt
.venv/bin/python -m uvicorn bot_service:app --port 8001

# Terminal 2 — game
cd wizard_ml/wizzzzard
npm install          # first time only
npm start            # http://localhost:3001

# Validate
cd wizard_ml
.venv/bin/python validate_bot_integration.py
cd wizzzzard && npm test
```

That is the complete path from **two checkpoint files** plus a **new Standard official
mode** to a playable Champion bot in this project's wizzzzard app.
