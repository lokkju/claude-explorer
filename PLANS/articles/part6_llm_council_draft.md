<!--
  Medium series: Unlocking Your Claude History
  Part 6 of 7 — DRAFT CONTENT (lifted from Part 2 long-form on 2026-05-27)

  This file holds the LLM Council bug-hunting essay originally drafted as a
  section inside Part 2 (commit 5e26b3c era). Part 2 is "User Guide with
  Technical Deep Dive"; the Council methodology became its own essay that
  belongs in Part 6 (Adversarial Code Review with Heterogeneous Models).
  The prose sits here until Part 6 gets a full framing pass.

  Companion plan (structure + outline): PLANS/articles/part6_llm_council_plan.md
  Voice rules: PROCESS/99_voice_cheatsheet.md
-->

# Part 6 — DRAFT CONTENT (Bug-Hunting essay lifted from Part 2)

> **Status:** lifted-from-Part-2 draft. This is the writeup of the `/code-audit` LLM Council, the 16-class catalog, and the bug stories from the audits. It needs intro / outro / framing to stand on its own as Part 6. The plan at `PLANS/articles/part6_llm_council_plan.md` is the structural spec; this file is the prose to absorb into it.

## Bug Hunting with an LLM Council

The performance work in Part 2 answered a question I could state precisely: *where is the time going, and what moves first?* The question that came next was harder: *what's broken that I haven't noticed yet?* I worked through that one the same way — with measurement, against a baseline, and with explicit cross-critique — and it turned into a piece of methodology I've started using on every project. This section is the writeup.

Two bugs kicked the audit off. The first was mine: I'd shipped a one-liner in `backend/store.py` that filtered conversation summaries by name, summary, and project path, using a pattern that looks right in Python but is fragile:

```python
name_match = search_lower in data.get("name", "").lower()
```

The trouble is that `data.get("name", "")` returns the default `""` only when the *key is missing*. If the key is present with value `None` — which happens for legacy conversations that were never re-fetched, and for certain Claude Code session shapes — `.get()` returns `None`, and `None.lower()` raises `AttributeError`. The route returned a 500 mid-iteration; the sidebar search box looked broken in a way I couldn't reproduce on my own corpus, because none of MY conversations triggered the path. The second was reported by a user testing the dev build: typing in the search box returned hits, but clicking one rendered "Conversation not found." Both the same shape — endpoint A advertises something that endpoint B doesn't honor — and both invisible to the test suite I had.

I built `/code-audit` to keep this from being a one-off response. It's a Claude Code slash command that runs an **LLM Council**: three heterogeneous models with explicit roles, repeated cross-critique, and decision records. Opus (the orchestrator I'm chatting with) is the CTO; Gemini 3 Pro Preview is the Platform Architect that proposes the approach; GPT-5 is the adversarial Critic that argues against it (Gemini 2.5 Pro fills in when GPT-5 hits its quota). The skill ships a catalog of 16 bug classes that I derived from the audits below, plus a fixed workflow per hunt: recon, three rounds of council deliberation, TDD implementation with bidirectional tests, and a transient-break verification step that proves the fix isn't a rubber stamp.

### The catalog

The 16 classes the council knows how to hunt fall into three buckets. **Crash classes** are the ones a user sees as a 500 or a white screen: null-safety violations (the `.lower()`-on-None family, plus its `c.name.toLowerCase()` mirror in TypeScript), unsafe primitive coercion (`int()` and `float()` over JSON, plus the subtler Pydantic-implicit form where `class Foo: count: int` raises `ValidationError` if a stored value is the wrong shape, plus structured-parse failures where `json.load(open("config.json"))` raises `JSONDecodeError` and crashes the entire boot path), type-assertion lies in TypeScript (`as X` and the non-null `!.` operator, which bypass the nullability checker at runtime), and async exception swallowing (`except Exception: pass` inside long-running watcher loops that produces invisible data loss). **Contract classes** are where two endpoints get out of sync: unvalidated `Query()`/`Path()` parameters that let surprising input reach handler logic, Pydantic models that default to `extra='ignore'` and silently drop typos, fragile `fromisoformat(ts.replace("Z", "+00:00"))` parsing that aggregates `now()` into a recent-list `max()` and bounces a corrupt session to the top of the sidebar, TOCTOU races between `os.stat` and a file read, missing `AbortController` plumbing on fetches that should cancel on unmount, optimistic UI updates with no `onError` rollback, `ThreadPoolExecutor` instantiated *inside* a route handler instead of at module scope, and unstable `sort(key=...)` calls with no UUID tiebreaker that flicker on refresh and drift on paginated fetches. **Meta classes** are the ones that hide everything else: rubber-stamp tests that assert only `status_code == 200` with no content check (they pass against an implementation that always returns `[]`), `setTimeout` calls in React components with no unmount cleanup, the seam class (paired endpoints with no test pinning their cross-endpoint invariant), and the **convergence class** — multi-channel projection assemblers (the FTS5 body, the export markdown writer) that combine several source channels without de-duping, so the same content gets indexed or exported twice and surfaces as visibly doubled output. The user-reported "Conversation not found" bug lived in the seam bucket; the user-reported "doubled snippets" bug lived in the convergence bucket. Every endpoint passed its own unit tests, no test pinned the invariants between them, and the bugs were the absence of a test class rather than a flawed assertion in one.

