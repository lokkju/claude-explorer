"""Regression test: FastMCP must advertise OUR package version, not its own.

Pre-fix shipping bug (found 2026-06-04 while smoke-testing the published
1.0.4 wheel from PyPI): ``mcp_server/server.py`` constructed
``FastMCP("Claude Session Explorer", instructions=...)`` with no
``version=`` argument, so the MCP-protocol ``serverInfo.version`` field
reported the FastMCP library's own version (e.g. ``3.2.4``) to every
connecting client. Clients had no portable way to ask "which version of
claude-explorer am I talking to?" — exactly what serverInfo is meant to
answer.

The fix passes the installed package version (resolved via
``importlib.metadata``) into ``FastMCP(version=...)`` so it appears
verbatim in ``serverInfo.version`` on the MCP handshake.
"""

from __future__ import annotations

from importlib.metadata import version

import fastmcp

from mcp_server.server import mcp


def test_server_version_matches_installed_package() -> None:
    expected = version("claude-explorer")
    assert mcp.version == expected, (
        f"FastMCP serverInfo.version must report the claude-explorer "
        f"package version ({expected!r}), not {mcp.version!r}."
    )


def test_server_version_is_not_the_fastmcp_library_version() -> None:
    # Regression guard for the pre-fix bug: if someone removes the
    # version= kwarg from the FastMCP(...) constructor, the attribute
    # falls back to the fastmcp library's own version. That's exactly
    # the wrong thing to advertise to MCP clients.
    fastmcp_lib_version = version("fastmcp")
    pkg_version = version("claude-explorer")
    # Only meaningful when the two diverge (they almost always do).
    if fastmcp_lib_version != pkg_version:
        assert mcp.version != fastmcp_lib_version, (
            f"FastMCP serverInfo.version is reporting the fastmcp library "
            f"version ({fastmcp_lib_version!r}) instead of the "
            f"claude-explorer package version ({pkg_version!r}). The "
            f"FastMCP(...) constructor is missing the version= kwarg."
        )


def test_server_name_is_stable() -> None:
    # Belt-and-suspenders: the human-facing name is part of serverInfo too
    # and should not silently change while we're fixing version reporting.
    assert mcp.name == "Claude Session Explorer"
