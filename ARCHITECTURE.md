# ClinicalPilot — Architecture Reference

> **Purpose**: This file is the technical architecture reference for ClinicalPilot as a complete, production-style project.
> It documents the system layout, runtime behavior, and deployment-relevant interfaces.

---

## Project Structure

```
clinicalpilot/
├── ARCHITECTURE.md          ← THIS FILE (reference for all agents/IDEs)
├── INSTALL.md               ← Full installation instructions
├── README.md                ← Public-facing README
├── .env.example             ← Template for environment variables
├── .env                     ← Local secrets (NEVER commit)
├── .gitignore
├── requirements.txt         ← Lean runtime deps (free-tier friendly)
├── requirements-optional.txt← Heavy extras: RAG (torch), unstructured, langchain, langsmith
├── render.yaml              ← Render deployment blueprint (Python 3.11, en_core_web_sm)
├── config/models.json       ← Model engines + per-role routing
├── pyproject.toml           ← Project metadata
│
├── Flowcharts/              ← Visual architecture diagrams (HTML)
│
├── backend/                 ← FastAPI Python backend
│   ├── main.py              ← FastAPI app + all endpoints + provider-aware chat
│   ├── config.py            ← Settings / env loading + runtime overrides
│   │
│   ├── models/              ← Pydantic data models
│   │   ├── __init__.py
│   │   ├── patient.py       ← PatientContext, UnifiedSchema
│   │   ├── soap.py          ← SOAP note models
│   │   ├── agents.py        ← Agent input/output models
│   │   └── safety.py        ← Drug interaction / safety models
│   │
│   ├── input_layer/         ← Input Gateway + Anonymizer
│   │   ├── __init__.py
│   │   ├── anonymizer.py    ← Microsoft Presidio PHI scrubbing
│   │   ├── fhir_parser.py   ← FHIR JSON → PatientContext
│   │   ├── ehr_parser.py    ← PDF/CSV upload → PatientContext
│   │   └── text_parser.py   ← Free text / voice → PatientContext
│   │
│   ├── agents/              ← Multi-Agent Layer
│   │   ├── __init__.py
│   │   ├── orchestrator.py  ← Main controller / router
│   │   ├── clinical.py      ← Clinical reasoning agent
│   │   ├── literature.py    ← PubMed / RAG literature agent
│   │   ├── safety.py        ← Drug-drug / contraindication agent
│   │   ├── critic.py        ← Debate critic agent
│   │   └── prompts/         ← System prompts for each agent
│   │       ├── clinical_system.txt
│   │       ├── literature_system.txt
│   │       ├── safety_system.txt
│   │       ├── critic_system.txt
│   │       ├── emergency_system.txt
│   │       └── synthesizer_system.txt
│   │
│   ├── debate/              ← Debate Layer (multi-round)
│   │   ├── __init__.py
│   │   └── debate_engine.py ← Debate orchestration (2-3 rounds)
│   │
│   ├── validation/          ← Validator + Output Formatting
│   │   ├── __init__.py
│   │   ├── validator.py     ← Output completeness, safety clearance
│   │   └── synthesizer.py   ← Final SOAP synthesis
│   │
│   ├── emergency/           ← Emergency Mode (fast path)
│   │   ├── __init__.py
│   │   └── emergency.py     ← Bypasses debate, <5s response
│   │
│   ├── safety_panel/        ← Medical Error Prevention Panel
│   │   ├── __init__.py
│   │   └── med_errors.py    ← Drug interactions, dosing alerts
│   │
│   ├── llm/                 ← LiteLLM router + model registry + secret resolution
│   │   ├── registry.py      ← config/models.json load/save, role → engine resolution
│   │   ├── router.py        ← LiteLLM call args, cross-provider JSON parsing, artifact strip
│   │   └── secrets.py       ← key resolution: hardcoded → runtime(UI) → ask
│   │
│   ├── rag/                 ← RAG / Vector DB layer (OPTIONAL — CLI only, not in request path)
│   │   ├── __init__.py
│   │   ├── lancedb_store.py ← LanceDB vector store   (needs requirements-optional.txt)
│   │   └── embeddings.py    ← sentence-transformers  (needs requirements-optional.txt; pulls torch)
│   │
│   ├── external/            ← External API integrations
│   │   ├── __init__.py
│   │   ├── pubmed.py        ← PubMed E-utilities (BioPython)
│   │   ├── drugbank.py      ← DrugBank open data lookups
│   │   ├── rxnorm.py        ← RxNorm API
│   │   └── fda.py           ← FDA openFDA API
│   │
│   ├── observability/       ← Tracing & monitoring
│   │   ├── __init__.py
│   │   ├── store.py         ← In-app trace store: ring buffer + SQLite (primary)
│   │   └── tracing.py       ← Optional LangSmith / Langfuse export (needs optional deps)
│   │
│   └── guardrails/          ← Output validation rules
│       ├── __init__.py
│       └── rules.py         ← Pydantic validators, hallucination checks
│
├── frontend/                ← React 18 CDN frontend (zero build step)
│   ├── index.html           ← Complete SPA (~1100 lines: React 18 + Babel CDN + Tailwind)
│   ├── app.js               ← Backward-compat stub
│   └── styles.css           ← Backward-compat stub
│
└── data/                    ← Local data files
    ├── drugbank/            ← DrugBank open CSV data
    ├── few_shot_examples/   ← Few-shot clinical examples
    └── sample_fhir/         ← Sample FHIR bundles for testing
```

