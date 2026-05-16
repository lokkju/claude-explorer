<!--
  Medium series: Unlocking Your Claude History
  Part 2 of 5 — User-doc lite version
  Source: PLANS/articles/part_2_web_app.md (~7,700 words)
  Voice: PROCESS/99_voice_cheatsheet.md (Raymond Peck's "Best Practices for Modern REST APIs in Python" series)
  Council: Gemini 3 Pro + Gemini 2.5 Pro (GPT-5.2-pro fallback after 429) drafters → cross-critique → synthesis
-->

# Part 2 — Using the `claude-explorer` Web App (User Guide)

*This is the user guide for the `claude-explorer` web app: install, sidebar, keyboard shortcuts, exports, the lot. If you also want a technical deep-dive into how the front end works under the hood (the search index, the image-cache architecture, settings persistence), see the [longer version](part_2_web_app.md), which keeps everything here and adds the internals.*

***In this part of the series, we'll install `claude-explorer`, capture and fetch your Claude Desktop history, and then take a full product tour of the web UI: the unified sidebar, full-text search, keyboard navigation, reading conversations, appearance and settings, and exports.***

> **Disclaimer**: This is an independent, community-built project. It is not affiliated with, endorsed by, sponsored by, or supported by Anthropic, PBC. "Claude" and "Claude Code" are trademarks of Anthropic, PBC. This project consumes Anthropic's products as a user would (via the same APIs and on-disk file formats the official clients use), but nothing here represents an Anthropic-sanctioned interface, and the formats this project depends on may change without notice. If they do, I'll update the project asap.

![[Pasted image 20260513161826.png]]

In the previous installation of this series, we covered the three moving parts that make this project work (capture → fetch → browse / export / query), plus the five reasons you'd actually want a unified local archive in the first place. If you missed that, make sure to go back and read [Part 1](https://medium.com/@raymondpeck/unlocking-your-claude-history-part-1-f19000c05655) first; Part 1 explains why we have to "capture" a `sessionKey` to download Claude Desktop conversations, and that Claude Code sessions already live on disk under `~/.claude/projects/`.

## Install and First Run

`claude-explorer` is a local tool you can get running in just a few minutes: install dependencies, start the server, open it in your browser, and let the UI handle credential capture and the first fetch on its own. We'll leave the MCP server for the next article in the series; it lets you use the same corpus of Claude conversations to have Claude analyze itself.

We use `uvx` (from [Astral](https://docs.astral.sh/uv/getting-started/installation/), which is [joining OpenAI](https://openai.com/index/openai-to-acquire-astral/)) to do the heavy lifting; one command installs `claude-explorer` into an isolated, cached environment and runs it. If you'd rather install from source, the [README](https://github.com/rpeck/claude-explorer#readme) has the `git clone` + `uv sync` flow.

Here's the "happy path" install and first run, end to end:

```bash
which uvx

# install uv/uvx if needed: https://docs.astral.sh/uv/getting-started/installation/

# One-time setup, in any order:

# install Chromium for in-process credential capture
# (skip if you only care about Claude Code sessions; they need no capture)
uvx --from claude-explorer playwright install chromium

# Strongly recommended: install the always-on image-cache watcher
# (one-time; runs as a launchd / systemd / Task Scheduler job so
# Claude Code can't quietly rotate your screenshots off disk).
uvx claude-explorer install-watcher

# Optional: install the system libraries WeasyPrint needs for PDF export
# (skip if you'll only export to Markdown).
#   macOS:   run the brew command below
#   Linux:   use your distro's pango / cairo / libffi packages
#   Windows: install MSYS2 (https://www.msys2.org), then in its shell run
#            `pacman -S mingw-w64-x86_64-pango`. Or grab the standalone
#            WeasyPrint .exe from the GitHub releases page to skip the
#            system-library dance entirely.
brew install pango cairo libffi

# Then run the app (this one blocks; leave it running and open the URL in your browser):
uvx claude-explorer serve
```

That's it for the terminal. Open `http://localhost:8765` and your Claude Code sessions are visible immediately; those JSONL files already live under `~/.claude/projects/` and the back end reads them live at request time.

The default port is `8765`, picked because nothing widely-deployed claims it. If you got an `[Errno 48] Address already in use` error, something else is already on the port (almost always a previous `claude-explorer` run that didn't exit cleanly). Identify it and kill it:

```bash
# macOS / Linux
lsof -i :8765                            # see what's holding the port
kill $(lsof -ti :8765)                   # kill it (Ctrl-C-style; add -9 if it ignores you)
```

```powershell
# Windows (PowerShell)
Get-NetTCPConnection -LocalPort 8765 | Select-Object OwningProcess
Stop-Process -Id (Get-NetTCPConnection -LocalPort 8765).OwningProcess
```

If you'd rather just pick a different port instead, re-run with:

```bash
uv run claude-explorer serve --port 8766
```

For the full set of flags, run:

```bash
claude-explorer serve --help
```

To pull in your Claude Desktop history, click the **Refresh** button in the top of the sidebar and the UI runs the full pipeline for you: capture credentials in a small browser window, persist them locally, then incrementally fetch your conversations and stream progress back to a small status popup in the corner of the window. Subsequent Refresh clicks reuse the saved credentials and only re-capture when they expire.

## The Conversation List (Sidebar)

The sidebar makes the unified corpus visible: one list containing both Claude Desktop conversations and Claude Code sessions, with a few affordances that make it usable once you've got more than a couple dozen sessions. Special shout-out to Donald Norman for *The Design of Everyday Things*, which everyone should read!

<div align="center">
<img src="Pasted image 20260514121201.png" alt="The Claude Explorer sidebar showing the source filter dropdown, project grouping, starred sessions, and the refresh button" width="300">
</div>

### Source filter and project grouping

At the top, you'll see a simple source filter dropdown: `All Conversations`, `Claude Desktop`, and `Claude Code`. Your brain tends to remember context before content; if you know "this was a Claude Code debugging session in my repo" you can switch to `Claude Code` and cut your search space in half.

Claude Code sessions also show up grouped by project. The UI pulls the project name from the directory the session ran in, which is usually the git repo root, then renders a collapsible grouping so you can treat *"everything I did in repo `foo`"* as a first-class bucket. I prefer this to tags because it matches how work happens; most of us don't sit down and decide which taxonomy to apply to a session, we just run `claude` in a directory and get to work.

### Row metadata

Each row in the list carries just enough metadata to let you scan without clicking: the session title, a source badge (`Desktop` or `Code`), a last-updated timestamp, and a message count. Those four fields give you the shape of the conversation: whether it was long or short, fresh or old, and where it came from. That's surprisingly close to how humans remember work; we rarely remember exact filenames, but we do remember that something happened "last month" and that it was "a big one."

### Stars and the refresh button

You'll also see a starred group at the top. Stars are blunt, and that's why I like them; when you find something you know you'll come back to, you star it and it stops drifting away into the scrollback.

There's a refresh button at the top of the sidebar that does exactly what you want in a unified browser: one click triggers a Desktop fetch for new conversations *and* a re-scan of the Claude Code directory, so you don't have to remember which source needs which kind of refresh. I asked for that because I'm lazy, and laziness is the mother of "make it one button."

### Named filters

Below the source dropdown, the sidebar carries a small *named-filter* picker for keeping title-pattern filters around and switching between them. Each filter is a name plus a behavior (*hide matches* or *show only matches*) plus one or more patterns; a single `cron jobs` filter can carry every chore pattern you want gone, and toggling it on hides them all. Filters can also be composed into groups that AND or OR other named filters together, which is handy when you want one filter that, e.g., hides cron jobs AND keeps client-A work without juggling two toggles. The active selection is sticky across reloads. Claude Code sometimes spawns sessions with only local-command scaffolding and no real conversation; the sidebar quietly filters those out so you never see them.

## Reading Messages

Before we get to global search and keyboard navigation, let's look at how the viewer presents the conversation in front of you.

### Tool blocks and slash commands

The viewer hides tool-use and tool-result blocks by default, because tool output can dominate the screen and drown out the conversation. When you want them, toggle them on in the conversation toolbar. The default is the right one for *reading* a session ("what happened, in plain English?"); the toggle is there for *auditing* one ("what did the assistant actually run, and what did it get back?"). Image attachments are deliberately *not* gated by that toggle; they're primary content.

![[Pasted image 20260515191033.png]]

Slash commands get the same careful treatment. When you ran `/coding "Help me trace this bug"`, the user's prompt renders as a normal message bubble with a small `/coding` badge above the body. When you ran `/exit`, `/clear`, or any argless command, the bubble collapses to a muted *"Session: /exit"* marker that's visually de-emphasized; it's excluded from search and Copy-as-Markdown for the same reason.

When a session opens with one or more `/exit` markers before any real user message (it happens more than you'd expect on long-running sessions resumed from a different terminal), the leading markers fold into a single *"Session prelude: N earlier /exit runs (show)"* control at the top, collapsed by default.

In the upper-right of the conversation header, alongside the Markdown and PDF export buttons, there's an *"Expand / Collapse All Tools"* control that forces every tool block in the conversation open or closed at once. It only appears when the **Tools** toggle is on, and it saves a lot of time when you're reviewing a session with dozens of tool calls.

## Searching and Navigating with the Keyboard

Claude Explorer is really a three-pane app: the sidebar, the conversation detail, and a search panel that pops in when you hit `⌘+K`. The whole UI is built for keyboard-first navigation; you can search the global archive, step through matches, and read long sessions without your hands ever leaving the keys. Searches stay fast (sub-second on archives in the thousands of conversations) thanks to a full-text search index the back end keeps over every message.

One quick note on key labels: I write shortcuts with the `⌘` glyph because I'm on macOS; on Windows and Linux, use `Ctrl` instead.

![[Pasted image 20260514161227.png]]

### Overview and the focus model

All of the search functions tie into a small set of keyboard shortcuts. `⌘+K` opens the search panel and runs the query, `⌘+G` jumps to the next match across the whole result set, `⌘+Shift+G` jumps to the previous one, and pressing `Enter` on a highlighted hit focuses that message in the conversation pane. Search covers every message in the archive, including tool calls and tool results, and composes with whatever scope the sidebar is showing.

The flow relies on a strict focus model to keep the shortcuts predictable. Exactly one of `{sidebar, detail}` has focus at any moment, and the keys apply to the focused pane only. Click anywhere in either pane to focus it; use `Enter` to descend from the sidebar into the detail pane, and `Esc` to pop focus back to the sidebar.

### Running a search (`⌘+K`)

`⌘+K` opens full-text search, the standard shortcut across modern apps for *"I want a fast, global search"*. The pane slides in from the right so we can see the conversations list and the search hits list at the same time. The pane carries two tabs (Search and Bookmarks); `⌘+K` always lands on Search, and clicking the Bookmarks tab swaps the list view to your saved-message list (more on bookmarks in the conversation-pane section). Each search hit includes enough context to be useful in a skim: conversation title, source, timestamp, and a snippet around the matching text. Search also covers tool calls and tool results, which matters once you use Claude Code heavily; we tend to remember the *effect* of a tool invocation ("the `ripgrep` output showed the string in three files") even when we've forgotten the exact assistant text around it.

### Query syntax: terms vs phrases

There are two modes you'll use day-to-day, and the distinction matters because each one answers a different question:

- **Multi-word, unquoted**, e.g. `comprehensive medium`. All words must appear in the same matched message, in any order, possibly with other words between them. This is the right tool when you remember a couple of distinctive words but have forgotten the exact phrasing.
- **Quoted phrase**, e.g. `"comprehensive medium"`. The words must appear in that exact sequence. Wrap the whole query in double quotes; the back end translates that to a phrase clause.

Both modes highlight every matched token (or phrase) in the snippet, so you can tell at a glance which words triggered the hit.

### Search-and-Copy Navigation (`⌘+G`, `⌘+C`, `⌘+F`)

After you run a search, you're usually in a loop: find a match, read around it, hop to the next one, then copy something out. `⌘+G` advances to the next match; `⌘+Shift+G` goes backward. `⌘+G` jumps between conversations as naturally as between matches in a single thread, so you can treat a result set like a playlist. If you prefer the mouse, clicking a hit loads the corresponding conversation and scrolls you precisely to the matching message.

Once a match is focused, `⌘+C` copies the focused message to your clipboard, including the speaker and timestamp; if the cell is a tool block, you get the tool input or output verbatim. If you want to adjust the query instead of navigating matches, `⌘+F` jumps focus into the find input. The full one-handed flow: `⌘+K`, pick a hit, `⌘+F` to tweak the query, `⌘+C` to copy the focused cell.

### Scope composition

Both search surfaces (the title-search input at the top of the left sidebar and the right-pane full-text search) honor whatever scope the sidebar is currently showing: the source dropdown, the workspace dropdown for Claude Code projects, and the active named filter. Results also respect the **Tools** toggle, so a hit you couldn't see in the viewer never shows up in the result list either. The mental model is "the sidebar is the lens; search asks questions through it." Flip a filter off and the previously-hidden matches re-appear without you re-typing the query.

### Scoping search to a conversation or project (Pin)

Search defaults to global, but there's a complementary mode for when you've drilled into a specific session: *"search this conversation only"* (or *"this project only"*). That's a **pin**. There's a small `Search scope` button next to the conversation title with two entries: `Pin this conversation` and (when applicable) `Pin this project`. Click one and the search panel sprouts a small rounded scope tag (`In: <Conversation Title>`), and the sidebar dims any rows that fall outside the scope. The pin is sticky and survives a full page reload because it's encoded in the URL, which makes it shareable too. It clears when you click the explicit unpin control or type in the sidebar's title-search box. `⌘+G` honors the scope and wraps within it.

### Emacs by default, Vim for heathens 😉

By default, the app uses an Emacs-ish set of bindings (the ones you're probably used to from `bash` / `zsh`):

- `Ctrl+N` / `Ctrl+P` move within the focused pane.
- `Alt+N` / `Alt+P` page (within the conversation detail).
- `Alt+<` / `Alt+>` jump to first / last message.
- `Esc` exits the current focus mode (or pops you back to the sidebar).
- `⌘+F` (or `Ctrl+F`) toggles the full-text search panel.

If Vim is more your speed, you can opt in on the settings page. In Vim mode, `j` / `k` move line by line, `g` / `G` jump to top and bottom (single-key rather than `gg`), and `/` starts search; the UI keeps the same explicit focus model, so Vim keys never leak into the wrong pane.

A few bindings are specific to reading a conversation. In the detail pane, `u` and `a` jump to the next user message and the next assistant message; `U` and `A` reverse direction. I like these because they let you skim by speaker. The UI also binds `⌘+R` to the refresh action so you don't accidentally reload the single-page app and lose your place. If you ever forget a binding, hit `?` to open the help page; it lists every binding for both modes.

One last bit of polish in the sidebar: when you press `Ctrl+P` or `Ctrl+N` to step through sessions, the UI does not eagerly load each conversation. It blanks the conversation pane and renders a hint to hit `Enter` to load. Loading a heavy session is an explicit action, so you scan the list with your fingers on the keyboard and only commit to opening one when you actually want to read it.

## Inside the Conversation Pane

When you select a conversation in the sidebar (and hit `Enter`, because loading is explicit), the detail pane renders the full session as a sequence of message bubbles.

![[Pasted image 20260515131449.png]]

### Timestamps and content blocks

Each message shows a local timestamp on both sides of the conversation. That matters more than you'd think, because time is part of the story; *"this was a ten-minute back-and-forth"* feels different than *"this took three hours and spanned lunch."* Messages can contain multiple content blocks; in practice, you'll see three: text blocks for normal conversation, tool-use blocks when the assistant invokes a tool, and tool-result blocks for the tool's output.

### Image attachments and the lightbox

Image attachments live next to the content blocks, and the viewer renders them inline as thumbnails. Single attachments display at their natural aspect ratio; multiple attachments fall into a tidy two-column grid of square tiles, with a `+N` overflow tile when a single message carries more than five images.

![[Pasted image 20260515132702.png]]

Click any thumbnail and a full-screen lightbox opens; arrow keys move between images, `Esc` closes, `d` downloads, and `o` opens the original in a new tab. The thumbnail and the lightbox both load through a local service, so images keep working even when you're offline from claude.ai itself.

### Image caching (Desktop and Claude Code)

Images live in two places depending on which Claude they came from. Claude Desktop attachments come from the `claude.ai` API with the conversation fetch. Claude Code stores its image-cache files locally and **deletes them on its own rotation schedule**, so a screenshot you pasted last month may already be gone by the time you go looking for it. Claude Explorer keeps its own permanent local copy of both; the `install-watcher` you ran during install is what makes that protection always-on, even while the app isn't running.

### Copy, branches, and scroll-to-match

Each content block shows a *"two overlaid pages"* copy icon on hover, and the conversation header includes a *"Copy as Markdown"* action that copies the entire thread to your clipboard. This becomes a workflow the first time you realize you can paste a whole session into notes, a pull request description, or a retrospective without wrestling with formatting. The copy paths respect the same tool-call toggle as the viewer; one truth, three surfaces (viewer, copy, export).

There's also a *"View branches"* button on the conversation header. Claude can create branches when you edit an earlier message and regenerate from there; when branches exist, the UI renders a tree so you can see the structure and click any leaf to switch the conversation pane to that branch's path. The scroll-to-match behavior we discussed in search shows up here too: clicking a search hit jumps directly to that message.

### Bookmarks (message-level)

Stars in the sidebar save a whole conversation; bookmarks save a single message inside one. Hover over any message bubble and a star icon appears in the action overlay alongside the copy icon; clicking it adds that message to your bookmark list and turns the star amber. Clicking it again removes the bookmark. Argless-command markers (`/exit`, `/clear`) deliberately do not get the bookmark affordance, since *"save a meaningful message"* is the whole mental model.

The bookmark list lives in the **Bookmarks** tab of the right pane (the same pane that holds the search results; click the tab header to switch between them, and the choice persists across sessions). The list groups bookmarks by conversation, and each row shows a snippet of the saved message, an optional note you can edit inline, and the timestamp. Click any row to navigate to that exact message in the conversation pane; an edit icon opens the note field, and a trash icon deletes the bookmark.

A small **Export to Markdown** button at the top of the panel writes the whole bookmark set to a single `.md` file. Each entry includes the snippet and any note, grouped under its conversation, so you can paste the export into notes or share it without needing the app running.

## Appearance and Settings

### Dark mode (Light, Dark, System)

The theme has three settings: Light, Dark, and System. The default is System, which follows your operating system's light or dark mode setting, including changes mid-session. The toggle lives in the sidebar footer, and it cycles Light → Dark → System.

### Settings (`/settings`)

The settings page is deliberately small. It has four sections: *Appearance* (theme), *Keyboard Navigation* (Emacs vs Vim), *Data* (data directory and fetch controls), and *About*. Your settings follow you across browsers and Incognito windows on the same machine; pick `Dark` mode and Vim navigation in Chrome, then open the same address in Safari, and you get the same configuration without re-clicking anything.

## Exports (Markdown and PDF)

If the goal is to make your Claude history *yours*, then *"I can read it in the browser"* is only half the story. You also want to move it into other tools: paste a thread into a pull request, save a session as a note, or hand a Markdown export to a teammate as part of a retro. Claude Explorer has two export formats per conversation: Markdown and PDF.

### Markdown export

Clicking *Markdown* in the conversation header opens a small dialog with three radios: **Inline** (a single `.md` file with images embedded as `data:` URLs), **Bundle CommonMark** (a `.zip` with `conversation.md` plus `images/` and `attachments/` folders, using standard `[name](path)` links), and **Bundle Obsidian** (the same zip layout but with `[[wikilink]]` syntax in `conversation.md` so it drops cleanly into an Obsidian vault). A *"Save as default"* checkbox pre-selects your last pick the next time you open it. Inline is great for pasting a thread into a pull request or a notes app; bundles are the right pick when you want a portable archive that survives without the local server running.

Bundles include every attachment in the conversation. Image attachments land in `images/`; PDFs, text files, and anything else Claude Desktop accepted land in `attachments/`. The Markdown links inside `conversation.md` are rewritten to point at the bundled paths, so the export remains internally consistent. The export honors the same tools toggle as the viewer.

### PDF export (WeasyPrint)

WeasyPrint handles PDF export. It needs a few system libraries (`pango`, `cairo`, `libffi`); if you ran the optional `brew install` line up in the install section, you're set. You click export, you get a PDF of the conversation, and whether or not the tool calls appear depends on the same toggle. PDF is the thing you can stick in an archive folder, attach to a ticket, or keep as *"this is exactly what we saw at the time."*

## Your History, On Your Disk

Claude Desktop keeps your conversations server-side, so you need to be online and signed in to read them; Claude Code keeps sessions on your machine, but by default it deletes session transcripts older than 30 days from `~/.claude/projects/` at startup (and rotates its image cache off disk on its own schedule).

The session-transcript retention is controlled by the `cleanupPeriodDays` setting in `~/.claude/settings.json`; the default is 30, and a large value like 36500 effectively preserves transcripts indefinitely:

```json
{
  "cleanupPeriodDays": 36500
}
```

I learned about that setting the hard way: Claude Code deleted a batch of sessions out from under me one morning, and I had to restore them from Time Machine. Add the setting before you start trusting your local archive.

If you're on a Mac and you've already been bitten, `utils/restore-deleted-sessions-and-images.sh` in the repo will pull both the missing session JSONLs and the image-cache PNGs back out of a Time Machine disk. It walks snapshots newest-first, restores anything that's gone from `~/.claude/projects/` and `~/.claude/image-cache/`, refuses to overwrite files that still exist, and supports `--dry-run` so you can see the plan before anything moves.

Claude Explorer gives you a single archive you can read and search locally, without remembering which interface holds which half of your history or whether the bit you want has already aged out. The long sessions you almost remember, the ones that taught you something real, stop being ephemeral. You can find them again, quote them, reuse them, and hand them to your future self, who will actually be able to read them.

## Coming Up: Another Claude, Querying Yours

Up to now we've been talking about how *we* browse: the sidebar, full-text search, keyboard navigation, and exports. Part 3 flips the point of view; another Claude queries the same on-disk archive via an MCP server, so your history becomes something a fresh session can interrogate without you copy-pasting anything.

That MCP server exposes a small set of tools, and the outline-first pattern is the trick that keeps it practical; a new Claude Code run can start broad, then zoom in, even when the underlying session is thousands of messages long.

And yes, I used this MCP server to mine this project's own history to write this series. Which prior conversation would you most want a fresh Claude session to read for you?

## Wrapping Up!

Ok, that's enough for today! We covered a lot of ground: installing with `uvx`, capturing a `sessionKey` in a small browser window, fetching Claude Desktop conversations locally, and then using the web app to browse a unified sidebar, run full-text search with `⌘+K`, navigate matches with `⌘+G`, read sessions with tool-call toggles and timestamps, switch themes, and export conversations to Markdown or PDF, with image attachments preserved across Claude Code's silent rotation thanks to a permanent local cache.

Part 3 dives into the MCP server we just teased: install paths for Claude Code and Claude Desktop on macOS, Windows, and Linux, the outline-first querying model in more detail, and the workflows that come with it (the self-referential retrospective, the `CLAUDE.md` tuning loop). It's the part of the project that makes me happy. 🤓

One last note before the sign-off, since I led with it at the top: this is an independent, community-built project, not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are Anthropic trademarks; this tool just consumes their public APIs and on-disk formats the way any other client would, and those formats may change without notice. If they do, the project will catch up; the archive on your disk is yours either way.

Before you go, comment with the one session you wish you could hand to a fresh Claude Code run and say, "summarize this and pull out the decisions." Like last time, please comment below with any questions, corrections, etc. If you liked this, please clap and follow me here and on LinkedIn.

See you next time!
