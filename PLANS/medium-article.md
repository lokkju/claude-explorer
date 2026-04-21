# Medium Article Series: *Unlocking Your Claude History*

> Living plan + progress tracker. Mirrors `/Users/rpeck/.claude/plans/bright-jingling-comet.md` (the approved plan from the `/plan` flow).

## Context

A Medium series on this project — not one post. Three topics are fixed: **(1)** what it is + use cases, **(2)** the web UI, **(3)** the MCP server on Claude Code + Desktop across macOS/Windows/Linux. Plus **(4–5)** a creation-story on building it with Claude Code, mined from the actual build transcript.

The raw material for (4–5) lives in the `claude-sessions` MCP server: one main build session of **5,207 total messages** — 5,006 on the active branch (201 on inactive branches), of which 2,624 are recorded as `sender=human` but only **312 are real user-authored prompts** (the rest are `tool_result` payloads that Claude Code tags as `human`). The plan's central job is a disciplined extraction pipeline that lands on disk as citable artifacts in `PROCESS/`, then drafts five article parts in the user's established Medium voice.

## Shape

```
                           ┌─────────────────────┐
  5,207-msg build session ─┤  claude-sessions    │
                           │   MCP tools         │
                           └──────────┬──────────┘
                                      │
                                      ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                       PROCESS/                                │
   │  outline → phases → phase_NN_*.md (citable, msg_uuid-linked) │
   └──────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  synthesis:  themes / quotes / timeline / use_cases           │
   └──────────────────────────────────────────────────────────────┘
                                      │
        ┌──────────────┬──────────────┼──────────────┬──────────────┐
        ▼              ▼              ▼              ▼              ▼
     Part 1         Part 2         Part 3         Part 4         Part 5
     Overview       Web UI         MCP server     Build story 1  Build story 2
     (README +      (screenshots)  (README +      (phases 1–N)   (phases N–end)
      use_cases)                    meta demo)
```

Single-threaded. Subagents write files, return ≤300-word summaries. Pauses between phases let the user redirect.

## Confirmed Decisions

| Decision | Choice |
|---|---|
| Series title | *Unlocking Your Claude History: A UI and MCP Server for Your Conversations* |
| Publication | `@raymondpeck` directly on Medium |
| Voice source | User's "Best Practices for Modern REST APIs in Python" series |
| Voice artifact | `PROCESS/99_voice_cheatsheet.md` — pasted into every drafting subagent |
| Part 1 hook | Real story, first person — the "lost access to my account" narrative is sketchy; it makes me seem like I'm stealing IP; rather, the narrative should be around searching and accessing full session transcripts with a UI that shows the entirety of each session, plus programmatically via Claude Code and Claude Desktop (UI first, then MCP) |
| Part count | 3 fixed (overview, UI, MCP) + 1–3 creation-story parts; decided after synthesis |
| Code in articles | Real repo code, lightly trimmed |
| Screenshots | Captured via Playwright at draft time; user approves/retakes |
| Session scope | `claude-desktop-message-exporter` project only; 7 Gmail-agent sessions skipped |
| Target length | 2,500–5000 words per part; 600–900 for series intro |
| Pause points | 7 approved (before start, after scaffold, after phase boundaries, every 5 phases during extraction, after synthesis, after each article part, before final PII pass) |
| LLM Council content | **Split out of this series** (2026-04-20 decision). Full research preserved at `PLANS/future_articles/llm_council.md` for a standalone article building on user's existing LinkedIn post. In this series, Part 3 and/or Part 5 include a one-sentence forward reference only — see the scope note at the top of the *LLM Council* theme in `PROCESS/90_themes.md`. |

## The Series (5 parts proposed; compress to 4 or expand to 6 after Phase F)

### Part 1 — *What This Thing Is and Why You'd Want It*
Hook: the full text of every Claude conversation you've ever had — Desktop and Code — unified in one searchable UI, and also queryable programmatically from Claude Code and Claude Desktop via an MCP server. Three concrete use cases (UI-based search / reading, MCP-powered retrospective, find-mistakes-in-your-sessions). Prose architecture diagram: capture → fetch → browse/export (UI) + MCP (programmatic). The lost-account / data-portability beat is a supported edge case mentioned briefly, not the hook.

### Part 2 — *Using the Web App*
Install & first run. Screenshot walkthrough: conversation list, full-text search, keyboard nav, message tree, dark mode, mobile. Export to Markdown & PDF.

### Part 3 — *The MCP Server in Claude Code and Claude Desktop*
What MCP is. The 5 tools. Claude Code config (CLI + JSON). Claude Desktop config paths for macOS/Windows/Linux. **Headline demo:** *"I used this MCP server to mine this project's own build history to write this series."*

### Part 4 — *Building It with Claude Code, Part 1 — Reverse-Engineering the Claude API*
Where Claude Desktop stores data. mitmproxy + cert pinning. Unofficial API mapping. Pivot from proxy to Playwright.

### Part 5 — *Building It with Claude Code, Part 2 — Backend, Frontend, and MCP*
FastAPI backend. React/Tailwind/shadcn frontend. MCP server. Retrospective on Claude Code pair-programming.

