# Part 6 — *The LLM Council: Adversarial Code Review with Heterogeneous Models*

**Status:** detailed plan for the new Part 6 of the *Unlocking Your Claude History* series. Added 2026-05-22 (reversal of the 2026-04-20 split-out decision). Supersedes `PLANS/future_articles/llm_council.md` for the in-series article; that file remains as historical record of the seed material.

**Working title:** *The LLM Council: How Three Models Argue Your Code Into Shape* (alt: *Adversarial Code Review with Heterogeneous LLMs*, *I Hired Three AIs to Disagree About My Code*)

**Target length:** 4,500–5,500 words (longest in the series). Justification: the methodology section needs space; the receipts list is the article's spine and benefits from being unhurried.

## Voice & Audience

- **Voice:** same first-person register as Parts 1–5; the `PROCESS/99_voice_cheatsheet.md` lessons apply. Active voice. No em-dashes mid-sentence (user preference per `feedback_active_voice_critical`).
- **Audience:** semi-technical readers per the user's directive on 2026-05-22 ("we can assume that most of the readers will be at least semi-technical, so covering how that worked is important"). Don't dumb down the methodology. Show the agent prompt, show the council output, show the Decision Record.
- **Tone:** receipts-first. The hook is the shipping crash; the methodology serves the receipts, not the other way around.

## Hook Strategy

**Lead with the shipping crash.** Single best opening because (a) it's unambiguous and visceral — a CLI that was crashing on every invocation, (b) no test covered it (concrete failure of the safety net the reader expects), (c) the Engineer (GPT-5.2) caught it while the Architect (Gemini-3-Pro) missed it (concrete demonstration of the heterogeneous-provider thesis in one anecdote).

**Draft hook:**

> The CLI command at the heart of my Claude conversation exporter — `claude-explorer fetch` — was crashing on every invocation. `TypeError: ClaudeFetcher.__init__() got an unexpected keyword argument 'org_id'`. The signature of the constructor had drifted from the call site, and somewhere along the line both my test suite and I had agreed to look the other way. The bug shipped. I'd been using the tool myself for months.
>
> What caught it wasn't a new test, or a code review I asked a friend for, or a static-analysis pass. It was the GPT-5.2 instance of an adversarial LLM council I'd just stood up to review the codebase before publishing it. The Gemini-3-Pro instance in the same council missed it. The Opus-4.7 orchestrator on top didn't catch it either. One of three models found a regression no single-model review would have surfaced.
>
> That's the thesis: **heterogeneity isn't just nice-to-have; it's what makes the council useful**. Three models from three providers, running in parallel, given the same code and the same brief, will disagree about real things. The job of the council infrastructure is to make those disagreements legible — turn them into cited code arguments, force resolution through cross-critique rounds, and produce a Decision Record that names what shipped and what got rejected and why.
>
> Here's the rest of what the council caught.

## Structural Sketch

```
1. Hook — the shipping crash (~400 words)
2. What the council is, stated plainly (~500 words)
3. Setup — agent file, PAL MCP, the three models (~600 words)
4. Five receipts from this session (~1500 words)
5. Two receipts from the original build (Phase 19/20) (~600 words)
6. The §5.12 rule that came out of the process (~400 words)
7. The negative example — intended-council-degraded-to-solo (~300 words)
8. When NOT to use the council (~400 words)
9. Wrapping up + CTA (~300 words)
```

## Section-by-Section

### 1. Hook (~400 words)

See "Hook Strategy" above. Lead with the crash, end the hook with the thesis statement: heterogeneity is the point.

Drop in a code excerpt of the actual TypeError trace if recoverable from the session transcript or by reverting `0df133b`. This is concrete and grounding.

### 2. What the Council Is (~500 words)

State it plainly. The structure:

- **Three personas** with explicit roles:
  - Senior Principal Engineer (GPT-5.2 via PAL) — Python idiom, code-level quality, sloppy-coding hunt, test-suite rot, security-adjacent
  - Software Architect (Gemini-3-Pro-preview via PAL) — module boundaries, layering, REST API design, file-size cliffs, abstraction drift
  - CTO (Opus 4.7, in Claude Code directly) — synthesis, Decision Records, ship/no-ship, user-gating, transient-break enforcement
