<!--
  Medium series: Unlocking Your Claude History
  Part 2 of 5 — Draft (Council synthesis: Gemini 3 Pro + GPT-5.2-pro drafters → cross-critique → Opus synthesis)
  Sources: Part 1 (immutable), PROCESS/99_voice_cheatsheet.md, README.md, phase_07/11/14/18/19 extractions
  Voice: Raymond Peck's "Best Practices for Modern REST APIs in Python" series
-->

# Part 2 — Using the `claude-explorer` Web App (User Guide with Technical Deep Dive)

*This is the user guide for the `claude-explorer` web app plus a deep-dive into how the front end works under the hood (the search index, the image-cache architecture, settings persistence, dark mode, exports). If you only want the product tour without the implementation detail, see the [user-guide version](part_2_web_app_userdoc.md).*

***In this part of the series, we'll install `claude-explorer`, capture and fetch your Claude Desktop history, and then take a full product tour of the web UI: the unified sidebar, full-text search, keyboard navigation, reading conversations, appearance and settings, and exports.***

> **Disclaimer**: This is an independent, community-built project. It is not affiliated with, endorsed by, sponsored by, or supported by Anthropic, PBC. "Claude" and "Claude Code" are trademarks of Anthropic, PBC. This project consumes Anthropic's products as a user would (via the same APIs and on-disk file formats the official clients use), but nothing here represents an Anthropic-sanctioned interface, and the formats this project depends on may change without notice. If they do, I'll update the project asap.

![[Pasted image 20260513161826.png]]

In the previous installation of this series, we covered the three moving parts that make this project work (capture → fetch → browse / export / query), plus the five reasons you'd actually want a unified local archive in the first place. If you missed that, make sure to go back and read [Part 1](https://medium.com/@raymondpeck/unlocking-your-claude-history-part-1-f19000c05655) first; Part 1 explains why we have to "capture" a `sessionKey` to download Claude Desktop conversations, and that Claude Code sessions already live on disk under `~/.claude/projects/`.

## Install and First Run

`claude-explorer` is a local tool you can get running in just a few minutes: install dependencies, start the server, open it in your browser, and let the UI handle credential capture and the first fetch on its own. We'll leave the MCP server for the next article in the series; it lets you use the same corpus of Claude conversations to have Claude analyze itself for a bunch of different use cases.

