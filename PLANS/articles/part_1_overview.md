<!--
  Medium series: Unlocking Your Claude History
  Part 1 of 5 — Draft (v2, post-Council review 2026-04-20)
  Sources: PROCESS/93_use_cases.md, 90_themes.md, 91_memorable_quotes.md, 92_timeline.md, 99_voice_cheatsheet.md, README.md
  Voice: Raymond Peck's "Best Practices for Modern REST APIs in Python" series
  Council contributors: gemini-3-pro-preview + gpt-5.2 (both neutral stance)
-->

# Part 1 — What This Thing Is and Why You'd Want It

***In this first part of the series, we meet the project: a local, unified, searchable archive of every session you've ever had with Claude, on both Desktop and Code, complete with your prompts, Claude's responses, and all the tool calls and tool results in between. And, alongside it, an MCP server that lets a new Claude session query the whole corpus programmatically.***

## The Hook

Here's a question that probably hasn't kept you up at night, but should have: *where exactly is all the stuff you've ever asked Claude? And its answers?* Not the clever one-liners, the ones you remember. The long debugging sessions. The three-hour architecture arguments where you and the model finally landed on a good design. The half-written prompts you abandoned but meant to come back to. The Claude Code runs where you tried four approaches before one stuck.

If you're a heavy Claude user, that's a lot of material, and the honest answer is that it's scattered. Some of it lives in Claude Desktop, which is an Electron app that wraps `claude.ai` and stores conversation history server-side *only*. Some lives in Claude Code, which drops each session as JSONL under `~/.claude/projects/` on your own disk. Some lives inside Claude Desktop's Code tab, which only shows you the Claude Code sessions you ran from inside Claude Desktop, and quietly hides the ones you ran from the CLI. None of it is in one place. None of it is searchable together. And the Claude Desktop half is accessible only so long as you remain authenticated to the account that owns it.

This project fixes that. It gives you one local spot containing every Claude Desktop conversation and every Claude Code session, a web UI that shows each session in its entirety with full-text search across the combined corpus, and, alongside it, a **Model Context Protocol** server that exposes that same archive to a new Claude Code or Claude Desktop session as five structured tools. The UI is how you the human search and browse and read; the MCP server is how another Claude session searches and browses and reads.

That second piece is the one I'm more excited about, and it's the one that snuck up on me while I was building the first piece. We'll come back to it.

## The Grounding Fact

Before we talk about what you can *do* with a unified archive, let's be precise about where your history actually lives today, because that's the gap this project fills.

Claude Desktop stores your conversation history **server-side only**. The app is a thin view onto the Anthropic backend. If you poke around your Mac looking for a local cache, you'll find chat drafts (unsent text in the input box) in `~/Library/Application Support/Claude/IndexedDB/`, and you'll find app-update URLs in `~/Library/Caches/com.anthropic.claudefordesktop/`. You will *not* find your conversations, they're not there. To read them, your local app has to query the server every time.

Claude Code, on the other hand, writes each session to disk as a JSONL file under `~/.claude/projects/<project-slug>/*.jsonl`. The data is right there on your machine, in a reasonable format, owned by you. But there is no shipped UI to browse or search it. If you want to find a particular session from three months ago, you're left with `find` and `grep` and `xargs`.

Half your history is somebody else's to show you, and the other half is yours but unreadable. This project's job is to copy the first half down to your disk on a schedule you control, read the second half live from where it already lives, and put both of them behind a single UI and a single MCP surface.

## The Shape of the Thing

At a high level, the project is three pieces that share one on-disk corpus:

```
   Claude Desktop                           Claude Code
   (server-side only)                       (JSONL on disk)
         │                                        │
         │   capture  (mitmproxy OR                │
         │   Playwright login)                     │
         ▼                                         │
    fetch all conversations                        │
         │                                         │
         ▼                                         │
   ~/.claude-exporter/                             │
   conversations/*.json                            │
         │                                         │
         └──────────────┬──────────────────────────┘
                        │   one unified corpus
                        ▼
                 FastAPI backend
                        │
            ┌───────────┴────────────┐
            ▼                        ▼
         React UI                MCP server
       (search, read,           (5 tools,
        keyboard nav,            stdio)
        Markdown/PDF)
            │                        │
            ▼                        ▼
         You read              Another Claude reads
```

