"""Tests for ``backend.parsing.parse_datetime``.

This module is the consolidated home for the ``_parse_datetime`` helper
that previously lived (in identical form) in both
``backend.claude_code_reader`` and ``backend.store``. ``backend.search``
still imports ``_parse_datetime`` from ``backend.store`` at 8 call
sites, so both modules retain an aliased re-export.

Locked-in behavior (preserved from the pre-refactor implementations):

* Empty / ``None`` / unparseable input returns
  ``datetime.now(timezone.utc)`` — NOT ``None``. This is intentional so
  downstream consumers always have a tz-aware ``datetime``.
* A trailing ``"Z"`` is rewritten to ``"+00:00"`` before
  ``datetime.fromisoformat`` is called (works identically on Python
  3.10–3.12).
* A successfully-parsed naive datetime is tagged ``timezone.utc``.
* A successfully-parsed datetime with an explicit non-UTC offset is
  returned unchanged (the offset is preserved, NOT converted to UTC).
* Only ``ValueError`` is caught — bit-for-bit parity with the prior
  implementations. Exception-widening is deferred follow-up work.
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta

import backend.parsing as parsing
from backend import claude_code_reader, store


_NOW_TOLERANCE = timedelta(seconds=5)


def _is_close_to_now_utc(dt: datetime) -> bool:
    """True if ``dt`` is tz-aware UTC and within _NOW_TOLERANCE of now."""
    if dt.tzinfo is None:
        return False
    now = datetime.now(timezone.utc)
    return abs(now - dt) <= _NOW_TOLERANCE


def test_parse_datetime_none_returns_now_utc():
    """``None`` input falls back to current UTC time (NOT ``None``)."""
    result = parsing.parse_datetime(None)
    assert isinstance(result, datetime)
    assert result.tzinfo is not None
    assert _is_close_to_now_utc(result)


def test_parse_datetime_empty_string_returns_now_utc():
    """Empty string falls back to current UTC time."""
    result = parsing.parse_datetime("")
    assert isinstance(result, datetime)
    assert result.tzinfo is not None
    assert _is_close_to_now_utc(result)


def test_parse_datetime_iso_with_z_suffix():
    """Z-suffixed ISO strings parse as tz-aware UTC."""
    result = parsing.parse_datetime("2025-01-15T10:30:00Z")
    assert result.year == 2025
    assert result.month == 1
    assert result.day == 15
    assert result.hour == 10
    assert result.minute == 30
    assert result.second == 0
    # Z → +00:00 → tz-aware UTC
    assert result.tzinfo is not None
    assert result.utcoffset() == timedelta(0)


def test_parse_datetime_naive_iso_gets_utc_tagged():
    """A naive ISO string (no offset) gets ``timezone.utc`` attached."""
    result = parsing.parse_datetime("2025-01-15T10:30:00")
    assert result.year == 2025
    assert result.month == 1
    assert result.day == 15
    assert result.hour == 10
    assert result.minute == 30
    assert result.tzinfo is timezone.utc


def test_parse_datetime_explicit_non_utc_offset_preserved():
    """Non-UTC offsets are preserved (NOT silently converted to UTC).

    Locks in current behavior so a future "fix" doesn't change it.
    """
    result = parsing.parse_datetime("2025-01-15T10:30:00+04:00")
    assert result.year == 2025
    assert result.month == 1
    assert result.day == 15
    assert result.hour == 10
    assert result.minute == 30
    # Offset is preserved, not normalized to UTC.
    assert result.utcoffset() == timedelta(hours=4)


def test_parse_datetime_unparseable_returns_now_utc():
    """Garbage input does not raise; falls back to current UTC time."""
    result = parsing.parse_datetime("not a date")
    assert isinstance(result, datetime)
    assert _is_close_to_now_utc(result)


def test_parse_datetime_trailing_whitespace_falls_back():
    """Trailing whitespace defeats the .endswith('Z') swap and
    ``fromisoformat`` rejects it, so we fall back to now(UTC)."""
    result = parsing.parse_datetime("2025-01-15T10:30:00Z ")
    assert isinstance(result, datetime)
    assert _is_close_to_now_utc(result)


def test_aliases_are_same_object_as_parsing_function():
    """Both modules re-export the canonical function via aliasing.

    The ``_parse_datetime`` symbols in ``backend.claude_code_reader``
    and ``backend.store`` MUST be the same callable object as
    ``backend.parsing.parse_datetime`` — not wrappers. ``backend.search``
    imports ``_parse_datetime`` from ``backend.store`` and that path
    must continue to resolve to the single canonical implementation.
    """
    assert claude_code_reader._parse_datetime is parsing.parse_datetime
    assert store._parse_datetime is parsing.parse_datetime
