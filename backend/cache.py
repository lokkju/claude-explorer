"""
High-performance caching for Claude Code conversation files.

This module provides:
1. Memory cache with mtime-based invalidation
2. Parallel file reading with ThreadPoolExecutor
3. Fast JSON parsing with orjson
"""

import threading
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
    """Thread-safe file cache with mtime-based invalidation."""

    def __init__(self, max_workers: int = 8):
        self._cache: dict[Path, CacheEntry] = {}
        self._lock = threading.RLock()
        self._max_workers = max_workers

    def get(self, path: Path) -> tuple[Any | None, bool]:
        """Get cached data if still valid.

        Returns (data, is_valid) - if is_valid is False, data is stale/missing.
        """
        with self._lock:
            entry = self._cache.get(path)
            if entry is None:
                return None, False

            try:
                current_mtime = path.stat().st_mtime
                if current_mtime == entry.mtime:
                    return entry.data, True
                # File changed, cache is stale
                return entry.data, False
            except OSError:
                # File no longer exists
                return None, False

    def set(self, path: Path, data: Any, mtime: float | None = None) -> None:
        """Cache data for a file."""
        if mtime is None:
            try:
                mtime = path.stat().st_mtime
            except OSError:
                return  # Don't cache if we can't get mtime

        with self._lock:
            self._cache[path] = CacheEntry(mtime=mtime, data=data)

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


# Global cache instance - shared across requests
_conversation_cache = FileCache(max_workers=8)


def get_conversation_cache() -> FileCache:
    """Get the global conversation cache."""
    return _conversation_cache


def clear_cache() -> None:
    """Clear the global cache (useful for testing or manual refresh)."""
    _conversation_cache.clear()