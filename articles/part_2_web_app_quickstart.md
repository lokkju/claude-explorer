<!--
  Medium series: Unlocking Your Claude History
  Part 2 of 7: Quickstart (five-minute version)
  Source: articles/part_2_web_app_userdoc.md
  Voice: PROCESS/99_styleguide.md (Raymond Peck's "Best Practices for Modern REST APIs in Python" series)
-->

# Part 2 Quickstart: `claude-explorer` in Five Minutes

***In this quickstart companion to Part 2, we install `claude-explorer`, pull our Claude history onto our own disk, and find anything in it from the keyboard, in about five minutes.***

New here? Start with [Part 1](https://medium.com/@raymondpeck/unlocking-your-claude-history-part-1-f19000c05655) for what this project is and why you'd want it. For the full product tour (named filters, branches, bookmarks, themes, Time Machine recovery), read the [user guide](part_2_web_app_userdoc.md); for the internals (search index, image-cache architecture, settings persistence), read the [deep-dive](part_2_web_app.md).

![[Pasted image 20260527130701.png]]

## Install

```bash
# Need uv/uvx first? https://docs.astral.sh/uv/getting-started/installation/

# Capture Claude Desktop credentials in a browser window
# (skip if you only use Claude Code; those sessions need no capture)
uvx --from claude-explorer playwright install chromium

# Strongly recommended: the always-on image-cache watcher, so Claude Code
# can't rotate your pasted screenshots off disk while the app is closed.
uvx claude-explorer install-watcher

# Optional, for PDF export on macOS (Linux/Windows: see the user guide)
brew install pango cairo libffi

# Run it (this blocks; leave it running)
uvx claude-explorer serve
```

Open `http://localhost:8765`. Your Claude Code sessions show up right away; the app reads them straight from `~/.claude/projects/` on your machine. (Port already in use? Add `--port 8766`.)

## Load your Claude Desktop history

Click **Refresh** at the top of the Conversation List, or press **`⌘+R`**. The first time, the app opens a small browser window to capture your `claude.ai` credentials, saves them locally, then fetches your conversations and streams progress in a corner popup. Later Refreshes reuse the saved credentials and re-capture only when they expire.

## Find anything

`claude-explorer` puts three panes on screen: the **Conversation List** on the left, the **Conversation Pane** in the center, and a **Search Pane** that slides in on **`⌘+K`**. One search covers every message across all three sources (Claude Desktop, Claude Code, Claude Cowork), including tool calls, tool results, and `/compact` summaries, and stays sub-second even on archives in the thousands.

- **`⌘+K`** opens search and runs the query. Unquoted words (`comprehensive medium`) match in any order; wrap the query in quotes (`"comprehensive medium"`) to match that exact phrase.
- **`⌘+G`** / **`⌘+Shift+G`** step to the next / previous match, jumping across conversations as easily as within one.
- Press **`Enter`** on a hit to focus that message in the Conversation Pane; **`⌘+C`** copies it.
- The **source dropdown**, your saved **named filters**, and the **Show Tools** / **Show Compactions** checkboxes all scope the search, so you never get a hit you can't see in the viewer.

## Keyboard cheat sheet

The app ships Emacs-style bindings by default; you can switch to Vim with one click on the Settings page.

| Action | Key |
|---|---|
| Search | **`⌘+K`** |
| Next / previous match | **`⌘+G`** / **`⌘+Shift+G`** |
| Jump to the find input | **`⌘+F`** |
| Copy the focused message | **`⌘+C`** |
| Refresh (fetch + rescan) | **`⌘+R`** |
| Open the focused conversation | **`Enter`** |
| Back / leave the current pane | **`Esc`** |
| Move within the focused pane | **`Ctrl+N`** / **`Ctrl+P`** |
| Page up / down | **`Option+P`** / **`Option+N`** |
| First / last message | **`Option+<`** / **`Option+>`** |
| Next user / assistant message | **`u`** / **`a`** (reverse: **`U`** / **`A`**) |
| Show every binding | **`?`** |

On Windows and Linux, press **`Ctrl`** wherever this says **`⌘`**, and **`Alt`** wherever it says **`Option`**. In Vim mode, **`j`** / **`k`** move, **`g`** / **`G`** jump to top / bottom, and **`/`** starts a search.

## Read, export, keep

- **Read.** The viewer hides tool blocks and `/compact` summaries by default so the conversation reads cleanly. Tick **Show Tools** or **Show Compactions** in the toolbar to bring them back. Click any image for a full-screen lightbox.
- **Export.** Use **Copy as Markdown** in the conversation header for the clipboard, or export a whole conversation to Markdown (a single file or a zipped bundle with its images) or PDF. Every export honors the same two checkboxes the viewer does.
- **Keep.** Claude Code deletes session transcripts older than 30 days by default. Raise the limit once so you stop losing history:

```bash
python3 scripts/check-cleanup-period.py --set 36500   # ~100 years
```

Run that alongside the `install-watcher` step from the install block, and both your transcripts and your pasted screenshots survive Claude Code's silent rotation.

## Next

That is the whole loop: install, **`⌘+R`**, **`⌘+K`**, read, export. For the complete walkthrough, read the [Part 2 user guide](part_2_web_app_userdoc.md). [Part 3](part_3_mcp_server.md) turns this same on-disk archive into something a fresh Claude can query over an MCP server, with no copy-pasting.

---

*This is an independent, community-built project, not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic, PBC; this tool consumes Anthropic's public APIs and on-disk formats the way any client would, and those formats may change without notice.*
