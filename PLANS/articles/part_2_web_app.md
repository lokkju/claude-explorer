<!--
  Medium series: Unlocking Your Claude History
  Part 2 of 5 — Draft (Council synthesis: Gemini 3 Pro + GPT-5.2-pro drafters → cross-critique → Opus synthesis)
  Sources: Part 1 (immutable), PROCESS/99_voice_cheatsheet.md, README.md, phase_07/11/14/18/19 extractions
  Voice: Raymond Peck's "Best Practices for Modern REST APIs in Python" series
-->

# Part 2 — Using the Web App

***In this part of the series, we'll install `claude-explorer`, capture and fetch your Claude Desktop history, and then take a full product tour of the web UI: the unified sidebar, full-text search, keyboard navigation, reading sessions, dark mode, and exports.***

In the previous installation of this series, we covered the three moving parts that make this project work (capture → fetch → browse / export / query), plus the five reasons you'd actually want a unified local archive in the first place. If you missed that, make sure to go back and read [Part 1](https://medium.com/@raymondpeck/part-1-what-this-thing-is-and-why-youd-want-it) first; Part 2 assumes you already understand why we have to "capture" a `sessionKey` to download Claude Desktop conversations, while Claude Code sessions already live on disk under `~/.claude/projects/`.

## Install and First Run

The fastest way to get value out of this project is to treat it like a local tool you can run in an afternoon: install dependencies, capture credential (only if you want Claude Desktop history), fetch conversations to your data directory, then start the server and browse your archive at `http://localhost:8000`. We'll keep it boring on purpose; boring is what you want from anything that handles credentials and writes thousands of files onto your machine.

![[Pasted image 20260428101512.png]]

