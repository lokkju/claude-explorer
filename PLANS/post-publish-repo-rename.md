# Post-publish repo rename — claude-desktop-message-exporter → claude-desktop-message-explorer

**Status:** Deferred until Part 1 + Part 2 articles are published.

**Why deferred:** The articles cite file paths and source-of-truth
references. Renaming the repo while we're still iterating on the
articles risks broken links and `git log` confusion. Once both
articles ship, we can rename in one clean step.

## Pre-conditions

- [ ] Part 1 article published.
- [ ] Part 2 article published.
- [ ] No active Claude Code sessions in the repo (close all CC tabs/processes).
- [ ] Git working tree clean (commit or stash everything first).
- [ ] GitHub remote rename done (or planned for the same window — see
      "Out of scope" below).

## Steps

In a single window between Claude Code sessions:

```bash
# 1. Rename the local repo directory.
mv ~/Source/claude-desktop-message-exporter \
   ~/Source/claude-desktop-message-explorer

# 2. Rename the Claude Code per-project directory. The encoding is the
#    absolute path with '/' replaced by '-', so:
mv ~/.claude/projects/-Users-rpeck-Source-claude-desktop-message-exporter \
   ~/.claude/projects/-Users-rpeck-Source-claude-desktop-message-explorer

# 3. (Optional cleanup) Update any memory file bodies that cite the old
#    absolute repo path. Historical session JSONLs are read-only history
#    and can be left alone.
grep -rln "claude-desktop-message-exporter" \
   ~/.claude/projects/-Users-rpeck-Source-claude-desktop-message-explorer/memory/

# For each hit, decide: still a live reference? rewrite. Historical
# context only? leave it.

# 4. cd into the new directory and resume work. Claude Code will pick
#    up the renamed project dir on the next session.
cd ~/Source/claude-desktop-message-explorer
```

## What survives the rename

- All git history. `git log`, `git blame`, branches, tags unchanged.
- All in-repo files. The data lives in the directory, not its name.
- The `~/.claude-explorer/` data dir (user prefs, conversations,
  search index). Already renamed; independent of repo location.
- All `~/.claude/projects/<new-dir>/` memory + plans + sessions
  (moved as a unit by step 2).

## What does NOT survive

- **Historical session JSONLs** (`~/.claude/projects/<new-dir>/*.jsonl`)
  contain absolute paths in tool inputs/outputs that reference the
  old repo path. They render fine for review (the transcripts are
  display-only), but a tool re-run from inside an old session would
  hit the old path and 404. Accept as historical artifact.
- **External references** to the old path: shell aliases, IDE
  workspace files (`.vscode/`, `.idea/`), `~/.zshrc` line items,
  `pyproject.toml` *if* it cites an absolute path (it doesn't today),
  CI configs referencing the local path (none today). Quick grep:
  ```bash
  grep -rln "claude-desktop-message-exporter" ~/.zshrc ~/.bashrc \
    ~/.config/ 2>/dev/null
  ```

## Plans dir

`~/.claude/plans/` is **global, not project-scoped**. Nothing to
rename there; plan files just keep their existing names.

## Verification after rename

```bash
cd ~/Source/claude-desktop-message-explorer
git log --oneline | head -5            # commit history intact
uv run pytest backend/tests -q          # 305+ tests pass
cd frontend && npx playwright test --reporter=line  # 327+ pass
```

Open a fresh Claude Code session in the new directory; confirm the
memory index (`MEMORY.md`) loads. Old sessions remain readable as
historical artifacts.

## Out of scope (do separately if you want them)

- **GitHub repo rename** (`anthropics/claude-desktop-message-exporter`
  → `…-explorer`). GitHub auto-creates a permanent redirect so old
  URLs and clones keep working, but: update remote, update any
  external docs/Medium articles that cite the GitHub URL.
- **Python package name** in `pyproject.toml` (if you ever decide
  to publish to PyPI). Currently scoped to `claude-explorer` CLI
  command; the project name in `pyproject.toml` is a separate field.
- **Article retro-edits.** Once published, Part 1 + Part 2 cite the
  repo URL; if the GitHub rename happens, add an editor's-note line
  rather than silently rewriting the link.
