<!--
  Medium series: Unlocking Your Claude History
  Part 1 of 5 — Draft
  Sources: PROCESS/93_use_cases.md, 90_themes.md, 91_memorable_quotes.md, 92_timeline.md, 99_voice_cheatsheet.md, README.md
  Voice: Raymond Peck's "Best Practices for Modern REST APIs in Python" series
-->

# Part 1 — What This Thing Is and Why You'd Want It

***In this first part of the series, we meet the project: a local, unified, searchable archive of every conversation you've ever had with Claude, on both Desktop and Code, plus an MCP server that lets a new Claude session query the whole corpus programmatically.***

## The Hook

Here's a question that probably hasn't kept you up at night, but should have: *where exactly is all the stuff you've ever asked Claude?* Not the clever one-liners, the ones you remember. The long debugging sessions. The three-hour architecture arguments where you and the model finally landed on a good design. The half-written prompts you abandoned but meant to come back to. The Claude Code runs where you tried four approaches before one stuck.

If you're a heavy Claude user, that's a lot of material, and the honest answer is that it's scattered. Some of it lives in Claude Desktop, which is an Electron app that wraps `claude.ai` and stores conversation history server-side *only*. Some lives in Claude Code, which drops each session as JSONL under `~/.claude/projects/` on your own disk. Some lives inside Claude Desktop's Code tab, which only shows you the Claude Code sessions you ran from inside Claude Desktop, and quietly hides the ones you ran from the CLI. None of it is in one place. None of it is searchable together. And the Claude Desktop half is accessible only so long as you remain authenticated to the account that owns it.

This project fixes that. It gives you one local directory containing every Claude Desktop conversation and every Claude Code session, a web UI that shows each session in its entirety with full-text search across the combined corpus, and, bolted on the side, a **Model Context Protocol** server that exposes the same archive to a new Claude Code or Claude Desktop session as five structured tools. The UI is how you browse and read. The MCP server is how another Claude reads.

That second piece is the one I'm more excited about, and it's the one that snuck up on me while I was building the first piece. We'll come back to it.

## The Grounding Fact

Before we talk about what you can *do* with a unified archive, let's be precise about where your history actually lives today, because that's the gap this project fills.

Claude Desktop stores your conversation history **server-side only**. The app is a thin view onto the Anthropic backend. If you poke around your Mac looking for a local cache, you'll find chat drafts (unsent text in the input box) in `~/Library/Application Support/Claude/IndexedDB/`, and you'll find app-update URLs in `~/Library/Caches/com.anthropic.claudefordesktop/`. You will *not* find your conversations. They're not there. To read them, your local app has to ask the server, every time.

Claude Code, on the other hand, writes each session to disk as a JSONL file under `~/.claude/projects/<project-slug>/*.jsonl`. The data is right there on your machine, in a reasonable format, owned by you. But there is no shipped UI to browse or search it. If you want to find a particular session from three months ago, you're left with `find`, `grep`, and a prayer.

So the status quo is: half your history is somebody else's to show you, and the other half is yours but unreadable. This project's job is to copy the first half down to your disk on a schedule you control, read the second half live from where it already lives, and put both of them behind a single UI and a single MCP surface.

## A Prose Architecture Diagram

Three moving parts, in order. **Capture** gets a valid `sessionKey` out of Claude Desktop or `claude.ai`, either by intercepting it through a local mitmproxy with `--ignore-certificate-errors` on the Claude Desktop launch, or by running a Playwright-controlled browser that lets you log in normally and then reads the cookie. **Fetch** uses that session key to walk the `chat_conversations` API and download every conversation (plus attachments: images, canvas transcripts, PDFs) into per-conversation JSON files under `~/.claude-exporter/conversations/`; it also picks up `render_all_tools=true` on the URL so tool-call content actually survives the capture. **Browse / Export / Query** is where you spend your time afterward: the FastAPI backend reads the Desktop JSONs from disk and the Claude Code JSONLs live from `~/.claude/projects/` (no import step, single source of truth), the React frontend shows them behind one unified list with project grouping and a Cmd+K full-text search, and the `mcp_server/` package exposes the same corpus as five MCP tools over stdio so another Claude instance can query it.

That's it. Capture once. Fetch whenever you want fresh data. Then browse or query forever, without the network or the account in the loop.

## The Use Cases

I'll walk through six reasons you'd actually install this, in the order I think they land. Three are UI-driven, two are MCP-driven, and one is the edge case the whole project started from. I've deliberately interleaved UI and MCP instead of grouping them, because if I listed all the UI use cases first you might go *"cool, it's a local archive, got it"* and bail before getting to the MCP ones. The MCP ones are arguably the higher-leverage half.

