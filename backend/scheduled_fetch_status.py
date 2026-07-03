"""Read/write the scheduled-fetch run-status file.

Single source of truth for `doctor` and the notification transition
check. CLI-only — must stay OUT of the MCPB import closure. Never
raises on read (missing/corrupt → defaults).
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path

from .config import canonical_home_dir


@dataclass
class FetchStatus:
    last_run_at: str | None = None
    last_success_at: str | None = None
    last_result: str = "unknown"          # ok | auth_expired | needs_auth | error | unknown
    auth_expired: bool = False
    fetched_count: int | None = None
    error: str | None = None
    interval_sec: int | None = None


def status_path() -> Path:
    return canonical_home_dir() / "scheduled-fetch-status.json"


def read_status(path: Path | None = None) -> FetchStatus:
    p = path or status_path()
    try:
        data = json.loads(p.read_text())
    except (OSError, ValueError):
        return FetchStatus()
    if not isinstance(data, dict):
        return FetchStatus()
    known = {f: data.get(f) for f in FetchStatus().__dict__}
    return FetchStatus(**known)


def write_status(status: FetchStatus, path: Path | None = None) -> None:
    p = path or status_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    try:
        tmp.write_text(json.dumps(asdict(status), indent=2))
        os.chmod(tmp, 0o600)
        os.replace(tmp, p)
    except OSError:
        if tmp.exists():
            tmp.unlink()
        raise
