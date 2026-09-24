"""
ClinicalPilot — FastAPI Backend Server

Serves:
- REST API for all clinical analysis endpoints
- WebSocket for streaming analysis
- Static frontend files
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any, Optional

# Fix macOS SSL certificate verification globally.
# On macOS, Python's urllib doesn't trust the system cert store.
# This patches ssl so ALL urllib-based calls (BioPython Entrez,
# spaCy model downloads, etc.) use certifi's cert bundle.
import os as _os
import ssl as _ssl
try:
    import certifi as _certifi
    _cert_file = _certifi.where()
    # Patch in-process urllib/http.client default SSL context
    _ssl._create_default_https_context = (
        lambda: _ssl.create_default_context(cafile=_cert_file)
    )
    # Set env vars so child processes (pip, spaCy download) also trust certs
    _os.environ.setdefault("SSL_CERT_FILE", _cert_file)
    _os.environ.setdefault("REQUESTS_CA_BUNDLE", _cert_file)
except ImportError:
    pass

from fastapi import FastAPI, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.config import get_settings, PROJECT_ROOT
from backend.models.patient import AnalysisRequest, PatientContext
from backend.models.soap import SOAPNote, EmergencyOutput
from backend.models.safety import MedErrorPanel

from backend.llm import registry
from backend.llm.registry import Profile, RoleRoute, DebateConfig, ObservabilityConfig, ROLE_NAMES
from backend.llm.secrets import set_runtime_secret, secret_status, NeedsKey, resolve_secret
from backend.agents.llm_client import llm_call, set_call_context
from backend.observability import store as obs_store
from backend import runs

# ── Logging ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("clinicalpilot")

# ── App ─────────────────────────────────────────────────
app = FastAPI(
    title="ClinicalPilot",
    description="Multi-agent clinical decision support system with debate-driven reasoning",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ────────────────────────────────────────────────
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Missing-key handler → 428 so the UI can prompt for exactly that key ──
@app.exception_handler(NeedsKey)
async def needs_key_handler(request: Request, exc: NeedsKey):
    reason = getattr(exc, "reason", "missing")
    detail = {
        "missing": f"An API key is required for '{exc.profile_id}'. Add it in Settings.",
        "rate_limit": f"The current key for '{exc.profile_id}' hit its rate limit. Add your own key to continue.",
        "invalid": f"The key for '{exc.profile_id}' was rejected. It may be expired or invalid. Enter a valid key.",
    }.get(reason, f"An API key is required for '{exc.profile_id}'.")
    return JSONResponse(
        status_code=428,
        content={
            "needs_key": True,
            "key_ref": exc.key_ref,
            "profile": exc.profile_id,
            "reason": reason,
            "detail": detail,
        },
    )


# ── Startup ─────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    logger.info("ClinicalPilot starting up...")
    
    # Setup observability
    try:
        from backend.observability.tracing import setup_tracing
        tracing = setup_tracing()
        logger.info(f"Tracing enabled: {tracing}")
    except Exception as e:
        logger.warning(f"Tracing setup failed: {e}")

    logger.info("ClinicalPilot ready.")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  API ENDPOINTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    default_profiles = registry.resolve_role("default")
    primary = default_profiles[0] if default_profiles else None
    return {
        "status": "ok",
        "service": "clinicalpilot",
        "version": "2.0.0",
        "model": primary.model if primary else "",
        "engine": primary.label if primary else "",
    }


def _default_active_provider() -> str:
    """The provider that the default role would actually run on right now."""
    for prof in registry.resolve_role("default"):
        if not prof.api_key_ref or resolve_secret(prof.api_key_ref):
            return prof.provider
    return "none"


@app.get("/api/config-status")
async def config_status():
    """Compact status for the navbar/banner. Reflects the ACTUAL runnable default."""
    active = _default_active_provider()
    default_profiles = registry.resolve_role("default")
    primary = default_profiles[0] if default_profiles else None
    return {
        # back-compat fields (older frontend builds read these)
        "has_openai_key": secret_status("OPENAI_API_KEY") in ("hardcoded", "runtime"),
        "has_groq_key": secret_status("GROQ_API_KEY") in ("hardcoded", "runtime"),
        "use_local_llm": active == "ollama",
        "active_provider": active,
        "openai_model": (registry.get_profile("cloud-quality").model
                         if registry.get_profile("cloud-quality") else ""),
        "groq_model": (registry.get_profile("cloud-fast").model
                       if registry.get_profile("cloud-fast") else ""),
        # new: generic engine label for de-branded UI
        "engine_label": primary.label if primary else "Not configured",
        "engine_model": primary.model if primary else "",
        "demo": __import__("backend.demo", fromlist=["is_enabled"]).is_enabled(),
    }


@app.post("/api/config/demo")
async def set_demo(payload: dict):
    """Toggle the presentation dataset (Settings → Advanced). In-memory only."""
    from backend import demo
    enabled = demo.set_enabled(bool(payload.get("enabled")))
    return {"enabled": enabled}


@app.post("/api/set-api-key")
async def set_api_key(payload: dict):
    """Back-compat alias — maps legacy openai/groq keys onto the new secret store."""
    updated = []
    if payload.get("openai_api_key", "").strip():
        set_runtime_secret("OPENAI_API_KEY", payload["openai_api_key"].strip())
        updated.append("OPENAI_API_KEY")
    if payload.get("groq_api_key", "").strip():
        set_runtime_secret("GROQ_API_KEY", payload["groq_api_key"].strip())
        updated.append("GROQ_API_KEY")
    if not updated:
        raise HTTPException(400, "No valid API key provided")
    return {"status": "ok", "updated": updated}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  CONFIGURATION API — profiles, routing, secrets, debate
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _redact_config() -> dict:
    """Full config with secret VALUES never included — only a status per key ref."""
    cfg = registry.load_config()
    data = cfg.model_dump()
    for pid, prof in data["profiles"].items():
        ref = prof.get("api_key_ref")
        prof["key_status"] = secret_status(ref)  # none | hardcoded | runtime | missing
    data["roles_available"] = ROLE_NAMES
    data["providers_available"] = [
        "ollama", "openai", "groq", "anthropic", "azure", "openai_compatible",
    ]
    return data


@app.get("/api/config/models")
async def get_models_config():
    """Full model routing config (secret values redacted)."""
    return _redact_config()


@app.put("/api/config/models")
async def put_models_config(payload: dict):
    """Replace the entire config (used by 'save all' in the UI)."""
    try:
        cfg = registry.ModelsConfig.model_validate(payload)
        registry.save_config(cfg)
    except Exception as e:
        raise HTTPException(400, f"Invalid config: {e}")
    return _redact_config()


@app.post("/api/config/profiles")
async def upsert_profile(payload: dict):
    """Create or update one connection profile."""
    try:
        prof = Profile.model_validate(payload)
    except Exception as e:
        raise HTTPException(400, f"Invalid profile: {e}")
    registry.upsert_profile(prof)
    return _redact_config()


@app.delete("/api/config/profiles/{profile_id}")
async def delete_profile(profile_id: str):
    registry.delete_profile(profile_id)
    return _redact_config()


@app.put("/api/config/roles/{role}")
async def set_role(role: str, payload: dict):
    """Set a role's primary + fallback profiles."""
    if role not in ROLE_NAMES:
        raise HTTPException(400, f"Unknown role '{role}'")
    try:
        route = RoleRoute.model_validate(payload)
    except Exception as e:
        raise HTTPException(400, f"Invalid route: {e}")
    registry.set_role(role, route)
    return _redact_config()


