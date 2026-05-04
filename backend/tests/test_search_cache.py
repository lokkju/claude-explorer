"""Issue #0 — Desktop conversation search must reuse a cache between calls.

Before this fix, ConversationStore._load_conversation re-read every JSON
file from disk and re-parsed it on every search request. With ~100+
Desktop conversations, that's ~100 syscalls + ~100 json.load() calls
per keystroke (after the 200ms debounce in the frontend). The Claude
Code path already used backend.cache.FileCache with mtime-based
invalidation; this regression test pins that the same cache is used
for Desktop JSON files.

The benchmark angle:
  * Cold call (first search after disk write): full read-and-parse.
  * Warm call (no file changes): fully served from memory cache; the
    JSON loader is NOT invoked.

We assert the second call doesn't touch the loader at all by patching
json.load (and orjson.loads if used). Mtime-based invalidation is
spot-checked by writing the file again with a new mtime — the cache
must reload for that file only.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from backend.cache import clear_cache
from backend.search import search_conversations
from backend.store import ConversationStore


def _write_conv(path: Path, uuid: str, body: str) -> None:
    payload = {
        "uuid": uuid,
        "name": f"Conv {uuid}",
        "summary": "",
        "model": "claude-sonnet-4-6",
        "created_at": "2026-04-01T10:00:00Z",
        "updated_at": "2026-04-01T10:00:00Z",
        "is_starred": False,
        "is_temporary": False,
        "current_leaf_message_uuid": "m1",
        "chat_messages": [
            {
                "uuid": "m1",
                "sender": "human",
                "text": body,
                "content": [{"type": "text", "text": body}],
                "created_at": "2026-04-01T10:00:00Z",
                "updated_at": "2026-04-01T10:00:00Z",
                "parent_message_uuid": None,
            }
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


def test_desktop_search_reuses_cache_across_calls(tmp_path):
    """Two consecutive searches against unchanged files do exactly ONE
    set of disk reads.

    The second call must be served entirely from the in-memory cache:
    json.load and Path.read_bytes / open(...).read may NOT be called
    for any conversation file.
    """
    clear_cache()

    org_dir = tmp_path / "by-org" / "11111111-1111-1111-1111-111111111111"
    for i in range(5):
        _write_conv(
            org_dir / f"{i:08x}-0000-0000-0000-000000000000.json",
            f"{i:08x}-0000-0000-0000-000000000000",
            f"hello world body {i}",
        )

    # Empty claude_dir so we don't load Claude Code conversations.
    cc_dir = tmp_path / "claude-empty"
    cc_dir.mkdir()
    store = ConversationStore(data_dir=tmp_path, claude_dir=cc_dir)

    # First call — populates the cache.
    results1 = search_conversations(store, "hello world")
    assert len(results1) == 5

    # Second call — should be 100% cache hits. Patch the JSON loader
    # so any disk read raises immediately, surfacing the cache miss.
    def _boom(*args, **kwargs):
        raise AssertionError("loader called on warm cache call")

    with patch("backend.store.json.load", side_effect=_boom):
        results2 = search_conversations(store, "hello world")

    assert len(results2) == 5
    # Sanity: same conversations.
    assert {r.conversation_uuid for r in results1} == {
        r.conversation_uuid for r in results2
    }


def test_desktop_search_invalidates_cache_when_file_changes(tmp_path):
    """If a conversation file's mtime changes, only that file is
    re-read; everything else is still a cache hit."""
    clear_cache()

    org_dir = tmp_path / "by-org" / "11111111-1111-1111-1111-111111111111"
    paths = []
    for i in range(3):
        path = org_dir / f"{i:08x}-0000-0000-0000-000000000000.json"
        _write_conv(
            path,
            f"{i:08x}-0000-0000-0000-000000000000",
            f"alpha {i}",
        )
        paths.append(path)

    cc_dir = tmp_path / "claude-empty"
    cc_dir.mkdir()
    store = ConversationStore(data_dir=tmp_path, claude_dir=cc_dir)

    # Prime the cache.
    r1 = search_conversations(store, "alpha")
    assert len(r1) == 3

    # Mutate one file with a new mtime + new content.
    target = paths[1]
    _write_conv(target, target.stem, "beta one")
    # Bump mtime so the cache treats it as stale.
    import os
    import time

    new_mtime = time.time() + 10
    os.utime(target, (new_mtime, new_mtime))

    # Search for the new word — only the mutated file should be
    # re-read.
    load_calls: list[Path] = []
    real_json_load = json.load

    def _spy(fp, *args, **kwargs):
        # Path that was opened (best-effort: capture file path).
        load_calls.append(Path(fp.name))
        return real_json_load(fp, *args, **kwargs)

    with patch("backend.store.json.load", side_effect=_spy):
        r2 = search_conversations(store, "beta")

    assert len(r2) == 1
    assert r2[0].conversation_uuid == target.stem
    # The dirty file gets re-read; clean files stay cached.
    assert load_calls == [target], (
        f"Expected only the mutated file to reload, got: {load_calls}"
    )
