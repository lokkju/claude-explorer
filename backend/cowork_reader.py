"""Reader for Claude Desktop "Cowork" local-agent-mode sessions.

Cowork is the Desktop app's Claude Code-style local-agent harness for
non-coding workflows. Sessions live entirely on disk under

    <claude_desktop_app_dir>/local-agent-mode-sessions/
        <deployment_uuid>/<org_uuid>/
            local_<session_uuid>/audit.jsonl       (append-only messages)
            local_<session_uuid>.json              (sidecar: title, model, ...)

The ``audit.jsonl`` shape is byte-similar to Claude Code's
``projects/*.jsonl``: one JSON object per line, ``{type, message, ...}``,
``message.content`` is a string OR list of content blocks. Differences:

* Cowork uses snake_case ``session_id`` instead of camelCase ``sessionId``.
* Cowork has no ``parentUuid`` — the only parent link is
  ``parent_tool_use_id`` (tool-result -> tool-use), which we ignore.
  Cowork is a chronological append-only log; the store's
  ``is_chronological`` branch handles rendering without parent links.
* Cowork stamps ``_audit_timestamp`` instead of ``timestamp``.
* Cowork stamps ``_audit_hmac`` (a per-line integrity hash). We do NOT
  verify it (D4) and strip it before any downstream code sees it.
* Cowork lines include extra types we silently filter at grouping:
  ``system/init``, ``system/status``, ``rate_limit_event``, plus any
  future ``type`` we don't yet model.

This module is intentionally thinner than ``claude_code_reader``: there
are NO slash-command triplets, no canned-response fold, no prelude
flagging — those are CC-specific boilerplate that Cowork's UI doesn't
generate. We import the format-agnostic message merge from
``agent_session_io`` and stop.

See ``PLANS/2026.05.24-SUPPORT-COWORK-SESSIONS.md`` Phase 1 for the
behavioral contract pinned by ``backend/tests/test_cowork_reader.py``.
"""

from __future__ import annotations

import json
import logging
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

from .agent_session_io import (
    _get_message_key,
    _merge_entries_to_message,
    normalize_session_fields,
    parse_jsonl_file,
)


log = logging.getLogger(__name__)


# D11: max bytes per single content payload before we truncate with a
# ``[truncated; N bytes]`` marker. 1 MB is well above any normal
# Cowork user prompt and any reasonable tool_result, but bounds the
# pathological case (a multi-MB pasted log) so the SSE stream + the
# frontend renderer don't OOM. Hard-coded for V1; could be made
# configurable later if a user hits a legitimate larger payload.
_CONTENT_BYTE_LIMIT = 1 * 1024 * 1024


def read_cowork_conversation(session_dir: Path) -> dict | None:
    """Read a single Cowork session into the canonical conversation dict.

    ``session_dir`` is the directory containing ``audit.jsonl`` (e.g.
    ``.../local_<uuid>/``). The sidecar JSON lives at
    ``<session_dir>.json`` (a SIBLING file, not inside the dir).

    Returns ``None`` for:
      * an empty / missing audit.jsonl;
      * a session with no user record (D6 — there's nothing to render).
    """
    audit_path = session_dir / "audit.jsonl"
    sidecar_path = session_dir.with_suffix(".json")

    entries = parse_jsonl_file(audit_path)
    if not entries:
        return None

    # Step 1: normalize each line to the CC-canonical field shape so the
    # shared transforms (_get_message_key, _merge_entries_to_message)
    # work unchanged.
    normalized = [normalize_session_fields(e, fmt="cowork") for e in entries]

    # Step 2: D11 — truncate any single content payload over the byte
    # limit BEFORE the merge so the truncated text is what every
    # downstream caller sees.
    normalized = [_truncate_oversized_content(e) for e in normalized]

    # Step 3: group consecutive entries that belong to the same logical
    # message (same _get_message_key) and merge each group into one
    # message dict. _get_message_key returns None for system/init,
    # rate_limit_event, and any unknown future type — those drop here
    # without crashing.
    groups: OrderedDict[str, list[dict]] = OrderedDict()
    for entry in normalized:
        key = _get_message_key(entry)
        if key:
            groups.setdefault(key, []).append(entry)

    messages: list[dict] = []
    for group in groups.values():
        msg = _merge_entries_to_message(group)
        if msg:
            messages.append(msg)

    # D6: a session with no user turn doesn't render usefully — drop it
    # from the sidebar instead of showing a phantom row.
    if not any(m.get("sender") == "human" for m in messages):
        return None

    sidecar = _read_sidecar(sidecar_path)

    # Title from sidecar; fall back to "Untitled" when sidecar missing /
    # title key missing / title empty.
    title = sidecar.get("title") or "Untitled"

    # Cowork uuid derivation (autonomous decision #1 per the
    # smooth-Meandering-cat agent plan): the sidecar's ``sessionId`` is
    # ``local_<uuid>`` — strip the prefix so it matches the directory
    # stem (``local_<uuid>/``) AND the user-visible URL slug, and so
    # cross-source dedup at the store layer can compare uuid strings
    # without prefix bookkeeping.
    raw_session_id = sidecar.get("sessionId") or session_dir.name
    uuid = raw_session_id.removeprefix("local_")

    first_msg_ts = messages[0]["created_at"]
    last_msg_ts = messages[-1]["updated_at"]
    created_at = _iso_from_epoch_ms(sidecar.get("createdAt")) or first_msg_ts
    updated_at = _iso_from_epoch_ms(sidecar.get("lastActivityAt")) or last_msg_ts

    # D10: ``cwd`` is the sandbox path (e.g. ``/sessions/<vm>``). Carry
    # it through as both ``project_path`` (for compat with the existing
    # detail-view "Project path" field) AND ``sandbox_path`` (so the
    # detail view can label it "Sandbox path" when the source is
    # CLAUDE_COWORK). For some sessions ``cwd`` is the host path
    # instead — render either as plain text, no filesystem linking.
    cwd = sidecar.get("cwd", "")

    return {
        "uuid": uuid,
        "name": title,
        "summary": "",
        "model": sidecar.get("model", ""),
        "created_at": created_at,
        "updated_at": updated_at,
        "is_starred": False,
        "project_path": cwd,
        "git_branch": "",
        "source": "CLAUDE_COWORK",
        "chat_messages": messages,
        "current_leaf_message_uuid": messages[-1]["uuid"] if messages else "",
        # CC-parity scaffolding the renderer expects but Cowork doesn't
        # generate.
        "compact_markers": [],
        "prelude_hidden_count": 0,
        # D8: archived flag drives the "Show archived" toggle.
        "is_archived": bool(sidecar.get("isArchived", False)),
        # D9: sidecar.error is a plain string when the Cowork harness
        # logged a session-ending fault; None otherwise. Detail view
        # renders a banner when non-None.
        "error": sidecar.get("error") or None,
        # D10: aliased for the detail view's "Sandbox path" label.
        "sandbox_path": cwd,
        # Cowork doesn't map ``<org>`` directory to a user-visible
        # workspace (autonomous decision #4) — leave the legacy
        # workspace fields unset.
        "organization_id": None,
    }