@app.put("/api/config/debate")
async def set_debate(payload: dict):
    try:
        debate = DebateConfig.model_validate(payload)
    except Exception as e:
        raise HTTPException(400, f"Invalid debate config: {e}")
    registry.set_debate(debate)
    return _redact_config()


@app.put("/api/config/observability")
async def set_observability(payload: dict):
    try:
        obs = ObservabilityConfig.model_validate(payload)
    except Exception as e:
        raise HTTPException(400, f"Invalid observability config: {e}")
    registry.set_observability(obs)
    return _redact_config()


@app.post("/api/config/secret")
async def set_secret(payload: dict):
    """Store a key entered in the UI (memory only). {key_ref, value}."""
    key_ref = (payload.get("key_ref") or "").strip()
    value = (payload.get("value") or "").strip()
    if not key_ref or not value:
        raise HTTPException(400, "key_ref and value are required")
    set_runtime_secret(key_ref, value)
    return {"status": "ok", "key_ref": key_ref, "key_status": secret_status(key_ref)}


@app.post("/api/config/test")
async def test_profile(payload: dict):
    """Live connection test for a profile: a tiny real completion round-trip."""
    prof_id = payload.get("profile_id")
    prof = registry.get_profile(prof_id) if prof_id else None
    if not prof:
        # allow testing an unsaved draft profile too
        try:
            prof = Profile.model_validate(payload.get("profile", {}))
        except Exception:
            raise HTTPException(400, "Provide profile_id or a profile object")

    if prof.api_key_ref and not resolve_secret(prof.api_key_ref):
        return {"ok": False, "error": f"No key for {prof.api_key_ref}", "needs_key": prof.api_key_ref}

    # Force this exact profile (bypass routing/fallback) for a true single-profile test.
    from backend.agents.llm_client import _call_profile
    try:
        t0 = time.time()
        res = await _call_profile(
            prof,
            "You are a connection test. Reply with a short JSON object.",
            'Reply with exactly {"ok": true}.',
            json_mode=True, temperature=0.0, max_tokens=32,
            role="__test__", request_id="conn-test", debate_round=None, fallback_index=0,
        )
        return {
            "ok": True, "latency_ms": int((time.time() - t0) * 1000),
            "model": res.get("model"), "provider": res.get("provider"),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/config/effective")
async def config_effective():
    """The engine each role will try first right now (after deploy-aware filtering)."""
    out = {}
    for role in ROLE_NAMES:
        profiles = registry.resolve_role(role)
        if profiles:
            p = profiles[0]
            out[role] = {"profile": p.id, "label": p.label, "model": p.model, "provider": p.provider,
                         "fallbacks": [f.label for f in profiles[1:]]}
    return {"roles": out, "deployed": registry.is_deployed()}


@app.get("/api/config/discover")
async def discover_models(profile_id: str = ""):
    """List models available at a profile's endpoint (Ollama /api/tags or /v1/models)."""
    prof = registry.get_profile(profile_id)
    if not prof:
        raise HTTPException(404, "Unknown profile")
    import httpx
    models: list[str] = []
    try:
        if prof.provider == "ollama":
            base = prof.base_url or "http://localhost:11434"
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(f"{base.rstrip('/')}/api/tags")
                r.raise_for_status()
                models = [m["name"] for m in r.json().get("models", [])]
        else:
            default_base = {"groq": "https://api.groq.com/openai/v1"}.get(prof.provider, "https://api.openai.com/v1")
            base = prof.base_url or default_base
            headers = {}
            key = resolve_secret(prof.api_key_ref)
            if key:
                headers["Authorization"] = f"Bearer {key}"
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(f"{base.rstrip('/')}/models", headers=headers)
                r.raise_for_status()
                models = [m["id"] for m in r.json().get("data", [])]
    except Exception as e:
        return {"ok": False, "error": str(e), "models": []}
    return {"ok": True, "models": sorted(models)}


def _ollama_profile(profile_id: str = ""):
    """The requested Ollama profile, or the first one configured."""
    if profile_id:
        prof = registry.get_profile(profile_id)
        return prof if prof and prof.provider == "ollama" else None
    for prof in registry.load_config().profiles.values():
        if prof.provider == "ollama":
            return prof
    return None


@app.get("/api/ollama/status")
async def ollama_status(profile_id: str = ""):
    """Is Ollama reachable, is the model pulled, and is it loaded in memory right now?"""
    import httpx
    prof = _ollama_profile(profile_id)
    if prof is None:
        return {"configured": False}
    base = (prof.base_url or "http://localhost:11434").rstrip("/")
    out = {"configured": True, "profile": prof.id, "model": prof.model, "base_url": base,
           "deployed": registry.is_deployed(), "reachable": False, "installed": False,
           "loaded": False, "expires_at": None, "models": []}
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            tags = (await client.get(f"{base}/api/tags")).json().get("models", [])
            ps = (await client.get(f"{base}/api/ps")).json().get("models", [])
    except Exception as e:
        out["error"] = str(e)
        return out

    def same(name: str) -> bool:  # "medgemma1.5" matches "medgemma1.5:latest"
        return name == prof.model or name.split(":")[0] == prof.model.split(":")[0]

    out["reachable"] = True
    out["models"] = sorted(m["name"] for m in tags)
    out["installed"] = any(same(m["name"]) for m in tags)
    running = next((m for m in ps if same(m.get("name", ""))), None)
    if running:
        out["loaded"] = True
        out["expires_at"] = running.get("expires_at")
    return out


@app.post("/api/ollama/load")
async def ollama_load(payload: dict):
    """Load (or unload) the model into memory once. No text is generated.

    keep_alive is how long Ollama keeps it loaded after the last request; each real
    call resets that timer, so this only needs to be pressed once per session.
    """
    import httpx
    prof = _ollama_profile(payload.get("profile_id", ""))
    if prof is None:
        raise HTTPException(404, "No Ollama engine configured")
    base = (prof.base_url or "http://localhost:11434").rstrip("/")
    keep_alive = payload.get("keep_alive", "30m")
    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            r = await client.post(f"{base}/api/generate",
                                  json={"model": prof.model, "keep_alive": keep_alive})
            r.raise_for_status()
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "latency_ms": int((time.monotonic() - start) * 1000)}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  OBSERVABILITY API
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@app.get("/api/observability/summary")
async def observability_summary():
    return obs_store.get_summary()


