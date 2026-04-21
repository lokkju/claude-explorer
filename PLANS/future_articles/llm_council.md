# Future Article — The LLM Council as an Early-Warning System

**Status:** seed doc for a future standalone Medium article. Not part of the *Unlocking Your Claude History* series; will be written after that series ships. Builds on the user's existing short LinkedIn post on the LLM Council pattern (paste that content into this doc when you pick it up so the drafter can extend it, not duplicate it).

**Placement:** standalone article on Medium under `@raymondpeck`, probably under a new column tag about multi-model / agentic workflows. Pairs naturally with future retrospectives from the Phillips-Connect AI project and any other projects where the Council was used.

**Why split it out:** the material is too dense and transferable to fit as a sub-point of the *Unlocking Your Claude History* series. Its own article gets the space to (a) set up PAL MCP + the `llm-council-*` agent files properly, (b) walk through the "disagreements resolved" mechanic, (c) draw from multiple projects for a credible sample size.

---

## Seed material (from LinkedIn)

> *Paste user's existing LinkedIn post content here before the drafter runs.*

---

## Raw research findings (from `claude-desktop-message-exporter` session `a70251a5`)

These are the citable catches the Council produced in the exporter project. The future article should expand from this baseline with examples from other projects (Phillips-Connect AI, etc.) to reach the 10–15-example sample size that makes the pattern credible.

### Prevalence summary

- Roughly **4 explicit `/coding` (llm-council-coding) invocations** plus 3 `/llm-council-coding ultrathink` calls across the 5,006-message main build session.
- Plus **~10 `ultrathink`-without-council prompts** where the user asked Claude Code to think harder solo (distinct from Council use, worth contrasting in the article).
- Council is called for **design passes** (Phase 01 frontend plan, Phase 19 keyboard focus model, Phase 20 MCP server design) much more than for bug-fixing.
- Split is roughly **70% planning-phase / 30% implementation-phase** Council use.
- The Council is never spammed — specifically reserved for problems where "one-model-deep" would probably under-think the space.

### Catch 1: Phase 20 — MCP server design (council killed a 6-tool surface, invented hybrid addressing)

