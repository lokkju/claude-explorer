"""Preferences router (P3a).

Per-user preferences blob, persisted as a single JSON file under
``~/.claude-exporter/preferences.json``. Versioned envelope so we can evolve
the schema without breaking existing installs:

    {"version": 1, "data": {"theme": "dark", "keyboardMode": "vim", ...}}

PATCH is the primary write path used by the frontend: it deep-merges (top-
level overwrite per key) into the existing data so unrelated keys are
preserved when a single setting is toggled. PUT replaces the whole blob and
is exposed for completeness / future use.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..config import get_settings


router = APIRouter(prefix="/preferences", tags=["preferences"])

# In-process lock that guards the read-modify-write window for PATCH/PUT.
# A single backend process is the deployment model, so a threading.Lock
# is sufficient and simpler than fcntl.flock.
_write_lock = threading.Lock()

PREFS_VERSION = 1


def _resolve_path() -> Path:
    """Resolve preferences file location.

    Lives in the parent of the configured data dir, i.e.
    ``~/.claude-exporter/preferences.json`` for the default
    ``~/.claude-exporter/conversations`` data dir.
    """
    settings = get_settings()
    return settings.data_dir.parent / "preferences.json"


def _read_blob() -> dict[str, Any]:
    path = _resolve_path()
    if not path.exists():
        return {"version": PREFS_VERSION, "data": {}}
    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {"version": PREFS_VERSION, "data": {}}
    if not isinstance(raw, dict):
        return {"version": PREFS_VERSION, "data": {}}
    data = raw.get("data") if isinstance(raw.get("data"), dict) else {}
    version = raw.get("version") if isinstance(raw.get("version"), int) else PREFS_VERSION
    return {"version": version, "data": data}


def _write_atomic(blob: dict[str, Any]) -> None:
    path = _resolve_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        with open(tmp, "w") as f:
            json.dump(blob, f, indent=2)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        # If anything between write and replace raises, the .tmp file would
        # otherwise leak in the user's data dir. Best-effort cleanup; we
        # re-raise so the failure surfaces.
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass
        raise


class PreferencesEnvelope(BaseModel):
    version: int = Field(default=PREFS_VERSION)
    data: dict[str, Any] = Field(default_factory=dict)


class PreferencesWrite(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


@router.get("", response_model=PreferencesEnvelope)
async def get_preferences() -> PreferencesEnvelope:
    blob = _read_blob()
    return PreferencesEnvelope(version=blob["version"], data=blob["data"])


@router.put("", response_model=PreferencesEnvelope)
async def put_preferences(payload: PreferencesWrite) -> PreferencesEnvelope:
    if not isinstance(payload.data, dict):
        raise HTTPException(status_code=400, detail="`data` must be an object")
    with _write_lock:
        blob = {"version": PREFS_VERSION, "data": dict(payload.data)}
        _write_atomic(blob)
    return PreferencesEnvelope(version=blob["version"], data=blob["data"])


@router.patch("", response_model=PreferencesEnvelope)
async def patch_preferences(payload: PreferencesWrite) -> PreferencesEnvelope:
    if not isinstance(payload.data, dict):
        raise HTTPException(status_code=400, detail="`data` must be an object")
    with _write_lock:
        existing = _read_blob()
        merged: dict[str, Any] = dict(existing.get("data", {}))
        # Top-level overwrite per key — nested objects are values, not merge
        # targets, per the P3a spec.
        for k, v in payload.data.items():
            merged[k] = v
        blob = {"version": PREFS_VERSION, "data": merged}
        _write_atomic(blob)
    return PreferencesEnvelope(version=blob["version"], data=blob["data"])
