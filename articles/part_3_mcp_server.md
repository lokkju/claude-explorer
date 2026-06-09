<!--
  Medium series: Unlocking Your Claude History
  Part 3 of 7 — Story-led restructure (2026-06-02).
  Focus: real, receipt-backed use cases of the claude-sessions MCP server, light on implementation.
  Sources: the project's own build + drafting sessions, mined through the MCP server itself
  (citations live in PLANS/articles/part3_mcp_server_plan.md and part3-tuning-loop-run.md).
  Voice: Raymond Peck's "Best Practices for Modern REST APIs in Python" series (PROCESS/99_styleguide.md).
-->

# Part 3 — Claude Querying Its Own History: The MCP Server

> *"In my longest Claude Code conversation on this project, what did we decide about the database, and what's still open?"*

Ask a fresh Claude session that, and it answers, without you scrolling back through thousands of messages. It finds the right conversation, skims its outline, reads only the handful of turns that matter, and hands back the decision and the open threads.

***In this part of the series, we point a fresh Claude session at your saved Claude history through a small MCP server, then put it to real work: finding the old session you half-remember, boiling a giant one down to its decisions, turning Claude's recurring mistakes into sharper rules, and mining this series out of the project's own build history.***

> **Disclaimer**: This is an independent, community-built project. It is not affiliated with, endorsed by, sponsored by, or supported by Anthropic, PBC. "Claude" and "Claude Code" are trademarks of Anthropic, PBC. This project consumes Anthropic's products as a user would, via the same APIs and on-disk file formats the official clients use, but nothing here represents an Anthropic-sanctioned interface, and the formats this project depends on may change without notice.

![An ouroboros: the MCP server reading the very session that built it](Attachments/ouroboros.png)