@app.get("/api/observability/traces")
async def observability_traces(limit: int = 200, role: str = "", request_id: str = ""):
    return {"traces": obs_store.get_traces(limit=limit, role=role, request_id=request_id)}


@app.get("/api/observability/run/{request_id}")
async def observability_run(request_id: str):
    return {"request_id": request_id, "traces": obs_store.get_traces(limit=500, request_id=request_id)}


@app.delete("/api/observability/traces")
async def observability_clear():
    obs_store.clear()
    return {"status": "ok"}


@app.post("/api/analyze", response_model=dict)
async def analyze(request: AnalysisRequest):
    """
    Full analysis pipeline.
    Input → Anonymize → Parse → Multi-Agent Debate → SOAP Note
    """
    if not request.text and not request.fhir_bundle and not request.patient_context:
        raise HTTPException(400, "Must provide text, fhir_bundle, or patient_context")

    request_id = obs_store.new_request_id()
    set_call_context(request_id=request_id)

    from backend import demo
    if demo.is_enabled():
        demo.record_demo_traces(request_id)
        return {"request_id": request_id, "soap": demo.demo_soap(),
                "debate": demo.demo_debate(), "med_error_panel": demo.demo_med_panel()}

    try:
        from backend.agents.orchestrator import full_pipeline
        from backend.safety_panel.med_errors import run_med_error_panel
        from backend.input_layer.text_parser import parse_text_input

        # Get patient context for med error panel
        if request.patient_context:
            patient = request.patient_context
        else:
            patient = parse_text_input(request.text)

        # Run full pipeline and med error panel IN PARALLEL
        pipeline_task = full_pipeline(request)
        med_panel_task = run_med_error_panel(patient)

        (soap, debate_state), med_panel = await asyncio.gather(
            pipeline_task, med_panel_task
        )

        return {
            "request_id": request_id,
            "soap": soap.model_dump(),
            "debate": debate_state.model_dump(),
            "med_error_panel": med_panel.model_dump(),
        }
    except NeedsKey:
        raise
    except Exception as e:
        logger.exception("Analysis failed")
        raise HTTPException(500, f"Analysis failed: {str(e)}")


