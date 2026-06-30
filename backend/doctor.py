"""Read-only environment/install diagnostics for `claude-explorer doctor`.

Each check is a zero-arg callable returning a :class:`CheckResult`. The
registry pairs a display name with the callable so the runner can label a
result even if the check raises. Checks MUST NOT mutate state — fixing
lives in dedicated commands (install-watcher, reindex-search, mcp).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Callable


class Status(str, Enum):
    OK = "ok"
    WARN = "warn"
    FAIL = "fail"


@dataclass
class CheckResult:
    name: str
    status: Status
    detail: str
    fix_command: str | None = None
    fix: Callable[[], None] | None = None


Check = Callable[[], "CheckResult"]


def run_checks(checks: list[tuple[str, Check]]) -> list[CheckResult]:
    """Run every check, wrapping unexpected exceptions as FAIL results.

    One check failing never aborts the others.
    """
    out: list[CheckResult] = []
    for name, fn in checks:
        try:
            out.append(fn())
        except Exception as exc:  # noqa: BLE001 - doctor must never crash
            out.append(
                CheckResult(
                    name=name,
                    status=Status.FAIL,
                    detail=f"unexpected error: {type(exc).__name__}: {exc}",
                )
            )
    return out


def has_failure(results: list[CheckResult]) -> bool:
    return any(r.status is Status.FAIL for r in results)