- **Trigger:** User proposed 5 numbered tools in the opening prompt, including per-session SQLite summary caching. [a70251a5#pos=4844 msg=ff2ee72e…]
- **Invocation:** `/coding` → `llm-council-coding` agent (PAL → Opus 4.6 orchestrating GPT-5.2 + Gemini). [a70251a5#pos=4844 msg=ff2ee72e…, pos=4849 msg=5771f414…]
- **What the Council resolved:**
  - **Turn-pairs vs message-level addressing → Hybrid** (positions + UUIDs)
  - **6 tools vs 4 → 5 tools** (merged search+list, kept export separate)
  - **Cache invalidation → Session-level mtime with CASCADE delete** [a70251a5#pos=4851 msg=cfaab320…]
  - Agreed a **200-char summary cap** ("a 100-message outline is ~5K tokens vs ~200K+ raw")
  - Flagged that **tool calls are ~80% of content** and must be off by default — became the default-flag design
- **Outcome:** Adopted wholesale. Final `mcp_server/server.py` ships exactly the 5 tools the Council converged on, with position+UUID addressing. The Council output directly names "Disagreements Resolved" between the panel members — evidence the multi-model debate happened.
- **Attribution note:** Council summary is synthesized by Opus 4.6; the underlying splits (turn-pairs vs message-level; 6 vs 4 tools) are artifacts that two different sub-models advocated before consensus. Exact per-model attribution is not exposed in top-level Task-tool results; the "Disagreements Resolved" section is the Council's fingerprint.

### Catch 2: Phase 20 — append-only incremental-cache design

- **Trigger:** After the Council's first pass, the user asked *"Aren't the project message data only appended to by Claude Code and Claude Desktop, so the 'head' summaries could be kept?"* [a70251a5#pos=4852 msg=9bd17125…]
- **What the Council caught:** The follow-up reasoning surfaced the **append-only incremental-cache** design: check mtime, compare cached vs actual `message_count`, generate summaries only for new positions. [a70251a5#pos=4858 msg=e2b2504c…]
- **What the Council missed (user caught on review):** Council proposed `mcp.server.fastmcp` (Anthropic's bundled v1) instead of `fastmcp` v3 by jlowin; Claude Code patched the imports and `pyproject.toml` after reviewing Council output. [a70251a5#pos=4885 msg=85b6a530…]
- **Outcome:** Append-only pattern shipped as-designed. Library-version mistake was caught by Claude Code reading the Council's code and cross-checking against the user's preference — a good example of Council output being *reviewed*, not rubber-stamped.

### Catch 3: Phase 20 — token-budget rule (Council-adjacent, user-driven)

- **Trigger:** *"Can we make the descriptions such that the client LLM should only call these when explicitly asked? I'm worried that Claude Code and Claude Desktop could burn through a zillion tokens…"* [a70251a5#pos=4918 msg=2b09a3a9…]
- **Outcome:** Every tool description was rewritten with explicit "only call when the user explicitly asks…" language, and a server-level instruction block was added. Then the user asked for a **measured answer** on fixed context cost (*"how many tokens will be injected for the tool definitions?"* [pos=4948 msg=389485b9…]) — answer: **4,681 chars / ~1,200–1,600 tokens** across 5 tools [pos=4949 msg=41b1fe2b…].
- **Why this belongs in the Council article:** it's the post-Council discipline of treating tool-description wording as a first-class design artifact. Good companion to the main Council catches.

### Catch 4: Phase 19 — keyboard focus model (biggest "Council reshaped the plan" moment)

- **Trigger:** *"^P / ^N navigate the sidebar, but not the detail window. I'd like to … propose a way to navigate both between conversations and between turns, all using the keyboard."* [a70251a5#pos=3955 msg=146425ff…]
- **Invocation:** `/coding` → `llm-council-coding`. [a70251a5#pos=3957 msg=5c59631a…]
- **What the Council caught:** Rather than patch `^N`/`^P` handlers in the sidebar to also route to the detail pane, the Council reframed it as a **"Spatial Model with Contextual Scope"** — "The same keys should work in both panes but operate on different targets based on which pane has focus." Produced the Vim/Emacs mapping table (`j/k` vs `Ctrl+N/P`, Tab/Enter for pane-switching, `u`/`a` for user/assistant jumps). [a70251a5#pos=3959 msg=5547288f…]
- **Outcome:** Adopted with two user modifications — Emacs mode reuses Enter/Esc like Vim instead of Ctrl+F/Ctrl+B ([pos=3960 msg=f32f630d…]), and `u/a`/`U/A` replaced Alt+N/Alt+P for user/assistant jumps ([pos=3962 msg=8c87fb38…]).
- **Caveat:** The `Ctrl+N/P` part of the Council plan *regressed during Era 2* and required the user's explicit "focus in one or the other" re-assertion at [pos=4326 msg=49d158c4…] to fix. The Council's spec was right; the implementation drifted.

### Catch 5: Phase 01 — frontend plan depth

- **Trigger:** *"yes create frontend.md llm-council-coding ultrathink"* [a70251a5#pos=12 msg=6283ed70…]
- **Invocation:** Task tool with Council workflow. [a70251a5#pos=13 msg=3140d19b…]
- **What the Council produced:** A phase-by-phase frontend plan matching the depth of the existing `PLANS/fetcher.md` and `PLANS/backend.md`. Had Claude Code written `frontend.md` solo it would likely have produced a shallower doc.
- **Why this belongs:** set the quality bar that every subsequent phase executed against. Without this Council-level plan depth the project would have drifted into ad-hoc implementation much earlier.

### Catch 6 (negative example, illuminating): Phase 19 Cmd+G perf pass — intended Council, degraded to solo

- **Trigger:** *"Have the llm coding council think step by step…"* [a70251a5#pos=4796 msg=9671cb18…]
- **What actually happened:** The invocation used `/plan` + solo Plan/Explore subagents, not `/coding`. [pos=4810 msg=a5183942…, pos=4812 msg=622474f1…] The fast-path + prefetch design is single-model output.
- **Why this belongs:** crucial nuance for article readers. You have to double-check that your trigger actually reaches the Council, or you'll get the feeling-of-multi-model-review without the substance.

## Other catches to fold in (from outside this project)

*Placeholders — fill in from Phillips-Connect AI and any other projects when drafting.*

- Phillips-Connect AI: …
- Other: …

## Structural sketch for the future article

1. **Hook** — pick a single catch that's unambiguous and visual (Phase 19 keyboard focus-model reframe is the strongest candidate)
2. **The pattern, stated plainly** — what the Council is, how the three models relate, why it's reserved for design forks
3. **Setup** — PAL MCP, `llm-council-*` agent files, the `/coding` and `/llm-council-coding ultrathink` triggers. Short. Link to a setup gist.
4. **Four or five catches** — one per section, each with "what the single-model answer would have been" contrast
5. **The negative example** — intended-Council-degraded-to-solo. The article is stronger because it admits the pattern has edges.
6. **When NOT to use the Council** — routine bug fixes, small refactors, anywhere a single-model pass is good enough. This is the discipline half of the pattern.
7. **Wrapping Up** — recap, CTA, LinkedIn/Medium callback, next piece in the column.

## Caveats / gaps to resolve before drafting

- **Per-model attribution is thin.** Top-level Task-tool results surface only the Council's synthesized answer. Which specific catch came from GPT-5.2 vs Gemini is visible only when the Council output explicitly names the disagreement resolution. Consider whether to pull sub-agent tool-call logs for the standalone article.
- **PAL MCP setup is out of scope for this repo.** The `mcp_server/` in this project is Claude-sessions, not PAL. The future article will need to link out to PAL MCP install docs.
- **`llm-council-*` agent file contents aren't in this repo.** They live in `~/.claude/agents/`. The article should either include their definitions inline or link to a public gist.
- **Usage in other projects.** The 4-invocation sample from this one project is thin. Draft only after pulling examples from at least one additional project (Phillips-Connect AI is the natural candidate given the MCP-powered retrospective plan in `PROCESS/93_use_cases.md`).

## Referenced files

- `/Users/rpeck/Source/claude-desktop-message-exporter/PROCESS/a70251a5/phase_01_intent_and_planning.md`
- `/Users/rpeck/Source/claude-desktop-message-exporter/PROCESS/a70251a5/phase_19_keyboard_and_search_navigation.md`
- `/Users/rpeck/Source/claude-desktop-message-exporter/PROCESS/a70251a5/phase_20_mcp_server_design_and_build.md`
- `/Users/rpeck/Source/claude-desktop-message-exporter/mcp_server/server.py` (final Council-derived shape)
