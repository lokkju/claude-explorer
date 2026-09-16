"""PDF export must not read images from outside the CC image cache.

Found 2026-09-16. The absolute path in a ``[Image: source: <abs-path>]``
marker comes out of MESSAGE TEXT — `CC_IMAGE_MARKER_RE` in
``backend/exporters/_shared.py`` matches the literal string anywhere in a
message body, so anything that can put that string into a conversation
names the file. The browser route (`/api/files/cc-image`) has always
validated containment against the image-cache root, and the markdown
BUNDLE exporter has `_image_marker_path_is_safe` for the same reason.
The PDF exporter's `_resolve_cc_image_path` had no check at all:

    candidate = Path(abs_path).expanduser()
    if candidate.is_file():
        return candidate

so `[Image: source: ~/.claude-explorer/credentials.json]` in any message
embedded the session key's bytes into the exported PDF — a file users
export specifically in order to send to other people.

``backend/exporters/pdf.py`` already reasons about this exact class for
URL schemes ("would turn any HTML-injection vector in a user-controlled
field into SSRF + arbitrary-file-read during PDF render"); the cc-image
branch was simply missed.
"""
from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def cc_env(tmp_path, monkeypatch):
    """Isolated CLAUDE_DIR + data dir, with a secret sitting outside the
    image cache."""
    claude_dir = tmp_path / "claude"
    (claude_dir / "image-cache" / "sess-1").mkdir(parents=True)
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setenv("CLAUDE_DIR", str(claude_dir))
    monkeypatch.setenv("CLAUDE_EXPLORER_DATA_DIR", str(data_dir))
    from backend import config as cfg

    cfg.get_settings.cache_clear()  # type: ignore[attr-defined]

    legit = claude_dir / "image-cache" / "sess-1" / "1.png"
    legit.write_bytes(b"\x89PNG-legit-bytes")
    secret = tmp_path / "credentials.json"
    secret.write_bytes(b'{"sessionKey": "sk-ant-sid01-EXFILTRATED"}')

    yield {
        "claude_dir": claude_dir,
        "legit": legit,
        "secret": secret,
        "image_cache": claude_dir / "image-cache",
    }
    cfg.get_settings.cache_clear()  # type: ignore[attr-defined]


def test_marker_outside_image_cache_is_refused(cc_env) -> None:
    """The headline case: a marker naming the credentials file.

    Bug it would surface: `_resolve_cc_image_path` returning any
    absolute path that happens to exist.
    """
    from backend.exporters.pdf import _resolve_cc_image_path

    assert _resolve_cc_image_path(str(cc_env["secret"])) is None


@pytest.mark.parametrize("probe", ["/etc/passwd", "/etc/hostname"])
def test_system_files_are_refused(cc_env, probe: str) -> None:
    from backend.exporters.pdf import _resolve_cc_image_path

    if not Path(probe).is_file():
        pytest.skip(f"{probe} not present on this host")
    assert _resolve_cc_image_path(probe) is None


def test_traversal_out_of_the_cache_is_refused(cc_env) -> None:
    """A path that starts inside the cache but walks out of it."""
    from backend.exporters.pdf import _resolve_cc_image_path

    escape = cc_env["image_cache"] / "sess-1" / ".." / ".." / ".." / "credentials.json"
    assert _resolve_cc_image_path(str(escape)) is None


def test_legitimate_cached_image_still_resolves(cc_env) -> None:
    """The fix must not break real image export."""
    from backend.exporters.pdf import _resolve_cc_image_path

    got = _resolve_cc_image_path(str(cc_env["legit"]))
    assert got is not None
    assert got.read_bytes() == b"\x89PNG-legit-bytes"


def test_url_fetcher_returns_placeholder_not_secret_bytes(cc_env) -> None:
    """End of the chain: the WeasyPrint fetcher must hand back the 1x1
    placeholder for an out-of-root marker, never the file's bytes."""
    from backend.exporters.pdf import _TRANSPARENT_1x1_PNG, _build_pdf_url_fetcher
    from backend.models import ConversationDetail

    conv = ConversationDetail(
        uuid="conv-1",
        name="c",
        summary="",
        model="",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
        chat_messages=[],
    )
    fetcher = _build_pdf_url_fetcher(conv)

    import urllib.parse

    url = "/api/cc-image?path=" + urllib.parse.quote(str(cc_env["secret"]))
    got = fetcher(url)

    assert got["string"] == _TRANSPARENT_1x1_PNG
    assert b"EXFILTRATED" not in got["string"]


def test_url_fetcher_still_serves_a_real_image(cc_env) -> None:
    from backend.exporters.pdf import _build_pdf_url_fetcher
    from backend.models import ConversationDetail

    conv = ConversationDetail(
        uuid="conv-1",
        name="c",
        summary="",
        model="",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
        chat_messages=[],
    )
    fetcher = _build_pdf_url_fetcher(conv)

    import urllib.parse

    url = "/api/cc-image?path=" + urllib.parse.quote(str(cc_env["legit"]))
    assert fetcher(url)["string"] == b"\x89PNG-legit-bytes"
