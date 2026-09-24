"""
ClinicalPilot Configuration — loads .env and provides typed settings.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from functools import lru_cache
from typing import Any

from pydantic_settings import BaseSettings
from pydantic import Field

# Project root = parent of /backend
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# ── Runtime overrides (in-memory, not persisted) ────────
_runtime_overrides: dict[str, Any] = {}


class Settings(BaseSettings):
    # ── LLM ──────────────────────────────────────────────
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    openai_fast_model: str = "gpt-4o-mini"

    use_local_llm: bool = False
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "medgemma2:9b"

    # ── PubMed / NCBI ───────────────────────────────────
    ncbi_email: str = ""
    ncbi_api_key: str = ""

    # ── Observability ────────────────────────────────────
    langsmith_api_key: str = ""
    langchain_tracing_v2: bool = False
    langchain_project: str = "clinicalpilot"

    # ── Groq (AI Chat) ────────────────────────────────────
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"

    # ── FDA ──────────────────────────────────────────────
    fda_api_key: str = ""

    # ── App Settings ─────────────────────────────────────
    log_level: str = "INFO"
    cors_origins: list[str] = ["*"]
    emergency_timeout_sec: int = 5
    max_debate_rounds: int = 1
    # Start with the presentation dataset on (also togglable in Settings).
    demo_mode: bool = False

    # ── Data Paths ───────────────────────────────────────
    lancedb_path: str = "data/lancedb"
    drugbank_csv_path: str = "data/drugbank/drugbank_vocabulary.csv"

    # ── SpaCy ────────────────────────────────────────────
    # Small model by default: ~12MB vs ~560MB for _lg. Presidio works with either;
    # _sm keeps memory low enough for free-tier hosts. Override via SPACY_MODEL.
    spacy_model: str = "en_core_web_sm"

    model_config = {
        "env_file": str(PROJECT_ROOT / ".env"),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }

    @property
    def lancedb_abs_path(self) -> Path:
        p = Path(self.lancedb_path)
        return p if p.is_absolute() else PROJECT_ROOT / p

    @property
    def drugbank_abs_path(self) -> Path:
        p = Path(self.drugbank_csv_path)
        return p if p.is_absolute() else PROJECT_ROOT / p


@lru_cache()
def get_settings() -> Settings:
    return Settings()


def set_runtime_override(key: str, value: Any) -> None:
    """Set a runtime override for a setting (not persisted)."""
    _runtime_overrides[key] = value


def get_effective(key: str) -> Any:
    """Get a setting value, preferring runtime overrides."""
    if key in _runtime_overrides and _runtime_overrides[key]:
        return _runtime_overrides[key]
    return getattr(get_settings(), key)