### What the council found

The council ran fourteen hunts over the course of several sessions, plus a final full-sweep pass across all sixteen classes ahead of the public V1 flip. The numbers are blunt: backend tests went from 614 to 762, frontend tests from 191 to 284, and around forty commits' worth of work landed across the hunts. The interesting part is what *kind* of bug each hunt surfaced, because the patterns repeat across codebases.

#### Crash-class sweeps: null-safety, coercion, type-assertions

The null-safety sweep turned the original `dict.get(k, "").lower()` into `(dict.get(k) or "").lower()` everywhere it appeared in production code (the `or ""` collapses both missing-key and present-but-None into the same safe default), and applied the same pattern in TypeScript: `(c.name ?? '').toLowerCase()`. The coercion sweep wrapped `int()` calls in `try/except (ValueError, TypeError)` and discovered the Pydantic-implicit form when an audit of `_make_summary` showed the call chain `data.get("message_count")` flowing into a Pydantic `int` field with no validator — a single non-numeric value on disk would 500 the entire sidebar. The type-assertion sweep removed every `as any` from the frontend and replaced 91 `as X` casts and non-null assertions with runtime predicates (the `isPrefsEnvelope(body)` pattern for API responses, `instanceof HTMLInputElement` for DOM queries, generic component props that don't need the cast in the first place); the ESLint rule `@typescript-eslint/no-non-null-assertion: 'error'` is now on so the regression can't slip back in.

#### The hunts that came back empty

A few hunts came back with zero HIGH findings, and those were as informative as the positive ones. The async-exception-swallowing audit looked at 30+ `except Exception` callsites in long-running watcher loops and concluded they were all already correct — each one logged via `logger.exception(...)` with descriptive context, each one preserved the cancellation contract (Python 3.11+ promotes `CancelledError` to `BaseException`, so plain `except Exception` doesn't catch it), and the lifespan teardown awaited every background task via `gather(*tasks, return_exceptions=True)` under a 5 s hard cap. The Critic hunt prompt told it to "be especially critical of fixes that turn silent swallows into log-spam," and it correctly refused to ship anything — a result I flagged in the decision record so I could come back later if the answer turned out to be wrong. The pool-in-route audit also came back empty: zero hits for `ThreadPoolExecutor()` inside a request handler, which is the correct baseline for a healthy FastAPI codebase. Those negatives took 30 seconds each via grep and saved me from cargo-culting fixes that weren't needed.

#### A TOCTOU race in the drift detector

The bug that I'm most glad the council found was a TOCTOU race in the search-index drift detector that I would not have spotted on my own. The pattern in `backend/search_index.py` looked like this:

```python
content = path.read_bytes()
mtime = path.stat().st_mtime
upsert(content, mtime)        # stamps content with mtime captured AFTER read
```

That's `stat`-after-read, which is the dangerous variant: if the file is updated *between* the `read_bytes` and the `stat`, the cache stores stale content stamped with a fresh mtime, and the drift detector silently freezes for that path until something else invalidates it. The Architect for the hunt looked at the read-after-stat sites in `FileCache` (which are self-correcting and safe), didn't see a problem, and proposed shipping nothing. The Critic looked at the same sites, found the stat-after-read inversion at `search_index.py:1571` and `:1509`, wrote a `threading.Barrier` test that reproduced the race, and made the case for the check-read-check fix:

```python
mtime_before = path.stat().st_mtime
content = path.read_bytes()
mtime_after = path.stat().st_mtime
if mtime_before != mtime_after:
    logger.info("file modified during read; skipping %s", path)
    continue
upsert(content, mtime_before)
```

That's the kind of finding I would have missed if I'd only asked one model. The Architect's "ship nothing" verdict was reasonable based on a quick pattern match against the safe sites; the Critic's adversarial framing forced a closer look that surfaced the unsafe variant the Architect's mental model didn't have a slot for. The fix shipped with a regression test that fails under transient-break verification, and the audit's decision record documents the disagreement so a future reader can see why it landed the way it did.

#### Seam class: "Conversation not found"

The user-reported "Conversation not found" bug fell into the seam class. The fix turned out to be a two-pass lookup in `_find_conversation_data`: try filename-stem match first (the fast common case), and fall back to a scan via the persistent summary cache that matches on the internal `sessionId` field. The fallback exists because a "continued session" file's filename can differ from its internal id — e.g. `816c6dbf-….jsonl` whose first user entry has `sessionId: 908533b6-…`. The sidebar list endpoint reports the internal `sessionId`, so the user's click hands the detail endpoint a uuid that doesn't match any file's filename stem; pre-fix, the code never tried matching by internal id and returned 404. Post-fix, the detail endpoint resolves the same 100 of 100 search-result uuids on the live corpus. The new bug class in the catalog — *paired-endpoint contract gaps* — covers exactly this seam: each endpoint passes its own tests, no test pins the invariant between them, and the bug is the absence of a test class rather than a flawed assertion in one.

#### Convergence class: doubled snippets

The other user-reported bug — *doubled snippets* in the search panel — surfaced first as a UI complaint: a single hit rendered as two identical rows, with the matching line repeated above itself. The root cause was in the FTS5 projection assembler `_extract_searchable_text`, which appended both `message["text"]` *and* each text-type content block to the indexed body. The `text` field is itself derived from the content blocks (via `_parse_message` calling `_extract_text(content)`), so the prose ended up in the body twice as `"X\nX"`, and FTS5's `snippet()` faithfully echoed the duplication. The fix was a five-line dedupe: when any content block has type `text`, treat the blocks as the canonical source and skip the `text` field. That landed with a `SCHEMA_VERSION` bump from 7 to 8 to force a one-time index rebuild. A week later, a fresh full-sweep run hit the *sibling* of that bug in `_stringify_tool_input`: the same convergence pattern, different code path. For a tool_use block like `{"command": "echo hello"}`, the function appended both `json.dumps(tool_input)` (which carried both keys and values) *and* every top-level string value verbatim — so "echo hello" appeared twice in the body, and tool-call search hits rendered as doubled snippets the same way. The fix that landed (the council called it "Option C" in the decision record) emits a keys-only line *plus* each unique string value at any depth, exactly once each. Two search axes preserved, no overlap. `SCHEMA_VERSION` bumped 8 → 9 to drop+rebuild the index. The two bugs are the same shape: a multi-channel assembler that combines source channels without a dedupe contract pinned by tests. The catalog now calls that class out explicitly so the next hunt finds the third instance before the user does.

#### The pre-public full-sweep

The pre-public sweep itself was a useful data point. Running all sixteen classes against the codebase ahead of the V1 flip returned exactly one HIGH finding (the tool-arg doubling above) and nine "previously hardened — no new findings" outcomes. The Critic prompt is told to refuse a "ship nothing" verdict unless the recon evidence supports it, so each of those nine negatives is a real recon-grounded result, not a shrug. The full-sweep mode is the credibility signal I wanted: the codebase has been audited end-to-end with a method, and the score is recorded class-by-class in the council's decision records.

#### Filesystem-state failure: config-corruption defense in depth

One more shape that turned up in the pre-public work was different from a code bug: a **filesystem-state failure**. The Red-Teamer flagged it on a Round-2 critique of a config-corruption fix I'd already shipped. The original fix was tiny — wrap `json.load(open(config.json))` in a `try/except` so a truncated file doesn't crash boot. The Critic agreed the immediate crash was fixed, then refused to drop the hunt: "on parse failure you fall through to the default `data_dir`. If the user's intended `data_dir` lived somewhere custom — an external SSD, a synced cloud folder — the next fetch silently writes to `~/.claude-explorer/conversations/` instead. They don't lose data, but they orphan the existing archive AND start building a parallel archive in the wrong place. The user has no signal beyond a single log line that nothing reads." That critique turned a one-line patch into a three-layer hardening: (L1) a `config_corrupt_reason` flag on the `Settings` object populated by the parse loop, (L2) a writer-gate helper that returns HTTP 503 from every route that touches `data_dir` when the flag is set, with an explicit recovery message in the body, and (L3) a persistent non-dismissible banner in the UI that surfaces the reason and the recovery path. Reads remain unconditional — the user can still browse what's already on disk while they recover. The `install-watcher` command is intentionally exempt from the writer gate, because it IS the recovery path and locking the user out of it during corruption recovery would be self-defeating; that exemption is pinned by a HARD-invariant test. The Council's CTO synthesis deferred the L1+L2+L3 build as a follow-up because it crossed module boundaries (config + every writer + CLI surfaces + UI banner), and it shipped a week later as its own three-commit PR with thirty-two new tests. The lesson generalizes: a "defense in depth" patch is the right answer when a single try/except converts a crash failure into a silent data-orphaning failure. The cost of the L1+L2+L3 hardening was a few days of work; the cost of waking up one morning to discover six weeks of fetches had been writing to the wrong directory would be a multiple of that.

### Methodology that earned its keep

Two patterns from the audit are general enough that I think every codebase benefits from them. **Bidirectional verification** is the rule that for every "must match" test you write, you also write a "must not match" test seeded against the same fixture. A test that asserts *search for `alphaneedle` returns `conv-alpha`* is half a contract; pair it with a test that asserts *search for `zzzznotinanycorpus` returns `[]`*, and now your test can't pass against a broken implementation that returns everything (it'd fail the negative test) or returns nothing (it'd fail the positive). The pairing is the contract; either test on its own is a rubber stamp.

**Transient-break verification** is the rule that after writing a RED test and a GREEN fix, you revert the fix, confirm the test fails RED for the right reason, and then restore. It's a 30-second discipline that proves the test actually exercises the bug. Skipping it is how you end up with tests that vacuously pass because the fix changed something orthogonal to what the test asserts. Every HIGH fix in the audit had a transient-break verification step in its commit message; the ones that couldn't have one (e.g. type-only refactors where there's nothing to break at runtime) said so explicitly.

Two patterns from the council mechanics also earned their keep. **WWCMM** (*What Would Change My Mind*) is the rule that every persona on every hunt has to state a falsifiable, scoped, measurable condition under which their position would flip. "It might be wrong" doesn't count; "if recon reveals ≥1 hit in a hot request handler" does. The conditions go into the decision record alongside the verdict, so a future reader can re-evaluate when the world changes. In one hunt the Critic's WWCMM was "if you can show me a static-analysis report with zero `body = resp.json()` unused-variable hits"; I ran the analysis, got zero hits, and the Critic explicitly retracted that line of argument in Round 2. The mechanism worked exactly as designed: a falsifiable condition, falsified by evidence, with the position update on the record.

**`git commit --only <paths>`** is the small operational detail that made parallel-agent work tractable. When multiple agents run hunts concurrently against the same checkout — which I did to amortize the wall-clock cost of the twelve hunts — they race on the git index, and broad `git add` operations from one agent occasionally bundle another agent's unstaged changes into the wrong commit. `git commit --only <path1> <path2>` constructs the commit from *only* the listed paths, regardless of what's staged, which keeps each agent's commit attribution clean even under concurrent execution. (Watch out for the variant `git commit --only -- <paths>`: git misparses the `--` and stages the wrong things.) The skill documents both pitfalls so future agents don't re-discover them.

### The lesson

The thing I keep relearning, every time I do work like this, is the one I led the performance section with: experienced people are routinely wrong about where the bugs are, and the only protection is to measure, with a method, against a baseline that re-runs. The Quantify story was a profiler story; this one is a correctness story. Same shape. The Architect's instinct said "ship nothing" on the TOCTOU hunt because the patterns it was seeing didn't ping any of its experience-based heuristics; the Critic's adversarial reading found a real bug at a specific line number; the CTO synthesized the disagreement into a decision and a fix. None of those three roles, working alone, would have produced the result the three of them produced together. That's the part I'd build into every future tool — disagreement isn't a bug in a multi-model workflow, it's the feature that catches what a single model would miss.

The skill is at `~/.claude/commands/code-audit.md` with the catalog at `~/.claude/references/code-audit/bug-classes.md`; if you want to run the same audit on a different codebase, that's the entry point.