---

## Architecture Layers

### Layer 1: Input Gateway
- **FHIR API** (HL7 FHIR R4 JSON) → flattened to text chunks
- **EHR Upload** (PDF/CSV) → PyPDF2 by default; `unstructured` used only if installed (optional extra)
- **Free Text / Voice** → direct text, future: Whisper STT
- **Anonymizer** → Microsoft Presidio + spaCy `en_core_web_sm`; **degrades to regex PHI scrubbing** if the model/library is absent (so the app still runs on minimal installs)

### Layer 2: Processing (Parsers → Unified Schema)
- FHIR Parser: Extracts Patient, Condition, Observation, MedicationRequest
- EHR Parser: PDF text extraction + chunking
- Text Parser: Direct prompt normalization
- All output → `PatientContext` (Pydantic model)

### Layer 3: Agent Layer
| Agent | Model | Tools | Output |
|-------|-------|-------|--------|
| Clinical | Provider-aware (Ollama/OpenAI/Groq) | PatientContext + few-shot CoT | Differential dx, risk scores, SOAP draft |
| Literature | Provider-aware (fast model where available) | PubMed (BioPython Entrez); RAG/LanceDB optional | Evidence snippets, confidence, contradictions |
| Safety | Provider-aware + rule-based checks | DrugBank CSV, RxNorm, optional openFDA | Structured warnings with severity |

### Model Routing (LiteLLM-backed)
All model calls go through a **role → engine registry** (`config/models.json`), resolved by
`backend/llm/`. Every agent + chat is a *role* mapping to a **primary engine + fallbacks**;
each engine is any provider/model/base_url/key (Ollama, OpenAI, Groq, Azure, Anthropic, or
any OpenAI-compatible endpoint) via **LiteLLM**. **Shipped default: `cloud-fast` (Groq) for every
role, except the Clinical agent and Chat, which prefer local `medgemma-local` (MedGemma 1.5 via
Ollama) with `cloud-fast` as an automatic fallback.** On a deployed host (`DEPLOYED`/`RENDER` env set)
`resolve_role()` skips the Ollama primary so those roles use Cloud Fast too — no dead-connection wait.
A `cloud-quality` (OpenAI GPT-4o) engine is also pre-defined. Keys resolve **hardcoded → runtime(UI)
→ ask** (428 `needs_key`), and a keyed engine that hits a **rate limit (429)** or is **rejected
(401/expired)** also raises `needs_key` so the UI can prompt for a fresh key. Configure live in the
**Settings** tab or edit `config/models.json`. See `MODEL_SYSTEM_PLAN.md`.

### AI Chat Service
- Endpoint: `POST /api/chat`
- Engine: the `chat` role (configurable; ships pointing at `cloud-fast`/Groq)
- Purpose: Fast conversational clinical Q&A — no agent/debate overhead
- Maintains full conversation history (multi-turn)
- Uses a dedicated clinical system prompt (evidence-based, structured formatting, safety-first)
- Runtime config via `/api/config/*`; robust cross-provider JSON parsing handles formatting
  differences between providers

### Layer 4: Debate Layer
- **Per Round**: Clinical agent → Literature + Safety → Critic
- Literature and Safety run in parallel on OpenAI/Ollama and run sequentially with short spacing on Groq to respect free-tier limits
- **Rounds 1-3**: Each round builds on critic feedback; if no consensus after 3 rounds → flag for human review
- **Med Error Panel**: Runs in **parallel** alongside the debate pipeline via `asyncio.gather`
- Implementation: async Python with structured state