@app.post("/api/emergency", response_model=dict)
async def emergency(request: AnalysisRequest):
    """
    Emergency Mode — fast-path triage.
    Bypasses debate, targets <5s response.
    """
    if not request.text:
        raise HTTPException(400, "Must provide text for emergency mode")

    request_id = obs_store.new_request_id()
    set_call_context(request_id=request_id)

    from backend import demo
    if demo.is_enabled():
        await asyncio.sleep(1.2)
        return {"request_id": request_id, "emergency": demo.demo_emergency()}

    try:
        from backend.emergency.emergency import emergency_analyze

        result = await emergency_analyze(request.text)
        return {"request_id": request_id, "emergency": result.model_dump()}
    except NeedsKey:
        raise
    except Exception as e:
        logger.exception("Emergency analysis failed")
        raise HTTPException(500, f"Emergency analysis failed: {str(e)}")


@app.post("/api/upload/fhir", response_model=dict)
async def upload_fhir(bundle: dict):
    """Upload a FHIR R4 Bundle for analysis."""
    try:
        from backend.input_layer.fhir_parser import parse_fhir_bundle

        patient = parse_fhir_bundle(bundle)
        return {
            "patient_context": patient.model_dump(),
            "summary": patient.to_clinical_summary(),
        }
    except Exception as e:
        logger.exception("FHIR parsing failed")
        raise HTTPException(500, f"FHIR parsing failed: {str(e)}")