- **Three rounds, by design**:
  - Round 1 — parallel, blind. Each persona sees the brief and the code, none see each other's response.
  - Round 2 — cross-critique. Each external persona sees the other's Round-1 response and must hold or revise with code evidence.
  - Round 3 — CTO synthesis. Opus reads both rounds plus its own independent notes, writes the Decision Record.
- **WWCMM (What Would Change My Mind)** on every position. Required form: *"I would reverse this position if <specific test>: <repro steps> — producing <observable signal>."* Stylistic objections without a concrete repro get bounced.
- **Decision Record** as the durable artifact: Chosen Option, Top Rejected, Decision Basis, Residual Risks, CTO WWCMM, per-disagreement resolution table.

Explain *why* heterogeneity matters: same-provider models share training-data bias, prompt-following style, and failure modes. Cross-provider councils don't share those. The few times this session a single model produced an articulate-sounding bad recommendation, a different-provider councilor caught it.

Reference (lightly, without diving in) the user's existing LinkedIn post on the council pattern. The article extends; it doesn't duplicate.

### 3. Setup (~600 words)

Show the actual setup, abbreviated.

- **PAL MCP** — what it is, why it's the routing layer, link to install.
- **The agent file** — `~/.claude/agents/llm-council-code-review.md`. Show the YAML frontmatter (10 lines). Mention the spec is ~700 lines but most readers don't need that; link to a gist for the curious.
- **The invocation** — `Task(subagent_type: "llm-council-code-review", prompt: "scope:backend mode:hunt-and-fix tiers:HM")`.
- **Preflight, fail-fast** — the agent pings both PAL models before doing any work. If either is unavailable (insufficient quota, 5xx, MCP error), the council STOPS. No automatic single-provider fallback. The user can override per-run, but the default is to halt — preserves the heterogeneous-provider signal.

Show a redacted preflight log:
```
Preflight:    gpt-5.2 PONG | gemini-3-pro-preview PONG
Baseline:    928 backend pytest GREEN
                325 frontend vitest GREEN
Baseline SHA: <sha>
```

Pull from `~/.claude/agents/llm-council-code-review.md` for accuracy. Mention the WWCMM requirement and the §5.12 attribute-patch rule are encoded directly in the agent prompt — the agent enforces its own discipline, the orchestrator doesn't have to remember.

### 4. Five Receipts from This Session (~1500 words)

These are the headline. ~300 words each. Each follows the shape: **Trigger → What the council surfaced → Who caught what → Outcome → What single-model would have likely missed**.

#### 4.1 The shipping crash (revisited from the hook)

- **Commit:** `0df133b` (in consolidated history: `0ca4131`)
- **Catch:** `claude-explorer fetch` crashed with `TypeError: org_id` on every invocation; no test covered the CLI-to-bulk_fetch wire.
- **Who:** GPT-5.2 Engineer in Round 1.
- **Outcome:** fixed in same hunt; new test pinning the wire added.
- **Single-model contrast:** the Architect's framing was structural ("the cli.py module is overgrown"); only the Engineer's lens caught the call-site drift. The architectural view doesn't notice signature mismatches because it sees modules, not lines.

#### 4.2 CWE-200 exception text leak

- **Commit:** `d970c8e` (in consolidated history: `0ca4131`)
- **Catch:** backend `/api/orgs/{id}/credentials` and similar 500 responses included the raw exception text in the `detail` field, leaking stack-trace-adjacent internals to the browser.
- **Who:** convergent — both Engineer and Architect flagged it independently.
- **Outcome:** static user-facing message + server-side `exc_info=True` log via stdlib logging.
- **Beat for the article:** convergent catches are the cheaper signal — when both councilors land on the same point unprompted, the finding is real with no need for cross-critique.

#### 4.3 launchd plist XML injection

