#!/usr/bin/env python3
"""
Check (and optionally fix) Claude Code's `cleanupPeriodDays` setting.

Why this matters
----------------
Claude Code automatically deletes session files in ~/.claude/projects/ that are
older than `cleanupPeriodDays` (default: 30). Many users only discover this
when they realize months of conversation history has silently disappeared.

Setting `cleanupPeriodDays` to a large value (e.g. 36500 = 100 years) effectively
disables the auto-cleanup. DO NOT set it to 0 — issue #23710 documents that 0
silently disables conversation persistence entirely.

What this script does
---------------------
- Reads ~/.claude/settings.json
- Reports the current cleanupPeriodDays (or notes that the default is in effect)
- With --set N, atomically updates the file, preserving every other key

Usage
-----
    python3 scripts/check-cleanup-period.py          # report only
    python3 scripts/check-cleanup-period.py --set 36500
    python3 scripts/check-cleanup-period.py --set 365
    python3 scripts/check-cleanup-period.py --settings /path/to/settings.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

DEFAULT_PATH = Path.home() / ".claude" / "settings.json"
DEFAULT_VALUE = 30  # Claude Code's documented default
RECOMMENDED = 36500  # ~100 years; effectively disables cleanup


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Check or update Claude Code's cleanupPeriodDays setting.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--settings",
        type=Path,
        default=DEFAULT_PATH,
        help=f"Path to settings.json (default: {DEFAULT_PATH})",
    )
    p.add_argument(
        "--set",
        dest="set_value",
        type=int,
        metavar="N",
        help=f"Update cleanupPeriodDays to N (recommended: {RECOMMENDED}). "
             "DO NOT use 0 — that silently disables persistence (CC issue #23710).",
    )
    return p.parse_args()


def load_settings(path: Path) -> tuple[dict, bool]:
    """Return (settings_dict, file_existed). Errors if file is malformed."""
    if not path.exists():
        return {}, False
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"ERROR: {path} is not valid JSON: {e}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(data, dict):
        print(f"ERROR: {path} top-level must be a JSON object.", file=sys.stderr)
        sys.exit(1)
    return data, True


def write_settings_atomic(path: Path, data: dict) -> None:
    """Write JSON atomically: temp file in same dir, then rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_str = tempfile.mkstemp(
        prefix=".settings.json.", suffix=".tmp", dir=str(path.parent)
    )
    tmp = Path(tmp_str)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        # Preserve permissions if original existed
        if path.exists():
            try:
                st = path.stat()
                os.chmod(tmp, st.st_mode)
            except OSError:
                pass
        os.replace(tmp, path)
    except Exception:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


def report(path: Path, data: dict, file_existed: bool) -> None:
    print(f"Settings file:  {path}")
    if not file_existed:
        print("Status:         (file does not exist — Claude Code uses defaults)")
    else:
        print("Status:         file exists")
    if "cleanupPeriodDays" in data:
        val = data["cleanupPeriodDays"]
        print(f"cleanupPeriodDays: {val}  (explicitly set)")
        if val == 0:
            print()
            print("WARNING: cleanupPeriodDays = 0 silently DISABLES conversation persistence")
            print("(see Claude Code GitHub issue #23710). Set it to a positive number.")
        elif val < 30:
            print(f"WARNING: {val} days is shorter than the 30-day default — projects")
            print("untouched for that long will be deleted on the next Claude Code start.")
        elif val < 365:
            print("Note: this is shorter than 1 year. Consider raising it if you want")
            print("long-term conversation history preserved.")
    else:
        print(f"cleanupPeriodDays: <unset>  (Claude Code default: {DEFAULT_VALUE} days)")
        print()
        print(f"Recommendation: set to {RECOMMENDED} (~100 years) to effectively disable")
        print("auto-cleanup. Run:")
        print(f"  python3 {sys.argv[0]} --set {RECOMMENDED}")


def update(path: Path, data: dict, new_value: int) -> int:
    if new_value < 0:
        print("ERROR: cleanupPeriodDays must be non-negative.", file=sys.stderr)
        return 2
    if new_value == 0:
        print("REFUSING: cleanupPeriodDays = 0 silently disables conversation")
        print("persistence (Claude Code issue #23710). Pick a positive number.")
        return 2

    old = data.get("cleanupPeriodDays", "<unset>")
    if old == new_value:
        print(f"No change needed: cleanupPeriodDays already = {new_value}.")
        return 0

    data["cleanupPeriodDays"] = new_value
    write_settings_atomic(path, data)
    print(f"Updated {path}")
    print(f"  cleanupPeriodDays: {old}  ->  {new_value}")
    return 0


def main() -> int:
    args = parse_args()
    data, existed = load_settings(args.settings)

    if args.set_value is None:
        report(args.settings, data, existed)
        return 0

    return update(args.settings, data, args.set_value)


if __name__ == "__main__":
    sys.exit(main())