There's a **capture-and-fetch flow** that pulls every Claude Desktop conversation down into `~/.claude-exporter/conversations/` as JSON files, attachments and all. There's a **web UI** (I call it `Claude Explorer`) that reads those JSONs *and* reads Claude Code sessions live from `~/.claude/projects/`, merges them behind one list, and hands you both a left-side side panel with the sessions list (which you can group and search and such) and a right-side search panel that runs full-text search across the whole thing. And there's an **MCP server** that exposes the same unified corpus to a fresh Claude Code or Claude Desktop session as five structured tools, so you can have your agents query your history programmatically.

We'll get into how each piece actually works in the "Under the Hood" section at the end. First, the reasons you'd want any of this.

## The Use Cases

Five reasons you'd actually install this, with UI and MCP use cases interleaved on purpose; the MCP ones are arguably the higher-leverage half, and I don't want you closing the tab after three UI-shaped ones.

### Use case 1: Unified local archive with full-text search *(UI)*

Claude Desktop ships its own full-text search. The catch is that the data it searches lives on Anthropic's servers, reachable only through a logged-in Desktop or web session. Claude Code keeps its sessions in `~/.claude/projects/*.jsonl` on your machine, but ships no UI at all for browsing them. Between the two of them, everything you've ever asked Claude (and everything Claude has ever answered back, and every tool it called, and every tool result that came back) is split across two storage systems, accessed through two different interfaces, owned by different parties.

*Claude Explorer* (the web UI half of this project) pulls both into a single local corpus and gives you two ways to search it. The **left sidebar** has a title filter that narrows the conversation list as you type, for the case where you remember *roughly* what a session was about. The **right side of the window** has a persistent full-text search panel that walks you through every match across every message in the combined corpus, for when you need to find the exact turn where something got said. Both searches share the same keyboard-first philosophy: everything important is one keystroke away from your left hand, so you can hunt across thousands of sessions without ever reaching for the trackpad. Part 2 has the full key map.

The need for the full-text version got hammered into shape during the build in a very concrete way. Early on we had a backend search endpoint wired up but nothing in the UI used it, and the sidebar "search" was doing nothing more than filtering titles and summaries. As I wrote in one of those build prompts: *"The full-text search hook exists but isn't used anywhere in the UI. The sidebar search only filters by title/summary."* That was the prompt that forced the real full-text UX into existence: first a modal palette against the backend endpoint, then a match-walk with a background prefetch of adjacent conversations so navigating hits across a 5,000-message corpus feels instant, and most recently the persistent right-side panel that replaced the modal so you can browse hits without losing your place.

The other piece worth calling out is the word *unified*. Claude Desktop's Code tab is useful, but it only shows Claude Code sessions you ran from inside Claude Desktop. The CLI ones are invisible there. In an early reframing prompt I wrote: *"Claude Desktop only shows the Claude Code sessions that I ran inside Claude Desktop under the Code tab. That's fine, but I'd like our front end to show and be able to search all Claude Code sessions, whether they are from the CLI or from inside Claude Desktop."* That one sentence quietly changed the scope from *Claude Desktop exporter* to *unified Claude history browser*, and most of the rest of the UI followed from it.

We'll do the full UI tour in Part 2. For now, the takeaway is simple: every session you've ever had with Claude, one list, one search box, on your disk.

### Use case 2: MCP-powered project retrospective *(MCP)*

This is the use case that got me to build the MCP server in the first place, and it's the one I'd lead with if I had thirty seconds to pitch the whole project to another engineer.

The MCP server exposes five tools: `list_sessions`, `list_projects`, `get_session_outline`, `get_messages`, and `export_session`. All five speak to the *same* corpus the web UI browses (Desktop JSONs plus live-read Claude Code JSONLs), but through a schema designed for outline-first, messages-on-demand querying. A new Claude Code session can walk through an old session message by message without trying to swallow the whole thing into context and blowing up.

When I first proposed this to myself (via Claude, which is a funny loop to describe), the prompt was pretty specific: *"I want to build an MCP server into this project, so that Claude Code and Claude Desktop can query our saved sessions. One use case would be to read through the session(s) for a project and write a comprehensive blog post about the work that went into it. We might use this session's project as a test case for this."*

And yes, that last sentence is *exactly* what's happening right now. The Medium series you're reading was mined out of this project's own build session using the MCP server that was shipped in the last phase of that same build session. The tool eats its own tail on purpose. A new planning session attached to the `claude-sessions` MCP server, issued the query *"Find all the sessions for project claude-desktop-message-exporter"*, walked the main session phase by phase using `get_session_outline` plus targeted `get_messages` calls, produced the per-phase extractions, the quote list, and the use-case synthesis, and then handed that pile to the drafting agent that wrote this article. I did not hand-transcribe any of it. As I often say, laziness is the mother of invention!