def list_cowork_conversations(cowork_root: Path) -> list[dict]:
    """Walk ``<deployment>/<org>/local_*/`` and return all sessions.

    D2: the deployment + org directory layers are flattened in the
    output — callers receive a single list of conversation dicts with
    no deployment/org metadata leaking through. Cowork's ``<org>``
    directories reuse Claude Desktop's internal org UUIDs but don't
    map to user-facing workspaces, so we deliberately leave
    ``organization_id`` unset on the conv dicts.

    Returns ``[]`` (not raises) when the cowork root doesn't exist —
    a user without Cowork data installed must not see a crash.
    """
    if not cowork_root.exists():
        return []

    session_dirs: list[Path] = []
    try:
        deployment_dirs = list(cowork_root.iterdir())
    except OSError:
        return []
    for deployment_dir in deployment_dirs:
        if not deployment_dir.is_dir():
            continue
        try:
            org_dirs = list(deployment_dir.iterdir())
        except OSError:
            continue
        for org_dir in org_dirs:
            if not org_dir.is_dir():
                continue
            try:
                entries = list(org_dir.iterdir())
            except OSError:
                continue
            for entry in entries:
                if entry.is_dir() and entry.name.startswith("local_"):
                    session_dirs.append(entry)

    out: list[dict] = []
    for sd in session_dirs:
        try:
            conv = read_cowork_conversation(sd)
        except Exception:  # pragma: no cover  defensive: one bad session
            # can't kill the whole sidebar
            log.exception("cowork: failed to read session %s", sd)
            continue
        if conv:
            out.append(conv)
    return out


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _read_sidecar(path: Path) -> dict:
    """Tolerate a missing / corrupt sidecar — return ``{}`` so the
    caller falls back to defaults (title="Untitled", model="", etc.).

    A user mid-migration or mid-write may have a session dir without
    its sidecar (or with a half-written one). We log the parse failure
    at WARNING so it's visible in supervised-job logs, but never raise.
    """
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        log.warning("cowork: sidecar %s unreadable", path, exc_info=True)
        return {}


def _truncate_oversized_content(entry: dict) -> dict:
    """D11: truncate any single content payload over the byte limit.

    Operates on the raw entry (pre-merge) so the truncated bytes are
    what gets baked into both the merged ``text`` AND the per-block
    ``content`` array — no double-truncation, no off-by-one between
    the two views.
    """
    msg = entry.get("message")
    if not isinstance(msg, dict):
        return entry
    content = msg.get("content")

    if isinstance(content, str):
        encoded = content.encode("utf-8")
        if len(encoded) <= _CONTENT_BYTE_LIMIT:
            return entry
        # Decode the truncated prefix back with errors="ignore" so a
        # multi-byte character split at the boundary doesn't raise.
        truncated = encoded[:_CONTENT_BYTE_LIMIT].decode("utf-8", errors="ignore")
        truncated += f"\n\n[truncated; {len(encoded)} bytes]"
        out = dict(entry)
        out_msg = dict(msg)
        out_msg["content"] = truncated
        out["message"] = out_msg
        return out

    if isinstance(content, list):
        mutated = False
        new_blocks: list[dict] = []
        for block in content:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                text = block["text"]
                encoded = text.encode("utf-8")
                if len(encoded) > _CONTENT_BYTE_LIMIT:
                    truncated = encoded[:_CONTENT_BYTE_LIMIT].decode(
                        "utf-8", errors="ignore"
                    )
                    truncated += f"\n\n[truncated; {len(encoded)} bytes]"
                    new_block = dict(block)
                    new_block["text"] = truncated
                    new_blocks.append(new_block)
                    mutated = True
                    continue
            new_blocks.append(block)
        if mutated:
            out = dict(entry)
            out_msg = dict(msg)
            out_msg["content"] = new_blocks
            out["message"] = out_msg
            return out

    return entry


def _iso_from_epoch_ms(value) -> str | None:
    """Convert a sidecar epoch-ms timestamp to ISO-8601 UTC.

    Returns ``None`` for missing / non-numeric / zero values so the
    caller can fall back to the message-derived timestamp.
    """
    if not value:
        return None
    try:
        return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None