### Layer 5: Validation & Output
- Validator checks completeness, format, safety clearance
- Final Synthesizer produces SOAP note
- Human-in-the-loop: doctor edits → optional re-debate (max 1 iteration)

### Layer 6: Observability
- **Built-in, dependency-free**: in-memory ring buffer + SQLite (`backend/observability/store.py`)
  records every call — provider/model/agent, tokens, latency, request/debate-round grouping
- Exposed at `/api/observability/summary` and `/api/observability/traces` (Observability tab)
- **Optional** LangSmith/Langfuse export (`tracing.py`) only when their keys + optional deps are present

### Layer 7: Guardrails
- Pydantic schema validation for SOAP output
- No hallucinated medications check (cross-ref DrugBank)
- Differential must have ≥2 options
- Safety flags must be explicit
- MUC confidence thresholds

### Emergency Mode
- Bypasses debate layer entirely
- Clinical + Safety agents run in parallel only
- Response target: <5 seconds
- Output: top 3 differentials, red flags, call-to-action
- ESI scoring for triage

### Medical Error Prevention Panel
- Runs as sidebar on every case
- Drug-drug interactions (severity tiers)
- Drug-disease contraindications
- Dosing alerts (renal/hepatic)
- Population flags (pregnancy, pediatric, elderly)

### Classifier Kit (External Streamlit Apps)
- Lung Disease: https://lung-disease-classification.streamlit.app/
- Chest Disease: http://caryaai.streamlit.app/
- AI Retina Analyser: https://retinopathy-detection.streamlit.app/
- Skin Cancer: https://skincancer-detection.streamlit.app/
- Embedded via iframe or linked with redirect fallback

---

## Dependency Footprint (lean by default)

`requirements.txt` holds only what the request path actually imports, so the app builds inside a
512 MB free tier. Heavy/optional packages live in `requirements-optional.txt`, each lazy-imported
with a graceful fallback:

| Package | Status | Reason |
|---------|--------|--------|
| `groq` SDK | **removed** | LiteLLM already speaks Groq; the `groq` package is never imported |
| `langchain*` | **optional** | not imported anywhere in the code today |
| `sentence-transformers` | **optional** | RAG-CLI only; pulls **torch (~2 GB)** → the main free-tier build OOM |
| `lancedb` | **optional** | RAG vector store; literature agent uses PubMed instead |
| `unstructured` | **optional** | richer PDF parse; `ehr_parser` auto-falls back to PyPDF2 |
| `langsmith` | **optional** | external trace sink; built-in observability works without it |
| `aiohttp`, `jinja2` | **unpinned** | only needed transitively; pip resolves them when a dep requires them |
| spaCy `en_core_web_lg` → `en_core_web_sm` | **swapped** | 560 MB runtime download (crashed mid-request) → 12 MB wheel installed at build |

Nothing in `backend.main`'s import graph loads torch/langchain/lancedb/unstructured. Installing the
optional file re-enables the RAG CLI, richer PDF parsing, and external tracing on a box with the RAM
to spare. See `INSTALL.md` for the full breakdown and Render deployment guidance.

---

## Operational Summary (Short List)

