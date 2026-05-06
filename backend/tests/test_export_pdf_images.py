"""Phase 5: PDF export must embed real image bytes, not blank placeholders.

Two failure modes today:

* ``[Image: source: <abs-path>]`` text markers are escaped as plain text,
  never converted to ``<img>``.
* Even when an ``<img>`` exists, ``WeasyPrint.HTML(string=..)`` cannot
  fetch ``/api/cc-image?path=<abs>`` — there's no HTTP server context.

Fix: rewrite markers to ``<img src=...>`` and pass a ``url_fetcher``
callback that reads bytes from disk.

These tests verify the bytes that land in the PDF actually match the
fixture image, not just that *some* image stream exists (WeasyPrint
emits valid streams for broken-image icons, which would falsely pass).
"""

from __future__ import annotations

import io
import zlib
from datetime import datetime
from pathlib import Path

import pytest

from backend.export import create_pdf
from backend.models import ConversationDetail, Message


# A deterministic 2x1 PNG with two unique RGB pixels:
#   pixel 0 = (0xAB, 0xCD, 0xEF)
#   pixel 1 = (0x12, 0x34, 0x56)
#
# We pick distinctive colors so that after WeasyPrint decodes the PNG
# and re-encodes it as a FlateDecode RGB stream inside the PDF, the
# concatenated pixel bytes still appear verbatim in the decompressed
# image data — giving us a content-level check that the *real* fixture
# was embedded, not a 1x1 transparent placeholder for a missing file.
_FIXTURE_PNG = bytes.fromhex(
    "89504e470d0a1a0a"
    "0000000d49484452000000020000000108020000007b40e8dd"
    "0000000f49444154789c63587df6bd904918000cba03049f4768ab"
    "0000000049454e44ae426082"
)
_FIXTURE_PIXELS = bytes([0xAB, 0xCD, 0xEF, 0x12, 0x34, 0x56])


def _has_pypdf() -> bool:
    try:
        import pypdf  # noqa: F401

        return True
    except ImportError:
        return False


def _extract_image_xobjects(pdf_bytes: bytes) -> list[dict]:
    """Walk a PDF and return per-image dicts with width/height + the
    flate-decompressed raw pixel bytes.
    """
    import pypdf

    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    out: list[dict] = []
    for page in reader.pages:
        resources = page.get("/Resources")
        if resources is None:
            continue
        xobjects = resources.get("/XObject") if hasattr(resources, "get") else None
        if not xobjects:
            continue
        try:
            xobjects = xobjects.get_object()
        except AttributeError:
            pass
        for name in xobjects:
            obj = xobjects[name]
            try:
                obj = obj.get_object()
            except AttributeError:
                pass
            if obj.get("/Subtype") != "/Image":
                continue
            raw = getattr(obj, "_data", b"") or b""
            decompressed = b""
            if obj.get("/Filter") == "/FlateDecode":
                try:
                    decompressed = zlib.decompress(raw)
                except zlib.error:
                    decompressed = b""
            out.append(
                {
                    "width": obj.get("/Width"),
                    "height": obj.get("/Height"),
                    "filter": obj.get("/Filter"),
                    "raw": raw,
                    "decompressed": decompressed,
                }
            )
    return out


def _make_conversation(text: str, message_uuid: str = "m1") -> ConversationDetail:
    msg = Message(
        uuid=message_uuid,
        sender="human",
        text=text,
        content=[],
        created_at=datetime(2026, 5, 1, 12, 0),
        updated_at=datetime(2026, 5, 1, 12, 0),
        files=[],
        files_v2=[],
    )
    return ConversationDetail(
        uuid="c-fixture",
        name="PDF image fixture",
        summary="",
        model="claude",
        created_at=datetime(2026, 5, 1, 12, 0),
        updated_at=datetime(2026, 5, 1, 12, 0),
        message_count=1,
        human_message_count=1,
        current_leaf_message_uuid=message_uuid,
        messages=[msg],
    )


@pytest.mark.skipif(not _has_pypdf(), reason="pypdf required to inspect PDF streams")
def test_pdf_embeds_marker_image_bytes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Marker `[Image: source: <abs>]` must produce a PDF whose image
    stream contains the fixture PNG bytes — i.e. WeasyPrint successfully
    fetched and embedded the on-disk file rather than rendering a
    broken-image placeholder."""
    # Place the fixture under a dir we point CLAUDE_DIR at, so the
    # url_fetcher's safety check (path must live under image-cache root)
    # accepts it.
    claude_dir = tmp_path / "claude"
    image_cache = claude_dir / "image-cache" / "sess-abc"
    image_cache.mkdir(parents=True)
    fixture = image_cache / "1.png"
    fixture.write_bytes(_FIXTURE_PNG)

    monkeypatch.setenv("CLAUDE_DIR", str(claude_dir))
    # Reset cached settings so the new env var takes effect.
    from backend.config import get_settings

    get_settings.cache_clear()  # type: ignore[attr-defined]

    conv = _make_conversation(f"Look at this: [Image: source: {fixture}]")
    pdf_bytes = create_pdf(conv)
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF")

    images = _extract_image_xobjects(pdf_bytes)
    assert images, "PDF contained no image XObject streams at all"

    # WeasyPrint decodes the source PNG to raw RGB and re-encodes it as
    # a FlateDecode XObject in the PDF. To prove the *real* fixture was
    # embedded (not a 1x1 transparent placeholder for a missing file),
    # we look for an XObject with our 2x1 dimensions whose decompressed
    # stream contains the fixture's pixel bytes verbatim.
    matched = [
        img
        for img in images
        if img["width"] == 2
        and img["height"] == 1
        and _FIXTURE_PIXELS in img["decompressed"]
    ]
    assert matched, (
        "No image stream in the PDF matched the fixture pixel bytes. "
        "WeasyPrint likely rendered a broken-image placeholder. "
        f"Saw images: {[(i['width'], i['height'], i['filter']) for i in images]}"
    )


def test_pdf_missing_marker_renders_cleanly(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A marker pointing at a non-existent path must NOT raise. The PDF
    can render a placeholder; we only require a non-empty bytes return."""
    claude_dir = tmp_path / "claude"
    (claude_dir / "image-cache").mkdir(parents=True)
    monkeypatch.setenv("CLAUDE_DIR", str(claude_dir))
    from backend.config import get_settings

    get_settings.cache_clear()  # type: ignore[attr-defined]

    ghost = claude_dir / "image-cache" / "sess-zzz" / "9.png"
    conv = _make_conversation(f"Where? [Image: source: {ghost}]")

    pdf_bytes = create_pdf(conv)
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0
    assert pdf_bytes.startswith(b"%PDF")