- **Commit:** `4a37cc5` (in consolidated history: `0ca4131`)
- **Catch:** the `install-watcher` CLI generated a launchd `.plist` by string-interpolating `Path.cwd()` into XML. A user whose cwd contained `&` would generate invalid XML that launchd would silently reject — failed install, no error surfaced.
- **Who:** Engineer found it as a side observation during a different hunt.
- **Outcome:** `xml.sax.saxutils.escape` on every interpolation site.
- **Beat for the article:** "side observation during a different hunt" is a recurring council pattern — when you bring three pairs of eyes to a codebase, they don't always answer the question you asked; sometimes they answer a better question.

#### 4.4 The half-wired error classifier

- **Commit:** `9ec2d00` (in consolidated history: `0ca4131`)
- **Catch:** `routers/fetch.py` was already calling `_classify_error()` and producing a clean `ErrorKind` enum (`AUTH` / `TRANSIENT` / `TERMINAL`). Six lines later, it discarded that result and re-derived ad-hoc `HTTP_***` strings from `str(exc)` to persist in `_index.json`. Both Engineer and Architect spotted the incoherence.
- **Who:** Round-1 convergent.
- **Outcome:** persist `(error_kind, http_status)` as two fields; legacy `HTTP_***` strings migrated at read time so existing user data keeps working; rollup rewritten to switch on kind.
- **Beat for the article:** this is the kind of incoherence that only surfaces when something forces you to read the whole flow. The council reads code more carefully than you do because it's not in a hurry to ship.

#### 4.5 The MessageBubble god-module split

- **Commits:** `a4e972b` + `3d51a47` + `401a49c` + `d76dc6c` (consolidated into `3b8c910`)
- **Catch:** `MessageBubble.tsx` at 806 LOC was mixing clipboard handling, timer state, CC image cataloging, marker parsing, tool blocks, and content rendering. Engineer initially marked HIGH, downgraded to MED in Round 2 ("maintainability not correctness"). Architect proposed the `blocks/` subdirectory split.
- **Who:** Round-1 split; converged in Round 2 on the conservative four-commit chunked refactor.
- **Outcome:** 806 → 299 LOC; six new modules under `blocks/`; 17 new contract tests pinning the public render contract via data-attributes (not byte-for-byte snapshots).
- **Beat for the article:** the article should show the actual Decision Record fragment with the "Engineer Round-2 downgrade" reasoning. That's the council's audit trail in action.

### 5. Two Receipts from the Original Build (~600 words)

Reuse the `PLANS/future_articles/llm_council.md` Phase 19 and Phase 20 material with light updates.

#### 5.1 Phase 19 — the keyboard focus-model reframe

Council reframed "patch `^N`/`^P` to also route to detail pane" into **"Spatial Model with Contextual Scope: the same keys should work in both panes but operate on different targets based on which pane has focus"**. Produced the full Vim/Emacs binding table. This is the *biggest "council reshaped the plan"* moment in the build.

Cite session position: `a70251a5#pos=3955`. Reference `PROCESS/a70251a5/phase_19_keyboard_and_search_navigation.md` for the full extraction.

Include the caveat: the `Ctrl+N/P` part regressed during a later phase and required the user to re-assert. **The council's spec was right; the implementation drifted.** Article should call this out — credibility through admission.

#### 5.2 Phase 20 — MCP server design

Council killed a 6-tool surface (the user's opening proposal), invented hybrid positions+UUIDs addressing, agreed a 200-char summary cap, flagged that tool calls are ~80% of content and must be off by default. The append-only incremental cache design came out of the cross-critique round.

Cite `a70251a5#pos=4844`. Reference `PROCESS/a70251a5/phase_20_mcp_server_design_and_build.md`.

Include the council's miss: it proposed `mcp.server.fastmcp` (Anthropic's bundled v1) instead of `fastmcp` v3 by jlowin. Claude Code patched the imports after reviewing the council output. **Council output is reviewed, not rubber-stamped.** Important beat for the article.

### 6. The §5.12 Rule (~400 words)

A testing-discipline rule that came out of the process. During the A2 `export.py` refactor (also this session), the Engineer caught that a proposed function-move would silently break 23 tests because they used the `import module; setattr(module, "X", ...)` (attribute-patch) idiom rather than the value-binding form. The council downsized the refactor mid-implementation.