@app.post("/api/upload/ehr", response_model=dict)
async def upload_ehr(file: UploadFile = File(...)):
    """Upload a PDF or CSV EHR document for parsing."""
    if not file.filename:
        raise HTTPException(400, "No file provided")

    file_bytes = await file.read()

    try:
        if file.filename.lower().endswith(".pdf"):
            from backend.input_layer.ehr_parser import parse_ehr_pdf
            patient = await parse_ehr_pdf(file_bytes, file.filename)
        elif file.filename.lower().endswith(".csv"):
            from backend.input_layer.ehr_parser import parse_ehr_csv
            patient = await parse_ehr_csv(file_bytes, file.filename)
        else:
            raise HTTPException(400, "Unsupported file type. Use PDF or CSV.")

        return {
            "patient_context": patient.model_dump(),
            "summary": patient.to_clinical_summary(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("EHR parsing failed")
        raise HTTPException(500, f"EHR parsing failed: {str(e)}")


@app.post("/api/human-feedback", response_model=dict)
async def human_feedback(payload: dict):
    """
    Human-in-the-loop: doctor edits SOAP → triggers re-debate (max 1 iteration).
    """
    edited_soap = payload.get("edited_soap", "")
    original_text = payload.get("original_text", "")
    feedback = payload.get("feedback", "")

    if not edited_soap and not feedback:
        raise HTTPException(400, "Must provide edited_soap or feedback")

    try:
        from backend.agents.orchestrator import full_pipeline
        from backend.models.patient import AnalysisRequest

        # Re-run with feedback as additional context
        enhanced_text = f"{original_text}\n\n---\nDoctor Feedback: {feedback}\nEdited SOAP: {edited_soap}"
        request = AnalysisRequest(text=enhanced_text)
        soap, debate_state = await full_pipeline(request)

        return {
            "soap": soap.model_dump(),
            "debate": debate_state.model_dump(),
            "note": "Re-analysis with human feedback completed",
        }
    except Exception as e:
        logger.exception("Human feedback re-analysis failed")
        raise HTTPException(500, str(e))


@app.get("/api/safety-check")
async def safety_check(drugs: str = ""):
    """
    Quick drug interaction lookup.
    Query param: drugs=metformin,lisinopril,aspirin
    """
    if not drugs:
        raise HTTPException(400, "Provide comma-separated drug names in 'drugs' param")

    drug_list = [d.strip() for d in drugs.split(",") if d.strip()]

    results = {}

    # RxNorm interactions
    try:
        from backend.external.rxnorm import check_interactions_rxnorm

        rxnorm_results = await check_interactions_rxnorm(drug_list)
        results["rxnorm_interactions"] = rxnorm_results
    except Exception as e:
        results["rxnorm_interactions"] = f"Error: {e}"

    # NLM retired the RxNav interaction API in January 2024, so RxNorm usually returns
    # nothing now. Review the list with the medication-error panel (routed model) as well.
    if len(drug_list) >= 2:
        try:
            from backend import demo
            from backend.models.patient import Medication, PatientContext
            from backend.safety_panel.med_errors import run_med_error_panel

            if demo.is_enabled():
                results["med_panel"] = demo.demo_med_panel()
            else:
                patient = PatientContext(
                    medications=[Medication(name=d) for d in drug_list],
                    current_prompt=f"Medication review: {', '.join(drug_list)}",
                )
                results["med_panel"] = (await run_med_error_panel(patient)).model_dump()
        except NeedsKey:
            raise
        except Exception as e:
            results["med_panel_error"] = str(e)

    # DrugBank lookup
    try:
        from backend.external.drugbank import lookup_interactions

        db_results = lookup_interactions(drug_list)
        results["drugbank"] = db_results
    except Exception as e:
        results["drugbank"] = f"Error: {e}"

    return results


@app.get("/api/classifiers")
async def get_classifiers():
    """List available medical image classifier tools."""
    return {
        "classifiers": [
            {
                "name": "Lung Disease Classifier",
                "description": "AI-powered lung disease classification from chest X-rays",
                "url": "https://lung-disease-classification.streamlit.app/",
                "icon": "🫁",
                "embed": True,
            },
            {
                "name": "Chest Disease Classifier",
                "description": "AI chest disease detection and analysis",
                "url": "https://caryaai.streamlit.app/",
                "icon": "🫀",
                "embed": True,
            },
            {
                "name": "AI Retina Analyser",
                "description": "Diabetic retinopathy detection from retinal images",
                "url": "https://retinopathy-detection.streamlit.app/",
                "icon": "👁️",
                "embed": True,
            },
            {
                "name": "Skin Cancer Detector",
                "description": "Skin lesion classification for melanoma screening",
                "url": "https://skincancer-detection.streamlit.app/",
                "icon": "🔬",
                "embed": True,
            },
        ]
    }


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  AI CHAT (lightweight conversational Q&A, no agents/debate)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CHAT_SYSTEM_PROMPT = """You are ClinicalPilot AI, a clinical decision-support assistant for healthcare professionals.

Your role:
- Answer clinical questions with evidence-based, concise responses.
- Help with differential diagnoses, drug interactions, guideline lookups, lab interpretation, and clinical reasoning.
- Always cite relevant guidelines (e.g., ACC/AHA, WHO, UpToDate) when applicable.
- If a question involves patient safety, flag it clearly.
- Use structured formatting (bullet points, numbered lists) for clarity.
- If you are unsure, say so — never fabricate clinical information.

You are NOT a replacement for clinical judgment. Always remind users that your answers are for educational/decision-support purposes only."""


@app.post("/api/chat")
async def chat(payload: dict):
    """
    AI chat — routed through the 'chat' role (configurable engine + fallback).
    Accepts {messages: [{role, content}, ...]} with conversation history.
    """
    messages = payload.get("messages", [])
    if not messages:
        raise HTTPException(400, "No messages provided")

    from backend import demo
    if demo.is_enabled():
        return demo.demo_chat_reply(messages)

    # Flatten the multi-turn history into a single user message so it works across
    # any provider (local Ollama included) without provider-specific chat plumbing.
    convo = "\n\n".join(f"{m['role'].upper()}: {m['content']}" for m in messages)
    set_call_context(request_id=obs_store.new_request_id())

    try:
        result = await llm_call(
            system_prompt=CHAT_SYSTEM_PROMPT,
            user_message=convo,
            role="chat",
            json_mode=False,       # chat is free-form prose, not JSON
            temperature=0.3,
            max_tokens=2048,
        )
    except NeedsKey:
        raise  # handled globally → 428 so the UI can prompt for the key
    except Exception as e:
        logger.warning(f"Chat failed: {e}")
        raise HTTPException(503, f"The AI engine is unavailable right now: {e}")

    return {
        "reply": result["content"],
        "model": result["model"],
        "provider": result["provider"],
        "latency_ms": result["latency_ms"],
        "tokens": result.get("tokens"),
    }


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  WEBSOCKET (Streaming Analysis)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_TERMINAL = ("complete", "error", "cancelled")


async def _analysis_work(run: "runs.Run", text: str, requested_rounds: Any, feedback: str = "") -> None:
    """The full analysis pipeline for one run. Publishes progress to the run."""
    from backend.agents.llm_client import set_stream_sink

    async def send(msg: dict):
        run.publish(msg)

    async def sink(role: str, delta: Optional[str]):
        if delta is None:
            run.publish({"type": "delta", "agent": role, "reset": True})
        else:
            run.publish({"type": "delta", "agent": role, "text": delta})

    set_call_context(request_id=run.id)
    set_stream_sink(sink)

    try:
        # Presentation dataset: stream a realistic run without external model calls.
        from backend import demo
        if demo.is_enabled():
            payload = await demo.stream_demo_analysis(send, run.id)
            if feedback:
                payload["soap"]["plan"] += f"\n7. Clinician feedback addressed: {feedback}"
            await send(payload)
            return

        await send({"type": "status", "stage": "parsing", "detail": "Anonymizing PHI and parsing input"})

        from backend.input_layer.anonymizer import get_anonymizer
        from backend.input_layer.text_parser import parse_text_input

        anon = get_anonymizer(settings.spacy_model)
        clean_text = anon.anonymize(text)
        patient = parse_text_input(clean_text)
        patient.current_prompt = text

        from backend.debate.debate_engine import run_debate
        from backend.llm.registry import get_debate
        from backend.validation.synthesizer import synthesize_soap
        from backend.validation.validator import validate_output
        from backend.safety_panel.med_errors import run_med_error_panel

        debate_cfg = get_debate()
        max_rounds = requested_rounds or debate_cfg.max_rounds
        max_rounds = max(debate_cfg.min_rounds, min(int(max_rounds), 10))

        # Med-error panel runs in parallel with the debate (as its own tracked step).
        await send({"type": "agent", "agent": "med_panel", "round": 0, "status": "start"})

        async def _run_panel():
            r = await run_med_error_panel(patient)
            await send({"type": "agent", "agent": "med_panel", "round": 0, "status": "done",
                        "data": r.model_dump()})
            return r

        debate_state, med_panel = await asyncio.gather(
            run_debate(patient, max_rounds=max_rounds, on_event=send),
            _run_panel(),
        )

        await send({"type": "status", "stage": "synthesis", "detail": "Writing the SOAP note"})
        await send({"type": "agent", "agent": "synthesizer", "round": None, "status": "start"})
        soap = await synthesize_soap(patient, debate_state)
        soap = validate_output(soap)

        await send({
            "type": "complete",
            "request_id": run.id,
            "soap": soap.model_dump(),
            "debate": debate_state.model_dump(),
            "med_error_panel": med_panel.model_dump(),
        })
    except asyncio.CancelledError:
        raise
    except NeedsKey as e:
        await send({"type": "error", "message": f"An API key is required for '{e.profile_id}'.",
                    "needs_key": True, "key_ref": e.key_ref, "profile": e.profile_id,
                    "reason": getattr(e, "reason", "missing")})
    except Exception as e:
        logger.exception("Analysis run %s failed", run.id)
        await send({"type": "error", "message": str(e)})


@app.websocket("/ws/analyze")
async def ws_analyze(websocket: WebSocket):
    """Stream an analysis run.

    Client sends {"text": ...} to start a run, or {"resume": request_id} to re-attach to
    one (after a refresh or dropped connection). The first reply is {"type": "run"}; then
    a replay of past events, then live events. {"type": "cancel"} stops the run. Closing
    the socket does not stop it.
    """
    await websocket.accept()
    try:
        data = await websocket.receive_json()
    except Exception:
        return

    if data.get("resume"):
        run = runs.get(str(data["resume"]))
        if run is None:
            await websocket.send_json({"type": "gone"})
            await websocket.close()
            return
    else:
        text = (data.get("text") or "").strip()
        feedback = (data.get("feedback") or "").strip()
        if feedback or data.get("edited_soap"):
            # Clinician feedback: re-run with the note and the correction as context.
            text = (f"{text}\n\n---\nDoctor Feedback: {feedback}\n"
                    f"Edited SOAP: {data.get('edited_soap', '')}")
        if not text:
            await websocket.send_json({"type": "error", "message": "No text provided"})
            await websocket.close()
            return
        rid = obs_store.new_request_id()
        rounds = data.get("max_debate_rounds")
        run = runs.start(rid, lambda r: _analysis_work(r, text, rounds, feedback))

    await websocket.send_json({"type": "run", "request_id": run.id, "resumed": bool(data.get("resume")),
                              "started": run.created, "server_now": time.time()})
    q, replay = run.subscribe()

    async def pump():
        for evt in replay:
            await websocket.send_json(evt)
            if evt.get("type") in _TERMINAL:
                return
        while True:
            evt = await q.get()
            await websocket.send_json(evt)
            if evt.get("type") in _TERMINAL:
                return

    async def listen():
        while True:
            msg = await websocket.receive_json()
            if msg.get("type") == "cancel":
                runs.cancel(run.id)

    pump_task = asyncio.create_task(pump())
    listen_task = asyncio.create_task(listen())
    try:
        await asyncio.wait({pump_task, listen_task}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        run.unsubscribe(q)
        for t in (pump_task, listen_task):
            t.cancel()
        try:
            await websocket.close()
        except Exception:
            pass


@app.get("/api/runs/{request_id}")
async def run_status(request_id: str):
    """Whether a run is still known to the server (used before resuming)."""
    run = runs.get(request_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    return {"request_id": run.id, "status": run.status}


@app.post("/api/runs/{request_id}/cancel")
async def run_cancel(request_id: str):
    return {"cancelled": runs.cancel(request_id)}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  STATIC FRONTEND
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FRONTEND_DIR = PROJECT_ROOT / "frontend"


@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    """Serve the main frontend page."""
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return HTMLResponse(index_path.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>ClinicalPilot</h1><p>Frontend not found. Place files in /frontend/</p>")


# Mount static files (CSS, JS, assets)
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
