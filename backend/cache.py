"""
High-performance caching for Claude Code conversation files.

This module provides:
1. Memory cache with mtime-based invalidation
2. Parallel file reading with ThreadPoolExecutor
3. Fast JSON parsing with orjson
4. Optional LRU eviction cap (``max_entries``) to bound memory growth
   on long-running servers (see PLANS/PERFORMANCE_PHASE_2.md §C1 R8).
"""

import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import orjson


@dataclass
class CacheEntry:
    """A cached file entry with its modification time."""
    mtime: float
    data: Any


class FileCache:
    """Thread-safe file cache with mtime-based invalidation.

    When ``max_entries`` is set to a positive integer, the cache evicts
    the least-recently-used entry on insert past the cap. ``get`` hits
    promote the entry to most-recently-used so a hot conversation
    survives bursts of fresh reads.

    When ``max_entries`` is ``None`` (the default), the cache grows
    without bound — preserves the historical behavior for tests and
    call sites that haven't opted in to a cap.

    Threading: an ``RLock`` guards both the backing ``OrderedDict``
    and the LRU bookkeeping. ``get`` takes the lock to record the
    use, so concurrent readers serialize briefly. Acceptable for our
    workload (file I/O dominates).
    """

    def __init__(
        self,
        max_workers: int = 8,
        max_entries: int | None = None,
    ):
        # ``OrderedDict`` so we can call ``move_to_end`` for O(1) MRU
        # promotion and ``popitem(last=False)`` for O(1) LRU eviction.
        self._cache: OrderedDict[Path, CacheEntry] = OrderedDict()
        self._lock = threading.RLock()
        self._max_workers = max_workers
        if max_entries is not None and max_entries < 1:
            raise ValueError(
                f"max_entries must be >= 1 or None; got {max_entries!r}"
            )
        self._max_entries = max_entries

    def get(self, path: Path) -> tuple[Any | None, bool]:
        """Get cached data if still valid.

        Returns (data, is_valid) - if is_valid is False, data is stale/missing.

        On a HIT (entry present AND mtime matches), promotes the
        entry to most-recently-used so a hot path survives eviction
        under cap pressure. Stale/missing entries are NOT promoted
        (returning ``(data, False)`` signals "drop and reload").
        """
        with self._lock:
            entry = self._cache.get(path)
            if entry is None:
                return None, False

            try:
                current_mtime = path.stat().st_mtime
                if current_mtime == entry.mtime:
                    # Hit — promote to MRU end.
                    self._cache.move_to_end(path)
                    return entry.data, True
                # File changed, cache is stale; do NOT promote — the
                # caller will reload via set() which re-positions.
                return entry.data, False
            except OSError:
                # File no longer exists
                return None, False

    def set(self, path: Path, data: Any, mtime: float | None = None) -> None:
        """Cache data for a file.

        Inserts at the MRU end. If a cap is configured and the cache
        exceeds it after insert, evicts the LRU entry (the first item
        in the OrderedDict).
        """
        if mtime is None:
            try:
                mtime = path.stat().st_mtime
            except OSError:
                return  # Don't cache if we can't get mtime

        with self._lock:
            # If the key already exists, move_to_end after assignment
            # would be redundant — re-assigning a key in OrderedDict
            # does not reposition it. Pop-then-reinsert is the canonical
            # MRU-promotion pattern.
            if path in self._cache:
                del self._cache[path]
            self._cache[path] = CacheEntry(mtime=mtime, data=data)
            # Evict LRU entries until we're under the cap.
            if self._max_entries is not None:
                while len(self._cache) > self._max_entries:
                    self._cache.popitem(last=False)

    def invalidate(self, path: Path) -> None:
        """Remove a file from cache."""
        with self._lock:
            self._cache.pop(path, None)

    def clear(self) -> None:
        """Clear all cached data."""
        with self._lock:
            self._cache.clear()

    def get_or_load(
        self,
        path: Path,
        loader: Callable[[Path], Any],
    ) -> Any:
        """Get from cache or load using the provided function."""
        data, is_valid = self.get(path)
        if is_valid:
            return data

        # Load fresh data
        data = loader(path)
        if data is not None:
            self.set(path, data)
        return data

    def load_many_parallel(
        self,
        paths: list[Path],
        loader: Callable[[Path], Any],
    ) -> list[Any]:
        """Load multiple files in parallel, using cache where valid.

        Returns results in the same order as paths.
        """
        results: dict[int, Any] = {}
        paths_to_load: list[tuple[int, Path]] = []

        # Check cache first
        for i, path in enumerate(paths):
            data, is_valid = self.get(path)
            if is_valid:
                results[i] = data
            else:
                paths_to_load.append((i, path))

        # Load missing files in parallel
        if paths_to_load:
            with ThreadPoolExecutor(max_workers=self._max_workers) as executor:
                future_to_idx = {
                    executor.submit(self._load_and_cache, path, loader): idx
                    for idx, path in paths_to_load
                }
                for future in as_completed(future_to_idx):
                    idx = future_to_idx[future]
                    try:
                        results[idx] = future.result()
                    except Exception:
                        results[idx] = None

        # Return in order
        return [results.get(i) for i in range(len(paths))]

    def _load_and_cache(
        self,
        path: Path,
        loader: Callable[[Path], Any],
    ) -> Any:
        """Load a file and cache the result."""
        try:
            mtime = path.stat().st_mtime
            data = loader(path)
            if data is not None:
                self.set(path, data, mtime)
            return data
        except Exception:
            return None

    @property
    def stats(self) -> dict[str, int]:
        """Get cache statistics."""
        with self._lock:
            return {
                "entries": len(self._cache),
                "size_estimate_mb": sum(
                    len(str(e.data)) for e in self._cache.values()
                ) // (1024 * 1024),
            }