The rule got codified in `CLAUDE-TESTING.md §5.12`:

> Prefer `monkeypatch.setattr(module, "name", fake)` over `from module import name`. The former is refactor-safe; the latter binds at test-import time and silently no-ops when the helper is moved.

Article beat: **the council surfaced not just a bug but a project rule.** Process improvements compound across future hunts. The agent prompt now encodes this as a Phase 1.5 structural pre-check: "before any refactor that touches a heavily-patched module, grep for the fragile idiom and surface the count."

This is the article's "build-on-itself" section — the council improves the council. Show a fragment of the agent prompt where the rule is encoded.

### 7. The Negative Example (~300 words)

Reuse the existing Phase 19 Cmd+G perf-pass anecdote from `future_articles/llm_council.md` Catch 6.

> *"Have the llm coding council think step by step…"* — the invocation used `/plan` + solo Plan/Explore subagents, not `/coding`. The fast-path + prefetch design is single-model output.

**Why it matters:** you have to double-check that your trigger actually reaches the council. The feeling-of-multi-model-review without the substance is a real failure mode.

Pair this with one from this session: the autonomous-mode period when OpenAI quota was exhausted. The agent halted at preflight rather than silently degrading to a 2-persona Gemini+Opus council. **The fail-fast rule is load-bearing.** Without it, the user thinks they got a council pass when they actually got a degraded single-provider review.

Two negative examples in one section, each demonstrating a different way the council can fail to be the council you wanted.

### 8. When NOT to Use the Council (~400 words)

The discipline half. The council costs ~$0.44 per hunt class and ~20 minutes of wall-clock time. For routine bug fixes, single-line corrections, typos, formatting changes, anywhere a single-model pass is already over-fitted: skip it.

The 2026-05-21 session's breakdown:
- ~10 council invocations
- 60 commits resulted (consolidated to 4)
- 5+ HIGH/MED findings shipped
- 8+ deferred LOW/NIT items the council *re-evaluated* and held with explicit rationale

The council is reserved for problems where one-model-deep would probably under-think the space. State the criteria:
- New design decisions with multiple credible paths
- Refactors with non-trivial blast radius
- Audits of unfamiliar code or pre-publish sweeps
- Anywhere "what would a different model think" has plausible alternative answers

Don't use it for:
- "Fix the typo in line 42"
- "Add a docstring"
- "Bump the version"
- Anywhere the answer is obvious to you already

Reference the `feedback_v1_release_polish` memory: this session's bar was "as perfect as possible" for a portfolio piece. That justified the council's intensity. For day-to-day work, single-model is usually fine.

### 9. Wrapping Up (~300 words)

Recap the receipts list as a bullet-pointed summary:

> Five real bugs the council caught in code I'd already reviewed myself:
> - A shipping crash in the main CLI command (no test covered it)
> - A CWE-200 information disclosure in 500 responses
> - An XML injection in the launchd plist generator
> - Two session-key prefix leaks in console banners
> - An unbounded retry loop that could spin forever
>
> Plus a half-wired classifier, six god modules split, and a project testing rule that came out of the process.

CTA: link to a public gist of the agent file. Reference the LinkedIn callback. Tease the next column piece (if any).

Closing line draft:

> The pattern works because the models disagree. The infrastructure works because the disagreements are forced into legible Decision Records instead of getting averaged into mush. That's the whole trick.

## Tone Beats (for the drafter)