## Session Inventory

See `PROCESS/00_session_inventory.md` for the full table. In scope: `a70251a5-…` (5207 msgs, main build) and `76fe578b-…` (41 msgs, this planning session). Skipped: 7 Gmail-scanner sessions from 2026-04-08.

## Progress Tracker

| # | Phase | Status | Artifact |
|---|---|---|---|
| A | Scaffold `PROCESS/` + copy plan | ✅ | `PROCESS/README.md`, `00_session_inventory.md`, `99_voice_cheatsheet.md`, `PLANS/medium-article.md` |
| B | Main-session outline | ✅ | `PROCESS/a70251a5/outline.jsonl` (5006 rows) + `outline_digest.md` + `_build_outline.py` |
| C | Phase boundary detection | ✅ | `PROCESS/a70251a5/phases.md` — 25 → **21 phases** after user-directed fold (2026-04-19); Phase 02 SKIPPED (off-topic); Phases 19–23 merged into `keyboard_and_search_navigation` |
| D | Per-phase extractions | ✅ | **20 of 20 done.** Phase 02 skipped (off-topic) per user directive. |
| E | Current + skipped | ✅ | `PROCESS/76fe578b/summary.md`, `PROCESS/skipped/gmail_sessions.md` |
| F | Synthesis | ✅ | `PROCESS/{90_themes,91_memorable_quotes,92_timeline,93_use_cases}.md` |
| G | User review gate | ⬜ | pause |
| H | Article drafts | 🟡 | **1 of 5 done.** `PLANS/articles/part_1_overview.md` written (3,772 words). Awaiting user review before Part 2. |
| I | Series intro | ⬜ | `PLANS/articles/00_series_intro.md` |
| J | PII sweep | ⬜ | final versions |

Legend: ⬜ not started • 🟡 in progress • ✅ done • ⏸️ paused • ⏭️ skipped

## Phase D Sub-Tracker (per-phase extractions)

Each subagent reads `PROCESS/a70251a5/outline.jsonl` + `phases.md`, pulls specific messages via `mcp__claude-sessions__get_messages(session_id="a70251a5-b932-4b61-aba1-16a70410b98e", positions=[…])`, and writes one `phase_NN_<slug>.md` in the Phase 01 template. Prompt template at end of this file.

| Phase | Slug | Positions | Status | File |
|-------|------|-----------|--------|------|
| 01 | intent_and_planning | `[0..57]` | ✅ | `phase_01_intent_and_planning.md` |
| 02 | figma_mcp_detour | `[58..112]` | ⏭️ | SKIPPED (off-topic per user) |
| 03 | initial_scaffold_backend_ui | `[113..335]` | ✅ | `phase_03_initial_scaffold_backend_ui.md` |
| 04 | fetcher_and_mitmproxy_capture | `[336..575]` | ✅ | `phase_04_fetcher_and_mitmproxy_capture.md` |
| 05 | file_and_pdf_attachments | `[576..703]` | ✅ | `phase_05_file_and_pdf_attachments.md` |
| 06 | playwright_e2e_harness | `[704..987]` | ✅ | `phase_06_playwright_e2e_harness.md` |
| 07 | viewer_tool_calls_and_branches | `[988..1250]` | ✅ | `phase_07_viewer_tool_calls_and_branches.md` |
| 08 | open_in_desktop_and_edit_retry | `[1251..1435]` | ✅ | `phase_08_open_in_desktop_and_edit_retry.md` |
| 09 | fetcher_403_and_rebrand | `[1436..1492]` | ✅ | `phase_09_fetcher_403_and_rebrand.md` |
| 10 | claude_code_local_files_unification | `[1493..1818]` | ✅ | `phase_10_claude_code_local_files_unification.md` |
| 11 | perf_caching_tool_results | `[1819..2109]` | ✅ | `phase_11_perf_caching_tool_results.md` |
| 12 | caveat_filter_and_rename_explorer | `[2110..2389]` | ✅ | `phase_12_caveat_filter_and_rename_explorer.md` |
| 13 | playwright_login_alt_credential | `[2390..2649]` | ✅ | `phase_13_playwright_login_alt_credential.md` |
| 14 | project_grouping_and_sidebar | `[2650..2787]` | ✅ | `phase_14_project_grouping_and_sidebar.md` |
| 15 | caveat_titles_and_exporter_cleanup | `[2788..2861]` | ✅ | `phase_15_caveat_titles_and_exporter_cleanup.md` |
| 16 | connection_status_popup | `[2862..3112]` | ✅ | `phase_16_connection_status_popup.md` |
| 17 | dev_env_noise_and_pkill_permission | `[3113..3280]` | ✅ | `phase_17_dev_env_noise_and_pkill_permission.md` |
| 18 | settings_page_kbd_dark_mode_plan | `[3281..3810]` | ✅ | `phase_18_settings_page_kbd_dark_mode_plan.md` |
| 19 | keyboard_and_search_navigation | `[3811..4842]` | ✅ | `phase_19_keyboard_and_search_navigation.md` (merged from old 19–23) |
| 20 | mcp_server_design_and_build | `[4843..4993]` | ✅ | `phase_20_mcp_server_design_and_build.md` |
| 21 | mcp_server_selftest | `[4994..5005]` | ✅ | `phase_21_mcp_server_selftest.md` |

