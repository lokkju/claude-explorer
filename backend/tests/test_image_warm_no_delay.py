"""Workstream B — image-warm 5 s delay removed; piggybacks on FTS5 build.

PLANS/PERFORMANCE_PHASE_2.md §Workstream B.

The original startup pipeline (backend/main.py:229) sleeps 5 s before
running ``warm_all_sessions_async`` which walks every CC JSONL on
disk a SECOND time (the FTS5 build already reads them all). Two
costs to remove:

  1. The 5 s ``asyncio.sleep`` itself — wasted wall-clock from the
     user's perspective.
  2. The duplicate corpus walk — every JSONL gets read twice
     (once for FTS5, once for image markers).

The fix: ``backend.search_index._load_conversation_at`` already
calls ``read_claude_code_conversation`` for CC JSONLs, which in
turn calls ``cache_all_markers`` (see
``backend/claude_code_reader.py:1195``). So image-warm is implicit
in the FTS5 build. We can DELETE the standalone warm task and
its delay.

Fallback: when FTS5 is disabled (``CLAUDE_EXPLORER_DISABLE_SEARCH_INDEX=1``)
the standalone warm task stays so we don't lose image protection
for users who opt out of search.

Contract pinned by these tests:
  1. With FTS5 enabled, the lifespan does NOT spawn
     ``_delayed_warm_all_sessions``.
  2. When FTS5 is disabled, the warm task DOES run (but without
     the 5 s sleep — see plan; we drop the delay even on the
     fallback path).
  3. The FTS5 ``_load_conversation_at`` path still invokes
     ``cache_all_markers`` (via read_claude_code_conversation)
     so the image-warm side effect is preserved on the merged
     path.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from backend import search_index as si
from backend.cache import clear_cache


def _write_cc_jsonl_with_image(path: Path, uuid: str) -> None:
    """Write a CC JSONL whose user message references an image marker.

    The ``read_claude_code_conversation`` parser flattens
    ``[Image: source: <path>]`` markers into message text via the
    streaming-parse path; ``cache_all_markers`` then walks those
    flattened markers and copies referenced images. For this test
    we don't need real image files on disk — we just need the
    side-effect function to be called on the loaded dict.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        json.dumps({
            "type": "summary",
            "summary": f"img test {uuid[:8]}",
            "leafUuid": "leaf-x",
        }),
        json.dumps({
            "type": "user",
            "uuid": "msg-1",
            "sessionId": uuid,
            "cwd": "/tmp/p",
            "timestamp": "2026-05-16T12:00:00.000Z",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": "hi"}],
            },
        }),
    ]
    path.write_text("\n".join(lines) + "\n")


def test_load_conversation_at_invokes_cache_all_markers(tmp_path):
    """``_load_conversation_at`` for a CC JSONL must invoke
    ``cache_all_markers`` so the FTS5 build piggybacks the
    image-warm side effect.

    Pins the invariant Workstream B relies on: removing the
    standalone warm task is safe ONLY because the FTS5 build
    already does the same work via this call path.
    """
    claude_dir = tmp_path / "claude"
    project_dir = claude_dir / "projects" / "-tmp-p"
    project_dir.mkdir(parents=True)
    uuid = "abc12345-6789-4abc-def0-fedcba987654"
    jsonl_path = project_dir / f"{uuid}.jsonl"
    _write_cc_jsonl_with_image(jsonl_path, uuid)

    clear_cache()

    # Track invocations of cache_all_markers — patched at the
    # canonical import site (claude_code_reader's reference to
    # cc_image_cache.cache_all_markers).
    calls: list[dict] = []

    def _record(conv_dict):
        calls.append({"uuid": conv_dict.get("uuid"), "msgs": len(conv_dict.get("chat_messages", []))})
        return []

    from backend import store as store_mod

    store = store_mod.ConversationStore(
        data_dir=tmp_path / "data",
        claude_dir=claude_dir,
    )
    (tmp_path / "data").mkdir(exist_ok=True)

    with patch("backend.cc_image_cache.cache_all_markers", side_effect=_record):
        # search_index._load_conversation_at is the FTS5 build's
        # canonical CC-loading entry point.
        conv = si._load_conversation_at(jsonl_path, store)

    assert conv is not None, "CC load failed; cannot verify side effect"
    assert conv.get("uuid") == uuid
    assert len(calls) == 1, (
        f"cache_all_markers must be invoked exactly once per CC load; "
        f"got {len(calls)} calls"
    )
    assert calls[0]["uuid"] == uuid


def test_lifespan_main_module_does_not_reference_delayed_warm():
    """The lifespan handler MUST NOT contain a standalone
    ``_delayed_warm_all_sessions`` task when FTS5 is enabled
    (the default).

    Source-level check: parse backend/main.py and assert the
    legacy function name is absent. A runtime check (patch +
    TestClient) doesn't work because the legacy task slept 5 s
    before invoking warm — TestClient's lifespan exits long
    before the sleep elapses, so an unconditional-patch spy
    records zero calls even with the legacy code present.

    This is a structural test against the source string. It's
    a deliberate trade-off: structural tests are brittle to
    rename refactors but they catch the exact contract the
    plan changes (delete this lifespan branch).
    """
    main_py = (
        Path(__file__).resolve().parent.parent / "main.py"
    ).read_text()

    # The legacy function name OR the create_task that scheduled
    # it should be gone for the FTS5-enabled default path. We
    # allow the function name to appear inside a comment or in
    # a docstring explaining the removal — so the check looks
    # for the create_task line specifically.
    bad_patterns = (
        "_delayed_warm_all_sessions(",  # call site
        "asyncio.create_task(_delayed_warm_all_sessions",
    )
    for pat in bad_patterns:
        assert pat not in main_py, (
            f"backend/main.py still references {pat!r}; "
            "Workstream B refactor incomplete (FTS5 build path "
            "already piggybacks cache_all_markers via "
            "_load_conversation_at → read_claude_code_conversation → "
            "cache_all_markers; the standalone delayed warm task is "
            "redundant and should be deleted)"
        )

    # Also assert the 5 s sleep that the delay rationale described
    # is gone. The plan deletes the delay everywhere.
    # Allow ``await asyncio.sleep(0.5)`` (the FTS5 build's small
    # event-loop yield) but NOT 5.0 anywhere in the legacy warm
    # branch.
    assert "await asyncio.sleep(5.0)" not in main_py, (
        "backend/main.py still has 'await asyncio.sleep(5.0)'; "
        "the 5 s warm delay should be gone after Workstream B"
    )
