"""
Debate Engine — orchestrates multi-round agent debate.

Round 1: All agents generate independently (parallel or sequential)
Round 2: Critic reviews → agents revise
Round 3: Final revision (if no consensus after round 2)

Fixed 2-3 rounds max — deterministic, no infinite loops.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable, Optional

from backend.llm.registry import resolve_role
from backend.agents.llm_client import set_call_context
from backend.models.patient import PatientContext
from backend.models.agents import (
    ClinicalAgentOutput,
    CriticOutput,
    DebateState,
    LiteratureAgentOutput,
    SafetyAgentOutput,
)

logger = logging.getLogger(__name__)


EventCb = Optional[Callable[[dict], Awaitable[None]]]


async def _emit(on_event: EventCb, **evt) -> None:
    """Fire a progress event to the caller (websocket). Never breaks the debate."""
    if on_event is None:
        return
    try:
        await on_event(evt)
    except Exception:
        pass


async def run_debate(
    patient: PatientContext,
    max_rounds: int = 1,
    on_event: EventCb = None,
) -> DebateState:
    """
    Run the full multi-agent debate.

    `on_event(evt)` (optional) receives structured progress dicts so a UI can show
    exactly which agent is working in which round. Returns DebateState.
    """
    state = DebateState()

    for round_num in range(1, max_rounds + 1):
        state.round_number = round_num
        set_call_context(debate_round=round_num)
        logger.info(f"Debate Round {round_num}/{max_rounds}")
        await _emit(on_event, type="round_start", round=round_num, max_rounds=max_rounds)

        if round_num == 1:
            clinical, literature, safety = await _round_1(patient, on_event, round_num)
        else:
            last_critic = state.critic_outputs[-1] if state.critic_outputs else None
            critique_text = _format_critique(last_critic) if last_critic else ""
            clinical, literature, safety = await _revision_round(
                patient, critique_text, on_event, round_num,
                prev_clinical=state.clinical_outputs[-1] if state.clinical_outputs else None,
            )

        state.clinical_outputs.append(clinical)
        state.literature_outputs.append(literature)
        state.safety_outputs.append(safety)

        # ── Critic Phase ──
        from backend.agents.critic import run_critic_agent
        await _emit(on_event, type="agent", agent="critic", round=round_num, status="start")
        critic = await run_critic_agent(patient, clinical, literature, safety)
        state.critic_outputs.append(critic)
        await _emit(on_event, type="agent", agent="critic", round=round_num, status="done",
                    consensus=bool(critic.consensus_reached), data=_dump(critic))

        if round_num < max_rounds:
            if critic.consensus_reached:
                logger.info(f"Consensus reached after round {round_num}")
                state.final_consensus = True
                await _emit(on_event, type="round_end", round=round_num, consensus=True)
                break
        else:
            state.final_consensus = critic.consensus_reached
            if not critic.consensus_reached:
                state.flagged_for_human = True
                logger.warning("No consensus after max rounds — flagging for human review")
        await _emit(on_event, type="round_end", round=round_num,
                    consensus=bool(critic.consensus_reached))

    return state


def _should_serialize() -> bool:
    """Run agents sequentially when the parallel roles resolve to a rate-limited
    profile (profile.serialize=True, e.g. a free cloud tier). Local/standard
    profiles run in parallel."""
    for role in ("literature", "safety"):
        profiles = resolve_role(role)
        if profiles and profiles[0].serialize:
            return True
    return False


# Small delay between sequential calls to respect free-tier rate limits
_GROQ_INTER_CALL_DELAY = 2.0


async def _run_agent(on_event: EventCb, agent: str, round_num: int, coro):
    """Emit start/done around an agent coroutine."""
    await _emit(on_event, type="agent", agent=agent, round=round_num, status="start")
    out = await coro
    await _emit(on_event, type="agent", agent=agent, round=round_num, status="done",
                data=_dump(out))
    return out


def _dump(out) -> dict | None:
    """Serialize an agent output for the UI's partial-results view. Never raises."""
    try:
        return out.model_dump()
    except Exception:
        return None