We use `uvx` (from [Astral](https://docs.astral.sh/uv/getting-started/installation/), which is [joining OpenAI](https://openai.com/index/openai-to-acquire-astral/)) to do the heavy lifting; one command installs `claude-explorer` into an isolated, cached environment and runs it, so it feels closer to launching a native app than to a typical Python install. If you'd rather install from source, the [README.md](https://github.com/rpeck/claude-explorer#readme) and [CONTRIBUTING.md](https://github.com/rpeck/claude-explorer/blob/main/CONTRIBUTING.md) have the `git clone` + `uv sync` flow. 

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

The default port is `8765`, picked specifically because nothing widely-deployed claims it. If you got an `[Errno 48] Address already in use` error from the `serve` command, something else is already on the port, almost always a previous `claude-explorer` run that didn't exit cleanly. Identify it and kill it:

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

To pull in your Claude Desktop history, click the **Refresh** button in the top of the sidebar and the UI runs the full pipeline in-process: capture credentials (Playwright), persist them to `~/.claude-explorer/credentials.json`, then incrementally fetch your conversations and stream progress back to a small status popup in the corner of the window. Subsequent Refresh clicks reuse the saved credentials and only re-capture when they expire.

### Tech Overview

Skip ahead if the stack doesn't interest you.
#### back and front end stack
The back end uses FastAPI from Sebastián Ramírez for the REST API, served by uvicorn, with [FastMCP](https://github.com/jlowin/fastmcp) layered on for the MCP server you'll meet in Part 3. I cover FastAPI in detail in [my best-practices column](https://medium.com/@raymondpeck/column-best-practices-in-modern-python-0cc40b50170e). PDF export goes through WeasyPrint (the optional `brew install` line earlier in the install block was for its system libs). The whole Python side runs inside a `uv`-managed virtual environment; `uv` is also how `uvx` ran the install command at the top of this section.

The front end is React 18 + TypeScript, built with Vite, styled with Tailwind CSS v4, and assembled out of shadcn/ui components, with TanStack Query for server-state caching. The whole thing builds to a static bundle that the FastAPI process serves directly; one server for both.

Packaging is hatchling, and the PyPI wheel ships with the pre-built React bundle inside it. That's the trick that lets `uvx claude-explorer serve` be a single line: nothing to clone, nothing to build, just run.

Since this article was written shortly after the May 2026 Mini Shai-Hulud npm worm hit parts of the TanStack ecosystem, one note: I audited our four pinned `@tanstack/*` packages (`react-query`, `query-core`, `react-virtual`, `virtual-core`) against [GHSA-g7cv-rxg3-hmpx](https://github.com/advisories/GHSA-g7cv-rxg3-hmpx). None of them appear in the advisory, and a defense-in-depth scan of `node_modules` and the shipped front-end bundle for the worm's known indicators of compromise came back clean. The full 15-check audit log (lockfile, on-disk IoCs, CI workflows, git author history, project- and user-level persistence vectors, shipped artifact) lives in [SECURITY.md](https://github.com/rpeck/claude-explorer/blob/main/SECURITY.md).

#### credentials
Credential capture uses Playwright to open a Chromium window for the standard login flow. The fetcher itself uses httpx for the HTTP calls and curl_cffi for the TLS fingerprint Cloudflare expects from a real desktop browser.

#### FTS5 for fast search
Search is SQLite FTS5 for the fast path and a linear-scan fallback (orjson + an mtime-keyed FileCache + a ThreadPoolExecutor) for the case where FTS5 is not available in a given sqlite3 build. We'll get to the details when we get to search.

### Some details about auth and fetching

Skip ahead if the auth internals don't interest you.

Claude Desktop's history lives behind a session cookie called `sessionKey`. The default capture path opens a Chromium window via Playwright, lets you log into Claude the normal way (email, Google, your work SSO, whatever your account uses), and on success reads the `sessionKey` cookie plus the active org ID out of the browser context. Those two values get written to `~/.claude-explorer/credentials.json` with mode `0o600`, atomically. The capture step has no network egress beyond the browser tab you used to log in; the code path is `fetcher/playwright_capture.py::capture_credentials` if you want to audit it.

With credentials in hand, the fetch step uses the unofficial `chat_conversations` API at `GET /api/organizations/{org_id}/chat_conversations` to list IDs and `GET /api/organizations/{org_id}/chat_conversations/{uuid}` to pull each full conversation tree. The fetcher rate-limits itself to a 0.3s polite pause between requests. It is incremental by default (skips conversations already on disk); `--full-refresh` re-pulls everything, `--limit N` caps the run, `--verbose` shows progress. We store the JSON in `~/.claude-explorer/conversations/` and attachment bytes in a sibling `~/.claude-explorer/files/` keyed by conversation and file UUID.

`sessionKey` expires eventually. When that happens, the next Refresh click gets a `401` / `403` / `cf-mitigated` response, and the back end automatically launches the Playwright login flow again so you get a new cookie without dropping to the CLI. The same headless CLI commands (`claude-explorer capture`, `claude-explorer fetch`) are also available for the days when you'd rather drive the whole pipeline from a cron job or another script, e.g. for the MCP server.

## The Conversation List (Sidebar)

The sidebar makes the unified corpus visible: one list, containing both Claude Desktop conversations (read from the fetched JSON files) and Claude Code sessions (read live and cached from `~/.claude/projects/*.jsonl`), with a few affordances that make it usable once you've got more than a couple dozen sessions. Special shout-out to Donald Norman for *The Design of Everyday Things*, which everyone should read! That was my intro to the word "affordance".

<div align="center">
<img src="Pasted image 20260514121201.png" alt="The Claude Explorer sidebar showing the source filter dropdown, project grouping, starred sessions, and the refresh button" width="300">
</div>

### Source filter and project grouping

At the top, you can search by title or project.

Just below that, you'll see the named filter dropdown. More on that in a bit.

Next is a simple source filter dropdown: `All Conversations` | `Claude Desktop` | `Claude Code`. That sounds trivial, but it helps because your brain tends to remember context before content.

Claude Code sessions can also be grouped by project. The UI pulls the project name from the directory the session ran in, which is usually the git repo root (or at least somewhere inside it); it then renders a collapsible grouping so you can treat *"everything I did in repo `foo`"* as a first-class bucket.

### Row metadata

Each row in the list carries just enough metadata to let you scan without clicking:

- The session title (or a derived title when the source format doesn't provide one).
- A source badge (`Desktop` or `Code`).
- A last-updated timestamp.
- A message count.

Those four fields give you the shape of the conversation: whether it was long or short, fresh or old, and where it came from. That's surprisingly close to how humans remember work; we rarely remember exact filenames, but we do remember that something happened "last month," that it was "a big one," and that it was "the CLI session, not the web chat."

You'll also see a starred group at the top. When you find something you know you'll come back to (a good project retrospective, a hard-won debugging thread, a clean solution you don't want to lose), you star it and it stops drifting away into the scrollback. Note that we also have message bookmarks, which we'll see later.

### The refresh button

There's a refresh button at the top of the sidebar, and it does exactly what you want in a unified browser: one click triggers a Desktop fetch for new conversations *and* a re-scan of the Claude Code directory. You don't have to remember which source needs which kind of refresh; the UI just rebuilds the corpus and you keep reading. I asked for that because I'm lazy, and laziness is the mother of "make it one button." Refresh is bound to `⌘+R`.

### The phantom-session filter

Claude Code sometimes spawns sessions with only local-command scaffolding and no real conversation; the sidebar filters those out, while keeping any session where real conversation appears after the scaffolding (titled from the first non-system message). Noise and annoyance are killers of trust in a tool.

### Named filters

Below the source dropdown, the sidebar carries a small *named-filter* picker for saving and reusing title-pattern filters. Each filter has a name plus a behavior (*hide matches* or *show only matches*) plus one or more patterns. E.g., a single `cron jobs` filter can match every recurring job pattern you don't want cluttering up your view all the time, and toggling it on hides them all. The active selection is sticky across reloads, so tomorrow's view of the archive is whichever one you closed with today.

Filters can also be composed into groups that AND / OR other named filters together, which is handy when you want one filter that, e.g., hides cron jobs AND keeps client-A work without juggling two toggles. Exactly one filter is active at a time: pick *Hide work-day chores* to narrow, pick *All conversations* to broaden.

## Reading Messages

Before we get to global search and keyboard navigation that span the whole archive, let's look at how the viewer presents the conversation in front of you. Tool calls and slash commands both get deliberate treatment so the human-readable thread stays readable.

### Tool blocks and slash commands

The viewer hides `tool_use` and `tool_result` blocks by default, because tool output can dominate the screen and drown out the narrative flow of the conversation. When you want them, you toggle them on in the conversation toolbar; when you don't, you read the thread as a human conversation again.

The default is the right one for *reading* a session ("what happened, in plain English?"), and the toggle is there for *auditing* one ("what did the assistant actually run, and what did it get back?"). Reconstructing a debugging thread, for example, we usually want the tool calls visible. Image attachments are deliberately *not* gated by that toggle; they're primary content.

![[Pasted image 20260515191033.png]]

Slash commands get the same careful treatment. When you ran `/coding "Help me trace this bug"` or `/plan <long prose>`, the user's prompt renders as a normal message bubble with a small `/coding` badge above the body so the provenance is obvious.

When you ran `/exit`, `/clear`, or any argless command, the bubble collapses to a muted *"Session: /exit"* marker that's visually de-emphasized; it's chrome, and it's excluded from search and Copy-as-Markdown for the same reason.

And when a session opens with one or more `/exit` markers before any real user message (it happens more than you'd expect on long-running sessions resumed from a different terminal), the leading markers fold into a single *"Session prelude: N earlier /exit runs (show)"* affordance at the top, collapsed by default. You can still expand it if you want to see what happened; you just don't have to look at it every time you open the conversation.

When the **Tools** toggle is on there's an *"Expand / Collapse All Tools"* control that forces every tool block in the conversation open or closed at once. This saves a lot of time when you're reviewing a session with dozens of tool calls; you can collapse everything to skim the high-level conversation, then expand everything when you want to audit what actually happened in detail.

## Searching and Navigating with the Keyboard

Claude Explorer is really a three-pane app: the sidebar, the conversation detail, and a transient search palette that pops in when you hit `⌘+K`. You can search the global archive, step through matches, and read long sessions without your hands ever leaving the keys. Searches stay fast (sub-second on archives in the thousands of conversations) because the back end maintains a **SQLite FTS5** inverted index over every message, including tool calls and tool results; we'll get to the benchmarks at the end of the section.

One quick note on key labels: throughout this section I write shortcuts using the `⌘` glyph because I'm on macOS; on Windows and Linux, every place you see `⌘`, use `Ctrl` instead. The code in `frontend/src/hooks/useKeyboardShortcuts.ts` accepts both modifiers (`metaKey || ctrlKey`), so the shortcuts work everywhere; only the labels are Mac-flavored.

![[Pasted image 20260514161227.png]]

### Overview

All of the search functions tie into a small set of keyboard shortcuts. We'll get to the specifics under each binding's own section below.

The search itself covers every message in the archive, from both the user and the assistant, and that includes tool calls and tool results inside those messages (the `ripgrep` invocations, the test-runner output, the web-search blocks). Searches also compose with whatever scope the sidebar is showing; the active filter, the source dropdown, and the conversation-level Tools toggle all narrow the result set together. This keyboard-driven flow relies on a strict focus model to keep the shortcuts predictable.

### The three-pane focus model

With three panes, keyboard shortcuts need an explicit focus rule. Without one you get half-working bindings, random scroll capture, and that familiar *"why did the key I just pressed do something totally different than five seconds ago?"* feeling.

Exactly one of `{sidebar, detail}` holds focus at any moment, and the keys apply to that pane only. Click anywhere in a pane to focus it; press `Enter` to descend from sidebar to detail, and `Esc` to pop back to the sidebar.

### Emacs by default, Vim for heathens 😉

By default, the app uses an Emacs-ish set of bindings (which you're probably used to from `bash` / `zsh` / etc):

- `Ctrl+N` / `Ctrl+P` move within the focused pane.
- `Alt+N` / `Alt+P` page (within the conversation detail).
- `Alt+<` / `Alt+>` jump to first / last message.
- `Esc` exits the current focus mode (or pops you back to the sidebar).
- `Ctrl+C` behaves as you'd expect in a UI that respects copy behavior.
- `⌘+F` (or `Ctrl+F`) toggles the full-text search panel. Yes, that overrides the classic Emacs `forward-char` reflex; the app is for reading and searching, so `⌘+F` for "find" is the muscle memory most people are reaching for here anyway.

If Vim is more your speed, you can opt in on the settings page. In Vim mode, `j` / `k` move line by line, `g` / `G` jump to top and bottom (single-key rather than `gg`), and `/` starts search; the UI keeps the same explicit focus model, so Vim keys never leak into the wrong pane.

There are also a few bindings that are specific to the *"read a conversation"* experience. In the detail pane, `u` and `a` jump to the next user message and the next assistant message; `U` and `A` reverse direction. I like these because they let you skim by speaker, which is often how you want to review a long thread. If you're hunting for *"what did I actually ask?"* you can jump by `u`; if you're hunting for *"where did the assistant propose that design?"* you can jump by `a`.

The UI also binds `⌘+R` to the refresh action (the same one the sidebar button triggers) so you don't accidentally reload the single-page app and lose your place.

If you ever forget a binding, hit `?` to open the help modal. The modal lists every binding for both modes.

### Running a search (`⌘+K`, `⌘+G`, `⌘+Shift+G`, `⌘+C`, `⌘+F`)

`⌘+K` opens the search panel and runs the query; the shortcut has become the standard across modern apps for *"I want a fast, global search"*. The pane slides in from the right so we can see the conversations list and the search hits list at the same time. The pane actually carries two tabs (Search and Bookmarks); `⌘+K` always lands on Search, and clicking the Bookmarks tab swaps the list view to your saved-message list. We'll get to bookmarks under the conversation pane.

When you type a query and hit enter, the UI sends it to a full-text search endpoint; the back end runs the same query across both sources and returns a single list of hits. Each hit includes enough context to be useful in a skim: conversation title, source, timestamp, and a snippet around the matching text.

Once results are in, the search panel header carries a small inline "N of M matches" counter so you can see your position at a glance. `⌘+G` jumps to the next match and `⌘+Shift+G` jumps to the previous one. `⌘+G` works across the whole result set, jumping between conversations as naturally as between matches in a single thread; if match #7 is in one conversation and match #8 is in another, `⌘+G` takes you there anyway.

If you prefer the mouse, clicking a hit in the results list loads the corresponding conversation and scrolls you precisely to the matching message. If you've ever tried to implement scroll-to-match over a virtualized list, you know why I'm calling it out; this is one of those places where a tiny bit of structure buys you a lot of polish.

#### What gets searched

Search also includes tool calls and tool results. This matters more than it sounds once you use Claude Code heavily. Engineers tend to remember the *effect* of a tool invocation ("the `ripgrep` output showed the string in three files," "the test runner printed that traceback") even when they have forgotten the exact assistant text around it. The same logic covers Claude Desktop sessions where the assistant ran a tool block (web search, web fetch, code execution) inside the conversation; that content is searchable too.
#### focusing on a message

Press `Enter` on a highlighted hit to focus that message bubble in the conversation pane; the search panel stays open so you can keep stepping through matches with `⌘+G`. Press `Esc` to close the panel and stay on whatever message you ended up on, ready to scroll and read with `j` / `k`.

With a match in focus, `⌘+C` copies the message cell to your clipboard. Focus is explicit, so copy is explicit, and you can search, move, copy, and repeat without switching modes. The clipboard gets the message text plus the speaker and timestamp; if you've focused a tool block, you get the tool input or output verbatim.

If you want to adjust the query instead of navigating matches, `⌘+F` jumps focus into the find input. Together with `⌘+K` / `⌘+G` / `⌘+C`, that gives you a one-handed flow: run `⌘+K`, step to a hit with `⌘+G`, do `⌘+F` to tweak the query, and `⌘+C` to copy the focused cell. It's the kind of thing you only notice after you've done it a dozen times, which is exactly the point; the best UI features are the ones you stop noticing because they match how you already work.

#### Query syntax: terms vs phrases

There are two modes you'll use day-to-day, and the distinction matters because each one answers a different question:

- **Multi-word, unquoted**, e.g. `comprehensive medium`. All words must appear in the same matched message, in any order, possibly with other words between them. This is the right tool when you remember a couple of distinctive words from a conversation but have forgotten the exact phrasing; an FTS5 index does the heavy lifting of finding messages where both tokens co-occur. 
- **Quoted phrase**, e.g. `"comprehensive medium"`. The words must appear in that exact sequence. This is the right tool when you remember a specific turn of phrase verbatim. Wrap the whole query in double quotes; the back end translates that to an FTS5 phrase clause, and the snippet only highlights matches of the full phrase.

Both modes highlight every matched token (or phrase) in the snippet, so you can tell at a glance which words triggered the hit.

#### Scope composition

Both search surfaces (the title-search input at the top of the left sidebar and the right-pane full-text search) honor whatever scope the sidebar is currently showing. That includes the **source dropdown** (`All Conversations` | `Claude Desktop` | `Claude Code`), the **workspace dropdown** (for Claude Code sessions, scoping you to a single project), and the **active filter** (any of your saved filters from the *Manage Filters* modal). Search results also respect the **Tools** toggle in the conversation header, so a hit you couldn't see in the viewer never shows up in the result list either. Every active filter narrows the result set further.

The mental model is "the sidebar is the lens; search asks questions through it." Flip a filter off and the previously-hidden matches re-appear without you having to re-type the query, because the search auto-re-runs whenever the scope changes. Same on the MCP side: `list_sessions` already accepts `source` and `project` arguments that mirror the dropdowns; an MCP-aware client (another Claude session) gets the same scoping vocabulary. (There is also a per-conversation *pin* scope, which I'll get to in the next section; it composes the same way.)

#### Scoping search to a conversation or project (Pin)

Search defaults to global, which is the behavior most people expect; you opened the app to find something across the whole archive. There's also a complementary mode that matters whenever you've drilled into a specific session: *"search this conversation only"* (or *"this project only,"* for Claude Code sessions grouped under a `cwd`). In Claude Explorer, that's a **pin**.

There's a small `Search scope` button next to the conversation title with a dropdown carrying two entries: `Pin this conversation` and (when applicable) `Pin this project`. Click one and you're scoped; the SearchPanel sprouts a small rounded scope indicator (a "chip") that says `In: <Conversation Title>` (or the project name), and the sidebar dims any rows that fall outside the scope so you can see at a glance what's currently in play.

This design owes a lot to chip-style scope indicators in macOS Finder, GitHub's repo and org search, and Slack's channel/DM filter; the pattern works because it makes a *mode* visible at the point of decision, instead of hiding it behind a toggle the user might forget they set. The dim, rather than a hard filter, was a deliberate call: the sidebar already does real filtering through the `All / Claude Desktop / Claude Code` source dropdown, and stacking two different *"not applicable"* semantics (*hidden* and *grayed*) would make the sidebar harder to read. Dim says *"still here, just not in scope right now,"* which is a clear description of the state.

The pin is *sticky*. It survives panel close, conversation switching, and a full page reload, because the scope is encoded in the URL as `?pin=conv:<uuid>` or `?pin=project:<path>` rather than in component state. That makes it shareable too; paste a URL with a pin param and the recipient ends up in the same scoped mode.

The pin clears on exactly two events: the user clicks the explicit *unpin* control (either the chip's `×` or the `Unpin and search all →` button that appears in the empty state of a scoped search), or the user types in the **sidebar's title-search box**. That second rule is worth a sentence: the sidebar's title-search is global by construction (it filters the visible conversation list across the entire archive), so running one is the user signaling *"I want to broaden,"* and the pin clears to match.

`⌘+G` honors the scope: when you're pinned to a conversation, `⌘+G` wraps within that conversation's matches; pinned to a project, it wraps within all sessions in that project. `⌘+G` is *"find again,"* and find-again should never yank focus out of the input.

### Sidebar navigation polish

One last bit of polish in the sidebar that ties this all together: when you press `Ctrl+P` or `Ctrl+N` to step through sessions, the UI does not eagerly load each conversation as you scroll. It blanks the conversation pane and renders a hint ("Hit `Enter` to select this conversation.") instead. Loading a heavy session is an explicit action; you scan the list with your fingers on the keyboard, and you only commit to opening one when you actually want to read it. That single decision is the difference between *"keyboard nav is fast"* and *"keyboard nav makes the whole app feel slow because every step opens a new conversation."*

### Performance (FTS5 index)

Skip ahead if the internal architecture doesn't interest you. The rest of this section covers the FTS5 search index, the persistent summary cache, the event-driven freshness watchers, the wire-payload split, and the frontend virtualization that took a 4–5 s "loading…" experience down to one that feels instant.

Here's the full picture before the deep dive. All numbers come from `hyperfine` on the same ~1,000-conversation / ~2.5 GB corpus, macOS / M3 Pro / local SSD; the "Before" column is the pre-optimization baseline shipped in early V1 betas.

| Metric | Before | After | Improvement |
|---|---|---|---|
| Sidebar list (`/api/conversations`), warm cache | 4,518 ms | **72 ms** | ~63× |
| Sidebar list, cold SQLite cache, warm filesystem | 11,168 ms | **134 ms** | ~83× |
| Sidebar list, first install, cold everything | ~6,000 ms | **135 ms** | ~44× |
| Search query, narrow term (`q=foobar`) | ≈1,400 ms (linear) | **≈317 ms** (FTS5) | ~4.4× |
| Search query, broad term (`q=python`, ~770 KB results) | ≈1,400 ms (linear) | **≈750 ms** (FTS5) | ~1.9× |
| Search query cold (`q=python` first call after restart) | ≈20,850 ms | **≈780 ms** | ~27× |
| Conversation detail, 288 MB CC JSONL (warm) | 1,474 ms | **≈230 ms** | ~6.4× |
| Markdown export of same conversation (warm) | 1,460 ms | **≈230 ms** | ~6.4× |
| Search-ready time after server restart | ~15 s | **<1 s** | ~15× |
| Startup time-to-image-protection | ~15 s | **~1 s** | ~15× |
| In-flight search freshness (CC session updated while running) | up to 600 s | **~2–3 s** | ~200× |
| Sidebar wire payload | 650,640 B | **459,555 B** | −29% |
| Sidebar DOM rows rendered (334-conv corpus) | 334 | **13** | −96% |

A **SQLite FTS5 inverted index** built at backend startup is what keeps things fast, even on archives in the thousands of conversations; the same watcher that protects the CC image cache keeps it warm as new conversations land. The linear-scan path (`orjson` parsing plus an mtime-keyed `FileCache` plus parallel reads via a `ThreadPoolExecutor`) is still in the codebase as a safety-net fallback that triggers if FTS5 isn't available (e.g., with some Linux distros' stock sqlite3 builds) or if the index hasn't finished its first walk yet. So search never goes "down": the FTS5 path is fast, and the fallback is correct.

Performance-wise, the tuned FTS5 path is fast enough that you stop thinking about search on a typical archive. The numbers below come from `benchmarks/bench_search_paths.py` running against my own data directory (about 1,000 conversations across Desktop and Claude Code after phantom-session filtering, ~2.9 GB of JSON on disk, warm OS file cache, FTS5 index built), so they should give you a realistic feel rather than a synthetic best case. Both columns hit the same corpus the same way; the only thing that changes is which code path the dispatcher runs.

The gap between the fallback linear scan and the FTS5 index is large enough to feel:

| Query | Linear scan (fallback) | FTS5 (current) | Speedup |
|---|---|---|---|
| `q=foobar` (narrow) | ≈ 1.4 s | ≈ 317 ms | **~4.4×** |
| `q=python` (broad, ~770 KB of hits) | ≈ 1.4 s | ≈ 750 ms | **~1.9×** |
| `q=python` cold (first call after restart) | ≈ 20.9 s | ≈ 780 ms | **~27×** |
| `q=<no-match>` (the floor cost of asking) | ≈ 1.1 s | ≈ 310 ms | **~3.5×** |

That's well inside the *"feels interactive"* zone for search; the search palette returns hits in under a second and `⌘+K` doesn't make you sit and wait, including the first ⌘+K after a fresh server start.

**The 16 s cold-search bug, in detail.** Even after the FTS5 index landed, the first `/api/search?q=python` after every server restart took 16–21 s on a 1,000-conversation corpus. The index itself returned MATCH hits in under 100 ms; the slowness lived in a separate pass. After FTS5 narrowed the result set, the search dispatcher walked `store.get_all_conversations_raw(source="all")` to load every matched conversation's body text from disk so it could run the existing `create_snippet` regex over each matched message and build the ±150-char snippet window the UI shows. With a cold filesystem cache that walk read ~1 GB of JSON off the SSD; with a warm cache it still cost ~300 ms of Python dict iteration plus per-file `os.stat`. The FTS5 index made the *lookup* fast, but the *snippet-build* stage still re-read every matched conversation from disk.

The fix replaces the Python scatter-gather with FTS5's built-in [`snippet()`](https://sqlite.org/fts5.html#the_snippet_function). Two existing FTS5 features make this practical. First, the indexed `body` column already stores the exact same `_extract_searchable_text(msg)` projection the Python snippet path operated over, so the character semantics line up byte-for-byte. Second, BM25-driven window selection picks the densest match cluster across multi-token queries instead of arbitrarily marking the first hit; "python script" against a long body lands on the cluster where both words co-occur instead of the first stray "python" in some unrelated paragraph.

The wire format gains a structured `fragments: list[{text, mark}]` field per `MessageSnippet`. The backend parses FTS5's marker-wrapped output once at SQL time and ships pre-split fragments; the frontend's `<HighlightedSnippet>` renders each fragment as either plain text or a `<mark>` — no inline HTML parsing, no `dangerouslySetInnerHTML`, no DOMPurify dependency. The legacy `snippet` + `match_start` + `match_end` triple stays populated for backward compat (MCP consumers and any older frontend keep working), so the change is purely additive on the wire. The old Python scatter-gather path stays in the codebase as the fallback for the rare `context_size="full"` requests (the "expand to whole message" UX) where `snippet()` can't produce the full body.

One pragmatic implementation note: FTS5's `snippet()` is ~140 µs per row on a 861 MB index. Running it across all 5,000 rows that match a broad query (`q=python` on a heavy corpus) costs ~700 ms; capping the SQL `LIMIT` at 1,000 distributes ~10 snippets per matched conversation across ~100 conversations — plenty for the UI's "first 3 + show N more" affordance — and brings the SQL cost back under 400 ms. A two-pass strategy (cheap rowid fetch followed by snippet-only on a small subset) was prototyped and rejected: combining `rowid IN (?, ?, ...) AND messages MATCH ?` forced FTS5 to scan with both predicates, which is slower than just letting MATCH return the top N directly.

**Tool-aware projection via a second indexed column.** The first FTS5 cut shipped a known divergence between the fast path and the linear-scan fallback under the **Tools** toggle. The viewer hides tool_use and tool_result bubbles by default; the search index always stored the full projection (tool blocks included), so `snippet()` occasionally highlighted a token that lived only inside a hidden tool block. The user clicked the sidebar hit, the conversation pane scrolled to the owning message, and nothing matched what they saw. The linear-scan fallback got this right because it re-projected the body at query time and filtered tool blocks before placing the highlight.

The fix gives the FTS5 schema a second indexed body column. `body` keeps the full projection (text + tool_use + tool_result); the new `body_text` column carries the same text-only projection the linear-scan path uses with `include_tool_calls=False`. The query path then picks the column at MATCH time via FTS5's column-scoped syntax: `{body}:(translated_query)` when Tools is on, `{body_text}:(translated_query)` when Tools is off. The snippet position lines up with the column that produced the hit, so the highlight always lands on text the user can actually see. Index size grows ~30% (the text-only projection is most of the body for typical CC sessions; tool args and results are the minority), which is a fair one-time disk cost in exchange for parity with the linear-scan path and zero added query latency. The schema bump (v6 → v7) drops and rebuilds the index on first start under the new code, and the lifespan task does that in the background while linear scan covers search.

**Truncation disclosure on every response.** The `LIMIT 1000` cap on the FTS5 snippet pass means a query that hits 12,000 messages returns the top 1,000 BM25-ranked snippets and silently drops the rest. The first cut shipped that as a hidden ceiling — the response was the same `list[SearchResult]` shape regardless of how many matches existed in the corpus, and the user had no signal that the result set was capped. The wire format now wraps the per-conversation rollup in a `SearchResponse` envelope: `{results, total_messages_matched, returned_messages, truncated}`. `total_messages_matched` comes from a cheap second SQL call (`SELECT COUNT(*) FROM messages WHERE … MATCH …`) under the same WHERE clauses as the snippet query — sub-10 ms on the user's corpus because the count walks the FTS5 inverted lists without paying the `snippet()` cost. A shared `_build_match_where_clause` helper feeds both queries so they can't drift on what they're matching. When `returned_messages < total_messages_matched`, the SearchPanel renders a small muted footer beneath the results: *"Showing first 1,000 of 12,400 message matches. Refine your query to see the rest."* The MCP server's `list_sessions` tool uses a higher cap (5,000) than the HTTP route (1,000), so programmatic and LLM consumers can reason about broader queries without paginating; both expose the envelope unchanged.

The measured cost on the user's current corpus (791 conversations, ~85,000 indexed messages, 1.0 GB FTS5 file after the v7 rebuild): warm `q=python` lands at 906 ms ± 41 ms and returns 1,000 of 22,751 matching messages (`truncated: true`). The same broad query with Tools off uses the `body_text` column, lands at 882 ms ± 13 ms, and returns 1,000 of 3,795 (the narrower projection drops most matches that lived only in tool blocks). Narrow query `q=foobar` lands at 401 ms ± 8 ms with 414 matches total, no truncation. The `/api/conversations` warm path is unchanged at 89 ms ± 6 ms. Index size grew from 834 MB pre-v7 to 1.0 GB post-rebuild — proportional to the duplicated `body_text` content, as expected. The v7 build on this corpus took 24.5 s end-to-end the first time the new code started, and falls back to linear scan during the build (so search keeps working, just slower) — the rebuild is one-time per upgrade.

**The conversation-detail re-parse, in detail.** Every `/api/conversations/{uuid}` request for a Claude Code session was re-parsing the entire JSONL from disk because `ConversationStore._find_conversation_data` called `read_claude_code_conversation()` directly. The Desktop branch in the same function used `self._load_conversation()` which routed through `FileCache`; the CC branch had been missed when the cache wrapper was added in a prior refactor. On the largest CC session on disk (a 288 MB, 16,103-message JSONL) the warm-cache request took 1,474 ms — same on every call, because the cache was never populated. The same path served the Markdown / PDF / JSON export endpoints, so a "Export to PDF" on that conversation paid the same 1.5 s every time the user hit the button.

The fix is a one-line change to route through `_load_conversation_cached(jsonl_path)` instead of the direct call. The same `FileCache.get_or_load` path the Desktop branch uses now serves both. Heaviest-session warm latency drops from 1,474 ms to ~230 ms (the residual is JSON serialization of the 55 MB Pydantic response, not the parse; the parse itself is now a dict lookup). The same payoff carries through to every export endpoint, since they all call `store.get_conversation(uuid)` which now hits the cache.

`FileCache` gained an optional `max_entries` LRU cap at the same time. The default global cache caps at 4,096 entries — high enough that the corpus walks in search and sidebar paths don't thrash the cache (the heaviest known corpus is ~1k conversations), low enough to bound long-running server memory growth. An earlier cap of 64 caused exactly that thrashing on the first benchmark run, surfacing the cap-vs-working-set trade in the most direct way possible.

**First paint used to be the painful one.** `/api/conversations` took around **4.5 s** to return a ~650 KB sidebar payload, dominated by walking every Claude Code session JSONL on disk (~1,000 files, ~2.5 GB on my workstation) to recompute message counts, the latest custom title, and a few other metadata fields. It worked, but it felt slow, and the connection-status dialog had time to flash a "Last error" badge before the response came back. Three small changes fixed it.

**The dominant cost: re-parsing files that hadn't changed.** A "fast" metadata reader still read every byte of every session JSONL on every sidebar request, just because no cache layer persisted across restarts. The fix is a thin SQLite table — `conversation_summaries(path PRIMARY KEY, mtime, size, summary_json)` — co-located in the existing search-index database at `~/.claude-explorer/search-index.sqlite`. On each request, the hot path runs `SELECT … WHERE path IN (…)` against every JSONL path, then drops any row whose on-disk `mtime` or `size` has drifted. Cache hits cost a single SQLite read each. Cache misses still happen — when a CC session grows between requests — but they're now a small fraction of the corpus, fanned out across 8 worker processes via `ProcessPoolExecutor`. (The original plan said `ThreadPoolExecutor` on the theory that orjson releases the GIL during decode; measuring it showed threads were actually *slower* than sequential on this workload because the per-line Python iteration around `orjson.loads` is GIL-bound. Processes sidestep the GIL entirely and read 970 files in 1.55 s in isolation.)

**Auto-invalidation when the scan function changes.** Every persistent cache eventually faces the question "what happens when the code that populates it gets smarter?" Bumping a manual `SCHEMA_VERSION` works but only if you remember to bump it. The cleaner answer is to hash the source code of the producer:

```python
LOGIC_VERSION = hashlib.sha256(
    inspect.getsource(read_conversation_summary_fast).encode()
).hexdigest()[:16]
```

The hash lives in a `conversation_summaries_meta` row, gets compared at lifespan startup, and any mismatch wipes the cache table. Whitespace and comment edits also trigger a wipe — a fair price for never shipping a silent regression where the cached rows say one thing and the live function says another.

**Negative caching for empty sessions.** About 10% of a typical corpus are sessions the metadata reader returns `None` for (phantom sessions that are just a `Caveat: ...` row, sessions with no real user message, etc.). Without remembering "this file produced None," the cache re-reads ~85 files on every single request, adding ~300 ms back onto the warm path. The fix is a literal byte-sentinel blob in `summary_json` that the read path knows means *"the producer returned None for this file at this mtime+size; don't bother re-opening it."* A cache *hit* with value `None` is distinct from a cache *miss*, which is what the caller needs to know.

**Serialization: `ORJSONResponse` over FastAPI's default encoder.** A one-line decorator on the `@router.get("")`. On a 1 MB payload this saves around 30 ms — barely visible against a 4.5 s baseline, but visible once the rest of the path got fast enough to make 30 ms a meaningful fraction.

**Drift detection piggybacks on a watcher that already runs.** The image-cache watcher (`backend/cc_image_watcher.py`) was already doing a 600 s "backstop poll" pass that walks the live data directories for the FTS5 search index. The same iteration now upserts the summary cache in the same transaction — two purposes, one walk, single source of truth for *"what files have we re-examined since last mtime change."*

**The new numbers** (`hyperfine`, 10 runs, warm caches):

| Query | Before | After | Status |
|---|---|---|---|
| `/api/conversations` warm (FS + SQLite both hot) | ≈ **4.5 s** | ≈ **87 ms** | ✓ target met |
| `/api/conversations` cold SQLite, warm FS | n/a | ≈ **137 ms** | ✓ target met (<300 ms) |
| `/api/conversations` first-install, 1,000 files, cold FS | ≈ **4.5 s** | ≈ **123 ms** | ✓ target met (<1.5 s) |

The warm path is the one users actually feel: every refresh, every workspace switch, every `Cmd+R`. That dropped 57×, the connection-status dialog stopped firing on first paint, and the sidebar now paints essentially instantly.

The cold-restart path needed more work. The first request after a server restart used to take 5–6 s because the FastAPI lifespan hook kicked off two heavy background tasks at the same time: building the FTS5 search index from scratch (1,000 files / ~13,000 messages) and pre-warming the CC image cache (walking every session for `[Image: ...]` markers). Both competed with the first incoming request for CPU and disk bandwidth. The fix has two parts. An eager-fill background task populates the summary cache on startup, so the first request after a cold restart with a populated SQLite cache hits warm rows immediately. The two heavy tasks (FTS5 build and CC image-warm scan) then start a short delay after lifespan yield, giving the first request a clear runway.

The FTS5 build originally needed a 5 s head start of its own. The build called `get_all_conversations_raw(source="all", full_content=True)`, which loaded every message of every conversation into memory before doing any per-file mtime check. That walk took ~10 s of contended disk reads on every restart, even when zero files had drifted. A separate refactor swapped this for a drift-first scan: enumerate every on-disk conversation path, fetch the whole `indexed_files` table in one SELECT, diff in Python, and only load content for the drifted set. Warm restarts now absorb their drift in ~100 ms instead of ~10 s, and the FTS5 build's delay drops back to 500 ms. The search-ready time after restart moves from t≈15 s back to t≈1 s; the FTS5 path takes over from linear scan within the first second of server uptime, so a ⌘+K within the first few seconds of launching the app now hits the index instead of the fallback.

The CC image-warm scan used to wait its own 5 s for the same contention reason, then walked every session looking for `[Image: ...]` markers — a separate 10 s of disk I/O on every restart. A later pass merged that work into the FTS5 build: `search_index._load_conversation_at` already calls `read_claude_code_conversation`, which calls `cache_all_markers` as a side effect, so each drifted CC JSONL the FTS5 build reads already warms its images implicitly. The standalone warm task survives as a fallback only when FTS5 is disabled (`CLAUDE_EXPLORER_DISABLE_SEARCH_INDEX=1`) — and even on that path the 5 s sleep is gone, since the contention rationale only made sense when FTS5 was also walking the corpus.

**Event-driven freshness while running.** The same drift refactor also closed a long-standing in-flight freshness gap. The image-cache watcher already had an event-driven primary path (`watchdog`) for image files, plus a 600 s backstop poll. The search-index drift pass piggybacked on the backstop only, which meant an active CC session edited mid-run took up to ten minutes to appear in search results. A second `watchdog` Observer now watches `~/.claude/projects/` for `*.jsonl` modifications and queues a debounced drift call (default 2 s, env-tunable). CC writes JSONLs append-only as the user types, so a single message can fire 5–20 `on_modified` events in rapid succession; debouncing collapses each storm into one `update_drifted_files` call per session. Search-fresh time during runtime drops from up to 600 s to about 2–3 s after the edit lands.

**Virtualizing the sidebar list.** Once the network call landed at 80 ms, the cost of rendering ~1,000 list rows on the main thread became the visible bottleneck. The fix is `@tanstack/react-virtual` wrapping the flat sidebar list: only the rows in the viewport (plus a small overscan window) get mounted, and the scroll container sees the full height via a CSS spacer. On a 334-conversation corpus, the rendered row count drops from 334 to 13, and the `<aside>` element tree shrinks from ~5,300 nodes to ~330 — a 94% DOM reduction that takes the linear-in-N reconciliation and layout work with it. First-Contentful-Paint moved from 76 ms to 64 ms (median, 5 runs against the production build), modest at this corpus size, but the gap widens as the archive grows. The grouped-by-project view stays non-virtualized — per-group collapse is the natural pagination there. Variable row heights (Desktop rows are 83 px, Claude Code rows are 119 px because of the project-path subtitle) made `scrollToIndex` flaky under React 18 + StrictMode, so deep-link and keyboard-nav scrolls set `scrollTop` to an estimated offset and let each row's own `scrollIntoView({block: 'nearest'})` effect finish the centering once it mounts.

**Trimming the payload.** With virtualization handling the render side, the wire format got an audit. Four `ConversationSummary` fields looked unused by the sidebar; three turned out to have non-sidebar consumers (the MCP server's `list_sessions` and `export_session` tools depend on `summary` and `human_message_count`; the conversation detail page reads `git_branch`), so only `is_temporary` came off the model outright. Each kept field now carries an inline comment naming the consumer that depends on it, so the next audit doesn't have to repeat the grep. Payload size dropped from 650,640 to 629,829 bytes (3.2%).

**Splitting the list-item shape.** The bigger win arrived once the audit showed `summary`, `human_message_count`, and `git_branch` all have consumers OUTSIDE the sidebar but no consumer INSIDE it. The fix is a second Pydantic model, `ConversationListItem`, that lives as a strict subset of `ConversationSummary`. The `/api/conversations` route serves the skinny shape; the router still asks `store.list_conversations` for the full one so the server-side `?search=` filter keeps matching against `summary`, then projects via `model_validate(..., from_attributes=True)` per row before serialization. The detail endpoint, the search path, the per-conversation MCP tools, and `ConversationDetail` (which still extends `ConversationSummary`) all see the unchanged shape. Payload dropped from 629,829 to 459,555 bytes, a 27% reduction on top of the earlier trim, and warm latency stayed at ~85 ms (vs. ~80 ms before; the per-row projection costs microseconds at ~1,000 rows). The earlier hesitation about API-stability cost evaporated once the schema-stable surface stayed schema-stable: the only consumer that sees the slimmer shape is the in-tree React frontend, which ships from the same repo.

If you want to take your own measurements, the repo ships a `make bench` target that drives the whole canonical suite — sidebar, search (warm + cold via server restart), conversation-detail at small/medium/large/xlarge size percentiles, and Markdown export — against a running backend on `:8765`. The output is a single table you can paste into a PR body; `make bench-json` emits the same numbers as structured JSON. The harness auto-picks fixture UUIDs from the live corpus at the 5th / 50th / 95th / 99th size percentiles so the same `make bench` invocation produces meaningful coverage on whatever corpus the developer has, with the chosen UUIDs printed for reproducibility. Two focused scripts also ship for narrower questions: `benchmarks/bench_perf.py` hits two endpoints with custom stats, and `benchmarks/bench_search_paths.py` calls `_search_via_linear_scan` and `_search_via_index` directly so you can compare both paths in-process. For ad-hoc one-off measurements outside the suite, [`hyperfine`](https://github.com/sharkdp/hyperfine) is still the right tool — `brew install hyperfine` on macOS, `apt install hyperfine` on Debian or Ubuntu, `cargo install hyperfine` if you have a Rust toolchain handy. `make bench` is the canonical "did this PR regress anything" check; it is intentionally NOT a CI gate (per-machine baseline storage is a different plan) and instead lives in the PR-template checklist so the dev runs it before posting.

## Inside the Conversation Pane

Now that we can move around efficiently, we can look at the rest of the detail pane: timestamps, image attachments, the lightbox, the local image cache, and the copy / branches / scroll-to-match affordances.

When you select a conversation in the sidebar (and hit `Enter`, because loading is explicit), the detail pane renders the full session as a sequence of message bubbles. The goal here is straightforward: preserve the structure of the original exchange, but make it easy to skim, search, and export.

![[Pasted image 20260515131449.png]]

### Timestamps and content blocks

Each message shows a local timestamp, on both sides of the conversation. That matters more than you'd think, because time is part of the story; *"this was a ten-minute back-and-forth"* feels different than *"this took three hours and spanned lunch."*

Messages can contain multiple content blocks. In practice, you'll see three:

- `text` blocks for normal conversation.
- `tool_use` blocks when the assistant invokes a tool.
- `tool_result` blocks for the tool's output.

### Image attachments and the lightbox

Image attachments live next to the content blocks rather than inside them; Claude Desktop ships them on the message itself, and the viewer renders them inline as thumbnails. Single attachments display at their natural aspect ratio (capped to a readable height); multiple attachments fall into a tidy two-column grid of square tiles, with a `+N` overflow tile when a single message carries more than five images.

![[Pasted image 20260515132702.png]]

Click any thumbnail and a full-screen lightbox opens; arrow keys move between images, `Esc` closes, `d` downloads, and `o` opens the original in a new tab.

The thumbnail and the lightbox both load through the same local backend proxy that handles your other Claude Desktop fetches, so images keep working even when you're offline from claude.ai itself. The proxy refuses any request that tries to escape the data directory via `..` or absolute-path injection: `/api/attachments` and `/api/cc-image` both resolve the request path against the configured root and refuse with a 4xx error if it doesn't fall inside, so no amount of clever URL crafting can read a file outside `~/.claude-explorer/`.

### Image caching (Desktop and Claude Code)

Images live in two places depending on which Claude they came from. Claude Desktop attachments (images, PDFs, anything else attached to a message) come from the `claude.ai` API with the conversation fetch. Claude Code stores its image-cache files at `~/.claude/image-cache/<sess>/<N>.png` and **deletes them on its own rotation schedule**, so a screenshot you pasted last month may already be gone by the time you go looking for it. Claude Explorer keeps its own permanent local copy of both; the `install-watcher` you ran during install is what makes that protection always-on, even while the dev server isn't running.

#### Under the hood (for the curious)

Skip ahead if the caching architecture doesn't interest you.

I made the cache opportunistic because losing an image is irreversible. Claude Code rotates its own cache (`~/.claude/image-cache/`) on a schedule I can't control, so by the time the explorer notices a file is gone, the bytes are gone too.

To guarantee that protection, the back end mirrors images along three independent paths. First, an eager scan grabs images when you read a conversation. Second, a lazy capture triggers when you view an image via `/api/cc-image`. Third, a continuous background watcher grabs images the moment they appear on disk, using the `watchdog` library on top of FSEvents on macOS, inotify on Linux, and ReadDirectoryChangesW on Windows; a 10-minute backstop poll catches the rare event the OS drops or coalesces.

The `install-watcher` command extends the continuous path beyond the `claude-explorer serve` lifetime. It registers the same event-driven watcher to run continuously at login, with restart-on-crash, using launchd on macOS, a systemd user unit on Linux, and Task Scheduler on Windows. The CLI dispatches by `sys.platform` so a single command works everywhere. On Linux, one extra step (`sudo loginctl enable-linger $USER`) keeps the watcher alive across logout; without that, your protection pauses every time you close the GUI session. Verify the job is running with the status command for your platform:

```bash
launchctl list | grep claude-explorer
# or systemctl --user status claude-explorer-cc-watcher.service
# or schtasks /Query /TN ClaudeExplorerCCWatcher
```

Captured images are written to disk permanently. Claude Desktop attachments save to `~/.claude-explorer/files/<conv-uuid>/<file-uuid>/{thumbnail|preview|original|document}` as part of the fetch; Claude Code images mirror into `~/.claude-explorer/cc-images/<sess>/<sess>--<N>.<sha8>.<ext>`. The mirror is content-addressed (sha8 in the filename) and append-only, so duplicates dedup and a captured image stays captured.

There is also a one-shot escape hatch for forcing a re-walk; you shouldn't normally need it since the background watcher covers normal use.

```bash
claude-explorer warm-cc-cache
```

### Copy, branches, and scroll-to-match

Copy affordances show up where you'd expect. Each content block shows a *"two overlaid pages"* copy icon on hover, and the conversation header includes a *"Copy as Markdown"* action that copies the entire thread as Markdown to your clipboard. This becomes a workflow the first time you realize you can paste a whole session into notes, a pull request description, or a retrospective document without wrestling with formatting. The copy paths respect the same tool-call toggle as the viewer; one truth, three surfaces (viewer, copy, export).

There's also a *"View branches"* button on the conversation header. Claude can create branches when you edit an earlier message and regenerate from there; when branches exist, the UI renders a tree visualization so you can see the structure, and you can click any leaf to switch the conversation pane to that branch's path (the URL gains a `?leaf=<uuid>` so the choice is shareable and back-button friendly).

Finally, the scroll-to-match behavior we discussed in search shows up here too. Each message bubble carries a stable identifier, and the UI uses it to jump directly to a matching message when you click a search hit; it's deterministic, and it makes the *"search then read"* loop feel tight.

### Bookmarks (message-level)

Stars in the sidebar save a whole conversation; bookmarks save a single message inside one. Hover over any message bubble and a star icon appears in the action overlay alongside the copy icon; clicking it adds that message to your bookmark list and turns the star amber. Clicking it again removes the bookmark. Argless-command markers (`/exit`, `/clear`) deliberately do not get the bookmark affordance, since *"save a meaningful message"* is the whole mental model.

The bookmark list lives in the **Bookmarks** tab of the right pane (the same pane that holds the search results; click the tab header to switch between them, and the choice persists across sessions). The list groups bookmarks by conversation, and each row shows a ~140-character snippet of the saved message, an optional note you can edit inline, and the timestamp. Click any row to navigate to that exact message in the conversation pane; an edit icon opens the note field, and a trash icon deletes the bookmark.

A small **Export to Markdown** button at the top of the panel writes the whole bookmark set to a single `bookmarks-YYYY-MM-DD.md` file. Each entry includes the snippet and any note, grouped under its conversation, so the export reads cleanly outside the app. The back end persists everything atomically to `~/.claude-explorer/bookmarks.json`, so a `claude-explorer serve` restart never loses a bookmark.

With the core reading experience covered, the remaining features are the ones that make the app comfortable to live in: appearance controls, a small settings page, the responsive layout, and exports.

## Appearance and Settings

Most of us spend enough time in tools like this that comfort earns its keep; if a UI fights your eyes, your hands, or your screen size, you stop using it. Claude Explorer keeps these parts simple and predictable.

### Dark mode (Light, Dark, System)

Theme is a three-valued state: `'light' | 'dark' | 'system'`, and `'system'` is the default. (Skip ahead if the theming internals don't interest you.) When you pick `system`, the UI follows your OS preference via `matchMedia('(prefers-color-scheme: dark)')`, including changes mid-session; if you flip your system from light to dark while the app is open, the UI flips with it. The app applies the effective theme by toggling a `.dark` class on the document element, which keeps the CSS story straightforward and avoids the *"half the app is themed, half isn't"* problem.

The toggle lives in the sidebar footer, and it cycles Light → Dark → System. I like cyclical toggles for three-state theme because it's fast, it's discoverable, and it doesn't require a settings panel trip every time you're on a laptop in a bright cafe.

### Settings (`/settings`)

The settings page is deliberately small. It has four sections: *Appearance* (theme), *Keyboard Navigation* (Emacs vs Vim), *Data* (data directory and fetch controls), and *About*. It's the place you go to make a deliberate choice; the main UI remains the conversation list and the conversation viewer.

Settings persist server-side rather than in browser localStorage. (Skip ahead if the persistence internals don't interest you.) When you change a setting, the front end `PATCH`es `/api/preferences`, and the back end writes the merged blob to `~/.claude-explorer/preferences.json` (atomic tmp-and-rename, `0600` permissions, deep-merge per key, and a `try/finally` that unlinks the `.tmp` if the rename ever fails so the data dir stays clean even after a botched write).

The practical consequence is that your settings follow you across browsers and Incognito windows on the same machine; pick `Dark` mode and Vim navigation in Chrome, then open the same `localhost:5173` in Safari, and you get the same configuration without re-clicking anything. The front end keeps a localStorage mirror as a fallback so the UI keeps working if the back end is briefly down (any in-flight write is gone, but everything before it survives).

Almost done. We can browse, search, navigate, and read comfortably; the last practical feature is the one that turns *"a viewer"* into *"an archive you can actually use elsewhere."*

## Exports (Markdown and PDF)

If the goal is to make your Claude history *yours*, then *"I can read it in the browser"* is only half the story. You also want to move it into other tools: paste a thread into a pull request, save a session as a note, archive a conversation as a PDF, or hand a Markdown export to a teammate as part of a retro.

Claude Explorer has two export formats per conversation: Markdown and PDF.

### Markdown export

Clicking *Markdown* in the conversation header opens a small dialog with three radios: **Inline** (a single `.md` file with images as `data:` URLs), **Bundle CommonMark** (a `.zip` with `conversation.md` plus `images/` and `attachments/` folders, using standard `[name](path)` links), and **Bundle Obsidian** (the same zip layout but with `[[wikilink]]` syntax in `conversation.md` so it drops cleanly into an Obsidian vault). A *"Save as default"* checkbox saves the choice so the dialog pre-selects your last pick the next time you open it. Inline is great for pasting a thread into a pull request or a notes app; bundles are the right pick when you want a portable archive that survives without the local server running.

Bundles include every attachment in the conversation, of every kind. Image attachments (both Claude Desktop and Claude Code) land in `images/`; PDFs, text files, and anything else Claude Desktop accepted as a document land in `attachments/`. The Markdown links inside `conversation.md` are rewritten to point at the bundled paths, so the export remains internally consistent whether you're reading it in CommonMark, Obsidian, or unzipping it for a teammate.

The export honors the same `showToolCalls` toggle as the viewer. One truth, three surfaces (viewer, copy, export); if you've decided tool calls should be visible for this session, that decision applies consistently whether you're reading in the UI, copying to your clipboard, or exporting to a file.

Backend export also strips two `TOOL_PLACEHOLDER` strings Claude Desktop bakes into the conversation: the common *"This block is not supported on your current device yet."* and the rarer *"Viewing artifacts created via the Analysis Tool web feature preview isn't yet supported on mobile."* The Anthropic API sometimes hands you back a conversation in flattened form (the structured `content[]` array empty, only a pre-rendered `text` field), and any block the originating Desktop client couldn't render at write time, most commonly a tool call (web search, MCP server, artifact, the analysis REPL, file ops), is gone for good, replaced by one of those placeholder strings. Claude Explorer can suppress the noise so the bundle reads cleanly, but the original block is not on disk anywhere; nothing can put it back.

### PDF export (WeasyPrint)

WeasyPrint handles PDF export. It needs a few system libraries (`pango`, `cairo`, `libffi`); if you ran the optional `brew install` line up in the install section, you're set. PDF export then works the way you'd expect: you click export, you get a PDF representation of the conversation. Just like the Markdown export, whether or not the tool calls appear depends on the toggle.

Image attachments come through with their bytes embedded, which is unusual; HTML-to-PDF pipelines without an HTTP context typically produce broken-image placeholders. (Skip ahead if the PDF generation internals don't interest you.) This works because the back end hands WeasyPrint a `url_fetcher` callback that resolves `/api/cc-image` and `/api/<org>/files/...` URLs from disk, including the permanent attachment cache, so a screenshot you pasted into a Claude Code session three months ago still embeds in the PDF even after Claude Code rotated the original.

If you're thinking *"why bother with PDF when Markdown exists,"* the answer is simple: PDF is a stable artifact. Markdown is great for editing and reuse, but it will render differently depending on where you view it; PDF is the thing you can stick in an archive folder, attach to a ticket, or keep as *"this is exactly what we saw at the time."*

At this point, we've covered the UI tour: install and first run, the unified sidebar, search, match navigation, keyboard focus and shortcuts, reading sessions, appearance and settings, and exports. All that's left is the feeling you get when you realize what you're actually looking at.

## Your History, On Your Disk

Claude Desktop keeps your conversations server-side, so you need to be online and signed in to read them; Claude Code keeps sessions on your machine, but by default it deletes session transcripts older than 30 days from `~/.claude/projects/` at startup (and rotates its image cache off disk on its own schedule).

The session-transcript retention is controlled by the `cleanupPeriodDays` setting in `~/.claude/settings.json`; the default is 30, the minimum is 1, and a large value like 36500 effectively preserves transcripts indefinitely:

```json
{
  "cleanupPeriodDays": 36500
}
```

I learned about that setting the hard way: Claude Code deleted a batch of sessions out from under me one morning, and I had to restore them from Time Machine. Add the setting before you start trusting your local archive.

If you're on a Mac and you've already been bitten, `utils/restore-deleted-sessions-and-images.sh` in the repo will pull both the missing session JSONLs and the image-cache PNGs back out of a Time Machine disk. It walks Time Machine snapshots newest-first, restores anything that's gone from `~/.claude/projects/` and `~/.claude/image-cache/`, refuses to overwrite files that still exist, and supports `--dry-run` so you can see the plan before anything moves.

Claude Explorer gives you a single archive you can read and search locally, without needing to remember which interface holds which half of your history or whether the bit you want has already aged out.

The payoff is not that the UI is pretty (it's fine), or that the keyboard shortcuts are clever (they're consistent), or that export works (it does). The payoff is that the long sessions you almost remember, the ones that taught you something real, stop being ephemeral. You can find them again, quote them, reuse them, and hand them to your future self, who will actually be able to read them.

## Coming Up: Another Claude, Querying Yours

Up to now we've been talking about how *we* browse: the sidebar, full-text search, keyboard navigation, and exports. Part 3 flips the point of view; another Claude queries the same on-disk archive via an MCP server, so your history becomes something a fresh session can interrogate without you copy-pasting anything.

That MCP server exposes five tools (`list_sessions`, `list_projects`, `get_session_outline`, `get_messages`, `export_session`), and the outline-first pattern is the trick that keeps it practical; a new Claude Code run can start broad, then zoom in, even when the underlying session is thousands of messages long.

And yes, I used this MCP server to mine this project's own history to write this series. Which prior conversation would you most want a fresh Claude session to read for you?

## Wrapping Up!

Ok, that's enough for today! We covered a lot of ground: installing with `uvx` (one line, no clone, no environment management), capturing a `sessionKey` via Playwright, fetching Claude Desktop conversations into `~/.claude-explorer/conversations/`, and then using the web app to browse a unified sidebar, run full-text search with `⌘+K`, navigate matches with `⌘+G`, drive the whole UI from the keyboard with an explicit focus model, read sessions with tool-call toggles and timestamps, switch themes (with settings that follow you across browsers), and export conversations to Markdown (Inline, Bundle CommonMark, Bundle Obsidian) or PDF, with image attachments preserved across Claude Code's silent rotation thanks to a permanent local cache.

Part 3 dives into the MCP server we just teased: install paths for Claude Code and Claude Desktop on macOS, Windows, and Linux, the outline-first querying model in more detail, and the workflows that come with it (the self-referential retrospective, the `CLAUDE.md` tuning loop). It's the part of the project that makes me happiest. 🤓

One last note before the sign-off, since I led with it at the top: this is an independent, community-built project, not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are Anthropic trademarks; this tool just consumes their public APIs and on-disk formats the way any other client would, and those formats may change without notice. If they do, the project will catch up; the archive on your disk is yours either way.

Before you go, comment with the one session you wish you could hand to a fresh Claude Code run and say, "summarize this and pull out the decisions." Like last time, please comment below with any questions, corrections, etc. If you liked this, please clap and follow me here and on LinkedIn.

See you next time!
