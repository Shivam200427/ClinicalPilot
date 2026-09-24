"""
LLM client — role-based routing over LiteLLM with per-profile fallback.

Every agent calls `llm_call(role=..., ...)`. The role resolves to an ordered list of
connection profiles (primary + fallbacks). Each profile can be any provider/model/
base_url/key — local Ollama (MedGemma), OpenAI, Groq, or any OpenAI-compatible endpoint.

Design goals: reliable fallback, robust cross-provider JSON parsing, and a trace
recorded for every attempt (observability).
"""

from __future__ import annotations

import asyncio
import contextvars
import logging
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

import litellm

from backend.llm.registry import Profile, resolve_role
from backend.llm.router import build_call_args, parse_content
from backend.llm.secrets import resolve_secret, NeedsKey

logger = logging.getLogger(__name__)

PROMPTS_DIR = Path(__file__).parent / "prompts"

# Keep LiteLLM quiet and resilient
litellm.drop_params = True          # silently drop unsupported params per-provider
litellm.suppress_debug_info = True
litellm.num_retries = 0             # we own fallback/retry — don't let LiteLLM retry a dead engine
litellm.request_timeout = 120       # hard ceiling per attempt (generous for local generation)

GROQ_MAX_RETRIES = 4
GROQ_BASE_DELAY = 5.0

# Ambient call context so observability can group calls per analysis/round
# without every agent threading these through their signatures.
_ctx_request_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("cp_request_id", default=None)
_ctx_debate_round: contextvars.ContextVar[Optional[int]] = contextvars.ContextVar("cp_debate_round", default=None)
# Optional token sink for live output. When set (by a streaming analysis run), calls are
# streamed and text deltas are pushed as sink(role, text); sink(role, None) means "reset"
# (a retry or fallback started over). Unset everywhere else, so chat/REST are unchanged.
_ctx_stream_sink: contextvars.ContextVar[Optional[Callable[[str, Optional[str]], Awaitable[None]]]] = \
    contextvars.ContextVar("cp_stream_sink", default=None)

STREAM_FLUSH_SEC = 0.15


def set_call_context(request_id: Optional[str] = None, debate_round: Optional[int] = None) -> None:
    """Set ambient request id / debate round for subsequent llm_call traces."""
    if request_id is not None:
        _ctx_request_id.set(request_id)
    if debate_round is not None:
        _ctx_debate_round.set(debate_round)


def set_stream_sink(sink: Optional[Callable[[str, Optional[str]], Awaitable[None]]]) -> None:
    """Stream every llm_call in the current context to `sink` (see _ctx_stream_sink)."""
    _ctx_stream_sink.set(sink)


def current_context() -> tuple[Optional[str], Optional[int]]:
    """Ambient (request_id, debate_round) — used by non-LLM steps (e.g. PubMed) to co-trace."""
    return _ctx_request_id.get(), _ctx_debate_round.get()


def load_prompt(name: str) -> str:
    """Load a system prompt from the prompts/ directory."""
    path = PROMPTS_DIR / name
    if path.exists():
        return path.read_text(encoding="utf-8")
    logger.warning(f"Prompt file {name} not found at {path}")
    return ""


async def llm_call(
    system_prompt: str,
    user_message: str,
    role: str = "default",
    *,
    model: Optional[str] = None,          # kept for back-compat; ignored (routing decides)
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    json_mode: Optional[bool] = None,
    request_id: Optional[str] = None,
    debate_round: Optional[int] = None,
) -> dict[str, Any]:
    """Route a call through the profiles configured for `role`, with fallback.

    Returns: {"content", "model", "provider", "profile", "tokens", "latency_ms"}.
    Raises NeedsKey if no runnable profile has a key; AllProvidersFailed otherwise.
    """
    if request_id is None:
        request_id = _ctx_request_id.get()
    if debate_round is None:
        debate_round = _ctx_debate_round.get()
    profiles = resolve_role(role)
    needs_key: Optional[NeedsKey] = None
    last_error: Optional[Exception] = None

    for idx, profile in enumerate(profiles):
        # Skip cloud profiles whose key isn't available — remember to prompt later.
        if profile.api_key_ref and not resolve_secret(profile.api_key_ref):
            needs_key = needs_key or NeedsKey(profile.api_key_ref, profile.id)
            _record(role, profile, idx, request_id, debate_round, 0, 0, 0,
                    success=False, error="needs_key")
            continue

        try:
            result = await _call_profile(
                profile, system_prompt, user_message,
                json_mode=json_mode, temperature=temperature, max_tokens=max_tokens,
                role=role, request_id=request_id, debate_round=debate_round,
                fallback_index=idx,
            )
            return result
        except NeedsKey as e:
            needs_key = needs_key or e
            continue
        except Exception as e:
            last_error = e
            logger.warning("Profile '%s' (%s) failed: %s", profile.id, profile.provider, e)
            continue

    # Nothing succeeded.
    if needs_key is not None:
        raise needs_key
    raise AllProvidersFailed(role, last_error)


class AllProvidersFailed(RuntimeError):
    def __init__(self, role: str, cause: Optional[Exception]):
        self.role = role
        self.cause = cause
        msg = f"All model providers failed for role '{role}'"
        if cause:
            msg += f": {cause}"
        else:
            msg += ". Configure a model in Settings (local Ollama or an API key)."
        super().__init__(msg)


