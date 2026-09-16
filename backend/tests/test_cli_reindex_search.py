"""``claude-explorer reindex-search`` must default to the non-destructive
drift pass.

See ``docs/notes/reindex-search-destructive-default.md``. The command
used to default to ``--full``, which calls ``clear_all()`` (DELETE from
messages / indexed_files / conversations) before rebuilding, while its
own docstring advertised idempotent, mtime-cheap re-runs — a claim only
the drift path has. A user reaching for "reindex" to repair a stale
index instead got a multi-minute wipe-and-rebuild during which search is
degraded, and, if enumeration was under-covering for any reason, lost the
rows it could not re-discover.
"""
from __future__ import annotations

from click.testing import CliRunner

from cli.main import main


class _FakeIndex:
    """Records whether the destructive wipe was invoked."""

    def __init__(self) -> None:
        self.cleared = 0

    def clear_all(self) -> None:
        self.cleared += 1


def _patch_index(monkeypatch, idx):
    """Point every symbol ``reindex_search`` imports at our fakes.

    The command does its imports inside the function body, so patching
    the source modules (not ``cli.main``) is what takes effect.
    """
    import backend.search_index as si
    import backend.store as store_mod

    monkeypatch.setattr(si, "get_search_index", lambda: idx)
    monkeypatch.setattr(store_mod, "ConversationStore", lambda *a, **k: object())
    return si


def test_default_runs_drift_and_never_wipes(monkeypatch) -> None:
    """Bare ``reindex-search`` must run the drift pass and leave the
    existing rows alone.

    Bug it would surface: a default that wipes. The assertion is on
    ``clear_all`` being untouched, not merely on drift being called —
    a regression that ran both would still be destructive.
    """
    idx = _FakeIndex()
    si = _patch_index(monkeypatch, idx)
    calls = []
    monkeypatch.setattr(
        si, "update_drifted_files", lambda store, index=None: calls.append("drift") or 3
    )
    monkeypatch.setattr(
        si, "build_full_index",
        lambda *a, **k: calls.append("full") or (0, 0),
    )

    res = CliRunner().invoke(main, ["reindex-search"])

    assert res.exit_code == 0, res.output
    assert idx.cleared == 0, (
        "the default reindex-search must not wipe the index; "
        f"clear_all() was called {idx.cleared} time(s)"
    )
    assert calls == ["drift"], f"expected the drift path only, got {calls}"
    assert "3" in res.output


def test_full_flag_wipes_and_rebuilds(monkeypatch) -> None:
    """``--full`` remains the explicit destructive escape hatch."""
    idx = _FakeIndex()
    si = _patch_index(monkeypatch, idx)
    calls = []
    monkeypatch.setattr(
        si, "update_drifted_files", lambda store, index=None: calls.append("drift") or 0
    )
    monkeypatch.setattr(
        si, "build_full_index",
        lambda *a, **k: calls.append("full") or (7, 42),
    )

    res = CliRunner().invoke(main, ["reindex-search", "--full"])

    assert res.exit_code == 0, res.output
    assert idx.cleared == 1
    assert calls == ["full"]
    assert "7" in res.output and "42" in res.output


def test_full_flag_warns_before_wiping(monkeypatch) -> None:
    """``--full`` must name the destructive effect in its output.

    Bug it would surface: a silent wipe. The user who hit this had no
    signal distinguishing a rebuild from a repair.
    """
    idx = _FakeIndex()
    si = _patch_index(monkeypatch, idx)
    monkeypatch.setattr(si, "update_drifted_files", lambda store, index=None: 0)
    monkeypatch.setattr(si, "build_full_index", lambda *a, **k: (1, 1))

    res = CliRunner().invoke(main, ["reindex-search", "--full"])

    out = res.output.lower()
    assert "warning" in out, f"--full must warn before wiping; got: {res.output!r}"
    assert "search is degraded" in out or "degraded" in out


def test_explicit_drift_flag_still_works(monkeypatch) -> None:
    """``--drift`` stays accepted so existing scripts don't break."""
    idx = _FakeIndex()
    si = _patch_index(monkeypatch, idx)
    monkeypatch.setattr(si, "update_drifted_files", lambda store, index=None: 5)
    monkeypatch.setattr(si, "build_full_index", lambda *a, **k: (0, 0))

    res = CliRunner().invoke(main, ["reindex-search", "--drift"])

    assert res.exit_code == 0, res.output
    assert idx.cleared == 0
    assert "5" in res.output
