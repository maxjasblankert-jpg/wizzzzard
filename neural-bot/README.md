# Neural bot service

Champion bots (v6/v7) for **Standard (Official)** mode.

## Local

```bash
cd neural-bot
pip install -r requirements-bot.txt
python -m uvicorn bot_service:app --port 8001
```

Or from repo root: `npm run bot:service`

Set `BOT_SERVICE_URL=http://127.0.0.1:8001` in `.env`, then `npm run sync:firebase`.

## Deploy (Render)

1. Create a **Web Service** from this repo, root directory `neural-bot`
2. Use the included `Dockerfile` or set start command:
   `uvicorn bot_service:app --host 0.0.0.0 --port $PORT`
3. Health check: `/health`
4. Copy the public URL into Vercel env `BOT_SERVICE_URL` and local `.env`

## Endpoints

- `GET /health` — model load status
- `POST /act` — bid or play action (see `docs/09_wizzzzard_neural_bot_integration.md`)
