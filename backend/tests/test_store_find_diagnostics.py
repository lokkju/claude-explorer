"""Diagnostic-log regression test for ``ConversationStore._find_conversation_data``.

Pins the C3 silent-swallow fix from the 2026-05-21 LLM council code-review
sweep (Categories C correctness + F hygiene, scope=backend).

PRIOR FAILURE MODE
==================
``backend/store.py:651-654`` had::

    try:
        summary = read_conversation_summary_fast(jsonl_path)
    except Exception:
        continue

The bare ``continue`` swallowed every parse failure with **zero
diagnostics**. A user resolving a UUID where one JSONL on disk had
just been partial-written or was permission-flipped would see a
generic "Conversation not found" with no breadcrumb. The fallback
loop's leading comment (``# Final fallback ... never silently
returns 404 when the data IS on disk``) is correct as-written — but
when the read RAISES (rather than returns ``None``), that contract
was being broken silently.

FIX
===
``logger.warning("Failed to read Claude Code summary for %s while
resolving uuid=%s", jsonl_path, uuid, exc_info=True)`` then
``continue``. Behavior-preserving (still skips the failing file and
keeps scanning) but the operator can now see which file failed and
why.

TEST DESIGN
===========
Bidirectional pair:

* ``test_find_logs_warning_when_summary_read_raises`` — the must-MATCH
  test. Forces ``read_conversation_summary_fast`` to raise on one
  file; asserts a WARNING log with the failing path and ``exc_info``.
* ``test_find_does_not_log_when_summary_reads_succeed`` — the
  must-NOT-MATCH (boundary) test. Same code path, no raise; asserts
  no spurious WARNING.

Both tests pin the fallback loop, not the summary-cache fast path,
by forcing ``get_summary_cache()`` to return ``None`` so the cached
``summary_cache.get_many()`` branch is bypassed.
"""

from __future__ import annotations

import logging
from pathlib import Path

import pytest

from backend.store import ConversationStore


@pytest.fixture
def isolated_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ConversationStore:
    """A ConversationStore pointed at an isolated tmp_path so the
    fallback loop is the ONLY path that touches our fake JSONLs.

    We force:
      * no Claude Desktop JSON files (empty conversations_dir),
      * no summary_cache (so the fallback loop is reached),
      * ``discover_jsonl_files`` to return our two fake paths.
    """
    # Empty conversations dir → desktop-JSON pass returns nothing.
    conv_dir = tmp_path / "conversations"
    conv_dir.mkdir()

    # Fake CC root.
    cc_dir = tmp_path / "claude"
    (cc_dir / "projects").mkdir(parents=True)

    store = ConversationStore(
        data_dir=conv_dir,
        claude_dir=cc_dir,
    )

    # Force summary_cache to None so we always reach the fallback loop.
    monkeypatch.setattr(
        "backend.summary_cache.get_summary_cache",
        lambda: None,
    )
    return store


def _fake_paths(tmp_path: Path) -> tuple[Path, Path]:
    """Return two fake JSONL paths with stems != target uuid (so the
    fast Pass-A is skipped) and not equal to each other.
    """
    bad = tmp_path / "claude" / "projects" / "bad-session-uuid.jsonl"
    good = tmp_path / "claude" / "projects" / "good-session-uuid.jsonl"
    bad.write_text("placeholder")  # content irrelevant — we monkeypatch the reader
    good.write_text("placeholder")
    return bad, good


def test_find_logs_warning_when_summary_read_raises(
    isolated_store: ConversationStore,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """RED test: forcing the fallback summary reader to raise on one
    file MUST emit a WARNING that includes the failing path.

    Before the fix: caplog has 0 WARNINGs from backend.store → FAIL.
    After the fix:  caplog has 1 WARNING mentioning the bad path.
    """
    target_uuid = "target-uuid-xyz"
    bad, good = _fake_paths(tmp_path)

    # Both files participate in the fallback scan; one raises, the
    # other returns a non-matching summary so the loop also doesn't
    # short-circuit on a successful match (we want to prove the
    # warning fires INDEPENDENT of whether the loop ever finds a
    # match).
    def fake_summary(path: Path) -> dict | None:
        if path == bad:
            raise RuntimeError("simulated CC JSONL parse failure")
        return {"uuid": "some-other-uuid"}

    # Patch at the import site used inside _find_conversation_data
    # (which does a local import: `from .cc_jsonl_io import
    # read_conversation_summary_fast`).
    monkeypatch.setattr(
        "backend.cc_jsonl_io.read_conversation_summary_fast",
        fake_summary,
    )
    # discover_jsonl_files is imported at module scope in backend.store
    # so we patch it on the store module.
    monkeypatch.setattr(
        "backend.store.discover_jsonl_files",
        lambda _claude_dir: [bad, good],
    )

    with caplog.at_level(logging.WARNING, logger="backend.store"):
        result_data, result_path = isolated_store._find_conversation_data(target_uuid)

    # Behavior-preserving: the loop still returns (None, None) since
    # neither file matched the target uuid. The fix only added
    # diagnostics; it did not change the return value.
    assert result_data is None
    assert result_path is None

    # Diagnostic invariant: at least one WARNING from backend.store
    # mentioning the failing JSONL path.
    warnings = [
        rec for rec in caplog.records
        if rec.levelno == logging.WARNING and rec.name == "backend.store"
    ]
    assert warnings, (
        "Expected backend.store to log a WARNING when the fallback "
        "summary read raised. Got no WARNINGs — silent-swallow bug "
        "has regressed."
    )
    assert any("bad-session-uuid.jsonl" in rec.getMessage() for rec in warnings), (
        f"Expected WARNING message to mention the failing path "
        f"'bad-session-uuid.jsonl', got: {[r.getMessage() for r in warnings]}"
    )
    # exc_info must be attached so operators can see WHICH exception
    # type fired (decode vs permission vs upstream regression).
    assert any(rec.exc_info is not None for rec in warnings), (
        "Expected at least one WARNING to carry exc_info — the "
        "exception type is the load-bearing diagnostic signal."
    )


def test_find_does_not_log_when_summary_reads_succeed(
    isolated_store: ConversationStore,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Boundary / must-NOT-match test: when no summary reads raise,
    backend.store MUST NOT emit any WARNINGs.

    Pins the "minimal-diff fix" property: we only log on the failure
    path. Healthy operation must not become noisy.
    """
    target_uuid = "target-uuid-xyz"
    bad, good = _fake_paths(tmp_path)

    monkeypatch.setattr(
        "backend.cc_jsonl_io.read_conversation_summary_fast",
        lambda _path: {"uuid": "some-other-uuid"},
    )
    monkeypatch.setattr(
        "backend.store.discover_jsonl_files",
        lambda _claude_dir: [bad, good],
    )

    with caplog.at_level(logging.WARNING, logger="backend.store"):
        result_data, result_path = isolated_store._find_conversation_data(target_uuid)

    assert result_data is None
    assert result_path is None

    warnings = [
        rec for rec in caplog.records
        if rec.levelno == logging.WARNING and rec.name == "backend.store"
    ]
    assert not warnings, (
        f"Expected zero WARNINGs from backend.store on the success "
        f"path; got {len(warnings)}: {[r.getMessage() for r in warnings]}"
    )
