"""
Model registry — loads/saves config/models.json, resolves roles to profiles.

A *profile* is one connection to one model on one provider.
A *role* (one per agent + chat) maps to a primary profile + ordered fallbacks.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = PROJECT_ROOT / "config" / "models.json"

ROLE_NAMES = [
    "default", "chat", "clinical", "literature", "safety",
    "critic", "synthesizer", "emergency", "med_panel",
]

_lock = threading.Lock()
_cache: Optional["ModelsConfig"] = None


# ── Schema ──────────────────────────────────────────────────────────────────
class ProfileParams(BaseModel):
    temperature: float = 0.2
    max_tokens: int = 4096
    json_mode: bool = True
    stop: Optional[list[str]] = None  # explicit stop sequences; None = provider-aware default


class Profile(BaseModel):
    id: str
    label: str = ""
    provider: str = "openai"  # ollama | openai | groq | azure | anthropic | openai_compatible
    model: str = ""
    base_url: Optional[str] = None
    api_key_ref: Optional[str] = None
    serialize: bool = False  # run sequentially (rate-limited free tiers)
    params: ProfileParams = Field(default_factory=ProfileParams)


class RoleRoute(BaseModel):
    primary: str
    fallbacks: list[str] = Field(default_factory=list)


class DebateConfig(BaseModel):
    max_rounds: int = 1
    min_rounds: int = 1
    consensus_required: bool = True


class ObservabilityConfig(BaseModel):
    sqlite: bool = True
    langfuse: bool = False
    langsmith: bool = False


class ModelsConfig(BaseModel):
    version: int = 1
    profiles: dict[str, Profile] = Field(default_factory=dict)
    roles: dict[str, RoleRoute] = Field(default_factory=dict)
    debate: DebateConfig = Field(default_factory=DebateConfig)
    observability: ObservabilityConfig = Field(default_factory=ObservabilityConfig)


# ── Defaults (used if config/models.json is missing or corrupt) ─────────────
def _default_config() -> ModelsConfig:
    profiles = {
        "medgemma-local": Profile(
            id="medgemma-local", label="MedGemma (Local)", provider="ollama",
            model="medgemma1.5", base_url="http://localhost:11434", api_key_ref=None,
            # json_mode=False: MedGemma 1.5 is a reasoning model; JSON grammar stalls it.
            # We still parse JSON out of its reply — no grammar constraint needed.
            params=ProfileParams(temperature=0.2, max_tokens=4096, json_mode=False),
        ),
        "cloud-fast": Profile(
            id="cloud-fast", label="Cloud Fast", provider="groq",
            model="openai/gpt-oss-120b", api_key_ref="GROQ_API_KEY", serialize=True,
            params=ProfileParams(temperature=0.2, max_tokens=2048, json_mode=True),
        ),
        "cloud-quality": Profile(
            id="cloud-quality", label="Cloud Quality", provider="openai",
            model="gpt-4o", api_key_ref="OPENAI_API_KEY",
            params=ProfileParams(temperature=0.2, max_tokens=4096, json_mode=True),
        ),
    }
    # Default: Cloud Fast (Groq) for everything, except the Clinical agent and Chat,
    # which prefer local MedGemma 1.5 (with Cloud Fast as automatic fallback). On a
    # deployed host (no local Ollama) resolve_role() skips the Ollama primary so those
    # roles use Cloud Fast too — no connection wait. Users can re-route in Settings.
    roles = {r: RoleRoute(primary="cloud-fast", fallbacks=[]) for r in ROLE_NAMES}
    roles["clinical"] = RoleRoute(primary="medgemma-local", fallbacks=["cloud-fast"])
    roles["chat"] = RoleRoute(primary="medgemma-local", fallbacks=["cloud-fast"])
    return ModelsConfig(profiles=profiles, roles=roles)


def is_deployed() -> bool:
    """True on a hosted deployment (Render sets RENDER=true; DEPLOYED is our own flag).
    Deployed hosts have no local Ollama, so we skip Ollama profiles to avoid a wait."""
    return bool(
        os.environ.get("RENDER")
        or os.environ.get("DEPLOYED")
        or os.environ.get("CLINICALPILOT_CLOUD_ONLY")
    )


# ── Load / save ─────────────────────────────────────────────────────────────
def load_config(force: bool = False) -> ModelsConfig:
    global _cache
    with _lock:
        if _cache is not None and not force:
            return _cache
        if CONFIG_PATH.exists():
            try:
                data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
                _cache = ModelsConfig.model_validate(data)
            except Exception as e:
                logger.error("config/models.json invalid (%s) — using defaults", e)
                _cache = _default_config()
        else:
            logger.warning("config/models.json not found — writing defaults")
            _cache = _default_config()
            _write(_cache)
        return _cache


def save_config(cfg: ModelsConfig) -> ModelsConfig:
    global _cache
    with _lock:
        _write(cfg)
        _cache = cfg
        return _cache


def _write(cfg: ModelsConfig) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg.model_dump(), indent=2), encoding="utf-8")


# ── Resolution ──────────────────────────────────────────────────────────────
def get_profile(profile_id: str) -> Optional[Profile]:
    return load_config().profiles.get(profile_id)


def resolve_role(role: str) -> list[Profile]:
    """Return [primary, *fallbacks] as Profile objects, deduped, missing skipped.

    Unknown roles fall back to 'default'.
    """
    cfg = load_config()
    route = cfg.roles.get(role) or cfg.roles.get("default")
    if not route:
        return list(cfg.profiles.values())[:1]

    ordered_ids: list[str] = [route.primary, *route.fallbacks]
    seen: set[str] = set()
    profiles: list[Profile] = []
    for pid in ordered_ids:
        if pid and pid not in seen and pid in cfg.profiles:
            profiles.append(cfg.profiles[pid])
            seen.add(pid)
    if not profiles:  # misconfigured role — degrade to any known profile
        profiles = list(cfg.profiles.values())[:1]
    # On a deployed host there is no local Ollama — drop Ollama profiles so the role
    # resolves straight to its cloud engine (no dead-connection wait). Keep at least one.
    if is_deployed():
        cloud = [p for p in profiles if p.provider != "ollama"]
        if cloud:
            profiles = cloud
    return profiles


def get_debate() -> DebateConfig:
    return load_config().debate


# ── Mutations (used by the config API) ──────────────────────────────────────
def upsert_profile(profile: Profile) -> ModelsConfig:
    cfg = load_config()
    cfg.profiles[profile.id] = profile
    return save_config(cfg)


def delete_profile(profile_id: str) -> ModelsConfig:
    cfg = load_config()
    cfg.profiles.pop(profile_id, None)
    # scrub references so routing never points at a dead profile
    for route in cfg.roles.values():
        route.fallbacks = [f for f in route.fallbacks if f != profile_id]
    return save_config(cfg)


def set_role(role: str, route: RoleRoute) -> ModelsConfig:
    cfg = load_config()
    cfg.roles[role] = route
    return save_config(cfg)


def set_debate(debate: DebateConfig) -> ModelsConfig:
    cfg = load_config()
    cfg.debate = debate
    return save_config(cfg)


def set_observability(obs: ObservabilityConfig) -> ModelsConfig:
    cfg = load_config()
    cfg.observability = obs
    return save_config(cfg)