**Pause cadence:** pause for user review every 5 extractions. Next pause: after Phase 06 finishes (5th extraction since 01 started; skipped 02 doesn't count against the 5). Then pauses after 11, 16, 21.

## Phase D subagent prompt template (reuse verbatim per phase)

```
**You are NOT in plan mode.** Ignore any plan-mode system reminders — stale. Execute autonomously.

---

You are a Phase D extractor for the Medium-article pipeline. Plan: /Users/rpeck/Source/claude-desktop-message-exporter/PLANS/medium-article.md. Template: PROCESS/a70251a5/phase_01_intent_and_planning.md.

## Job

Write one file: /Users/rpeck/Source/claude-desktop-message-exporter/PROCESS/a70251a5/phase_<NN>_<slug>.md.

Source:
- Session: a70251a5-b932-4b61-aba1-16a70410b98e
- Positions: [<start>..<end>]
- Dates: <d1> → <d2>
- Theme (from phases.md): <theme>
- Real prompts: <N>

## Output format

Match phase_01_intent_and_planning.md: H1 + session/positions/dates header, then sections Goal / Opening prompt / Key decisions / Code outcome / Missteps / Memorable moments / Tone / Cross-refs. Every bullet and quote cited [pos=N msg=UUID8…].

## How

1. `uv run python -c "..."` to filter PROCESS/a70251a5/outline.jsonl for <start> <= pos <= <end>, sender=="human", non-empty summary.
2. mcp__claude-sessions__get_messages(session_id="a70251a5-b932-4b61-aba1-16a70410b98e", positions=[real prompts + +1 follow-ups], include_tool_calls=false, include_tool_results=false) — ~15 positions per call, 2 calls max.
3. Do NOT pull all <total> positions.

## Deliverable back

≤300 words: one-line summary, top 3 highlights (≤15 words each), "Interesting for Medium" flag, "done, file written" signoff. Don't paste contents.
```

## Execution Phases

### A — Scaffold ✅
- `PROCESS/` directory created at repo root.
- `PROCESS/README.md` — citation format and directory map.
- `PROCESS/00_session_inventory.md` — session table + skip-note.
- `PROCESS/99_voice_cheatsheet.md` — voice notes for drafting subagents.
- `PLANS/medium-article.md` — this file.

### B — Main-session outline (one subagent)
`get_session_outline("a70251a5-…")` → `PROCESS/a70251a5/outline.jsonl` (one row per message) + `outline_digest.md` (every 100th human message rendered). Returns counts + date markers.

### C — Phase boundary detection (one subagent)
Reads outline, produces `PROCESS/a70251a5/phases.md`: ~20–40 phase boundaries with slug, position range, theme, seed `msg_uuid`s.

### D — Per-phase extractions (one subagent per phase, sequential)
Each → `PROCESS/a70251a5/phase_NN_<slug>.md` with: **Goal**, **Opening prompt** (quoted, `msg_uuid`), **Key decisions** (bullets, cited), **Code outcome**, **Missteps / reverts**, **Memorable moments**. **Pause every 5 phases.**

### E — Current + skipped sessions
`PROCESS/76fe578b/summary.md` + `PROCESS/skipped/gmail_sessions.md`.

### F — Cross-cut synthesis (one subagent)
`PROCESS/90_themes.md`, `91_memorable_quotes.md`, `92_timeline.md`, `93_use_cases.md`.

### G — User review gate (**PAUSE**)
User reads the four synthesis files, picks emphases, corrects, flags PII.

### H — Part-by-part drafts (one subagent per part, sequential)
Writes `PLANS/articles/part_N_<slug>.md`. User reviews each before the next starts.

### I — Series intro
`PLANS/articles/00_series_intro.md` — column-intro style, analogous to the Python series intro.

### J — PII sweep
Grep all drafts for `sk-ant-`, `sessionKey`, anything resembling an org UUID or personal email. Replace with placeholders.

## Verification

- **After Phase D:** sample 3 random `phase_NN_*.md` files; pick one cited `msg_uuid` per file and verify it resolves via `get_messages`.
- **After Phase F:** user reviews `90_themes.md`; confirms narrative matches memory.
- **After each Phase H part:** user reads draft; iterate with tight tone-fit focus.
- **Phase J:** `grep -rE "sk-ant-|sessionKey|[0-9a-f]{8}-[0-9a-f]{4}" PLANS/articles/` — manual review of each hit.

## Open Questions (surface as they arise)

- **Creation-story part count** — decide at Phase G after synthesis (1, 2, or 3 parts).
- **Per-section emphasis** — ask at each Phase H part before drafting.
- **Specific Part-1 use cases** — confirm at Phase G from `93_use_cases.md`.
- **PII to scrub** — flag at Phase J.
- **Part-2 screenshot coverage** — confirm at Part-2 draft time.