async def _round_1(
    patient: PatientContext,
    on_event: EventCb = None,
    round_num: int = 1,
) -> tuple[ClinicalAgentOutput, LiteratureAgentOutput, SafetyAgentOutput]:
    """Round 1: All agents generate (parallel when possible, sequential for Groq)."""
    from backend.agents.clinical import run_clinical_agent
    from backend.agents.literature import run_literature_agent
    from backend.agents.safety import run_safety_agent

    # Clinical runs first (literature needs its output)
    clinical = await _run_agent(on_event, "clinical", round_num, run_clinical_agent(patient))

    if _should_serialize():
        # Sequential execution to stay within Groq free-tier rate limits
        await asyncio.sleep(_GROQ_INTER_CALL_DELAY)
        literature = await _run_agent(on_event, "literature", round_num,
                                      run_literature_agent(patient, clinical_output=clinical))
        await asyncio.sleep(_GROQ_INTER_CALL_DELAY)
        safety = await _run_agent(on_event, "safety", round_num,
                                  run_safety_agent(patient, proposed_plan=clinical.soap_draft))
    else:
        literature, safety = await asyncio.gather(
            _run_agent(on_event, "literature", round_num,
                       run_literature_agent(patient, clinical_output=clinical)),
            _run_agent(on_event, "safety", round_num,
                       run_safety_agent(patient, proposed_plan=clinical.soap_draft)),
        )

    return clinical, literature, safety


async def _revision_round(
    patient: PatientContext,
    critique_text: str,
    on_event: EventCb = None,
    round_num: int = 2,
    prev_clinical: ClinicalAgentOutput | None = None,
) -> tuple[ClinicalAgentOutput, LiteratureAgentOutput, SafetyAgentOutput]:
    """Revision round: agents incorporate critique."""
    from backend.agents.clinical import run_clinical_agent
    from backend.agents.literature import run_literature_agent
    from backend.agents.safety import run_safety_agent

    clinical = await _run_agent(on_event, "clinical", round_num,
                                run_clinical_agent(patient, critique=critique_text))

    if _should_serialize():
        await asyncio.sleep(_GROQ_INTER_CALL_DELAY)
        literature = await _run_agent(on_event, "literature", round_num,
                                      run_literature_agent(patient, clinical_output=clinical, critique=critique_text))
        await asyncio.sleep(_GROQ_INTER_CALL_DELAY)
        safety = await _run_agent(on_event, "safety", round_num,
                                  run_safety_agent(patient, proposed_plan=clinical.soap_draft, critique=critique_text))
    else:
        literature, safety = await asyncio.gather(
            _run_agent(on_event, "literature", round_num,
                       run_literature_agent(patient, clinical_output=clinical, critique=critique_text)),
            _run_agent(on_event, "safety", round_num,
                       run_safety_agent(patient, proposed_plan=clinical.soap_draft, critique=critique_text)),
        )

    return clinical, literature, safety


def _format_critique(critic: CriticOutput) -> str:
    """Format CriticOutput into a string for agent prompts."""
    parts = []

    if critic.ehr_contradictions:
        parts.append("EHR Contradictions:\n" + "\n".join(f"- {c}" for c in critic.ehr_contradictions))

    if critic.evidence_gaps:
        parts.append("Evidence Gaps:\n" + "\n".join(f"- {g}" for g in critic.evidence_gaps))

    if critic.safety_misses:
        parts.append("Safety Misses:\n" + "\n".join(f"- {m}" for m in critic.safety_misses))

    if critic.overall_assessment:
        parts.append(f"Overall Assessment: {critic.overall_assessment}")

    if critic.dissent_log:
        parts.append("Points of Dissent:\n" + "\n".join(f"- {d}" for d in critic.dissent_log))

    return "\n\n".join(parts)