def parse_jsonl_fast(path: Path) -> list[dict]:
    """Parse a JSONL file using orjson for speed."""
    entries = []
    try:
        with open(path, "rb") as f:  # Binary mode for orjson
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = orjson.loads(line)
                    entries.append(entry)
                except orjson.JSONDecodeError:
                    pass
    except (OSError, IOError):
        pass
    return entries


def parse_jsonl_fast_limited(path: Path, max_lines: int = 30) -> list[dict]:
    """Parse only first N lines of a JSONL file using orjson."""
    entries = []
    lines_read = 0
    try:
        with open(path, "rb") as f:
            for line in f:
                lines_read += 1
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = orjson.loads(line)
                    entries.append(entry)
                except orjson.JSONDecodeError:
                    pass
                if lines_read >= max_lines:
                    break
    except (OSError, IOError):
        pass
    return entries


# Global cache instance - shared across requests.
#
# ``max_entries=64`` caps in-memory growth at ~64 parsed conversation
# dicts. The 64 most-recently-touched conversations cover virtually
# every interactive UI use case (sidebar of N, viewing 1-2 at a time,
# export of 1, FTS5 scatter-gather of a few dozen matches). The cap
# is a soft guarantee, not a correctness invariant — the cache is
# purely a perf optimization; cache misses fall back to a fresh
# disk read which is exactly the pre-cache behavior.
#
# Rationale for 64 (PLANS/PERFORMANCE_PHASE_2.md §C1 R8): on a
# heavy CC corpus the largest sessions are ~300 MB on disk and the
# parsed dict is ~1.5-2x that in memory. 10 such heavy sessions
# cached simultaneously would be ~5 GB, too high. But typical CC
# sessions are <5 MB; 64 entries at typical mean ~150 MB resident,
# bounded. If a user opens 64 heavy sessions in sequence we cap at
# ~30 GB which is still high — but realistic interactive sessions
# don't touch 64 distinct heavy convs without re-touching most of
# them, so the LRU keeps the heavy hitters warm.
#
# A future refinement could weight by serialized size and cap on
# memory bytes rather than entry count. Out of scope for V1.
_conversation_cache = FileCache(max_workers=8, max_entries=64)


def get_conversation_cache() -> FileCache:
    """Get the global conversation cache."""
    return _conversation_cache


def clear_cache() -> None:
    """Clear the global cache (useful for testing or manual refresh)."""
    _conversation_cache.clear()