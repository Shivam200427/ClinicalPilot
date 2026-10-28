# ClinicalPilot

**Multi-agent clinical decision support, powered by MedGemma.**
Specialist AI agents review a case, challenge each other, and produce a structured SOAP note with safety checks and cited evidence.

[![Python 3.11](https://img.shields.io/badge/python-3.11-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.116+-009688.svg)](https://fastapi.tiangolo.com/)
[![MedGemma 1.5](https://img.shields.io/badge/model-MedGemma%201.5-4285F4.svg)](https://ollama.com/library/medgemma1.5)
[![LiteLLM](https://img.shields.io/badge/LLM-LiteLLM%20gateway-6f42c1.svg)](https://github.com/BerriAI/litellm)

![Analysis workspace](docs/screenshots/03-analysis-complete.png)

---

## Why this exists

Most clinical AI tools are a single model call behind a long prompt. That is fine for a prototype, not for a patient.

ClinicalPilot routes each case through **specialized agents** (Clinical, Literature and Safety), hands their work to an adversarial **Critic**, and merges the result into a proper **SOAP note** with evidence and safety checks.

## Why teams choose ClinicalPilot

- **Clinical workflow focus.** The app is structured around diagnosis support, evidence review, and report generation rather than generic chat.
- **Safety-first review loop.** Literature, medication, and critic passes help catch contradictions, missing context, and risk signals before the final note is returned.
- **Local-first design.** MedGemma can run via Ollama on a local machine, which reduces reliance on cloud API access during exploration and testing.
- **Traceability.** Every model call is logged in the observability layer, with run details, prompts, responses, and evidence links available for inspection.
- **Flexible deployment.** The same app can run locally, in a development environment, or on a hosted service with cloud fallback engines.
- **Research-friendly structure.** The repository separates backend orchestration, frontend views, safety logic, and configuration so the system is easier to extend.

---

## MedGemma: the model at the centre

[**MedGemma 1.5**](https://ollama.com/library/medgemma1.5) is Google's open medical model, trained for clinical text and reasoning. ClinicalPilot runs it **locally through Ollama**, so patient text never has to leave the local environment unless you intentionally route to a cloud engine.

- **Clinical reasoning agent.** MedGemma builds the differential diagnosis, risk scores and the first SOAP draft.
- **AI Assistant chat.** Conversational clinical Q&A on the same local model.
- **Reasoning you can watch.** MedGemma 1.5 thinks before it answers. The live pipeline streams that reasoning token by token, labelled *Thinking* and *Answer*, and the final note keeps only the answer.
- **Local-model controls.** Settings shows whether Ollama is running, whether MedGemma is downloaded and whether it is loaded in memory, with one click to load it before the first case.

Every agent is a routing role, so any of them can run on MedGemma, a cloud model, or both with fallbacks.

---

## Features

### Clinical input
Free text, voice dictation, PDF or CSV records, and **FHIR R4** bundles. Built-in sample cases (STEMI, stroke, pulmonary embolism, FHIR bundle, EHR CSV) load in one click. Recent cases are saved in the browser session and can be reopened quickly.

![Clinical input](docs/screenshots/01-clinical-input.png)

### Live multi-agent pipeline
Watch the real run as it happens: parse and anonymize, Clinical, Literature, Safety, medication check, Critic and SOAP synthesis. Each step shows the engine it runs on, its timing, and its output in real time.

![Live pipeline](docs/screenshots/02-live-pipeline.png)

Runs live on the server, not in the tab. Switch pages, refresh, or drop the connection and the page re-attaches to the same run. Stop cancels it at any time. If a step fails, the results from the earlier steps remain visible so you can diagnose the issue quickly.

<p align="center"><img src="docs/screenshots/04-pipeline-details.png" width="720" alt="Pipeline details"></p>

### The SOAP report
A formal clinical document clipped to a clipboard: case details, numbered Subjective, Objective, Assessment and Plan sections, a differential diagnosis table, risk stratification, medication safety panel, and cited evidence sources.

**[Download the sample SOAP report (PDF)](docs/sample-soap-report.pdf)**

<p align="center"><img src="docs/screenshots/05-full-report.png" width="760" alt="Full SOAP report"></p>

### Doctor feedback loop
Add a correction or missing context and the case goes through a full new review. When it finishes, changed sections are marked *Revised*, with added text highlighted and removed text struck through for easy inspection.

![Feedback changes](docs/screenshots/06-feedback-changes.png)

### Emergency triage
A fast path that skips the debate: ESI level, red flags, immediate actions, top differentials and safety notes in seconds.

![Emergency triage](docs/screenshots/07-emergency-triage.png)

### AI Assistant
Clinical Q&A with formatted answers, suggested starter questions, voice input, and conversation history that survives page switches and refreshes.

![AI Assistant](docs/screenshots/08-ai-assistant.png)

### Clinical tools
A drug interaction checker backed by the medication error panel and DrugBank name checks, bedside calculators (BMI, MAP, Cockcroft-Gault CrCl, anion gap with albumin correction, Bazett QTc), and quick clinical reference utilities.

![Clinical tools](docs/screenshots/09-clinical-tools.png)

### Imaging AI
Chest X-ray, chest disease, diabetic retinopathy and skin lesion classifiers, embedded or opened in a new tab.

![Imaging AI](docs/screenshots/10-imaging-ai.png)

### Observability
Every model call is recorded: agent, engine, model, round, tokens, latency and status. Open any call to read the exact prompt sent, the model's full response, and the PubMed results it used.

![Observability](docs/screenshots/13-observability.png)

### Settings: engines and routing
Any provider through LiteLLM (Ollama, OpenAI, Groq, Anthropic, Azure or any OpenAI-compatible server). Add engines from presets, find available models, test all engines in one click, and choose which role uses which engine.

![Settings: engines](docs/screenshots/14-settings-engines.png)
![Settings: routing](docs/screenshots/15-settings-routing.png)

---

## Architecture

![System architecture](docs/screenshots/11-architecture.png)

Input from text, voice, FHIR or files is de-identified, then fanned out to the agents. The Critic checks their work against the record, the evidence and the safety findings, and the output layer compiles a final, clinician-facing report.

## Data pipeline

![Data pipeline](docs/screenshots/12-data-pipeline.png)

1. **Input.** The browser starts a run over a WebSocket.
2. **De-identification.** Microsoft Presidio removes protected health information before any model sees the text. FHIR bundles are parsed into a single patient record: birth dates become ages, and common identifiers are scrubbed.
3. **Clinical agent (MedGemma).** Differentials, risk scores and a SOAP draft.
4. **Literature and Safety agents in parallel.** PubMed evidence and citations; interactions, contraindications, dosing and population risks from RxNorm, DrugBank and openFDA.
5. **Critic.** Reviews all three for contradictions, evidence gaps and missed safety issues, then decides whether there is consensus. Without consensus the agents revise for another round, up to a limit set in Settings.
6. **Synthesis and validation.** A validated SOAP note, merged with the medication error panel, streamed back to the report.
7. **Clinician feedback.** Corrections start the pipeline again with the note and feedback as context.

Deeper design notes are in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Repository map

| Path | Purpose |
|------|---------|
| `backend/` | FastAPI backend, agents, orchestration, safety logic, observability and model routing |
| `frontend/` | Browser UI, React app, styles, and build tooling |
| `config/` | Model registry and local secret examples |
| `data/` | Sample clinical records, FHIR bundles and test inputs |
| `docs/` | Screenshots, sample report, and supporting media |
| `Flowcharts/` | Visual descriptions of the app workflow and user interaction model |
| `ARCHITECTURE.md` | System design and implementation notes |
| `INSTALL.md` | Detailed installation and deployment guidance |
| `MODEL_SYSTEM_PLAN.md` | Product and reasoning model plan |

---

## Built with

| Area | Stack |
|------|-------|
| Medical model | **MedGemma 1.5** via Ollama (local) |
| Model gateway | LiteLLM, with per-agent routing and fallbacks to any provider |
| De-identification | Microsoft Presidio with spaCy (regex fallback) |
| Clinical data | FHIR R4 parser, EHR CSV and PDF parsing, unified PatientContext |
| Evidence and safety | PubMed E-utilities, RxNorm, DrugBank, openFDA |
| Backend | FastAPI, resumable WebSocket runs, Pydantic v2 |
| Observability | SQLite trace store (optional Langfuse and LangSmith) |
| Frontend | React 18, Tailwind, prebuilt with esbuild |

---

## Quick checklist before first run

1. Install Python 3.10+ and create a virtual environment.
2. Install dependencies: `pip install -r requirements.txt`.
3. Copy environment settings if needed: `cp .env.example .env`.
4. Start Ollama and pull MedGemma: `ollama pull medgemma1.5`.
5. Launch the app: `python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000`.
6. Open `http://localhost:8000` and then the **Settings** tab to verify model routing and engine selection.

---

## Clinical safety and responsible use

This project is intended for research, prototyping, and educational exploration in clinical decision support. It is not a substitute for professional medical judgment and should be used with appropriate clinician oversight, human review, and institutional governance.

Any generated recommendation should be interpreted as an assistive aid only. The final treatment plan remains the responsibility of a qualified healthcare professional.

---

## Run it

```bash
git clone <repo-url> && cd clinicalpilot
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

ollama pull medgemma1.5
python -m uvicorn backend.main:app --port 8000
```

Open **http://localhost:8000**. Engines and keys can also be set from **Settings** in the app. Full setup notes are in [INSTALL.md](INSTALL.md).

<sub>For research and education only. Output requires review by a qualified clinician.</sub>
