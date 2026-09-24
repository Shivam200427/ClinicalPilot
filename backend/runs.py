"""
Analysis runs that outlive a single WebSocket connection.

A run executes as a background task and records every progress event. Any number of
sockets can subscribe to it; a socket that (re)attaches first receives a replay of what
already happened, then live events. Closing a socket only unsubscribes it, so a page
refresh or a dropped connection no longer loses (or restarts) a slow local-model run.
Only an explicit cancel stops the work.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable, Optional

MAX_RUNS = 20
FINISHED_TTL_SEC = 60 * 60


class Run:
    def __init__(self, run_id: str):
        self.id = run_id
        self.status = "running"          # running | done | error | cancelled
        self.events: list[dict] = []     # everything except token deltas
        self.live: dict[str, str] = {}   # agent -> streamed text so far
        self.task: Optional[asyncio.Task] = None
        self.subscribers: set[asyncio.Queue] = set()
        self.created = time.time()
        self.finished: Optional[float] = None

    def publish(self, evt: dict) -> None:
        evt.setdefault("ts", time.time())  # server time, so a replay keeps real durations
        if evt.get("type") == "delta":
            agent = evt.get("agent", "")
            if evt.get("reset"):
                self.live[agent] = ""
            else:
                self.live[agent] = self.live.get(agent, "") + (evt.get("text") or "")
        else:
            self.events.append(evt)
            if evt.get("type") in ("complete", "error", "cancelled"):
                self.status = {"complete": "done"}.get(evt["type"], evt["type"])
                self.finished = time.time()
        for q in list(self.subscribers):
            q.put_nowait(evt)

    def subscribe(self) -> tuple[asyncio.Queue, list[dict]]:
        """Attach a listener. Returns its queue and a replay of the run so far.

        No await between copying the backlog and registering the queue, so nothing
        published in between can be missed or duplicated.
        """
        q: asyncio.Queue = asyncio.Queue()
        replay = list(self.events)
        if self.live:
            replay.append({"type": "live", "agents": dict(self.live)})
        self.subscribers.add(q)
        return q, replay

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.subscribers.discard(q)

    @property
    def terminal(self) -> bool:
        return self.status != "running"


_RUNS: dict[str, Run] = {}


def _prune() -> None:
    now = time.time()
    for rid, r in list(_RUNS.items()):
        if r.terminal and r.finished and now - r.finished > FINISHED_TTL_SEC:
            _RUNS.pop(rid, None)
    if len(_RUNS) > MAX_RUNS:
        finished = sorted((r for r in _RUNS.values() if r.terminal), key=lambda r: r.created)
        for r in finished[: len(_RUNS) - MAX_RUNS]:
            _RUNS.pop(r.id, None)


def start(run_id: str, work: Callable[[Run], Awaitable[Any]]) -> Run:
    """Create a run and execute `work(run)` in the background."""
    _prune()
    run = Run(run_id)
    _RUNS[run_id] = run

    async def _wrapped():
        try:
            await work(run)
        except asyncio.CancelledError:
            run.publish({"type": "cancelled"})
        except Exception as e:  # work() normally publishes its own error
            if not run.terminal:
                run.publish({"type": "error", "message": str(e)})

    run.task = asyncio.create_task(_wrapped())
    return run


def get(run_id: str) -> Optional[Run]:
    return _RUNS.get(run_id)


def cancel(run_id: str) -> bool:
    run = _RUNS.get(run_id)
    if not run or run.terminal or not run.task:
        return False
    run.task.cancel()
    return True
