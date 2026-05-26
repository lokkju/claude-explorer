"""Exporters package — Markdown / PDF / bundle surfaces split out of the
former monolithic ``backend.export`` (Council A2, 2026-05-21).

Backwards-compatible imports continue to work via ``backend.export``,
which re-exports every symbol from the submodules here. Tests and the
router import from ``backend.export``; that public surface is pinned.
New code should prefer the submodule it actually uses.

Module layout:

* ``_shared``   — pure helpers shared by every surface (filename safety,
                  timestamps, HTML escape, ``filter_tool_placeholders``,
                  ``message_has_visible_content``, file dedupe).
* ``markdown``  — ``conversation_to_markdown``, ``message_to_markdown``,
                  ``create_markdown_zip``, etc.
* ``pdf``       — ``conversation_to_html``, ``create_pdf``, plus the
                  WeasyPrint url_fetcher and on-disk image resolvers.
* ``bundle``    — ``create_markdown_bundle`` and friends.

Hard rule: ``exporters/*.py`` MUST NOT import ``backend.export`` — that
would create a cycle (the facade imports from this package).
"""
