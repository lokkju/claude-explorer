"""Write side for registering the `claude-explorer mcp` server in MCP
client configs (Claude Code: ~/.claude.json / ./.mcp.json; Claude
Desktop: claude_desktop_config.json).

Pairs with backend.mcp_config_detect (read side). Stdlib-only and
CLI-only — must stay OUT of the MCPB import closure. Writes are atomic
(temp + os.replace) and preserve every other top-level key; the public
install_*/uninstall_* functions never raise (a corrupt/unwritable
target yields a failed InstallResult, never a clobbered file).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from .mcp_config_detect import claude_desktop_config_path, detect_mcp_in_file


SERVER_NAME = "claude-sessions"


def mcp_block() -> dict:
    """The mcpServers entry value we write. Single source of truth."""
    return {"type": "stdio", "command": "uvx", "args": ["claude-explorer", "mcp"]}


@dataclass
class InstallResult:
    target: str       # "code" | "desktop" | "watcher"
    ok: bool
    changed: bool
    detail: str


def _load_config(path: Path) -> dict:
    """Return the parsed config dict, or {} if the file is absent.

    Raises ValueError on corrupt JSON or a non-dict root — callers must
    NOT clobber a config they cannot parse.
    """
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path}: invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{path}: top-level JSON is not an object")
    return data


def _atomic_write_json(path: Path, data: dict) -> None:
    """Write data to path atomically (temp in same dir + os.replace).

    Creates parent dirs as needed. Sets 0o600 on the temp file before
    replace so a newly-created config isn't world-readable. Cleans up
    the temp file if the replace fails.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(json.dumps(data, indent=2))
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except OSError:
        if tmp.exists():
            tmp.unlink()
        raise


def _merge_entry(path: Path, name: str, entry: dict) -> bool:
    """Ensure mcpServers[name] == entry in the config at path.

    Returns True if the file was changed, False if it already matched.
    Preserves all other top-level keys and other mcpServers entries.
    """
    data = _load_config(path)
    servers = data.get("mcpServers")
    if not isinstance(servers, dict):
        servers = {}
    if servers.get(name) == entry:
        return False
    servers[name] = entry
    data["mcpServers"] = servers
    _atomic_write_json(path, data)
    return True


def _remove_entry(path: Path, name: str) -> bool:
    """Remove mcpServers[name] from the config at path.

    Returns True if an entry was removed, False if it wasn't present.
    """
    data = _load_config(path)
    servers = data.get("mcpServers")
    if not isinstance(servers, dict) or name not in servers:
        return False
    del servers[name]
    data["mcpServers"] = servers
    _atomic_write_json(path, data)
    return True