In the previous installment of this series, we covered the web app: how it unifies your Claude Desktop conversations (fetched down to disk) with your Claude Code sessions (read live from `~/.claude/projects/`) and your Claude Cowork sessions (also read live from disk), plus full-text search, keyboard navigation, and exports. If you missed that, make sure to go back and read [Part 1](https://medium.com/@raymondpeck/unlocking-your-claude-history-part-1-f19000c05655) and [Part 2](https://medium.com/@raymondpeck/unlocking-your-claude-history-part-2-using-the-claude-explorer-web-app-user-guide-109191dc24d4) first, because Part 3 assumes you already have a mental model of the on-disk archive.

Part 2 was about how *you* read your archive: you scan the sidebar, run a query, jump between matches, export a session, and so on. In this part, your robot friend is the reader. Another Claude session reads and analyzes the same conversations for you.

That is worth more than it sounds. Once you've got a few hundred Claude conversations behind you, your best thinking lies buried in them somewhere, and you're never going to scroll back to find it: the decision you half-remember, the config that finally worked, the bug you've now hit twice, or more importantly the *process* that led to that bug, are all sitting in transcripts you'll never reopen by hand. Handing that to a fresh session turns it from something you vaguely recall into a library you can put a direct question to and get a straight answer back.

So here's the plan: we'll get the server connected to Claude Code and Claude Desktop on your machine, then walk its five tools, four of which chain into a simple pipeline: find, outline, read, export. After that we'll spend most of our time on the first two uses I made of this server: mining this project's own build history into the series you're reading, and pointing it at my own sessions to find the mistakes Claude Code keeps making and draft sharper rules against them.

Along the way I'll be clear about what I've actually used the server for.

## Contents

- [The First Useful Query](#the-first-useful-query)
- [Connecting It](#connecting-it)
- [The Five Tools, by Example](#the-five-tools-by-example)
- [The Workflow That Mined This Series](#the-workflow-that-mined-this-series)
- [The Claude Self-Tuning Loop](#the-claude-self-tuning-loop)
- [Why Big Archives Are Still Fast](#why-big-archives-are-still-fast)
- [Security and Scope](#security-and-scope)
- [Wrapping Up!](#wrapping-up)

<a id="the-first-useful-query"></a>

## The First Useful Query

The best way to get a feel for this server is to show you the first real thing it ever did. The moment I finished wiring it into Claude Code, I didn't type a "hello world". I typed an actual question the whole project had been building toward:

> *"Find all the sessions for project claude-desktop-message-exporter"*

Note the project name in this prompt: it began life as a simple message exporter for Claude Desktop. As I used it I expanded its scope and renamed it Claude Explorer.

A fresh Claude session turned that one sentence into a tool call, queried my local archive, and answered: nine sessions for that project. The one at the top, with more than five thousand messages, was *"the main development history for this project"*, which is to say it was the very session I had been working in to build the server that just answered the question. The tool's first act was to find itself. Claude's verdict was deadpan: *"The MCP server is working."*

That exchange is the whole idea in miniature. The server speaks **Model Context Protocol (MCP)**, the standard that lets an LLM client (Claude Desktop, Claude Code, or any MCP-aware client) call tools you expose, with structured arguments and structured results. It's deliberately limited: it runs locally as a subprocess your client launches, talks over stdin and stdout with no ports and no network listener, and exposes exactly five read-only tools over your saved archive. [FastMCP](https://github.com/PrefectHQ/fastmcp) handles the protocol plumbing, so I could keep my attention on the one interesting problem: turning *"search my history"* into a safe, explicit, token-efficient query surface.
<a id="connecting-it"></a>
## Connecting It

Before any of the fun you need to attach the server to a client, so let's get that out of the way. The good news is that there's nothing to run and nothing to keep alive: your MCP client spawns the server as a subprocess on demand and speaks to it over stdio, so there's no port to open and no "is my firewall blocking it" debugging. That's how I want local developer tooling to behave.

There's one thing "nothing to keep alive" doesn't cover: your archive. The server reads only what's already on disk, so it's only as useful as the history captured there, and that capture happens back in Part 2. Your Claude Desktop conversations arrive on disk when you hit **Refresh**, and the one-time `claude-explorer install-watcher` from Part 2 runs an always-on job that copies Claude Code's images out of its cache before they rotate off disk. The MCP server itself never fetches and never watches, and it has no network egress at all. So make sure that Part 2 capture is in place before you expect the robot reader to see everything.

Setup is nearly identical on macOS, Windows, and Linux: the Claude Code command is the same everywhere, and for Claude Desktop the only thing that changes is where the config file lives, which I give for all three below.

### Adding it to Claude Code

Claude Code can attach the server at two scopes worth knowing. **User scope** lives in `~/.claude.json` and makes the tool available in every project; **project scope** lives in a `.mcp.json` file at a repo's root and travels with that repo, so anyone who clones it gets the tool too. (One trap worth flagging: MCP servers don't live under `.claude/`, which is for other settings like permissions. Project servers go in `.mcp.json` at the repo root.)

The easy path is the CLI helper: it writes the config for you and pulls the published package from PyPI with `uvx`, so there's nothing to clone and no path to hard-code. For user scope, run:

```bash
claude mcp add --scope user claude-sessions -- uvx claude-explorer mcp
```

Swap `--scope user` for `--scope project` to write a `.mcp.json` in the current repo instead. Confirm either way with:

```bash
claude mcp list
```

If you'd rather edit JSON by hand, the `mcpServers` block is identical at both scopes; only the file differs. For **user scope**, add it to `~/.claude.json`:

```json
{
  "mcpServers": {
    "claude-sessions": {
      "type": "stdio",
      "command": "uvx",
      "args": ["claude-explorer", "mcp"]
    }
  }
}
```

For **project scope**, put the same block in a `.mcp.json` at the repo root, the file your collaborators get when they clone:

```json
{
  "mcpServers": {
    "claude-sessions": {
      "type": "stdio",
      "command": "uvx",
      "args": ["claude-explorer", "mcp"]
    }
  }
}
```

You should see `claude-sessions` in `claude mcp list`, and once you start a Claude Code session, its five tools become available. The server advertises itself as `Claude Session Explorer`, and the tools are the same five we tour below. (Hacking on the project itself? Point `command` at your clone instead: `"command": "uv"` with `"args": ["run", "--directory", "/path/to/claude-explorer", "claude-explorer", "mcp"]`.)

### Adding it to Claude Desktop

Claude Desktop keeps its MCP servers in `claude_desktop_config.json`, and the friendliest way to open that file is from inside the app: **Settings → Developer → Edit Config** drops you right into it. (Settings also has an Extensions browser, but that's only for packaged "Desktop Extension" bundles, which this server isn't, so a plain stdio server like ours is a quick paste into the config rather than a one-click install.) If you'd rather open the file yourself, it lives at:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json` (usually `C:\Users\<you>\AppData\Roaming\Claude\…`)
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Paste the same block you'd use for Claude Code:

```json
{
  "mcpServers": {
    "claude-sessions": {
      "type": "stdio",
      "command": "uvx",
      "args": ["claude-explorer", "mcp"]
    }
  }
}
```

Then **fully quit and relaunch** Claude Desktop, because it only reads that file at startup and closing the window doesn't always cut it. After it reopens, a new chat will have the five tools. One cross-platform gotcha: a GUI app doesn't always inherit your shell's `PATH`, so if Desktop can't find `uvx`, put its full path (from `which uvx` or `where uvx`) in `command`.

### One deliberate guardrail

There's a design decision built into the connection that matters the moment you attach the server, so it's worth learning now. The instructions the server hands the client say, in the bluntest language I could justify:

```text
These tools query saved Claude conversation history. ONLY use them when the
user EXPLICITLY asks to search, browse, analyze, or export past conversation
sessions. Never call these tools proactively or speculatively.
```

That isn't decoration. We'll see why it's worth it when we talk about token cost, but the short version is that an attached tool tempts an eager client to "helpfully" go rummaging through your history on prompts that have nothing to do with it, and I would rather it sat on its hands until you ask.
<a id="the-five-tools-by-example"></a>
## The Five Tools, by Example

The server exposes five tools, all read-only, all pointed at the same files the UI reads. Rather than list them like a reference manual, let's walk them in the order you use them: **list your projects, find the sessions, outline one, pull the exact messages you want, and export a clean slice.** The last four chain into a tidy pipeline; listing projects is just where you get your bearings first. For each, I'll show the plain-English thing you'd type and sketch what comes back. I'm skipping the wire format here; the argument names and return shapes live in the repo for anyone who wants them.

### Listing projects

If you live in Claude Code, you tend to remember work by repo before you remember it by session title, so `list_projects` turns that into a first-class question:

> *"What projects do I have saved, and how many sessions does each have?"*

It returns each project with its session count and sorts them by count. It's a small tool, more of a stepping stone than a destination; you run it to get your bearings, then narrow with `list_sessions`.

### Finding sessions

`list_sessions` is the front door. It either lists everything or runs a full-text search across session titles and message content and hands back the matches. An example prompt is something like:

> *"Search my saved sessions for 'FTS5' and tell me which source each came from."*

Claude turns that into a `list_sessions` call with your query, and gets back a list of sessions plus a total count, where each matching session carries a `match_count` telling you how many of its messages hit. A couple of arguments make this scale to a real archive. You can filter by `source` (`CLAUDE_AI` for your Desktop conversations, `CLAUDE_CODE` for your local Code sessions, `CLAUDE_COWORK` for Cowork) and by `project` (a case-insensitive substring of the project name). Those two filters mirror the source and project dropdowns from the Part 2 UI exactly. I wanted one definition of *"search"* shared between how you browse manually and how Claude browses itself. To have any gap between them would be asking for confusion.

### Outlining a long session

Long sessions are the norm once you do real engineering with Claude Code, and the naive way to query one is also the ruinous way: pour the entire transcript into context and hope. That fails three ways at once. It costs tokens you can't justify, it makes the model wade through material you never needed, and it falls over unpredictably when the session is bigger than the window.

`get_session_outline` solves that by handing back a lightweight summary per message: a stable position, the sender, a 200-character gist, a character count, a tool count, and a timestamp. You *can* read that outline yourself, like a table of contents, but most of the time you never see it. **You ask a higher-level question, and under the hood Claude pulls the outline, skims it on your behalf, picks the handful of messages that matter, and reads only those in full before it answers.** The outline is the tool; the skim-and-select is what Claude composes around it. So the prompt you actually type usually says nothing about an outline at all:

> *"In my longest Claude Explorer session, where did we land on the indexing approach, and what did we rule out getting there?"*

Behind that one sentence, Claude runs a small pipeline: `get_session_outline` to skim the whole session cheaply, then a bounded `get_messages` on just the positions where the decision was hashed out, then an answer built from those exact messages instead of the thousands around them.

The outline is where querying your history becomes a workflow. Once Claude can skim, it can plan: *"find the four decision points, fetch those messages, and summarize them."* Two of the cheap fields turn out to be surprisingly strong signal. A high `tool_count` usually points to where something concrete happened on disk, and a long assistant message is usually where Claude explained a decision, so it can navigate by those without reading a word of the body.

### Reading the messages that matter

Once the outline has pinpointed where to look, `get_messages` pulls the full content of specific messages, addressed by position or by message ID. As with the outline, you rarely name those positions yourself; the same higher-level question drives this step too. Claude reads the positions it picked off the outline and fetches exactly those, so the call it makes under the hood looks like this, even though you never typed a number:

> *"Fetch positions 120 through 135, text only."*

You can drive it by hand when you want to, and positions are easy to read straight off an outline, but most of the time the composition does it for you. By default `get_messages` returns text only, which keeps the common case small. When the text references tool output (*"the grep showed…"*, *"the traceback said…"*), Claude pulls the same positions again with tools included, and now you can quote exact user phrasing, exact assistant wording, and exact command output. That matters if you want your retrospective to be accurate, because paraphrased technical details are where errors breed.

### Exporting a durable slice

Finally, `export_session` turns *"we found the right spot"* into *"give me something I can paste into a doc."*

> *"Export positions 112 through 168 as Markdown, including the tool calls."*

It hands back a single Markdown string, produced by the same export code the UI's "Markdown export" button uses, so the artifact matches what you'd have gotten by clicking in the browser.

Step back, and the through-line across all five tools is the same: you almost never call them one at a time yourself. A single plain-English question, *"find the session where we argued about the indexing approach and show me how it resolved,"* fans out into the whole pipeline at once, the client running `list_sessions` to find the candidates, `get_session_outline` to skim the likely one, then `get_messages` on the handful of positions where the argument reached an answer. The five tools are the vocabulary; the client writes the sentences. That's why the tool descriptions matter so much, and why the next thing I want to talk about is keeping the client from getting too eager with them.

### Keeping the client from getting too eager

Now back to that explicit-only guardrail, because here's the cost it's protecting you from. Attaching an MCP server isn't free: the client injects the tool definitions into the prompt of *every* conversation, whether you ever call them or not. I measured it on the live server, and the five definitions total 4,681 characters, roughly 1,200 to 1,600 tokens depending on tokenization, which you pay per conversation as a fixed tax. It's a small one, and it more than earns itself back the moment you put the tool to work: skimming a five-thousand-message session outline-first costs a fraction of what pasting the whole thing into context would, so one real query saves far more tokens than the tax costs. The explicit-only guardrail protects that trade, keeping an over-eager client from quietly spending tokens on calls you never asked for.
<a id="the-workflow-that-mined-this-series"></a>
## The Workflow That Mined This Series

Part 2 ended on a self-referential tease: I used this MCP server to mine this project's own history to write the series you're reading. Here's what that actually looked like, with the outline-first pipeline at its core, plus one caveat I'll get to at the end.

The goal was the kind of thing that's reasonable but turns into a lost weekend if you do it manually:

> *"Summarize the development history of this project, pull out the decisions and the memorable moments, and turn it into a drafting brief for a Medium series."*

The Claude Explorer MCP server did this for me automagically.

### The haystack

The raw material was a single Claude Code build session that, at the April snapshot I worked from, held **5,207 total messages**. Of those, **5,006** lived on the active branch, and of *those*, only **312** were real prompts I had typed; the rest were tool results that Claude Code records with a human sender tag. So the real shape of the problem was 312 human intentions buried in five thousand messages. No one is reading that by hand, and pulling it all into a context window is the mistake we built the outline tool to prevent.

### Running the pipeline

First, `get_session_outline` collapsed the whole session into a 5,006-row index, one skimmable line per message. Then a pass over that outline detected phase boundaries, the natural seams where the work changed character (scaffolding, then the fetcher, then attachments, then the search index, and so on), which grouped the session into 21 phases. Then, phase by phase, a bounded `get_messages` call pulled only the dozen-or-so real prompts and their immediate answers from that phase's position range. Twenty of those targeted pulls, plus a couple of synthesis passes, produced a small set of on-disk briefs: the themes, the memorable quotes, a timeline, the use cases. We drafted the articles from those briefs.

### What it pulled back out

To make that concrete, here's one thing the extraction handed back: the prompt this MCP server grew from, typed into that build session weeks earlier and then buried under thousands of messages. It read:

> *"I want to build an MCP server into this project, so that Claude Code and Claude Desktop can query our saved sessions. An example use case would be to read through an entire session bit by bit (assuming it won't all fit in context at once), and find mistakes that Claude Code made that we had to correct through followon prompts. This could be used to improve our agent prompts, CLAUDE.md, etc. Another use case would be to read through the session(s) for a project and write a comprehensive blog post about the work that went into it. We might use this session's project as a test case for this."*

Look how much of this article was already in that one prompt: it named both workflows you've just read about, the CLAUDE.md tuning loop and the series mining, long before either happened, and it even flagged the token problem the outline-first design exists to solve. You're reading the comprehensive blog post it asked for, mined from the very session it was typed into.

### Up front, then as it changed

Most of the mining was front-loaded: I used the server up front to turn the giant build transcript into stable, citable artifacts on disk, and much of the writing then ran against those briefs and the live codebase. But this wasn't a one-shot. As I kept improving and tweaking the UI and UX while writing Part 2, I went back to the MCP server repeatedly to update the draft against what had changed. The pattern worth stealing is the combination: do the heavy excavation once into reusable artifacts, then re-query in a targeted way whenever the ground truth shifts.
<a id="the-claude-self-tuning-loop"></a>
## The Claude Self-Tuning Loop

Here's the workflow I'm most excited about, and the one I most want you to make use of. In Claude Code, project instructions go in a `CLAUDE.md`: a file that describes the project and how to work with it, including the rules I've written to keep Claude from repeating the mistakes I got tired of seeing. The ones that hold across projects live in the reusable prompts (agents, skills, slash commands) I use in all projects, and this section applies equally to them. I'll use *"CLAUDE.md"* here as shorthand for that whole set. As we work with Claude we need to make certain that these prompts continue to match reality. This is a critical but tedious part of building and maintaining our tools. Fortunately, we can use Claude to manage its own reusable prompts; this is called *metaprompting*. I tend to ask Claude to learn and update these prompts as I work, but I suspected that I had forgotten a few times, while heads-down getting the app finished.

After finishing the first version of the app I wanted to make sure I had captured all the learnings from the project, so I asked a fresh Claude session to audit it:

> *"Read back through my sessions for this project, find the mistakes that keep recurring, and propose sharper rules for my CLAUDE.md."*

This fresh session pulled conversation outlines across the project's sessions, zoomed in on the places where I'd corrected it (the *"no"*, the *"that's still broken"*, the *"look for yourself"* moments), then clustered the repeats into candidate rules and checked each one against what my `CLAUDE.md` and `llm-council-coding.md` already contained. No eyeballing five thousand messages, no guessing; outline first, then bounded reads of exactly the turns that mattered.

### Mostly confirmation

Most of the recurring mistakes it flagged, roughly seven in ten, were *already written down*, often almost word for word: ALWAYS do Test Driven Development and ensure that we transition RED tests to GREEN; scope every process-kill to a port, never broad-`pkill`; assert on the browser console in end-to-end tests, not just the DOM; treat "the tests pass" as meaningless until you've checked that the run actually executed. For the most part the audit wasn't meeting Claude's failures for the first time; it was checking whether that in-the-moment habit had kept pace, and the answer was mostly yes. That's exactly what you want from a loop like this: confirmation that you've kept these prompts current, plus a short, specific list of the gaps it let through.

### Two rules worth stealing

The audit turned up two rules worth a full walkthrough, because they're the kind of mistake every coding agent makes.

The first: **read the actual data shape on disk before you write code against it.** Twice in this project, Claude Code wrote code against an *imagined* schema, and it failed silently. Once, it assumed a PDF attachment exposed a flat `thumbnail_url` field when the real payload nested it under `document_asset.url`, so PDFs just quietly didn't render, with no error to chase. Another time, it assumed each line of a `JSONL` Claude session file was a whole message, when in fact the real file split messages across streaming chunks. This forced a rewrite of the parsing code rather than a patch. Same root cause both times: a confident mental model of the data that Claude Code never checked against the actual code or API. The rule the loop proposed is blunt: if your change parses or renders an external payload, open a real example first and cite the exact field path you're reading. A remembered schema sometimes doesn't fail loudly; it fails as a blank where the data should be, and this can lead to a bug that doesn't cause a test to fail.

The second: **never hard-code or stub a user-visible value to hit a performance budget.** During an early speed pass, Claude Code hard-coded `message_count` to zero "for speed", and every session in the sidebar cheerfully reported "0 msgs". In the same pass, it sped up another reader by loading only the first 30 lines of a session, which quietly broke full-text search, because search can't match text the reader never loaded. The catch, in my own words at the time, was a single skeptical question: *"If you're reading only 30 lines will you have the full count?"* The rule generalizes past this project.

### Where each rule goes

Not every lesson belongs in the same file, and organizing them is half the value of the audit loop. A rule that's specific to this project (a quirk of its data, a fixture, a path) stays in this repo's `CLAUDE.md`, where it rides along with the code and means nothing anywhere else. On a team project, everyone working in the repo gets those rules too.

A rule that's about how I want *any* project to work belongs a level up, in the prompts I use in every project: my Claude Code agents, skills, and slash commands, like `llm-council-coding.md`, the prompt behind my `/coding` command. Both of the rules above are that second kind, so they go to the shared prompts, where every project gets them, rather than into this one `CLAUDE.md`. The origin prompt saw this coming: it asked the server to surface mistakes I could use to *"improve our agent prompts, CLAUDE.md, etc."* The audit doesn't just sharpen one file; it feeds the whole stack of instructions that shapes how Claude works for me.
<a id="why-big-archives-are-still-fast"></a>
## Why Big Archives Are Still Fast

That build session has grown from the 5,207 messages I worked with in April to 25,689 as I write this, and outlining it still comes back fast. The reason is a small piece of engineering: the server caches each session's outline and, because a Claude transcript only gets longer, it summarizes just the new tail instead of re-reading the whole thing. That append-only structure wasn't an afterthought; it came straight out of a question I'd asked in the build session, *"aren't the project message data only appended to by Claude Code and Claude Desktop, so the 'head' summaries could be kept?"*, and the cache is that observation turned into code.

(One note on those numbers: the counts in this article are the April snapshot I worked from, so re-running the tools today shows bigger ones. I lean on stable message IDs rather than positions internally, since positions drift as a session grows.)
<a id="security-and-scope"></a>
## Security and Scope

When you hear *"I attached my entire conversation history to an agent,"* the correct next question is whether you just opened a security hole in your machine.

The server's boundary is intentionally narrow, in ways you can check. It is read-only: none of the five tools mutate your store. It is local and stdio-only: there's no network listener, and the client has to spawn it as a subprocess and talk over stdin and stdout. It doesn't touch credentials: the Desktop authentication cookies live elsewhere, and this server never reads them. And it resists path traversal, because the server addresses sessions by ID and resolves them through the store's own enumeration, never through a file path you hand it.

That said, the tool is a file reader with a schema, and it will read whatever is in your local archive, so your human judgment is important. Don't attach a history-reading tool to a work context whose data boundary you haven't thought about (read: you need to be careful about intellectual property), and remember that the explicit-only instruction is a guardrail against an over-eager client, not a substitute for you deciding where you can safely use these tools. Use them with intention: *"search for X,"* *"outline session Y,"* *"pull the part where we decided Z,"* *"export that part of the conversation."*
<a id="wrapping-up"></a>
## Wrapping Up!

Ok, that's enough for today! We connected the `claude-sessions` MCP server to Claude Code and Claude Desktop on macOS, Windows, or Linux, toured all five tools (`list_sessions`, `list_projects`, `get_session_outline`, `get_messages`, `export_session`), and then spent our time where it counts: on the outline-first pattern that makes a giant session queryable, the dogfooding that mined this project's build history into the briefs behind this series, and the tuning loop that audited my own `CLAUDE.md` and coding agent prompt against the mistakes Claude Code kept making. If you remember one thing, make it this: don't pour a huge session into context; skim its outline and fetch the slices that matter.

Next time we pivot from *using* the tool to *building* it; Parts 4-7 are technical deep dives.

Part 4 starts the reverse-engineering story: mitmproxy capture, the unofficial `chat_conversations` API shape, the early credential-capture approach, and the eventual pivot to Playwright for a cleaner login. If you liked the systems-archaeology side of Part 1, you'll like Part 4.

Like last time, please comment below with any questions, corrections, or pushback. I'd love to hear what you'd ask a fresh Claude session to do with your own history, because the best workflows here tend to be the ones nobody thinks of until the tool exists. If you liked this, please clap and follow me here and on LinkedIn.

See you next time! 🤓
