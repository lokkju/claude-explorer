"""Tests for image-attachment rendering in Markdown export.

Phase 2 (article ↔ test coverage hardening): Markdown export must emit
image references for Message.files[] entries with file_kind='image'.
The "one truth, three surfaces" article promise (line 188) hangs on
parity between viewer, copy, and export.
"""

from datetime import datetime

from backend.export import (
    _dedupe_image_files,
    _image_markdown,
    message_has_visible_content,
    message_to_markdown,
)
from backend.models import Message


def _msg(**overrides) -> Message:
    base = dict(
        uuid="m1",
        sender="human",
        text="",
        content=[],
        created_at=datetime(2026, 4, 1, 10, 0),
        updated_at=datetime(2026, 4, 1, 10, 0),
        files=[],
        files_v2=[],
    )
    base.update(overrides)
    return Message(**base)


def _img(file_uuid: str, file_name: str, with_preview: bool = True) -> dict:
    file = {
        "file_kind": "image",
        "file_uuid": file_uuid,
        "file_name": file_name,
        "thumbnail_url": f"/api/test/files/{file_uuid}/thumbnail",
    }
    if with_preview:
        file["preview_asset"] = {
            "url": f"/api/test/files/{file_uuid}/preview",
            "primary_color": "f6f6f6",
            "image_width": 100,
            "image_height": 100,
        }
    return file


def test_dedupe_collapses_files_v1_v2_duplicates():
    img = _img("dupe", "x.png")
    msg = _msg(files=[img], files_v2=[img])
    deduped = _dedupe_image_files(msg)
    assert len(deduped) == 1
    assert deduped[0]["file_uuid"] == "dupe"


def test_dedupe_prefers_entry_with_preview_asset():
    bare = _img("p", "y.png", with_preview=False)
    rich = _img("p", "y.png", with_preview=True)
    # v1 has the bare entry, v2 has the rich one — prefer rich.
    msg = _msg(files=[bare], files_v2=[rich])
    deduped = _dedupe_image_files(msg)
    assert len(deduped) == 1
    assert "preview_asset" in deduped[0]


def test_dedupe_skips_non_image_file_kinds():
    msg = _msg(files=[
        _img("img", "i.png"),
        {"file_kind": "document", "file_uuid": "doc", "file_name": "spec.pdf"},
    ])
    deduped = _dedupe_image_files(msg)
    assert [d["file_uuid"] for d in deduped] == ["img"]


def test_image_markdown_emits_alt_and_url():
    msg = _msg(files=[_img("a", "screenshot.png")])
    md = _image_markdown(msg)
    assert "![Image attachment: screenshot.png](/api/test/files/a/preview)" in md


def test_image_markdown_handles_missing_url_gracefully():
    msg = _msg(files=[{"file_kind": "image", "file_uuid": "noUrl", "file_name": "ghost.png"}])
    md = _image_markdown(msg)
    assert "ghost.png" in md
    assert "unavailable" in md.lower()


def test_message_to_markdown_appends_image_refs_after_content():
    msg = _msg(text="here is a screenshot", content=[], files=[_img("s", "shot.png")])
    out = message_to_markdown(msg, include_tools=True)
    # Text first, then image ref.
    text_idx = out.index("here is a screenshot")
    img_idx = out.index("![Image attachment: shot.png]")
    assert text_idx < img_idx


def test_message_to_markdown_includes_images_even_when_tools_hidden():
    """Images are primary content (Council Q7); not gated by include_tools."""
    msg = _msg(text="hi", files=[_img("z", "z.png")])
    out_with_tools = message_to_markdown(msg, include_tools=True)
    out_without_tools = message_to_markdown(msg, include_tools=False)
    assert "z.png" in out_with_tools
    assert "z.png" in out_without_tools


def test_message_with_only_images_is_visible():
    """A message with no text/content but with image attachments must render."""
    msg = _msg(text="", content=[], files=[_img("only", "lone.png")])
    assert message_has_visible_content(msg, include_tools=True) is True
    assert message_has_visible_content(msg, include_tools=False) is True
