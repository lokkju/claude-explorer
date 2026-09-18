# Rename the package for the fork

**Priority:** Medium — blocks any PyPI presence for this fork.
**Discovery date:** 2026-09-17
**Status:** deferred; guard shipped in 1.1.0

## Context

Upstream (`rpeck/claude-explorer`) is unmaintained and has not responded
to contact. This fork now carries a release line of its own starting at
1.1.0.

## Problem

The PyPI project `claude-explorer` belongs to upstream, and its Trusted
Publisher record is pinned to `rpeck/claude-explorer` with a `pypi`
environment configured in that repository. From this fork the OIDC claim
cannot match, so `.github/workflows/release.yml`'s `publish` job fails on
every tag.

Shipped in 1.1.0: the job is gated on
`github.repository == 'rpeck/claude-explorer'`. Tags from this fork build
the wheel and the `.mcpb` and attach both to a GitHub Release; nothing is
uploaded to PyPI, and the workflow stays green.

`pip install claude-explorer` therefore still installs UPSTREAM's 1.0.9,
not this fork. The only supported install for this line is
`uv tool install git+https://github.com/lokkju/claude-explorer.git`.

## What a rename touches

- `pyproject.toml` `[project] name`, and the console-script entry point
  if the command name changes too (probably keep `claude-explorer` as the
  command even if the distribution is renamed — that keeps every docs
  example and the installed launcher path working).
- `mcp_server/__init__.py` is the version source of truth; unaffected by
  a name change, but `importlib.metadata.version("claude-explorer")`
  lookups are not — grep for the literal distribution name. The MCP
  serverInfo test asserts against it.
- `scripts/build-mcpb.py`: the bundle filename, the `manifest.json`
  `name`, and the stripped `pyproject.toml` it writes.
- README / CLAUDE.md install instructions.
- A Trusted Publisher record on the new PyPI project, plus a `pypi`
  GitHub environment in this repo, and flipping the `if:` guard above.

## Open question

Whether to rename the distribution only, or the command as well. Renaming
the command breaks every existing user's muscle memory and their
installed launcher scripts (`~/.claude-explorer/cc-watcher.py` and the
scheduled-fetch launcher bake in the entry-point path at install time, so
a command rename means re-running `install all`). Renaming just the
distribution avoids all of that.
