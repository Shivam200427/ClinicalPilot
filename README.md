# ClinicalPilot

**Multi-agent clinical decision support. Debate-driven reasoning. Real SOAP notes.**

[![Python 3.11](https://img.shields.io/badge/python-3.11-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.116+-009688.svg)](https://fastapi.tiangolo.com/)
[![LiteLLM](https://img.shields.io/badge/LLM-LiteLLM%20gateway-6f42c1.svg)](https://github.com/BerriAI/litellm)
[![Deploy: Render](https://img.shields.io/badge/deploy-Render%20free%20tier-46E3B7.svg)](render.yaml)
[![Frontend: zero-build](https://img.shields.io/badge/frontend-React%2018%20CDN%20(no%20build)-61dafb.svg)](frontend/index.html)

---

## Why this exists

Most clinical AI tools are a single LLM call behind a long prompt. That's fine for a demo, not for a patient.

ClinicalPilot routes a case through **specialized agents** — Clinical, Literature, and Safety — and passes their work to an adversarial **Critic**. They cite evidence, disagree, and get challenged. A **Synthesizer** then merges the result into a structured SOAP note while a **Medical Error Prevention Panel** runs in parallel, catching drug interactions, dosing problems, and contraindications.

The payoff: fewer hallucinations, richer differentials, real PubMed citations, and safety alerts a single model would miss — with every step traced so you can see exactly what was sent and what came back.

---

## Highlights

- **Multi-agent pipeline** — Clinical + Literature + Safety agents, an adversarial Critic, and a Synthesizer. Runs **single-pass by default** (fast, consensus in one round) and scales up to **multi-round debate** when you want it — set in Settings, no redeploy.
- **Live pipeline visualization** — the dashboard streams real backend events over WebSocket: which agent is running *right now*, in the real order, with per-round activity — not a fake progress bar.
- **Emergency fast-path** — bypasses the pipeline entirely for ESI triage in seconds, with red-flag detection and immediate action cards.
- **Medical error prevention** — drug–drug interactions, drug–disease contraindications, renal/hepatic dosing alerts, and pregnancy/pediatric/elderly flags (RxNorm + DrugBank, optional openFDA).
- **Full observability** — every call is captured (prompt sent, actual response, tokens, latency, agent, round, PubMed hits). Open any call in the Observability tab to read the exact request and reply.
- **Skeuomorphic SOAP report** — a proper letterhead document with S/O/A/P sections, safety alerts, citations, and one-click PDF export.
- **Configurable engines & routing** — any provider / base-URL / key via **LiteLLM**; choose which engine runs each agent (primary + ordered fallbacks) in Settings.
- **Deploy-aware & self-healing keys** — on a hosted box it prefers cloud engines automatically; when a key is rate-limited or expired the UI prompts for a fresh one (with a direct Groq key link, or drop in an OpenAI key instead).
- **FHIR R4 + EHR upload** — FHIR bundles, PDFs, CSVs, or plain free-text notes. Sample cases included (STEMI, Stroke, PE).
- **PHI anonymization** — Microsoft Presidio scrubs protected health info before anything reaches an LLM (degrades to regex if the model is absent).
- **Human-in-the-loop** — doctor edits feed back into the pipeline for re-analysis; the run continues in the background across page switches, with a Stop control.
- **AI Chat** — conversational clinical Q&A on the same routed engines.

---

## Quick start

```bash
git clone <repo-url> && cd clinicalpilot
python -m venv venv && source venv/bin/activate     # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# Add at least one key: GROQ_API_KEY and/or OPENAI_API_KEY
# (or run fully local with Ollama — see below). You can also set keys
# at runtime from the Settings tab.

python -m uvicorn backend.main:app --reload --port 8000
# Open http://localhost:8000
```

No npm, no bundler, no Docker. The entire frontend is one HTML file served by FastAPI. Targets **Python 3.11**.

> Analysis outputs are returned in the API response and are **not** persisted to a database; observability traces are (in-memory ring buffer + SQLite).

Full setup — platform notes, local MedGemma via Ollama, data downloads, Render deploy → **[INSTALL.md](INSTALL.md)**

---

## Model routing (defaults)

Every agent and Chat is a **role** that maps to a **primary engine + ordered fallbacks**, all through LiteLLM. Shipped defaults:

| Role | Primary | Fallback |
|------|---------|----------|
| Clinical, Chat | **MedGemma 1.5** (local, via Ollama) | Cloud Fast (Groq) |
| Literature, Safety, Critic, Synthesizer, Emergency, Med Panel | **Cloud Fast** (Groq `llama-3.3-70b`) | — |

- **Local by default where it matters**, cloud for speed everywhere else. Want MedGemma locally? `ollama pull medgemma1.5` (the Settings → Engines card walks you through it, and links [ollama.com/library/medgemma1.5](https://ollama.com/library/medgemma1.5) if it's missing).
- **On a deployed host** (`DEPLOYED`/`RENDER` set) routing skips the local Ollama primary automatically, so Clinical/Chat fall to Cloud Fast — no dead-connection wait.
- **Keys resolve** hardcoded → entered in the UI → asked on demand. A rate-limited (`429`) or rejected (`401`/expired) key re-prompts the UI for a new one.

Edit it live in **Settings**, or in [`config/models.json`](config/models.json). No code changes, no redeploy.

---

## Architecture

```
Input  (FHIR / EHR / Free-text / Voice)
   │
   ▼
Anonymizer  (Presidio PHI scrubbing)
   │
   ▼
Parsers  ─────►  Unified PatientContext
   │
   ▼
┌──────────────────────────────────────────────┐
│  PIPELINE  (single-pass default → multi-round) │
│                                                │
│  Clinical ──┐                                  │
│  Literature ┼──►  Critic  ──►  (loop if multi) │
│  Safety ────┘                                  │
└──────────────────────────────────────────────┘
   │                          │  (parallel)
   ▼                          ▼
Synthesizer → Validator   Med-Error Panel
   │
   ▼
SOAP Note  +  Safety Alerts  +  PubMed Citations
```

Layer-by-layer design, routing internals, and env reference → **[ARCHITECTURE.md](ARCHITECTURE.md)**

---

## The app

Zero-build React 18 SPA, served straight from FastAPI.

| View | What's in it |
|------|--------------|
| **Analysis** | Free-text/voice input, FHIR/CSV upload with sample cases, **live WebSocket pipeline** (real agent + round), skeuomorphic SOAP report with PDF export, doctor feedback loop (persists in background) |
| **Emergency** | Fast-path triage, ESI scoring, red flags, immediate action cards |
| **Observability** | Every call — provider/model/agent/round, tokens, latency; click any call to see the **exact prompt sent, the actual response, and PubMed hits** |
| **Tools** | Multi-drug interaction checker (RxNorm-backed), BMI/MAP calculators, clinical reference tables |
| **Imaging AI** | External Streamlit classifiers in iframes — lung disease, chest X-ray, diabetic retinopathy, skin cancer |
| **Architecture** | Live Mermaid diagrams — system flow and data pipeline |
| **AI Chat** | Multi-turn clinical Q&A on the routed `chat` engine |
| **Settings** | Engines, per-role routing, key management, connection tests, model discovery |

---

## API

| Method | Path | What it does |
|--------|------|--------------|
| `POST` | `/api/analyze` | Full multi-agent pipeline → SOAP note |
| `POST` | `/api/emergency` | Emergency triage, ESI scoring (fast path) |
| `POST` | `/api/chat` | AI chat via the routed `chat` engine |
| `POST` | `/api/human-feedback` | Doctor edits → re-analysis |
| `POST` | `/api/upload/fhir` | Upload FHIR R4 bundle JSON |
| `POST` | `/api/upload/ehr` | Upload PDF/CSV EHR document |
| `GET`  | `/api/safety-check` | Drug interaction lookup (RxNorm + DrugBank) |
| `GET`  | `/api/config-status` | Active engines + provider status for the UI |
| `GET/PUT` | `/api/config/models` | Read/replace full engine + routing config |
| `POST` | `/api/config/secret` | Set an API key at runtime (memory only) |
| `POST` | `/api/config/test` | Live connection test for an engine |
| `GET`  | `/api/observability/summary` · `/traces` | Call metrics and per-call traces |
| `GET`  | `/api/classifiers` | List imaging classifier apps |
| `GET`  | `/api/health` | Health check |
| `WS`   | `/ws/analyze` | Streaming pipeline events for the live visualization |

Full endpoint list → [ARCHITECTURE.md](ARCHITECTURE.md#api-endpoints)

---

## Tech stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.11, FastAPI, uvicorn, async throughout |
| LLM gateway | **LiteLLM** — one client for Ollama / OpenAI / Groq / Azure / Anthropic / any OpenAI-compatible endpoint |
| Routing | Per-role primary + ordered fallbacks (`config/models.json`), editable live in Settings; deploy-aware |
| PHI safety | Microsoft Presidio + spaCy (`en_core_web_sm`; degrades to regex if absent) |
| Clinical data | PubMed (BioPython Entrez), DrugBank, RxNorm, optional openFDA |
| Frontend | React 18 CDN + Tailwind + Babel — **zero build step** |
| Observability | Built-in: in-memory ring buffer + SQLite (prompt/response payloads, tokens, latency, per-agent/per-round) — optional LangSmith/Langfuse export |
| Validation | Pydantic v2 schemas + guardrail rules (no hallucinated meds, differential completeness, explicit safety flags) |
| Optional RAG | LanceDB + sentence-transformers — CLI-only, not in the request path |

---

## Dependencies (lean by default)

`requirements.txt` is deliberately small so the app builds inside a **512 MB free tier**. Everything heavy is lazy-loaded and moved to `requirements-optional.txt` with a graceful fallback when absent:

| Removed from the default install | Why | Where it lives now |
|---|---|---|
| `groq` SDK | LiteLLM already talks to Groq — the `groq` package is never imported | deleted |
| `langchain*` | not imported anywhere in the code | `requirements-optional.txt` |
| `sentence-transformers` | RAG-CLI only, and pulls **torch (~2 GB)** — the main free-tier build OOM | `requirements-optional.txt` |
| `lancedb` | RAG vector store, CLI-only; the literature agent uses PubMed | `requirements-optional.txt` |
| `unstructured` | richer PDF parsing; `ehr_parser` falls back to PyPDF2 | `requirements-optional.txt` |
| `langsmith` | optional external trace sink; built-in observability works without it | `requirements-optional.txt` |
| spaCy `en_core_web_lg` (560 MB, runtime download) | too big / crashed mid-request; `en_core_web_sm` (~12 MB) installs as a wheel at build | swapped to `en_core_web_sm` |

Need the RAG store, richer PDF parsing, or LangSmith? `pip install -r requirements-optional.txt` on a box with the RAM to spare. Details and Render notes → [INSTALL.md](INSTALL.md).

---

## Project structure

```
clinicalpilot/
├── backend/
│   ├── main.py            # FastAPI app — all endpoints + routed chat + WS streaming
│   ├── config.py          # pydantic-settings config
│   ├── models/            # Pydantic schemas (patient, SOAP, agents, safety)
│   ├── input_layer/       # Anonymizer, FHIR/EHR/text parsers
│   ├── agents/            # Orchestrator, Clinical, Literature, Safety, Critic (+ prompts/)
│   ├── debate/            # Pipeline engine (single-pass → multi-round, emits WS events)
│   ├── validation/        # Synthesizer + output validator
│   ├── emergency/         # Emergency fast-path triage
│   ├── safety_panel/      # Med-error panel (interactions, dosing)
│   ├── external/          # PubMed, DrugBank, RxNorm, openFDA
│   ├── llm/               # LiteLLM router, model registry, secret resolution
│   ├── observability/     # Trace store (ring buffer + SQLite w/ payloads) + optional exporters
│   ├── guardrails/        # Hallucination checks, schema validation
│   └── rag/               # LanceDB + embeddings (OPTIONAL — CLI only)
├── frontend/
│   └── index.html         # Full SPA — React 18 + Babel + Tailwind (CDN)
├── config/models.json     # Engines + per-role routing + debate rounds
├── data/                  # sample_fhir/, sample_ehr/, drugbank/, few_shot_examples/
├── requirements.txt       # Lean, free-tier-friendly runtime deps
├── requirements-optional.txt
├── render.yaml            # Render deploy blueprint (Python 3.11, en_core_web_sm)
├── ARCHITECTURE.md · INSTALL.md · .env.example
└── _smoke_test.sh         # End-to-end smoke tests
```

---

## Smoke tests

```bash
bash _smoke_test.sh
```

Validates health check, full analysis pipeline, emergency mode, drug safety checks, and classifier listing — each logged with timing.

---

## License & disclaimer

ClinicalPilot is a research and educational decision-support project. It is **not** a medical device and is **not** a substitute for professional clinical judgment. Do not use it to make real patient-care decisions.