The more generalizable instance of this pattern (and the one I'm planning to run next) is *"summarize the entire work history of a project across every session."* I've got another project I'm working on, with a thick stack of Claude Code sessions layered on top of it. Once this series ships, I'm going to point the MCP server at that archive and ask Claude Code to produce a proper retrospective: who asked for what, which approaches got tried and abandoned, which durable decisions shaped the codebase. That kind of summary is the single highest-leverage thing I can think of doing with an LLM-queryable session archive, because the context that would otherwise live only in the heads of the engineers who did the work gets written down in a form a new collaborator can actually read in an afternoon.

We'll get into the technical details of the MCP server (tool surface, token cost, install path) in Part 3, and we'll watch this exact self-referential retrospective as the closing demo of Part 5.

### Use case 3: Cross-device, cross-account consolidation *(UI)*

Once you've used Claude across more than one context, you start bumping into a problem the tooling doesn't quite acknowledge. Claude Desktop conversations don't live in the same place as Claude Code sessions. Claude Code sessions from one machine don't live in the same place as Claude Code sessions from another machine. And if you have more than one Claude account (personal *plus* work, or multiple clients, or full-time plus contractor), those histories don't mix either. Every one of those silos is its own little island, with its own interface, its own search, its own retention policy. Learnings from one project only transfer to other projects via human neurons.

The UI in this project treats every source as first-class: Desktop conversations from the fetched JSON, Claude Code sessions read live from disk (no import step, because *a single source of truth can't get out of sync*), every `source` tagged and filterable, every Claude Code session grouped by the project (usually the git repo) it ran in. The real payoff is *learning across silos*: a prompt, pattern, or workaround you figured out in one context becomes discoverable in another, instead of being siloed and forgotten the moment you switch hats.

A caveat worth stating plainly in prose, not tucking into a footnote: **you remain responsible for protecting your employer's intellectual property.** Unifying everything in one local archive does not change that. It doesn't mean you should archive your employer's conversations onto a personal machine, or search your work sessions from a personal one. Use the source and project filters in *Claude Explorer* to keep contexts separate when the data model requires it. When in doubt, keep work history under your employer's control, not yours. The project is a tool, not a license, and IP hygiene is still on you.

One small architectural decision from the build is worth flagging here, because it's the single most important choice inside this use case. Early on the plan was to *import* Claude Code JSONL into the same `conversations/` directory the Desktop fetcher wrote to, so the backend could read from one place. I vetoed that in a single prompt: *"why copy conversations from the local JSONL to the conversations/ dir? That seems like a poor design choice; it's better to have a single source of truth, so it can't get out of sync."* The backend was then rebuilt to read Claude Code live from `~/.claude/projects/` at request time. That one sentence collapsed a half-built import pipeline into a live-read architecture, and it's the reason the corpus never drifts out of sync with what `claude` itself sees.

Project grouping and source filters are Part 2 material; the point for now is that the archive is a single searchable view, not a pile of folders.

### Use case 4: Find the mistakes Claude Code made, so you can tune `CLAUDE.md` *(MCP)*

Use case 2 is about summarizing *what you did*. This one is about summarizing *what went sideways*, and using that to improve your agent.

Every interesting Claude Code session leaves a trail of small corrections: things the agent proposed and you rejected, things the agent did that turned out to be subtly wrong, things the agent quietly forgot between context compactions. A week of those adds up. A quarter of those adds up to a gold mine. And none of it is easily mineable when your transcripts live in two opaque stores.

With the MCP server attached to a fresh Claude Code instance, that instance can walk your old sessions and surface several patterns worth codifying. The ones I've found most valuable so far:

- **Proposal → pushback → fix.** Claude suggests an approach, you push back, Claude corrects. Each of these is a preference signal: what *your* codebase wants, not what the average codebase wants.
- **Wrong-assumption bugs.** Claude wrote code against an imagined API shape or data model without looking at the actual data, and you caught it later. The generalizable rule is almost always *"read the actual JSON / API response before coding against your mental model."* Worth an explicit entry in `CLAUDE.md`.
- **Context loss across compactions.** Claude forgot a codebase convention after a context compaction. Where does the test fixture live again? What's the naming scheme? What's the deploy script? Surface these and write them into `CLAUDE.md` once and for all, so the next session starts with the invariants already loaded.
- **Rule violations.** Claude ran `pkill uvicorn` and blew away another project's dev server. Claude used `cat | grep` instead of `rg`. Claude wrote `TODO` instead of filing a proper issue. Each violation is a rule that needed to be explicit, and usually isn't until it's been violated.
- **Over-eager optimization.** Claude helpfully hard-coded `message_count=0` on a fast path to make the listing "snappy" and quietly broke search. These are the hardest to find without a retrospective pass, because the symptom and the cause are separated by days.

The build history of this project is itself rich with these moments. The "no self-credit in commit messages" rule had to be asserted *twice* and eventually got propagated into `~/.claude/CLAUDE.md` *and* into every `llm-council-*.md` agent file. The "never broad-`pkill`" rule was born from a single blast-radius incident when a `pkill uvicorn` blew away another project's server mid-phase, at which point I wrote: *"Hey, I'm working on multiple projects that use Uvicorn. You need to be more selective with your pkill commands! Remember this."* The "always use `uv` with a project-local `.venv`" rule required two interrupts of a tool call before it stuck. Each of those is a durable rule born from a single correction event, and each is exactly the kind of signal a retrospective pass can pull out in bulk.

For a team that ships real work through Claude Code, I like running this as a small weekly loop. Pull the last week's sessions, have a fresh Claude Code instance with the MCP server propose `CLAUDE.md` diffs, and then *make a human read and edit the diffs before anything lands*. The human-curation gate matters more than any individual diff: without it, `CLAUDE.md` accumulates cruft, gets overfit to one bad session, or contradicts itself. With it, the rules file stays aligned with the mistakes you're actually paying for, and nothing lands that the maintainer hasn't signed off on. Weekly is my pace; yours might be per-PR or per-sprint. The cadence is less important than the loop.

More on the mechanics in Part 3 and more on the demo itself in Part 5.

### Use case 5: Self-contained archive, including attachments *(UI)*

A smaller but genuinely practical beat: the fetcher doesn't just download message text. It downloads **attachment bytes** (images, canvas and artifact text, and PDFs) into a per-conversation `files/` directory next to the JSON. Your archive survives Claude's server-side expiry of attachment URLs. Your PDFs stay. Your canvas transcripts stay. Your screenshots stay.

The PDF case is the one that caught us. I pulled a fresh conversation and went looking for the attachment, because I knew it was there. My note from the build session was blunt: *"I just fetched a new conversation. It should have a PDF attachment. I see it in the Claude Desktop app, but our fetcher utility didn't get it."* Sure enough, the fetcher was parsing `files_v2` as if it looked like the older `files` shape, with `thumbnail_url` and `preview_url` as top-level keys. The real shape nests those URLs one level deeper, under `document_asset` and `thumbnail_asset`. Once I looked at the actual JSON and followed the nesting down to the asset URLs, the fix was small, and the archive started keeping PDFs the same way it already kept images.

I'll come back to that one in Part 5 as a cautionary tale, because it's a habit this project taught me more than once: *read the actual JSON before coding against your mental model of the JSON*. The mental model is always tidier than the data.

## So: Should You Run This?

If any of these are true, probably yes:

- You want to run a retrospective over your own Claude Code history and act on it: summarize the sessions, look for specific info or patterns by semantics, propose `CLAUDE.md` updates based on actual correction patterns, etc.
- You want a new Claude Code session to be able to read your old sessions as structured data, not as opaque text files.
- You use Claude Desktop and Claude Code and you're tired of alt-tabbing between two different search boxes (and a third, for the CLI sessions Desktop hides).
- You want a local, searchable, backed-up copy of your Claude conversations that isn't subject to server-side retention, account state, or network access.

If none of those are true (you use Claude casually, on one account, on one machine, and you're fine with server-side search being the only way in) then honestly, you don't need this. Claude Desktop is a good product. I am not trying to replace it. I'm trying to build the thing that lives *next to* it for the users who've outgrown what the single-account, single-source view can do.

## Under the Hood

Now for the *how*. This is the architecture tour; we'll go deeper in later parts but it's worth having the whole shape in one place before the series starts drilling down.

**Capture.** Getting a valid `sessionKey` out of Claude Desktop or `claude.ai` is the only interesting part of getting started, and there are two supported paths. The **mitmproxy path** launches Claude Desktop through a local HTTPS proxy with `--ignore-certificate-errors`, grabs the `sessionKey` and `org_id` out of the outgoing requests, and writes them to `~/.claude-exporter/credentials.json`. The **Playwright path** launches a controlled browser, lets you log in to `claude.ai` the normal way, and then reads the session cookie after you're in. The two paths cover different failure modes: Playwright is cleaner when you can still log in, mitmproxy is the escape hatch when you can't (SSO gone, email rotated, account offboarded, but the Desktop app is still authenticated). Both paths stay supported. You pick whichever works for your situation. I'll go deeper on credential capture in Part 3 alongside the MCP install story.

**Fetch.** Once you've got credentials, `claude-exporter fetch` walks the `chat_conversations` API. It also picks up `render_all_tools=true` on the URL so tool-call content actually survives the capture, which took a fix to discover; without it, Claude Code conversations came back as placeholder-only shells. Each conversation writes to disk as a single JSON file in `~/.claude-exporter/conversations/<uuid>.json`, and if the conversation has attachments (images, canvas and artifact text, PDFs via the nested `files_v2.document_asset.url` shape we just talked about), those land in an adjacent `files/` directory. Fetch is idempotent: re-running is cheap because it only pulls what's new.

**The backend.** A FastAPI app (Python, `uv`-managed venv) reads the Desktop JSONs from disk and the Claude Code JSONLs live from `~/.claude/projects/` at request time, merges both sources behind a unified listing, and exposes endpoints for listing, search, detail retrieval, and export. The *"read Claude Code live instead of importing"* decision turns out to be load-bearing: it means the corpus is always in sync with what Claude Code itself just wrote, without a separate indexing step. Performance work early in the build (orjson for parsing, `mtime`-keyed `FileCache`, `ThreadPoolExecutor` for parallel reads) took listing time from four-plus seconds down to about seventy milliseconds for a corpus of several hundred sessions.

**The frontend.** React 18 on Vite, Tailwind v4 for styling, shadcn/ui for components. The main pieces are the sidebar (conversation list with project grouping), the detail pane (the messages in their original threaded order, with collapsible tool-call blocks), the right-side `SearchPanel` (the one we were just talking about), and a settings page with theme and keyboard-mode toggles. Keyboard navigation is Emacs-default, Vim-optional, and lives behind a central `KeyboardNavigationContext`. All of the UI details are Part 2 material.

**The MCP server.** A small FastMCP-based Python package in `mcp_server/` that exposes five tools (`list_sessions`, `list_projects`, `get_session_outline`, `get_messages`, `export_session`) over stdio. The tool descriptions are written to say *"only call when the user explicitly asks…"* so that a Claude Code or Claude Desktop instance with the server attached doesn't burn tokens on speculative calls. The fixed context cost of attaching this server is small: about 4,700 characters of tool definitions, somewhere between twelve hundred and sixteen hundred tokens per conversation, regardless of whether the tools ever actually get called. Installation is `uv run --directory /path/to/project mcp_server` (it's a local package, not a PyPI one), wired into `~/.claude.json` for Claude Code or `~/Library/Application Support/Claude/claude_desktop_config.json` for Claude Desktop on macOS. Part 3 walks through the setup on all three OSes.

**How it all fits.** The backend is the source of truth for "what sessions exist right now." The UI is a read-only browser on top of that backend (plus the export endpoints). The MCP server is a second, programmatic read-only browser on top of the same backend-internal logic, exposed to another Claude. None of the three components can mutate your Claude Desktop history, because that lives server-side at Anthropic and this project has no write path to it; none of them can mutate your Claude Code sessions either, because those are live JSONL files that Claude Code owns. This is a read-side project, top to bottom.

## Wrapping Up!

Ok, that's enough for today! We covered a lot of ground: where Claude Desktop and Claude Code each keep your history (and don't), what this project does to unify those into a single local corpus, five concrete reasons you'd want it (three UI-driven, two MCP-driven), and the architectural shape that makes it all work.

Next time we'll walk through the UI together. Install and first run, the conversation list, full-text search in the right-side panel, the keyboard navigation (Emacs mode by default, Vim mode if that's your thing), dark mode, mobile, and exports to Markdown and PDF. It's the tour I'd give you if you were sitting next to me and I was opening the app for the first time on your laptop.

Like last time, please comment below with any questions, corrections, or pushback. I'd especially love to hear creative ideas about how to use the MCP server!

If you liked this, please clap and follow me here and on LinkedIn. And if you're already running a local Claude archive of your own (I know a few of you are) I'd love to hear how you've been using it, because half the use cases above only became obvious to me *after* the archive existed.

See you next time! 🤓