### Use case 1: Unified local archive with full-text search *(UI)*

Claude Desktop ships its own full-text search, and it's a genuinely good feature. The catch is that the data it searches lives on Anthropic's servers, reachable only through a logged-in Desktop or web session. Claude Code keeps its sessions in `~/.claude/projects/*.jsonl` on your machine, but ships no UI at all for browsing them. Between the two of them, everything you've ever asked Claude is split across two storage systems, accessed through two different interfaces, owned by different parties.

*Claude Explorer* (the web UI half of this project) pulls both into a single local corpus and a single searchable view. `Cmd+K` opens a command palette that runs full-text search over every message, across both sources, in one pass. The archive is on your disk. No account, no network, no subscription required to read it once it's been captured.

The need for this got hammered into shape during the build in a very concrete way. At one point we had full-text search wired up on the backend but nowhere in the UI, and the sidebar "search" was doing nothing more than filtering titles and summaries. As I wrote in one of those build prompts: *"The full-text search hook exists but isn't used anywhere in the UI. The sidebar search only filters by title/summary."* The fix was to keep the title filter where it was but add a real `Cmd+K` palette that queries the actual search endpoint, and then, much later, to make `Cmd+G` walk the result list with a fast path plus background prefetch of adjacent conversations. That way, navigating hits across a 5,000-message corpus feels instant instead of making you wonder if the app has frozen.

The other piece worth calling out is the word *unified*. Claude Desktop's Code tab is useful, but it only shows Claude Code sessions you ran from inside Claude Desktop. The CLI ones are invisible there. In an early reframing prompt I wrote: *"Claude Desktop only shows the Claude Code sessions that I ran inside Claude Desktop under the Code tab. That's fine, but I'd like our front end (conversation browser) to show and be able to search all Claude Code sessions, whether they are from the CLI or from inside Claude Desktop."* That one sentence quietly changed the scope from *Claude Desktop exporter* to *unified Claude history browser*, and most of the rest of the UI followed from it.

We'll do the full UI tour in Part 2 (install, first run, conversation list, search, keyboard nav, exports). For now, the takeaway is: everything you've ever asked Claude, one list, one search box, on your disk.

### Use case 2: MCP-powered retrospective, query your own build history from a new session *(MCP)*

This is the use case that got me to build the MCP server in the first place, and it's the one I'd lead with if I had thirty seconds to pitch the whole project to another engineer.

The MCP server exposes five tools: `list_sessions`, `list_projects`, `get_session_outline`, `get_messages`, and `export_session`. All five speak to the *same* corpus the web UI browses (Desktop JSONs plus live-read Claude Code JSONLs), but through a schema designed for outline-first, messages-on-demand querying. A new Claude Code session can walk through an old session message by message without trying to swallow the whole thing into context and promptly blowing up.

When I first proposed this to myself (via Claude, which is a funny loop to describe), the prompt was pretty specific: *"I want to build an MCP server into this project, so that Claude Code and Claude Desktop can query our saved sessions. An example use case would be to read through an entire session bit by bit… and find mistakes that Claude Code made that we had to correct through followon prompts. Another use case would be to read through the session(s) for a project and write a comprehensive blog post about the work that went into it. We might use this session's project as a test case for this."*

Reader, that last sentence is *exactly* what's happening right now. The Medium series you're reading was mined out of this project's own 5,005-position build session using the MCP server that was shipped in the last phase of that same build session. The tool eats its own tail on purpose. A new planning session attached to the `claude-sessions` MCP server, issued the query *"Find all the sessions for project claude-desktop-message-exporter"*, walked the main session phase by phase using `get_session_outline` plus targeted `get_messages` calls, produced the per-phase extractions, the quote list, the timeline, and the use-case synthesis, and then handed that pile to the drafting agent that wrote this article. I did not hand-transcribe any of it. I don't have that kind of patience.

