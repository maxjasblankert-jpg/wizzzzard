"""FastAPI bot microservice for v6 (3p) and v7 (3p+4p) neural Wizard play.

Run from repo root:
    .venv/bin/pip install -r requirements-bot.txt
    .venv/bin/python -m uvicorn bot_service:app --port 8001
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Literal

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import model_v6
import model_v7
import obs_v7
from wizard_env import build_observation
from wizard_simulator import WizardSimulator

ROOT = Path(__file__).resolve().parent
V6_PATH = ROOT / "models" / "v6_final.pt"
V7_PATH = ROOT / "models" / "v7_final.pt"
V7_HOUSE_PATH = ROOT / "models" / "v7_house_final.pt"

app = FastAPI(title="Wizard Neural Bot Service", version=2)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_v6_model: model_v6.ActorCritic | None = None
_v7_model: model_v7.ActorCritic | None = None
_v7_house_model: model_v7.ActorCritic | None = None


class ActRequest(BaseModel):
    protocol: int = 1
    bot_id: str = "champion"
    model: Literal["v6", "v7", "v7_house", "auto"] = "auto"
    num_players: int = Field(default=3, ge=3, le=4)
    seat: int = Field(ge=0, le=3)
    phase: str  # "bid" | "play"
    round: int = Field(ge=1, le=20)
    trump: int = Field(default=-1, ge=-1, le=3)
    trump_card: int = Field(default=-1, ge=-1, le=59)
    dealer: int = Field(default=0, ge=0, le=3)
    starter: int | None = None
    hands: dict[str, list[int]] = Field(default_factory=dict)
    bids: list[int | None]
    taken: list[int]
    trick: list[dict[str, Any]] = Field(default_factory=list)
    seen: list[int] = Field(default_factory=list)
    legal_actions: list[int]


class ActResponse(BaseModel):
    protocol: int = 1
    model: str
    action: int
    kind: str
    latency_ms: float


def _resolve_model_id(req: ActRequest) -> Literal["v6", "v7", "v7_house"]:
    if req.model == "v6":
        return "v6"
    if req.model == "v7_house":
        return "v7_house"
    if req.model == "v7":
        return "v7"
    if req.num_players == 4:
        return "v7"
    return "v7"


def _checkpoint_path(preferred: Path, fallback: Path) -> Path:
    if preferred.exists():
        return preferred
    if fallback.exists():
        return fallback
    return preferred


def _load_v6() -> model_v6.ActorCritic:
    global _v6_model
    if _v6_model is not None:
        return _v6_model
    path = _checkpoint_path(V6_PATH, ROOT / "runs" / "v6" / "final.pt")
    if not path.exists():
        raise RuntimeError(f"No v6 checkpoint at {V6_PATH}")
    torch.set_num_threads(1)
    net = model_v6.ActorCritic(num_players=3)
    net.load_state_dict(torch.load(path, map_location="cpu", weights_only=True))
    net.eval()
    _v6_model = net
    return _v6_model


def _load_v7() -> model_v7.ActorCritic:
    global _v7_model
    if _v7_model is not None:
        return _v7_model
    path = _checkpoint_path(V7_PATH, ROOT / "runs" / "v7" / "final.pt")
    if not path.exists():
        raise RuntimeError(f"No v7 checkpoint at {V7_PATH}")
    torch.set_num_threads(1)
    net = model_v7.ActorCritic()
    net.load_state_dict(torch.load(path, map_location="cpu", weights_only=True))
    net.eval()
    _v7_model = net
    return _v7_model


def _load_v7_house() -> model_v7.ActorCritic:
    global _v7_house_model
    if _v7_house_model is not None:
        return _v7_house_model
    path = _checkpoint_path(
        V7_HOUSE_PATH,
        ROOT / "runs" / "v7_house" / "final.pt",
    )
    if not path.exists():
        path = _checkpoint_path(V7_PATH, ROOT / "runs" / "v7" / "final.pt")
    if not path.exists():
        raise RuntimeError(f"No v7_house checkpoint at {V7_HOUSE_PATH}")
    torch.set_num_threads(1)
    net = model_v7.ActorCritic()
    net.load_state_dict(torch.load(path, map_location="cpu", weights_only=True))
    net.eval()
    _v7_house_model = net
    return _v7_house_model


@app.on_event("startup")
def startup() -> None:
    if V7_PATH.exists() or (ROOT / "runs" / "v7" / "final.pt").exists():
        _load_v7()
    if V7_HOUSE_PATH.exists() or (ROOT / "runs" / "v7_house" / "final.pt").exists() or V7_PATH.exists():
        try:
            _load_v7_house()
        except RuntimeError:
            pass
    if V6_PATH.exists() or (ROOT / "runs" / "v6" / "final.pt").exists():
        _load_v6()


@app.get("/")
def root() -> dict[str, Any]:
    return health()


SERVICE_VERSION = "2026-06-18-tricks-played"


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "version": SERVICE_VERSION,
        "models": {
            "v6": _v6_model is not None,
            "v7": _v7_model is not None,
            "v7_house": _v7_house_model is not None,
        },
        "players": {"v6": [3], "v7": [3, 4], "v7_house": [3, 4]},
    }


def _rebuild_sim(req: ActRequest) -> tuple[WizardSimulator, int]:
    """Hydrate a simulator snapshot for inference (no opponent auto-play)."""
    npl = req.num_players
    sim = WizardSimulator(num_players=npl, misere=False, random_dealer=False)
    seat = req.seat
    if seat < 0 or seat >= npl:
        raise HTTPException(400, f"seat {seat} out of range for {npl} players")

    sim.round = req.round
    sim.trump = req.trump
    sim.trump_card = req.trump_card
    sim.dealer = req.dealer
    sim.starter = req.starter if req.starter is not None else (req.dealer + 1) % npl
    sim.phase = WizardSimulator.BIDDING if req.phase == "bid" else WizardSimulator.PLAYING
    sim.current_player = seat
    sim.current_bidder = seat if req.phase == "bid" else seat

    sim.hands[:] = False
    for key, cards in req.hands.items():
        p = int(key)
        if p < 0 or p >= npl:
            continue
        for c in cards:
            cid = int(c)
            if 0 <= cid < 60:
                sim.hands[p, cid] = True

    sim.seen[:] = False
    if 0 <= sim.trump_card < 60:
        sim.seen[sim.trump_card] = True
    for c in req.seen:
        cid = int(c)
        if 0 <= cid < 60:
            sim.seen[cid] = True

    sim.trick_mask[:] = False
    sim.trick_len = 0
    for entry in req.trick:
        cid = int(entry["card"] if isinstance(entry["card"], int) else entry["card"]["id"])
        p = int(entry["seat"])
        sim.trick_order[sim.trick_len] = cid
        sim.trick_players[sim.trick_len] = p
        sim.trick_mask[cid] = True
        sim.seen[cid] = True
        sim.trick_len += 1

    for i in range(npl):
        sim.bids[i] = 0 if i >= len(req.bids) or req.bids[i] is None else int(req.bids[i])
        sim.taken[i] = int(req.taken[i]) if i < len(req.taken) else 0

    sim.tricks_played = int(sim.taken.sum())
    sim._bids_placed = sum(1 for b in req.bids if b is not None)
    return sim, seat


def _legal_from_sim(sim: WizardSimulator, seat: int, phase: str) -> list[int]:
    if phase == "bid":
        sim.current_bidder = seat
        return sim.legal_bids()
    sim.current_player = seat
    return sim.legal_cards()


def _act_v6(sim: WizardSimulator, seat: int, legal: list[int]) -> int:
    model = _load_v6()
    obs, mask = build_observation(sim, seat, tactical_features=True)
    obs_t = torch.as_tensor(obs).unsqueeze(0)
    mask_t = torch.as_tensor(mask).unsqueeze(0)
    with torch.no_grad():
        action = int(model.act_greedy(obs_t, mask_t).item())
    if action not in legal and legal:
        action = int(legal[0])
    return action


def _act_v7(sim: WizardSimulator, seat: int, legal: list[int]) -> int:
    model = _load_v7()
    obs, mask = obs_v7.build_actor_obs(sim, seat)
    obs_t = torch.as_tensor(obs).unsqueeze(0)
    mask_t = torch.as_tensor(mask).unsqueeze(0)
    with torch.no_grad():
        action = int(model.act_greedy(obs_t, mask_t).item())
    if action not in legal and legal:
        action = int(legal[0])
    return action


def _act_v7_house(sim: WizardSimulator, seat: int, legal: list[int]) -> int:
    model = _load_v7_house()
    obs, mask = obs_v7.build_actor_obs(sim, seat)
    obs_t = torch.as_tensor(obs).unsqueeze(0)
    mask_t = torch.as_tensor(mask).unsqueeze(0)
    with torch.no_grad():
        action = int(model.act_greedy(obs_t, mask_t).item())
    if action not in legal and legal:
        action = int(legal[0])
    return action


@app.post("/act", response_model=ActResponse)
def act(req: ActRequest) -> ActResponse:
    if req.protocol != 1:
        raise HTTPException(400, "unsupported protocol")
    if req.phase not in ("bid", "play"):
        raise HTTPException(400, "phase must be bid or play")

    model_id = _resolve_model_id(req)
    if model_id == "v6" and req.num_players != 3:
        raise HTTPException(400, "neural_v6 supports exactly 3 players")
    if model_id == "v7" and req.num_players not in (3, 4):
        raise HTTPException(400, "neural_v7 supports 3 or 4 players")
    if model_id == "v7_house" and req.num_players not in (3, 4):
        raise HTTPException(400, "neural_v7_house supports 3 or 4 players")

    t0 = time.perf_counter()
    sim, seat = _rebuild_sim(req)
    legal = req.legal_actions or _legal_from_sim(sim, seat, req.phase)

    try:
        if model_id == "v6":
            action = _act_v6(sim, seat, legal)
        elif model_id == "v7_house":
            action = _act_v7_house(sim, seat, legal)
        else:
            action = _act_v7(sim, seat, legal)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc

    kind = "bid" if req.phase == "bid" else "play"
    ms = (time.perf_counter() - t0) * 1000
    return ActResponse(model=model_id, action=action, kind=kind, latency_ms=round(ms, 2))


__all__ = ["app", "_rebuild_sim", "_load_v6", "_load_v7", "_act_v6", "_act_v7"]
