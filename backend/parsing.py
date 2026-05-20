"""Shared parsing helpers for Claude's on-disk JSON formats.

Currently houses ``parse_datetime``, the canonical implementation of
the timestamp-string parser that previously lived (identically) in
both ``backend.claude_code_reader`` and ``backend.store``. Those
modules now re-export the function under their original underscore-
prefixed name (``_parse_datetime``) so existing import paths — most
notably ``from .store import _parse_datetime`` used by
``backend.search`` at 8 call sites — keep working unchanged.

Deliberate behavior preserved from the pre-refactor implementations
(do NOT "fix" without reading the call sites first):

* Empty / ``None`` / unparseable input returns
  ``datetime.now(timezone.utc)``, NOT ``None``. Downstream consumers
  (search ranking, conversation list rendering, summary cache) rely
  on always receiving a tz-aware ``datetime`` and have no codepath
  for ``None``. The return type is ``datetime``, not
  ``Optional[datetime]``.
* Only ``ValueError`` is caught. Other exceptions (e.g.
  ``AttributeError`` from a non-string truthy input) propagate. Bit-
  for-bit parity with the prior implementations; widening is a
  separate concern.
"""

from __future__ import annotations

from datetime import datetime, timezone


def parse_datetime(dt_str: str | None) -> datetime:
    """Parse a datetime string from Claude's JSON / JSONL formats.

    Accepts the ISO-8601 shapes Claude actually emits:

    * ``"2025-01-15T10:30:00Z"`` — Z-suffixed UTC. The ``"Z"`` is
      rewritten to ``"+00:00"`` before ``datetime.fromisoformat`` is
      called so this works identically on Python 3.10–3.12.
    * ``"2025-01-15T10:30:00+04:00"`` — explicit offset, preserved
      as-is (not normalized to UTC).
    * ``"2025-01-15T10:30:00"`` — naive; ``timezone.utc`` is attached.

    Returns ``datetime.now(timezone.utc)`` for ``None``, empty string,
    or any ``ValueError`` raised by ``fromisoformat``. See the module
    docstring for why the fallback is "now in UTC" rather than
    ``None``.
    """
    if not dt_str:
        return datetime.now(timezone.utc)
    try:
        if dt_str.endswith("Z"):
            dt_str = dt_str[:-1] + "+00:00"
        dt = datetime.fromisoformat(dt_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return datetime.now(timezone.utc)
