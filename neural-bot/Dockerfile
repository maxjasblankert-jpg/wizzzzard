FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip

COPY requirements-bot.txt .
RUN pip install --no-cache-dir -r requirements-bot.txt

COPY bot_service.py model_v6.py model_v7.py obs_v7.py wizard_simulator.py wizard_env.py ./
COPY models/ ./models/

ENV PORT=8001
EXPOSE 8001

CMD uvicorn bot_service:app --host 0.0.0.0 --port ${PORT}