1. Configure at least one LLM provider key (`OPENAI_API_KEY` and/or `GROQ_API_KEY`), plus `NCBI_EMAIL` for PubMed etiquette.
2. Start the service with `uvicorn backend.main:app --reload --port 8000` and open the UI at `/`.
3. Submit free text, FHIR bundle, or EHR document to trigger the full debate pipeline (`POST /api/analyze`).
4. Use emergency fast-path (`POST /api/emergency`) for rapid triage outputs.
5. Use runtime provider controls from UI Settings (`GET /api/config-status`, `POST /api/set-api-key`) without editing `.env`.
6. Optional: enable local Ollama (point roles at `medgemma-local`) and — with `requirements-optional.txt` installed — pre-populate LanceDB for fully offline-leaning workflows.

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | No* | OpenAI API key for GPT-4o / GPT-4o-mini |
| `OPENAI_MODEL` | No | Default: `gpt-4o` |
| `OPENAI_FAST_MODEL` | No | Default: `gpt-4o-mini` (for Literature agent) |
| `USE_LOCAL_LLM` | No | `true` to use Ollama/MedGemma instead of OpenAI |
| `OLLAMA_BASE_URL` | No | Default: `http://localhost:11434` |
| `OLLAMA_MODEL` | No | Default: `medgemma1.5` |
| `DEPLOYED` | No | `true` on a hosted deploy — routing skips the local Ollama primary so Clinical/Chat use Cloud Fast (Render also auto-sets `RENDER`). |
| `NCBI_API_KEY` | No | PubMed E-utilities API key (higher rate limits) |
| `NCBI_EMAIL` | Yes* | Required by NCBI for E-utilities |
| `LANGSMITH_API_KEY` | No | LangSmith tracing key |
| `LANGCHAIN_TRACING_V2` | No | `true` to enable LangSmith tracing |
| `LANGCHAIN_PROJECT` | No | Default: `clinicalpilot` |
| `LANCEDB_PATH` | No | Default: `data/lancedb` |
| `FDA_API_KEY` | No | openFDA API key (optional, works without) |
| `LOG_LEVEL` | No | Default: `INFO` |
| `GROQ_API_KEY` | No* | Groq API key for provider fallback and chat |
| `GROQ_MODEL` | No | Default: `openai/gpt-oss-120b` |
| `CORS_ORIGINS` | No | Default: `["*"]` |
| `EMERGENCY_TIMEOUT_SEC` | No | Default: `5` |
| `MAX_DEBATE_ROUNDS` | No | Legacy/unused — debate rounds come from `config/models.json → debate.max_rounds` (**default now 1**), overridable per request. This env var is not read. |

---

## Key Design Decisions

1. **LanceDB over ChromaDB/Pinecone** (optional RAG): Serverless, embedded, low-ops vector storage for local-first deployment — an optional extra, not required to run the app (the request path uses PubMed, not the vector store).
2. **Async Python (asyncio)**: All agent calls are async for parallel execution.
3. **Pydantic everywhere**: Type safety, auto-validation, JSON schema generation.
4. **Static frontend**: React 18 + Babel CDN. No React build step, no npm. Fastest to iterate.
5. **FastAPI**: Auto-generates OpenAPI docs, async-native, WebSocket support.
6. **Debate fixed rounds (2-3)**: Deterministic, no infinite loops.
7. **Emergency mode bypass**: Separate fast path, no debate overhead.

\* At least one of `OPENAI_API_KEY`, `GROQ_API_KEY`, or `USE_LOCAL_LLM=true` must be available for LLM-dependent flows.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/analyze` | Full analysis pipeline (input → debate → SOAP) |
| POST | `/api/emergency` | Emergency mode (fast path, <5s) |
| GET | `/api/config-status` | Compact active-engine status for the UI |
| GET/PUT | `/api/config/models` | Read/replace full engine + routing config |
| POST/DELETE | `/api/config/profiles[/{id}]` | Create/update/delete an engine |
| PUT | `/api/config/roles/{role}` | Set an agent's primary + fallbacks |
| PUT | `/api/config/debate` | Set debate rounds / consensus |
| POST | `/api/config/secret` | Set a key at runtime (memory only) |
| POST | `/api/config/test` | Live connection test for an engine |
| GET | `/api/config/discover` | List models at an engine's endpoint |
| GET | `/api/observability/summary` | Call/agent/provider/model metrics |
| GET | `/api/observability/traces` | Recent per-call traces |
| POST | `/api/set-api-key` | Legacy alias → `/api/config/secret` |
| POST | `/api/chat` | AI chat (routed via the `chat` role) |
| POST | `/api/upload/fhir` | Upload FHIR bundle JSON |
| POST | `/api/upload/ehr` | Upload PDF/CSV EHR document |
| POST | `/api/human-feedback` | Doctor edits → re-debate |
| GET | `/api/safety-check` | Drug interaction lookup |
| GET | `/api/classifiers` | List available classifier tools |
| GET | `/api/health` | Health check |
| WS | `/ws/analyze` | WebSocket for streaming analysis |

---

*Last updated: 2026-07-22*

### Notes

- Full analysis latency is typically dominated by multi-round LLM calls; emergency mode is the low-latency path.
- If debate consensus is not reached within configured rounds, output is flagged for human review.
- DrugBank CSV availability depends on licensed/open data download state in `data/drugbank/`.
- On macOS, startup applies certifi-backed SSL defaults to improve external API reliability.