The more generalizable instance of this pattern (and the one I'm planning to run next) is *"summarize the entire work history of a project across every session."* I've got another project I'm working on, with a thick stack of Claude Code sessions layered on top of it. Once this series ships, I'm going to point the MCP server at that archive and ask Claude Code to produce a proper retrospective: who asked for what, which approaches got tried and abandoned, which durable decisions shaped the codebase, which mistakes are worth codifying as standing rules. That kind of summary is the single highest-leverage thing I can think of doing with an LLM-queryable session archive, because the context that would otherwise live only in the heads of the engineers who did the work gets written down in a form a new collaborator can actually read in an afternoon.

We'll get into the technical details of the MCP server (tool surface, token cost, install path) in Part 3, and we'll watch this exact self-referential retrospective as the closing demo of Part 5.

### Use case 3: Cross-device, cross-account consolidation *(UI)*

Once you've used Claude across more than one context, you start bumping into a problem the tooling doesn't quite acknowledge. Claude Desktop conversations don't live in the same place as Claude Code sessions. Claude Code sessions from one machine don't live in the same place as Claude Code sessions from another machine. And if you have more than one Claude account (personal *plus* work, or full-time plus contractor, or two clients), those histories don't mix either. Every one of those silos is its own little island, with its own interface, its own search, its own retention policy.

The UI in this project treats every source as first-class: Desktop conversations from the fetched JSON, Claude Code sessions read live from disk (no import step, because *a single source of truth can't get out of sync*), every `source` tagged and filterable, every Claude Code session grouped by the project (usually the git repo) it ran in. The real payoff isn't neatness, it's *learning across silos*: a prompt, pattern, or workaround you figured out in one context becomes discoverable in another, instead of being siloed and forgotten the moment you switch hats.

A caveat worth stating plainly in prose, not tucking into a footnote: **you remain responsible for protecting your employer's intellectual property.** Unifying everything in one local archive does not change that. It doesn't mean you should archive your employer's conversations onto a personal machine, or search your work sessions from a personal one. Use the source and project filters in *Claude Explorer* to keep contexts separate when the data model requires it. When in doubt, keep work history under your employer's control, not yours. The project is a tool, not a license, and IP hygiene is still on you.

One small architectural decision from the build is worth flagging here, because it's the single most important choice inside this use case. Early on the plan was to *import* Claude Code JSONL into the same `conversations/` directory the Desktop fetcher wrote to, so the backend could read from one place. I vetoed that in a single prompt: *"why copy conversations from the local JSONL to the conversations/ dir? That seems like a poor design choice; it's better to have a single source of truth, so it can't get out of sync."* The backend was then rebuilt to read Claude Code live from `~/.claude/projects/` at request time. That one sentence collapsed a half-built import pipeline into a live-read architecture, and it's the reason the corpus never drifts out of sync with what `claude` itself sees.

Project grouping and source filters are Part 2 material; the point for now is that the archive is a single searchable view, not a pile of folders.

### Use case 4: Find mistakes Claude Code made so you can tune your agent prompts or `CLAUDE.md` *(MCP)*

This is a named subset of use case 2, and it deserves its own section because it's probably the single most repeatable loop the MCP server unlocks. The prompt that kicked off the MCP work names it directly: *"find mistakes that Claude Code made that we had to correct through followon prompts."* That's a specific pattern. Claude proposes an approach, you push back, Claude fixes it. Repeat across hundreds of sessions and you have a gold mine of signals about where your agent's defaults don't match your actual preferences.

With the MCP server attached to a fresh Claude Code instance, that instance can walk your old sessions, surface the *proposal → pushback → fix* sequences systematically, and propose updates to your `CLAUDE.md` or your agent prompts based on what it finds. This is the single most durable improvement loop I know of that you simply *cannot run* when your transcripts live in two opaque stores.

The build history of this project is itself rich with these moments. The "no self-credit in commit messages" rule had to be asserted *twice* and eventually got propagated into `~/.claude/CLAUDE.md` *and* into every `llm-council-*.md` agent file. The "never broad-`pkill`" rule was born from a single blast-radius incident when a `pkill uvicorn` blew away another project's server mid-phase, at which point I wrote: *"Hey, I'm working on multiple projects that use Uvicorn. You need to be more selective with your pkill commands! Remember this."* The "always use `uv` with a project-local `.venv`" rule required two interrupts of a tool call before it stuck. Each of those is a durable rule born from a single correction event, and each is exactly the kind of signal a retrospective pass can pull out in bulk.

If I had to pick the single highest-ROI activity for a team that ships any meaningful amount of work through Claude Code, it would be: once a quarter, run this retrospective over the last quarter's sessions, and ship the resulting `CLAUDE.md` diffs. Do that on an ongoing basis and your agent genuinely gets better at working with *your* codebase, not the average codebase it was trained on.

More on this in Part 3 (how the tool surface supports it) and Part 5 (the demo itself).

### Use case 5: Self-contained archive, including attachments *(UI)*

A smaller but genuinely practical beat. The fetcher doesn't just download message text. It downloads **attachment bytes** (images, canvas or artifact text, and PDFs, the last of which arrive via the nested `files_v2.document_asset.url` / `thumbnail_asset.url` shape) into a per-conversation `files/` directory next to the JSON. The upshot: your archive survives Claude's server-side expiry of attachment URLs. Your PDFs stay, your canvas transcripts stay, your screenshots stay.

The PDF case is the illustrative one and it's worth a paragraph because it's a teaching moment. The first implementation of the attachment fetcher assumed `files_v2` entries had the same flat shape as `files` entries (`thumbnail_url` and `preview_url` as top-level keys). The real shape nests those URLs one level deeper, under `document_asset` and `thumbnail_asset`. The bug was invisible until I spot-checked a specific conversation I knew had a PDF: *"I just fetched a new conversation. It should have a PDF attachment. I see it in the Claude Desktop app, but our fetcher utility didn't get it."* That one poke exposed the whole nested-shape issue, and (as is often the case with bugs found by looking at actual data rather than mocks) the fix was small once the shape was understood.

I'll flag this again in Part 5 as an example of *read the actual JSON before coding against your mental model of the JSON*, because it's a habit this project taught me twice.

### Use case 6: Data portability, before something takes your history away *(edge case)*

This is the use case the whole project originally started from, and it is *not* the hook for a reason. Framed wrong, it sounds sketchy. So let's frame it right.

Claude Desktop stores your history server-side. That server-side storage is governed by whatever account is associated with the app. If you lose access to that account (SSO gets revoked when you leave a job, the email address on the account gets rotated and you no longer control it, the subscription lapses, the account gets closed, the employer offboards you) the history effectively disappears. Claude's official export path sends a link to your account email, which is exactly the path you've just lost.

There is a narrow edge case here: *you can still be authenticated inside Claude Desktop even when you can't log in anywhere else.* Claude Desktop doesn't re-authenticate every time it starts. If it still has a valid session, it happily runs. The mitmproxy credential-capture path in this project is the escape hatch for exactly that situation. You launch Claude Desktop through a local proxy, the addon grabs the session key out of the outgoing requests, and the fetcher walks the API with it. The Playwright login path (which is the cleaner default when you *can* log in) doesn't help in this specific case, because there's nowhere to log in.

In my own words from the build session, when the user (me) was explaining why both credential-capture paths needed to live side by side: *"The mitmproxy method works for my initial case, where the Playwright one can't: I lost access to a work Claude account (so I couldn't log in), but I was still logged in to Claude Desktop. The mitmproxy method allowed me to export all my sessions. Please leave the plugin, and document how to use it in the README.md. I don't know if anyone else will ever be in this situation, but this was a lifesaver and I don't want to lose it."*

This is an edge case. It is not the pitch. But it's a real capability, and if you're in that specific spot (or you're about to be, which is the honest pre-condition for every SSO revocation I've ever seen) it's a one-time one-way door worth knowing exists.

## So: Should You Run This?

If any of these are true, probably yes:

- You use Claude Desktop and Claude Code and you're tired of alt-tabbing between two different search boxes (and a third, for the CLI sessions Desktop hides).
- You want a local, searchable, backed-up copy of your Claude conversations that isn't subject to server-side retention, account state, or network access.
- You want a new Claude Code session to be able to read your old sessions as structured data, not as opaque text files.
- You want to run a retrospective over your own Claude Code history and propose `CLAUDE.md` updates based on actual correction patterns.
- You're about to lose access to an account whose conversations you'd like to keep.

If none of those are true (you use Claude casually, on one account, on one machine, and you're fine with server-side search being the only way in) then honestly, you don't need this. Claude Desktop is a good product. I am not trying to replace it. I'm trying to build the thing that lives *next to* it for the users who've outgrown what the single-account, single-source view can do.

## Wrapping Up!

Ok, that's enough for today. We covered a lot of ground: where Claude Desktop and Claude Code each keep your history (and don't), what this project does to unify those into a single local corpus, and six concrete reasons you'd want it (three UI-driven, two MCP-driven, and one edge case for the unlucky day you lose an account). The headline is still the same as the lede: one searchable archive, plus a programmatic door into it so another Claude can read it for you.

Next time we'll walk through the UI together. Install and first run, the conversation list, full-text search across both sources, the keyboard navigation (Emacs mode by default, Vim mode if that's your thing), dark mode, mobile, and exports to Markdown and PDF. It's the tour I'd give you if you were sitting next to me and I was opening the app for the first time on your laptop.

Like last time, please comment below with any questions, corrections, or pushback. If you liked this, please clap and follow me here and on LinkedIn. And if you're already running a local Claude archive of your own (I know a few of you are) I'd love to hear how you've been using it, because half the use cases above only became obvious to me *after* the archive existed.

See you next time! 🤓
