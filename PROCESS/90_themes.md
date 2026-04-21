# Cross-cut Themes

Synthesized from the 20 per-phase extraction files in `PROCESS/a70251a5/` (`phase_01_*.md` through `phase_21_*.md`, no Phase 02) and the planning session `PROCESS/76fe578b/summary.md`. Every example cites the phase extraction it came from, using the `[a70251a5#pos=N msg=UUID8…]` form already present in those files.

The build came in side-project bursts with real use between them. Nearly every durable design decision in this repo was shaped less by up-front planning than by what surfaced *while actually using the thing* — the recurring themes below are all variations on that loop.

## User-as-architect

Short, pointed user prompts repeatedly reshaped the data model or the design after the assistant had committed to a plausible-looking but wrong direction. These are rarely long specs — more often a single sentence that reframes the whole problem.

- "unified + filter; but why copy conversations from the local JSONL to the conversations/ dir? That seems like a poor design choice; it's better to have a single source of truth." — collapses a half-built import pipeline into live-read. [a70251a5#pos=1574 msg=9c6d74a8…]
- "We need to have a clear notion of focus in being in one or the other, and how the focus switches: `<enter>` in the sidebar should switch focus to the messages panel; `<esc>` should switch back." — turns a stream of ad-hoc patches into a formal focus invariant. [a70251a5#pos=4326 msg=49d158c4…]
- "Each of the things we can sort by has a natural sort order (e.g., descending for dates, ascending for title/project). Make that the default." [a70251a5#pos=2571 msg=a757e375…]
- "In Claude Code, each session is related to a project (typically, but not always, a git repo). I'd like to see the project in the sidebar, and to be able to group sessions by project (optionally)." [a70251a5#pos=2466 msg=944b2085…]
- "yes, filter those out (by default, with a toggle)" — one line creates the Caveat-filter feature. [a70251a5#pos=2187 msg=d11eddd3…]

## Ship → use → fix

The defining rhythm of the project. Features land in a first-cut state, get used in anger, and the gaps that surface from actual use become the second-version spec. Phase 19 is the cleanest example — a single feature (two-pane keyboard navigation) iterated across three distinct eras of real use — but the pattern is everywhere.

- Era 1 two-pane keyboard nav ships (`aa6e781`), then Era 2 is a wave of bug reports from hands-on use: "ESC from detail leaves the sidebar with no visible selection," "tool calls render in the detail view even when the toggle is off," "`^N`/`^P` now work in the messages panel but not in the sidebar." [a70251a5#pos=4090 msg=fc07317f…, pos=4251 msg=3f914e4c…, pos=4326 msg=49d158c4…]
- Branch visualization ships against mock data — then real corpus inspection finds 0/68 conversations actually branch, so the switcher never lands. [a70251a5#pos=1398 msg=55d11b76…]
- First CMD-G works but is "super slow, and there's no indication to the user that it's 'thinking'"; a dedicated perf pass (fast path + background prefetch) turns a correct feature into a usable one. [a70251a5#pos=4796 msg=9671cb18…, pos=4831 msg=015920bd…]
- The connection-status popup lands, then real-use reveals it flashes during the optimistic first request — fixed by only incrementing retry state after an actual failure. [a70251a5#pos=3055 msg=934d36b2…]

## Verify before celebrating

The user rarely accepts "it compiles" or "tests pass" as proof a feature works. Verification in this project comes in three reinforcing layers: **automated tests at every level** (Vitest + RTL + MSW for frontend unit/integration, pytest for backend, Playwright for E2E), **ad-hoc Playwright during the session** (Claude Code drives a browser itself so it can actually *see* the bug and reproduce it, instead of reasoning about UI behavior in the abstract), and **manual spot-checks on real artifacts** (opening JSON files, hitting endpoints with `curl`, restarting services by hand). "Run the tests" is the non-negotiable gate; the other two layers catch what the tests don't.

**Testing at every level — the non-negotiable gate.** The v2 UI pass in Phase 18 codified the expectation that landing a feature means shipping tests *at the level where the feature lives*: Vitest unit tests for React contexts and hooks (`SettingsContext.test.tsx`), pytest for backend (`backend/tests/test_config.py`, `test_conversations.py`, `test_search.py`, `test_export.py` plus shared `conftest.py`), and Playwright E2E for user-visible flows (`settings.spec.ts`, `theme.spec.ts`, `keyboard-navigation.spec.ts`). "run the tests to make sure everything works" closes the phase. [a70251a5#pos=3540 msg=90aa7768…]

**Persistent Playwright tests over ad-hoc Playwright — but only after ad-hoc Playwright does its job.** Phase 06 is the formal codification: "Are you doing ad-hoc testing with Playwright, or creating persistent Playwright tests? I'd prefer the latter. Show me the plan you're following." [a70251a5#pos=737 msg=c672ff8d…] The assistant conceded immediately ("You're right — I was doing ad-hoc manual testing, not creating persistent tests.") and the harness plus initial specs landed. But the ad-hoc mode didn't disappear — it became a *debugging* tool rather than a *test* tool.

**Ad-hoc Playwright inside the session as a shared viewport.** Throughout the build, the assistant uses the Playwright MCP server interactively — `browser_navigate` + `browser_take_screenshot` + `browser_snapshot` — to show the user exactly what the app looks like right now, and to reproduce bugs the user describes verbally. It is the assistant's equivalent of "let me share my screen." A few illustrative moments:

- After standing up the frontend for the first time: "Frontend is already running on port 5173. Let me take a screenshot to see the current state." — the assistant's first move in Phase 06 is to look at the app, not at the code. [a70251a5#pos=717]
- When the assistant claims a feature is fixed but is actually looking at the wrong app: "That screenshot was from your viewer, not Claude Desktop! Debug and fix." — a one-line user correction that only works because both sides can reference the same screenshot. [a70251a5#pos=998]
- When debugging the connection-status popup in Phase 16: "The frontend is running and getting connection refused errors (backend is down). Let me take a screenshot to verify the connection status banner is showing." — ad-hoc Playwright is *how the assistant verifies its own fix*. [a70251a5#pos=2990]
- At the end of the keyboard-nav arc in Phase 19: "All working. Click-to-focus toggles correctly between panes. Let me take a final screenshot." — the closing shot that says "here, look, I know you'll ask." [a70251a5#pos=4537]

**Manual spot-checks on real artifacts — where big bugs get caught.** Automated tests find regressions; manual pokes find shape bugs in the data model that the tests didn't think to assert. The recurring examples are the richest source of durable corrections in the project:

- "Check that `~/.claude-exporter/credentials.json` looks correct." [a70251a5#pos=470 msg=8e3e3c60…]
- "It looks like the JSON files in the conversations dir are correct. Check a few at random to see if we're missing anything. E.g., does it handle PDF attachments correctly?" — this spot-check is what surfaced the `files_v2` bug. [a70251a5#pos=565 msg=790884a3…]
- "test the connection popup by shutting down the back end and restarting just the front end. I'll check if the retry loop ends with the popup, and if it does I'll have you restart the back end so I can reconnect." [a70251a5#pos=2953 msg=c50f0a1f…]
- "Look for yourself." — when the assistant claimed a feature worked but the user couldn't see it, the user refused to accept debugging-by-assertion. [a70251a5#pos=2639 msg=3b8c22cb…]

## The LLM Council as an early-warning system *(forward reference only in this series)*

**Scope note for drafters:** the user invoked a multi-model "LLM Council" (Opus 4.6 orchestrating GPT-5.2 and Gemini via the PAL MCP server, reached via `/coding` or `/llm-council-coding ultrathink`) at four of the highest-leverage design forks in this project. The pattern deserves a standalone article — it's too dense and transferable to fit as a sub-point of Part 4 or Part 5, and the user already has a short LinkedIn post on the pattern that a standalone piece can build on. **In this series we include only a forward reference**, not a full treatment.

**Full research is preserved at `PLANS/future_articles/llm_council.md`** for the upcoming standalone article. Drop-in forward references for this series land naturally at two places:

- **Part 3 (MCP server setup)** — when describing how the 5-tool surface was designed, one sentence: *"The specific shape of the tool surface — 5 tools rather than 6, hybrid position+UUID addressing, session-level mtime caching — came out of an LLM Council review that's worth a post of its own (coming soon)."*
- **Part 5 (build retrospective)** — when describing the keyboard focus model or the MCP design, a parenthetical breadcrumb: *"This is one of several moments the LLM Council pattern paid for itself during the build; I'll write that up separately."*

One citation to carry into either reference, because it's the cleanest single example: the keyboard focus-model reframe at [a70251a5#pos=3955 msg=146425ff…, pos=3959 msg=5547288f…] where a narrow "make `^P`/`^N` work in both panes" patch request got reshaped into a Spatial Model with Contextual Scope that grounded the entire keyboard-nav arc.

## The "0. commit" pattern

The user bundles product-polish work as numbered lists, often prefixed with `0. commit`. This is a recurring organizational move: commit what's there first, *then* apply the numbered changes, *then* commit again. It keeps diffs reviewable and creates clean phase boundaries.

- "0. commit / 1. The front end should really be called Claude Explorer rather than exporter. / 2. What would it take to be able to run the Claude Desktop chat exporter from the front end (like a refresh button)?" [a70251a5#pos=2257 msg=06d561c9…]
- "1. Add a refresh button at the top of the sidebar to refresh both CC and Claude Desktop conversations. / 2. In the main message display, add timestamps (in local time) to all the messages on both sides of the conversation." [a70251a5#pos=2650 msg=088ac7ec…]
- "/coding / 1. CMD-K works... / 2. What would be in a settings page? / 3. Add keyboard navigation … / 7. Add dark mode; system mode should be the default." — seven items in one prompt define the whole v2 UI pass. [a70251a5#pos=3333 msg=584faf50…]
- "Commit and then move on to the fetcher." — the earliest instance of the pattern. [a70251a5#pos=336 msg=982a2bf2…]

## Trust but verify the agent's numbers

Multiple times in the session, the user refused to trust numbers the app itself was reporting, and instead demanded an independent count. That skepticism paid off repeatedly.

- "Hm, there should be a lot more Claude Code conversations, I think. Please check the count in the JSONL file independently." — independent count surfaces 223 hidden agent sub-conversations (258 total, not 35). [a70251a5#pos=1700 msg=bd51590b…]
- "If you're reading only 30 lines will you have the full count?" — catches a perf "optimization" that hard-coded `message_count=0` on the fast path. [a70251a5#pos=2070 msg=0e03b4a8…]
- "Did you find any branched conversations?" — forces the answer "0 out of 68" and scopes down the branch-switcher work. [a70251a5#pos=1395 msg=a74f3efa…]
- "Look at our saved conversations, and determine if there is tool call text like that, that you can parse out." — before designing a tool-call UI, verify the data is even there. [a70251a5#pos=1306 msg=9cdd01fa…]

## Features that half-shipped

Not every feature survived contact with reality. Two cases are honest retrospective material for Part 5.

- **Toast notifications scaffolded but never wired.** `sonner` installed, `<Toaster>` mounted in `App.tsx`, zero `toast.*` call sites in the repo. Phase 18's seven-item `/coding` work order shipped item #4 as infrastructure but no feature (refresh complete, export complete, copy-to-clipboard, fetcher done, API errors) ever actually fires a toast. Flagged in the extraction as a known gap rather than silently fixed. [a70251a5#pos=3539 msg=b05bb783… (Phase 18 Missteps)]
- **"Open in Claude Desktop" deep link built and ripped out.** Buttons landed in both the sidebar and the detail header before manual verification showed `claude://conversation/<uuid>` just opens the app. User response: "it just opens the app, shit" — feature deleted. [a70251a5#pos=1391 msg=02ad1e52…, pos=1393 msg=416a55ac…]
- **Branch-switcher UI never fully shipped.** Tree visualization components landed, but full branch switching was gated on real data ("IFF we actually have conversations that branch") — and none did, so the switcher was parked. [a70251a5#pos=1129 msg=0e65108d…, pos=1398 msg=55d11b76…]

## Design against actual data, not wished-for data

A recurring correction: before building UI against an assumed data shape, go read the actual shape on disk.

- PDF attachments were silently no-opping because the fetcher looked for top-level `thumbnail_url` / `preview_url` on `files_v2` entries, but the real shape nests those under `document_asset.url`. Only caught because the user picked a specific conversation and asked where the PDF went. [a70251a5#pos=659 msg=82391f1f…, pos=680 msg=895d7bb9…]
- Tool-call blocks render as "black boxes" because Claude Desktop's export strips real tool I/O and leaves a placeholder string — user asked "look at our saved conversations" before accepting Option 2 (regex-extract real tool calls), and the answer reshaped the feature into Option 1 (detect the placeholder and render an info box). [a70251a5#pos=1306 msg=9cdd01fa…, pos=1311 msg=35f78e6a…]
- Claude Code JSONL messages streamed as chunks — the first parser treated each chunk as a separate message, leaving blank messages in the UI. Fix required a rewrite (`_get_message_key`, `_merge_entries_to_message`) after reading a real JSONL file, not patching blindly. [a70251a5#pos=1967 msg=5b6972ce…, pos=2102 msg=db93d67b…]
- Fetcher URL was missing `render_all_tools=true`, so Claude Code conversations were being saved with placeholder-only tool blocks. Caught by `ultrathink` investigation of a specific session. [a70251a5#pos=2424 msg=a977f490…]

## Durable rules born from single incidents

Several of the standing rules in this codebase trace to a single bad experience. They get codified — often into `CLAUDE.md` or project-permission files — rather than being left as tacit norms.

- **No self-credit in commit messages.** Born at [a70251a5#pos=35 msg=eeebeb16…], re-asserted at [pos=958 msg=237d6350…] with a hard requirement to propagate the rule into `~/.claude/CLAUDE.md` *and* every `llm-council-*.md` agent file before continuing.
- **Never broad-`pkill uvicorn`.** Born when a `pkill uvicorn` blew away another project's server mid-phase: "Hey, I'm working on multiple projects that use Uvicorn. You need to be more selective with your pkill commands! Remember this." [a70251a5#pos=4308 msg=1854813a…]. Previously discussed as a threat-model question at [pos=3222 msg=36b396b2…] — "I'm kinda scared of allowing pkill!" — resolved by scoping every kill to a port via `lsof -ti:PORT | xargs kill`.
- **Always use `uv` with a project-local `.venv`.** Two tool-call interrupts to enforce this, followed by a `CLAUDE.md` update. [a70251a5#pos=262 msg=4746a23b…]
- **Keep mitmproxy as a first-class credential path.** User vetoed the "replace mitmproxy with Playwright" plan because mitmproxy is the only path that works when you've lost email access but are still logged into Claude Desktop. "this was a lifesaver and I don't want to lose it." [a70251a5#pos=2391 msg=7d317c0f…]

## Meta / self-reference

The headline meta moment: the MCP server was designed to help Claude Code query this project's saved sessions, and the first real query against it was *"find all sessions for this project"* — the same query that seeds the Medium-article extraction pipeline. The tool eats its own tail on purpose.

- "write a comprehensive blog post about the work that went into it. We might use this session's project as a test case for this." — the self-referential beat, buried inside the MCP server's origin prompt. [a70251a5#pos=4844 msg=ff2ee72e…]
- "The MCP server is working. The first session (5,202 messages) is the main development history for this project." — Phase 21, the acceptance test that closes the build arc. [a70251a5#pos=5002 msg=f8dd72c3…]
- The Medium-series planning session itself (`76fe578b`) uses the MCP server built in Phase 20 to mine the session its own prose describes. [76fe578b#pos≈0..380]

## Credential-capture duality

Two credential-capture paths coexist because they cover disjoint failure modes. This was an explicit user decision, not an accident of refactoring.

- mitmproxy: works when the user can no longer log in to the web UI but is still authenticated inside Claude Desktop. "The mitmproxy method works for my initial case, where the Playwright one can't: I lost access to a work Claude account (so I couldn't log in), but I was still logged in to Claude Desktop." [a70251a5#pos=2391 msg=7d317c0f…]
- Playwright: works when the user has a normal web login and wants a simpler, no-proxy, no-cert-bypass flow. Introduced at [a70251a5#pos=2340 msg=449681da…] with "Don't do anything yet, just answer" — feasibility-first before commit.
- Both documented side-by-side in the README — neither deprecated, neither hidden. [a70251a5#pos=2391 msg=7d317c0f…]

## Performance as a correctness discipline

Perf shows up late (Phase 10 is the first grumble) and is treated alongside correctness rather than as a polish pass. The user is explicit about when *not* to optimize, too.

- First perf grumble: "1. CMD-K seems to ignore the type toggle. 2. It's gotten a lot slower. What can we do about this?" [a70251a5#pos=1772 msg=6b2b9db1…]
- "yes, add caching. And ultrathink about how we can more quickly read the file!" — kicks off the three-pronged orjson + `FileCache` + `ThreadPoolExecutor` approach. [a70251a5#pos=1917 msg=a9be9bdf…]
- "Perhaps we should cache slow stuff in sqlite? Hold off on this until we see how slow it is." — refusal to reach for SQLite prematurely. [a70251a5#pos=2075 msg=2ae07954…]
- "CMD-G and CMD-SHIFT-G seem to be working. But they are super slow, and there's no indication to the user that it's 'thinking' … the initial search results should have direct indexes to the messages, right?" — user prompts both the diagnosis and the fix direction. [a70251a5#pos=4796 msg=9671cb18…]
