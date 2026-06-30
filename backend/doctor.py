"""Read-only environment/install diagnostics for `claude-explorer doctor`.

Each check is a zero-arg callable returning a :class:`CheckResult`. The
registry pairs a display name with the callable so the runner can label a
result even if the check raises. Checks MUST NOT mutate state — fixing
lives in dedicated commands (install-watcher, reindex-search, mcp).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Callable

from .config import get_settings


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


def credentials_path() -> Path:
    """Return the path to the credentials file."""
    return Path.home() / ".claude-explorer" / "credentials.json"


def check_credentials() -> CheckResult:
    """Check if credentials file exists."""
    p = credentials_path()
    if p.is_file():
        return CheckResult("Credentials", Status.OK, f"found ({p})")
    return CheckResult(
        "Credentials", Status.WARN,
        "not found (needed for fetch, not for browsing existing data)",
        fix_command="claude-explorer capture",
    )


def check_data_dir() -> CheckResult:
    """Check if data directory exists and is writable."""
    data_dir = get_settings().data_dir
    if not data_dir.exists():
        return CheckResult(
            "Data directory", Status.FAIL, f"missing: {data_dir}",
            fix_command=f"mkdir -p {data_dir}  (or set CLAUDE_EXPLORER_DATA_DIR)",
        )
    if not os.access(data_dir, os.W_OK):
        return CheckResult(
            "Data directory", Status.FAIL, f"not writable: {data_dir}",
            fix_command=f"chmod u+w {data_dir}",
        )
    count = sum(1 for _ in data_dir.glob("*.json"))
    return CheckResult("Data directory", Status.OK, f"{data_dir} ({count} conversation(s))")


def check_config() -> CheckResult:
    """Check if config is valid (not corrupt)."""
    if hasattr(get_settings, "cache_clear"):
        get_settings.cache_clear()
    reason = get_settings().config_corrupt_reason
    if reason:
        return CheckResult(
            "Config", Status.FAIL, f"corrupt: {reason}",
            fix_command="fix or remove the named config file",
        )
    return CheckResult("Config", Status.OK, "valid")