async def _call_profile(
    profile: Profile,
    system_prompt: str,
    user_message: str,
    *,
    json_mode: Optional[bool],
    temperature: Optional[float],
    max_tokens: Optional[int],
    role: str,
    request_id: Optional[str],
    debate_round: Optional[int],
    fallback_index: int,
) -> dict[str, Any]:
    """Single-profile call with Groq-specific retry/truncation."""
    use_json = profile.params.json_mode if json_mode is None else json_mode
    args = build_call_args(
        profile, system_prompt, user_message,
        json_mode=use_json, temperature=temperature, max_tokens=max_tokens,
    )

    start = time.monotonic()
    retries = GROQ_MAX_RETRIES if profile.provider == "groq" else 1

    last_exc: Optional[Exception] = None
    for attempt in range(retries):
        try:
            sink = _ctx_stream_sink.get()
            if sink is not None:
                resp = await _streamed_completion(args, sink, role)
            else:
                resp = await litellm.acompletion(**args)
            latency_ms = int((time.monotonic() - start) * 1000)

            content_str = resp.choices[0].message.content or ""
            usage = getattr(resp, "usage", None)
            tokens_in = getattr(usage, "prompt_tokens", 0) or 0
            tokens_out = getattr(usage, "completion_tokens", 0) or 0
            total = getattr(usage, "total_tokens", 0) or (tokens_in + tokens_out)

            cost = _safe_cost(resp)
            _record(role, profile, fallback_index, request_id, debate_round,
                    tokens_in, tokens_out, latency_ms, success=True, cost=cost,
                    request_messages=args.get("messages"), response_text=content_str)

            return {
                "content": parse_content(content_str, use_json),
                "model": profile.model,
                "provider": profile.provider,
                "profile": profile.id,
                "tokens": total,
                "latency_ms": latency_ms,
            }
        except Exception as e:
            last_exc = e
            code = getattr(e, "status_code", 0)
            if profile.provider == "groq" and code == 413:  # payload too large
                for m in args["messages"]:
                    m["content"] = m["content"][: len(m["content"]) * 2 // 3]
                args["max_tokens"] = min(args.get("max_tokens", 2048), 1024)
                await asyncio.sleep(1)
                continue
            if profile.provider == "groq" and code == 429:  # rate limited
                await asyncio.sleep(GROQ_BASE_DELAY * (2 ** attempt))
                continue
            break  # non-retryable

    latency_ms = int((time.monotonic() - start) * 1000)
    # Classify: a keyed engine that failed on auth/rate-limit → prompt the user for a key.
    key_reason = _key_failure_reason(last_exc)
    _record(role, profile, fallback_index, request_id, debate_round,
            0, 0, latency_ms, success=False,
            error=(f"key:{key_reason}" if key_reason else str(last_exc)),
            request_messages=args.get("messages"))
    if profile.api_key_ref and key_reason:
        raise NeedsKey(profile.api_key_ref, profile.id, reason=key_reason)
    raise last_exc  # type: ignore[misc]


async def _emit_delta(sink, role: str, text: Optional[str]) -> None:
    try:
        await sink(role, text)
    except Exception:
        pass


async def _streamed_completion(args: dict, sink, role: str):
    """Stream a completion, pushing throttled text deltas to `sink`, and return a
    response object shaped like the non-streamed one (content + usage)."""
    await _emit_delta(sink, role, None)  # reset any text from an earlier attempt
    try:
        stream = await litellm.acompletion(**args, stream=True)
    except Exception:
        # Provider refused streaming outright: fall back to a plain call.
        return await litellm.acompletion(**args)

    chunks: list = []
    buf: list[str] = []
    last = time.monotonic()
    async for chunk in stream:
        chunks.append(chunk)
        try:
            delta = chunk.choices[0].delta.content
        except (AttributeError, IndexError):
            delta = None
        if delta:
            buf.append(delta)
        if buf and time.monotonic() - last >= STREAM_FLUSH_SEC:
            await _emit_delta(sink, role, "".join(buf))
            buf.clear()
            last = time.monotonic()
    if buf:
        await _emit_delta(sink, role, "".join(buf))
    return litellm.stream_chunk_builder(chunks, messages=args.get("messages"))


def _key_failure_reason(exc: Optional[Exception]) -> Optional[str]:
    """Return 'rate_limit' | 'invalid' if the failure looks like a key problem, else None."""
    if exc is None:
        return None
    code = getattr(exc, "status_code", 0) or 0
    msg = str(exc).lower()
    if code == 429 or "rate limit" in msg or "quota" in msg or "too many requests" in msg:
        return "rate_limit"
    if code in (401, 403) or "invalid api key" in msg or "expired" in msg \
            or "invalid_api_key" in msg or "incorrect api key" in msg or "authentication" in msg:
        return "invalid"
    return None


def _safe_cost(resp: Any) -> Optional[float]:
    try:
        return litellm.completion_cost(completion_response=resp)
    except Exception:
        return None


def _record(role, profile: Profile, idx, request_id, debate_round,
            tin, tout, latency, *, success, error=None, cost=None,
            request_messages=None, response_text=None) -> None:
    """Fire-and-forget trace; observability must never break a call."""
    try:
        from backend.observability.store import record_trace
        record_trace(
            role=role, profile=profile.id, provider=profile.provider,
            model=profile.model, base_url=profile.base_url, request_id=request_id,
            debate_round=debate_round, tokens_in=tin, tokens_out=tout,
            latency_ms=latency, cost_usd=cost, success=success, error=error,
            fallback_index=idx, request_messages=request_messages, response_text=response_text,
        )
    except Exception:
        pass