This project uses `uv` (from Astral) to manage the Python environment ([install docs are here](https://docs.astral.sh/uv/getting-started/installation/); `uv` can bootstrap Python itself, so you don't need a preinstalled system Python on macOS, Windows, or Linux). If you're used to `pip`, `pip-tools`, or `poetry`, think of `uv sync` as the "make my environment match `pyproject.toml`" button, except it does it fast enough that you stop thinking about it. Under the hood, the backend is FastAPI (the framework Sebastián Ramírez wrote for those of us who like typed request models, and the same ecosystem I write about in [my best-practices column](https://medium.com/@raymondpeck/column-best-practices-in-modern-python-0cc40b50170e)), and the frontend is a bundled React app that the backend serves out of the same process so we don't have to juggle two dev servers.

Here's the "happy path" install and first run, end to end:

```bash
# from the repo root
uv sync

# only needed if you plan to use Playwright-based credential capture
uv run playwright install chromium

# capture a Claude Desktop / claude.ai sessionKey into ~/.claude-explorer/credentials.json
uv run claude-explorer capture

# download Claude Desktop conversations (and attachments) into ~/.claude-explorer/conversations/
uv run claude-explorer fetch

# start FastAPI + the bundled React UI at http://localhost:8000
uv run claude-explorer serve
```

One `uv` detail that makes this workflow feel clean: you run everything from the cloned repo root, and `uv run` just does the right thing. It finds the project's `.venv`, resolves the dependencies declared in `pyproject.toml`, and then runs the installed entry points in that environment; no `source .venv/bin/activate`, no `python -m ...`, no "which interpreter am I on" debugging. Once you've used that a few times, it starts to feel like the only reasonable way to run a small local tool.

A few practical notes that matter once you've run this more than once.

The `capture` step is opt-in. If you only care about Claude Code sessions, you can skip it entirely; the UI will still show everything it finds under `~/.claude/projects/` because those JSONL files already live on your disk, and the backend reads them live at request time. When you *do* run `uv run claude-explorer capture`, the tool opens a Playwright-controlled Chromium window pointed at `claude.ai`; you log in normally (SSO included), and the tool reads the cookie plus the `sessionKey` and writes them to `~/.claude-explorer/credentials.json`. The file is small, but it's the key that unlocks the server-side Claude Desktop history, so treat it like any other auth material on disk. If you want to audit the trust path, it's right there in `fetcher/playwright_capture.py:183-202`: cookie values go in, JSON gets written to disk, and the capture step itself has no network egress beyond the browser you're already using to log in.

The `fetch` step is incremental by default. The tool walks the unofficial `chat_conversations` API (paginated, with a polite `0.3 s` delay between requests) and writes one JSON file per conversation under `~/.claude-explorer/conversations/`, plus a sibling `files/` directory for attachment bytes (images, PDFs, canvas transcripts, and so on). If you've already fetched a conversation, `fetch` skips it; you can re-fetch everything with `--full-refresh` when you actually need it, which is usually *"I changed something about how the downloader stores metadata"* rather than *"I woke up and felt like downloading a thousand conversations again"*.

There's also an SSO edge case worth mentioning. Some single-sign-on setups make it hard to complete the login inside a Playwright window; in those cases, `capture` supports a mitmproxy-based flow via a `--proxy` flag, and the README has the exact steps. It's the one place where a single sentence in this article is enough, so I'll just point you at the docs.

Once `uv run claude-explorer serve` is running, open `http://localhost:8000` and you're in. If you've already fetched Desktop conversations, you'll see them immediately; if not, you can still browse your Claude Code sessions right away, which is a nice way to sanity-check that everything else is wired up before you go through capture and fetch.

With the server running, we can move to the UI, because that's where this project stops being "a directory full of JSON" and becomes a usable archive.

## The Conversation List (Sidebar)

The sidebar is the unified corpus made visible: one list, containing both Claude Desktop conversations (read from the fetched JSON files) and Claude Code sessions (read live from `~/.claude/projects/*.jsonl`), with a few affordances that make it usable once you've got more than a couple dozen sessions. Special shout-out to Donald Norman for *The Design of Everyday Things*, which everyone should read!

![[Pasted image 20260428101733.png]]

At the top, you'll see a simple source filter dropdown: `All Conversations`, `Claude Desktop`, and `Claude Code`. That sounds trivial, but it matters because your brain tends to remember context before content. If you know "this was a Claude Code debugging session in my repo" you can switch to `Claude Code` and cut your search space in half; if you remember "this was a long Desktop conversation where I attached this certain PDF," you flip to `Claude Desktop` and you're in the right neighborhood instantly.

Claude Code sessions also show up grouped by project. The UI pulls the project name from the directory the session ran in, which is usually the git repo root (or at least somewhere inside it); it then renders a collapsible grouping so you can treat *"everything I did in repo `foo`"* as a first-class bucket. I prefer this to tags because it matches how work happens; most of us don't sit down and decide which taxonomy to apply to a session, we just run `claude` in a directory and get to work.

Each row in the list carries just enough metadata to let you scan without clicking:

- The session title (or a derived title when the source format doesn't provide one).
- A source badge (`Desktop` or `Code`).
- A last-updated timestamp.
- A message count.

Those four fields give you the *shape* of the conversation: whether it was long or short, fresh or old, and where it came from. That's surprisingly close to how humans remember work; we rarely remember exact filenames, but we do remember that something happened "last month," that it was "a big one," and that it was "the CLI session, not the web chat."

You'll also see a starred group at the top. Stars are blunt, and that's why I like them; when you find something you know you'll come back to (a good project retrospective, a hard-won debugging thread, a clean solution you don't want to lose), you star it and it stops drifting away into the scrollback.

There's a refresh button at the top of the sidebar, and it does exactly what you want in a unified browser: one click triggers a Desktop fetch for new conversations *and* a re-scan of the Claude Code directory. You don't have to remember which source needs which kind of refresh; the UI just rebuilds the corpus and you keep reading. I asked for that because I'm lazy, and laziness is the mother of "make it one button."

The sidebar also filters phantom sessions to prevent a specific kind of annoyance. Claude Code can produce JSONL files that contain only local-command scaffolding, with no actual conversation content; if we render those in the list, they become noise, and noise is how you stop trusting a tool. The filter hides the empty ones while still keeping sessions that start with a `Caveat:` preamble and then contain real conversation underneath; in those cases, the UI titles the session from the first non-system message and keeps it in the list. That's the difference between "the tool feels curated" and "the tool feels like a raw log viewer," and if you've ever shipped a raw log viewer to humans, you already know which one they keep using.

Ok, we've got the corpus on screen. Now we need to make it searchable in a way that's fast, unified, and good at the kinds of queries we humans actually run. And I count us engineers among the humans. 🤓

## Full-Text Search (`⌘+K`)

The search experience centers on a single command palette, opened with `⌘+K`, because that's become the standard *"I want a fast, global action"* muscle memory across modern apps. In Claude Explorer, `⌘+K` is *"search everything,"* and everything means both Desktop and Claude Code.

![[Pasted image 20260428102241.png]]

When you type a query and hit enter, the UI sends it to a full-text search endpoint; the backend runs the same query across both sources and returns a single list of hits. Each hit includes enough context to be useful in a skim: conversation title, source, timestamp, and a snippet around the matching text. If you click a hit, the UI loads the corresponding conversation and scrolls you straight to the matching message, not to "roughly the right neighborhood." If you've ever tried to implement scroll-to-match over a virtualized list, you know why I'm calling it out; this is one of those places where a tiny bit of structure buys you a lot of polish.

Search also includes tool calls and tool results. That's not a marketing bullet, it's a practical necessity once you use Claude Code heavily. Engineers tend to remember the *effect* of a tool invocation ("the `ripgrep` output showed the string in three files," "the test runner printed that traceback") even when they don't remember the exact assistant text around it; if search only indexed the plain-language conversation, you'd miss a huge fraction of the information you actually want to retrieve. The same logic covers Claude Desktop sessions where the assistant ran a tool block (web search, web fetch, code execution) inside the conversation; that content is searchable too.

Performance-wise, the tuned path is fast enough that you stop thinking about it on a typical archive. The numbers below come from `scripts/bench_perf.py` running against my own data directory (about 600 conversations, several hundred MB of JSON on disk, warm OS file cache), so they should give you a realistic feel rather than a synthetic best case:

- `/api/conversations` (the sidebar list): mean **≈ 2.3 s**, median 2.3 s, p95 2.4 s, payload ~470 KB.
- `/api/search?q=claude`: mean **≈ 1.1 s**, median 1.1 s, p95 1.2 s, payload ~7 MB (deliberately broad query, so the result set is huge).

That's slower than the *"sub-100 ms warm cache"* numbers you'd see on a tiny archive, but it's still well inside the *"feels interactive"* zone for the UI work it powers — the sidebar paints, the search palette returns hits, and `⌘+K` doesn't make you sit and wait. Under the hood the backend leans on `orjson` for parsing, an mtime-keyed `FileCache`, and parallel reads via a `ThreadPoolExecutor`; that's what keeps a several-hundred-MB archive in this zone instead of in the *"go make coffee"* zone. If you want to take your own measurements, the bench script ships with the repo.

So: `⌘+K` gets you to a match quickly. The next question is what you do once you're staring at the match, because most of the time you want to move through matches and copy the useful bits out.

## Search-and-Copy Navigation (`⌘+G`, `⌘+C`, `⌘+F`)

After you run a search, you're usually in a loop: find a match, read around it, hop to the next one, then copy something out. Claude Explorer supports that loop with a small set of bindings that are easy to memorize because they mirror what many of us already use in editors.

![[Pasted image 20260428102508.png]]

`⌘+G` advances to the next match across the whole result set; `⌘+Shift+G` goes backward. The UI renders a small overlay that reads "Match N of M," which is one of those tiny affordances that makes your brain relax because it always answers the question *"where am I in this set?"* without you having to count anything.

The best part is that `⌘+G` works across conversations, not just within a single thread. If match #7 is in one conversation and match #8 is in another, `⌘+G` takes you there anyway; you keep your hands on the keyboard and you keep moving forward. Under the hood, the UI takes a synchronous fast path for in-conversation matches, then prefetches adjacent matches in the background so the cross-conversation jump feels instant. In practice, you can treat a search result set like a playlist; you hit `⌘+G` until you see the thing you wanted, and you never have to re-open the palette unless you want a different query.

Once a match is focused, `⌘+C` copies the focused message cell to your clipboard. Most conversation viewers make you drag-select text inside a bubble, which is fine for one-off copying but slow when you're collecting multiple snippets for notes; here, focus is explicit, so copy is explicit, and you can search, move, copy, and repeat without switching modes.

If you want to adjust the query instead of navigating matches, `⌘+F` jumps focus into the find input. Combined with the *"select a hit and focus the matching cell"* behavior, this makes a nice one-handed flow: run `⌘+K`, pick a hit, then do `⌘+F` to tweak the query or refine it, and `⌘+C` to copy the focused cell. It's the kind of thing you only notice after you've done it a dozen times, which is exactly the point; the best UI features are the ones you stop noticing because they match how you already work.

By the way, *"copy the focused cell"* means *"copy what you're looking at."* The clipboard payload is the message text, plus the speaker and timestamp; if the cell is a tool block (and you've toggled tool blocks on, which we'll get to), you get the tool input or output verbatim. There's no separate "copy as plain text" / "copy as Markdown" mode for the cell; the surrounding viewer already controls how content is presented, and copy mirrors that.

With search and match navigation in hand, we can step back to the bigger navigation story, because this app is intentionally keyboard-friendly in a way that most web apps are not.

## Three-Pane Keyboard Navigation (Emacs by Default, Vim for You Heathens 😉)

Claude Explorer is really a three-pane app: the sidebar on the left, the conversation detail on the right, and a transient search palette that pops in over the top when you hit `⌘+K`. Two of those panes are always there and the third is on demand, which is great visually, but it can become a keyboard mess if the app doesn't make focus explicit; you end up with half-working shortcuts, random scroll capture, and that familiar feeling of *"why did the key I just pressed do something totally different than it did five seconds ago?"*

One quick note on key labels: throughout this section I write shortcuts using the `Cmd` glyph because I'm on macOS; on Windows and Linux, every place you see `Cmd`, use `Ctrl` instead. The code in `frontend/src/hooks/useKeyboardShortcuts.ts` accepts both modifiers (`metaKey || ctrlKey`), so the shortcuts work everywhere; only the labels are Mac-flavored.

This UI avoids that by making one idea load-bearing: exactly one of `{sidebar, detail}` has focus at any moment, and the keys apply to the focused pane only. Click anywhere in either pane (background included) to focus it; use `Enter` to descend from the sidebar into the detail pane, and `Esc` to pop focus back to the sidebar. Once you internalize that model, everything else becomes predictable.

![[Pasted image 20260428102944.png]]

By default, the app uses an Emacs-ish set of bindings, because a lot of us already have those muscle memories from terminals and editors:

- `Ctrl+N` / `Ctrl+P` move within the focused pane.
- `Alt+N` / `Alt+P` page (within the conversation detail).
- `Alt+<` / `Alt+>` jump to first / last message.
- `Esc` exits the current focus mode (or pops you back to the sidebar).
- `Ctrl+C` behaves as you'd expect in a UI that respects copy behavior.
- `⌘+F` (or `Ctrl+F`) toggles the full-text search panel. Yes, that overrides the classic Emacs `forward-char` reflex; in practice the app is for reading and searching, not editing text, and `⌘+F` for "find" is the muscle memory most people are reaching for here anyway.

If Vim is more your speed, you can opt in on the settings page. In Vim mode, `j` / `k` move line by line, `g` / `G` jump to top and bottom (single-key, not `gg`), and `/` starts search; the UI still keeps the same explicit focus model, so Vim keys never leak into the wrong pane.

There are also a few bindings that are specific to the *"read a conversation"* experience. In the detail pane, `u` and `a` jump to the next user message and the next assistant message; `U` and `A` reverse direction. I like these because they let you skim by speaker, which is often how you want to review a long thread. If you're hunting for *"what did I actually ask?"* you can jump by `u`; if you're hunting for *"where did the assistant propose that design?"* you can jump by `a`.

The UI also binds `⌘+R` to the refresh action (the same one the sidebar button triggers) so you don't accidentally reload the single-page app and lose your place. This is one of those *"engineers wrote this UI for themselves"* decisions; we all have that reflexive `⌘+R` habit, and it's nicer to make it do the right thing than to scold people for having muscle memory.

If you ever forget a binding, hit `?` to open the help modal. The modal lists every binding for both modes; it's the cheat sheet you'd otherwise keep in a note somewhere, except you don't have to keep it.

The only tiny bit of code I'll show in this part is the shape of the keyboard shortcut hook, because it communicates the design without turning this into an internals article:

```ts
// Inputs that opt-in to letting specific global shortcuts (⌘+K, ⌘+F,
// ⌘+G, ⌘+Shift+G, Escape) still fire even while they hold focus.
// The SearchPanel input sets this attribute so typing in it doesn't block
// its own navigation shortcuts.
function allowsShortcuts(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  return target.closest('[data-allow-shortcuts]') !== null
}

const cmdOrCtrl = e.metaKey || e.ctrlKey

// ⌘+R to refresh conversation list (prevent browser refresh)
if (e.key === 'r' && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
  e.preventDefault()
  queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
  return
}
```

The important thing is not the implementation; it's that the app routes shortcuts through explicit focus and explicit actions, so the behavior remains stable as the UI grows. If you've ever tried to retrofit good keyboard navigation into an app after the fact, you know why I'm smiling as I type that sentence; I commented the heck out of it when I first saw it working consistently.

One last bit of polish in the sidebar that ties this all together: when you press `Ctrl+P` or `Ctrl+N` to step through sessions, the UI does not eagerly load each conversation as you scroll. It blanks the conversation pane and renders a hint ("Hit `Enter` to select this conversation.") instead. Loading a heavy session is an explicit action; you scan the list with your fingers on the keyboard, and you only commit to opening one when you actually want to read it. That single decision is the difference between *"keyboard nav is fast"* and *"keyboard nav makes the whole app feel slow because every step opens a new conversation."*

Now that we can move around efficiently, we can look at what it feels like to read a session in the detail pane.

## Reading Individual Sessions

When you select a conversation in the sidebar (and hit `Enter`, because loading is explicit), the detail pane renders the full session as a sequence of message bubbles. The goal here is straightforward: preserve the structure of the original exchange, but make it easy to skim, search, and export.

![[Pasted image 20260428103419.png]]

Each message shows a local timestamp, on both sides of the conversation. That matters more than you'd think, because time is part of the story; *"this was a ten-minute back-and-forth"* feels different than *"this took three hours and spanned lunch."* Putting timestamps in local time keeps it readable without mental arithmetic.

Messages can contain multiple content blocks. In practice, you'll see three:

- `text` blocks for normal conversation.
- `tool_use` blocks when the assistant invokes a tool.
- `tool_result` blocks for the tool's output.

Image attachments live next to the content blocks rather than inside them; Claude Desktop ships them on the message itself (in `files[]`), and the viewer renders them inline as thumbnails. Single attachments display at their natural aspect ratio (capped to a readable height); multiple attachments fall into a tidy two-column grid of square tiles, with a `+N` overflow tile when a single message carries more than five images. Click any thumbnail and a full-screen lightbox opens; arrow keys move between images, `Esc` closes, `d` downloads, and `o` opens the original in a new tab. The thumbnail and the lightbox both load through the same local backend proxy that handles your other Claude Desktop fetches, so images keep working even when you're offline from claude.ai itself.

The viewer hides `tool_use` and `tool_result` blocks by default, because tool output can dominate the screen and drown out the narrative flow of the conversation. When you want them, you toggle them on in the conversation toolbar; when you don't, you read the thread as a human conversation again. The default is the right one for *reading* a session ("what happened, in plain English?"), and the toggle is there for *auditing* one ("what did the assistant actually run, and what did it get back?"). Reconstructing a debugging thread, for example, almost always wants the tools visible. Image attachments are deliberately *not* gated by that toggle — they're primary content, not tool noise.

In the upper-right of the conversation header, next to the Markdown and PDF export buttons, there's an *"Expand / Collapse All Tools"* control that forces every tool block in the conversation open or closed at once. It's a simple idea, but it saves a lot of time when you're reviewing a session with dozens of tool calls; you can collapse everything to skim the high-level conversation, then expand everything when you want to audit what actually happened on disk.

Copy affordances show up where you'd expect. Each content block shows a *"two overlaid pages"* copy icon on hover, and the conversation header includes a *"Copy as Markdown"* action that copies the entire thread as Markdown to your clipboard. This is one of those features that sounds like a convenience, but turns into a workflow once you realize you can paste a whole session into notes, a pull request description, or a retrospective document without wrestling with formatting. The copy paths respect the same tool-call toggle as the viewer; one truth, three surfaces (viewer, copy, export).

There's also a *"View branches"* button on the conversation header. Claude can create branches when you edit an earlier message and regenerate from there; when branches exist, the UI renders a tree visualization so you can see the structure, and you can click any leaf to switch the conversation pane to that branch's path (the URL gains a `?leaf=<uuid>` so the choice is shareable and back-button friendly). The visualization is read-only in the *editing* sense — you can't fork, merge, or rewrite history from the tree view — but it's a real navigator, not just a static diagram. I love it when I get to use the word isomorphic, and I love it more when a branch tree is something you can actually walk; this one is.

Finally, the scroll-to-match behavior we discussed in search shows up here too. Each message bubble carries a stable identifier, and the UI uses it to jump directly to a matching message when you click a search hit; it's deterministic, and it makes the *"search then read"* loop feel tight.

With the core reading experience covered, the remaining features are the ones that make the app comfortable to live in: appearance controls, a small settings page, the responsive layout, and exports.

## Appearance and Settings

Most of us spend enough time in tools like this that comfort is not a luxury; if a UI fights your eyes, your hands, or your screen size, you stop using it. Claude Explorer keeps these parts simple and predictable.

![[Pasted image 20260428103957.png]]

### Dark mode (Light, Dark, System)

Theme is a three-valued state: `'light' | 'dark' | 'system'`, and `'system'` is the default. When you pick `system`, the UI follows your OS preference via `matchMedia('(prefers-color-scheme: dark)')`, including changes mid-session; if you flip your system from light to dark while the app is open, the UI flips with it. The app applies the effective theme by toggling a `.dark` class on the document element, which keeps the CSS story straightforward and avoids the *"half the app is themed, half isn't"* problem.

If you're curious what that looks like at the implementation boundary, it's roughly this shape:

```ts
useEffect(() => {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const effective = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
  document.documentElement.classList.toggle("dark", effective === "dark");
  const onChange = () => setSystemPrefersDark(mq.matches);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}, [theme, setSystemPrefersDark]);
```

Again, the point isn't the code; the point is that you get a predictable, persisted theme choice that behaves the way every engineer expects theme to behave in 2026.

The toggle lives in the sidebar footer, and it cycles Light → Dark → System. I like cyclical toggles for three-state theme because it's fast, it's discoverable, and it doesn't require a settings panel trip every time you're on a laptop in a bright cafe.

### Settings (`/settings`)

The settings page exists, but it doesn't try to become a control center. It has four sections: *Appearance* (theme), *Keyboard Navigation* (Emacs vs Vim), *Data* (data directory and fetch controls), and *About*. It's the place you go to make a deliberate choice, not the place you go to run the app; the main UI remains the conversation list and the conversation viewer.

Almost done. We can browse, search, navigate, and read comfortably; the last practical feature is the one that turns *"a viewer"* into *"an archive you can actually use elsewhere."*

## Exports (Markdown and PDF)

If the goal is to make your Claude history *yours*, then *"I can read it in the browser"* is only half the story. You also want to move it into other tools: paste a thread into a pull request, save a session as a note, archive a conversation as a PDF, or hand a Markdown export to a teammate as part of a retro.

Claude Explorer ships two export formats per conversation: Markdown and PDF.

![[Pasted image 20260428104426.png]]

### Markdown export

The Markdown export endpoint serves a clean `.md` of the whole conversation, and it can optionally include tool calls. This matters because different exports want different levels of verbosity. If you're exporting a conversation as *"what did we decide?"* you might exclude tool calls; if you're exporting a conversation as *"what exactly did the assistant run?"* you include them.

The important design choice here is that export honors the same `showToolCalls` toggle as the viewer. One truth, two surfaces; if you've decided tool calls should be visible for this session, that decision applies consistently whether you're reading in the UI or exporting to a file.

You can also copy without exporting. The conversation header includes a *"Copy as Markdown"* button that copies the entire session as Markdown directly to your clipboard, and each content block has its own copy icon on hover. Those copy affordances respect the same tool-call toggle, which makes them reliable; *"copy what I'm looking at"* is the simplest mental model, and the UI sticks to it.

### PDF export (WeasyPrint)

WeasyPrint handles PDF export. On macOS, you'll need the system libraries it expects; if you don't already have them, this is the one command you'll run:

```bash
brew install pango cairo libffi
```

Once those are installed, PDF export works the way you'd expect: you click export, you get a PDF representation of the conversation. You can choose whether tool calls appear, and the toggle matches the viewer's setting.

If you're thinking *"why bother with PDF when Markdown exists,"* the answer is simple: PDF is a stable artifact. Markdown is great for editing and reuse, but it will render differently depending on where you view it; PDF is the thing you can stick in an archive folder, attach to a ticket, or keep as *"this is exactly what we saw at the time."*

At this point, we've covered the UI tour: install and first run, the unified sidebar, search, match navigation, keyboard focus and shortcuts, reading sessions, theme and mobile, and exports. All that's left is the feeling you get when you realize what you're actually looking at.

## Your History, On Your Disk

Claude Desktop keeps your conversations server-side; Claude Code keeps sessions on your machine but doesn't give you UI to browse them. Claude Explorer takes those two realities and gives you a single archive you can read and search locally, without needing to remember which interface holds which half of your history.

The payoff is not that the UI is pretty (it's fine), or that the keyboard shortcuts are clever (they're consistent), or that export works (it does). The payoff is that the long sessions you almost remember, the ones that taught you something real, stop being ephemeral. You can find them again, quote them, reuse them, and hand them to your future self, who will actually be able to read them.

I figured out a way, and you're reading this!

## Coming Up: Another Claude, Querying Yours

Up to now we've been talking about how *we* browse: the sidebar, full-text search, keyboard navigation, and exports. Part 3 flips the point of view; another Claude queries the same on-disk archive via an MCP server, so your history becomes something a fresh session can interrogate without you copy-pasting anything.

That MCP server exposes five tools (`list_sessions`, `list_projects`, `get_session_outline`, `get_messages`, `export_session`), and the outline-first pattern is the trick that keeps it practical; a new Claude Code run can start broad, then zoom in, even when the underlying session is thousands of messages long.

And yes, I used this MCP server to mine this project's own history to write this series. Which prior conversation would you most want a fresh Claude session to read for you?

## Wrapping Up!

Ok, that's enough for today! We covered a lot of ground: installing with `uv`, capturing a `sessionKey` via Playwright, fetching Claude Desktop conversations into `~/.claude-explorer/conversations/`, and then using the web app to browse a unified sidebar, run full-text search with `⌘+K`, navigate matches with `⌘+G`, drive the whole UI from the keyboard with an explicit focus model, read sessions with tool-call toggles and timestamps, switch themes, and export conversations to Markdown or PDF.

Part 3 dives into the MCP server we just teased: install paths for Claude Code and Claude Desktop on macOS, Windows, and Linux, the outline-first querying model in more detail, and the workflows that come with it (the self-referential retrospective, the `CLAUDE.md` tuning loop). It's the part of the project that makes me happy when I see it working. 🤓

Before you go, comment with the one session you wish you could hand to a fresh Claude Code run and say, "summarize this and pull out the decisions." Like last time, please comment below with any questions, corrections, etc. If you liked this, please clap and follow me here and on LinkedIn.

See you next time!