- **Receipts-first, methodology-second.** Don't make the reader earn the catches.
- **Show the Decision Record.** At least one real fragment, lightly trimmed.
- **Admit the misses.** Phase 20's `fastmcp` library mistake. The autonomous-mode quota halt. The Cmd+G perf pass that wasn't actually a council pass. The article's credibility comes from owning these.
- **Heterogeneity is the thesis.** State it three times across the article (hook, methodology section, wrap). Each from a slightly different angle.
- **No purple prose about AI.** Treat the council as infrastructure, not magic. The shipping-crash anecdote is dramatic because the failure is concrete, not because LLMs are inscrutable.
- **No em-dashes mid-sentence** (user's hard rule per `feedback_active_voice_critical`). Use commas, semicolons, or sentence breaks.
- **Active voice everywhere** (user's hard rule, same memory).

## Source Material

Required reads before drafting:
- `~/.claude/agents/llm-council-code-review.md` — the agent spec itself (final source of truth on the methodology)
- `PLANS/CODE-REVIEW-BACKEND.md` — Decision Records for the backend sweep
- `PLANS/CODE-REVIEW-FETCHER.md` — Decision Records including A1-CLI-LAYER shipping crash
- `PLANS/CODE-REVIEW-FRONTEND.md` — MessageBubble split Decision Record
- `PLANS/future_articles/llm_council.md` — original seed doc; Phase 19/20 material to reuse
- `PROCESS/a70251a5/phase_19_keyboard_and_search_navigation.md` — Phase 19 deep dive
- `PROCESS/a70251a5/phase_20_mcp_server_design_and_build.md` — Phase 20 deep dive
- `CLAUDE-TESTING.md §5.12` — the testing rule that came out of the process
- The user's existing LinkedIn LLM-Council post — paste into this plan doc before drafting so the article can extend, not duplicate

Recoverable from git:
- Commit message bodies for every receipt (`git log --format='%B' <sha>` for each)
- The consolidated `0ca4131` commit body has the per-finding bullet list

## Pre-Draft Checklist (run before Phase H subagent)

- [ ] LinkedIn LLM-Council post pasted into a "Seed material" section in this doc
- [ ] User confirms Part 6 placement (after Part 5, vs. between Part 3 and Part 4)
- [ ] User confirms the working title (or picks an alt)
- [ ] User reviews the receipts list — any to add/cut?
- [ ] Decide whether to include code snippets inline or link to a gist (recommended: gist for the agent file, inline for individual catches)
- [ ] PII scrub plan: ensure no real session keys, org UUIDs, or personal paths in any quoted Decision Record fragment

## Caveats / Risks

- **Per-model attribution thinness.** Top-level Task-tool results surface only the council's synthesized answer. Which specific catch came from GPT-5.2 vs Gemini is visible only when the Decision Record explicitly names the disagreement resolution. Mitigation: pull sub-agent tool-call logs for the standalone article if higher-resolution attribution is needed; for this in-series version, "convergent vs split" framing is sufficient.
- **PAL MCP setup is out of scope for this repo.** The `mcp_server/` in this project is the Claude-sessions MCP, not PAL. The article will need to link out to PAL MCP install docs.
- **`llm-council-*` agent file contents aren't in this repo.** They live in `~/.claude/agents/`. The article should either include their definitions inline or link to a public gist. Recommend gist (more shareable, cleaner article).
- **OpenAI quota dependency.** Worth one sentence: the council requires real spend on the OpenAI side; this is not a free pattern.
- **Voice-cheatsheet compliance.** Per Part 1 v2 lessons, run the draft through the active-voice + no-em-dash checks before review.

## Out of Scope

- Phillips-Connect AI and other-project catches (the original `future_articles/llm_council.md` planned to fold these in for a 10–15 sample size). For the in-series version, the catches from this one project are sufficient because the audience is "people who read Parts 1–5". The cross-project standalone article remains possible as a follow-up, but is not this article.
- Council-vs-other-patterns comparison (e.g., council vs `/code-audit` vs solo ultrathink). Save for a follow-up methodology piece.
- The 60→4 commit consolidation mechanics. That's a separate "git rewrite tricks" article, not this one.

## Cross-References

- `PLANS/medium-article.md` — series-level living plan (Part 6 added 2026-05-22)
- `PLANS/future_articles/llm_council.md` — historical seed doc; this plan supersedes it for the in-series version
- `PLANS/articles/part2_revision_plan.md` — pattern for detailed per-part planning docs
- `PLANS/articles/part2_codereview_audit.md` — sibling audit confirming Part 2 doesn't need updates from the same code-review session
