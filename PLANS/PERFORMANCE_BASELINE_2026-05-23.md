# Performance Baseline — 2026-05-23

Phase 0 measurement commit per Rule P1 of the LLM Council Coding Performance
Work Playbook. Establishes `[EMPIRICAL]` numbers for switch-back and first-load
latency on the real corpus, before implementing virtualization or other
mount-cost fixes.

Captured via Playwright MCP against the running dev server (frontend on
`:5173`, backend on `:8765`). Real corpus: conversation
`a70251a5-b932-4b61-aba1-16a70410b98e` (21,114 raw messages → 4,051 visible
MessageBubbles → ~141K DOM nodes). Raw artifact:
`/tmp/perf-baseline-2026-05-23.json`.

## Headline numbers (all `[EMPIRICAL]`)

| Scenario | Wall time | Long-task total | Long-task max | Backend fetches |
|---|---|---|---|---|
| **Cold first-load** large conv | **12.6s** | 8.6s | 7.9s | 1 (cold detail fetch) |
| **Warm switch-back** to large conv | **10.3s** | 8.6s | 8.5s | 0 (React Query cache hit) |
| Between two large convs (avg of 6 cycles) | 11.5s | 9.8s | 9.4s | 0 |
| Search typing "this image" on large conv | 2.2s | 945ms | 240ms | n/a (post-prior-fix) |

## Key insight

Warm switch-back is only **2.3s faster** than cold first-load. The fetch +
JSON parse saves ~2s. The remaining ~10s is React mount + reconciliation +
DOM commit of 4,051 MessageBubbles spawning 141K DOM nodes — paid in full on
every navigation, because route change unmounts the detail subtree.

`React.memo` doesn't help on first mount (fresh fiber tree, no prior props
to compare against). The dominant cost is the SHEER NUMBER of mounted rows,
not per-row work.

## Filter-drift (Task 2) — not reproduced on this corpus

The keyboard-nav `messages` array and the rendered `visibleMessages` array
DO drift in their filter rules (one uses `computeVisibleMessages`, the
other uses `messageHasVisibleContent`), but on the real corpus all 32
compact markers have visible summary text, so they pass both filters. The
`findIndex(...)` returns a valid index on click.

The bug is **latent**, not active. A compact marker with no visible content
(e.g., a tool-only compact summary) would surface it. Worth a prophylactic
fix in a future pass; not blocking.

## Refined A/B/C recommendation

The original brief labeled three candidate fixes (A=virtualization,
B=keep-alive, C=useCallback ref + useDeferredValue). With the empirical
baseline above, the ordering changes:

| Priority | Fix | Cold first-load | Warm switch-back | Risk |
|---|---|---|---|---|
| **1st (load-bearing)** | **Virtualization** of the bubble list | **~1s** (was 12.6s) | **~1s** (was 10.3s) | HIGH — touches scroll, refs, search-hit landing, keyboard nav, PDF export |
| 2nd (polish) | Route-level keep-alive | unchanged | **~50ms** (DOM stays mounted) | MEDIUM-HIGH — window keydown handlers fight if multiple pages cached |
| Demoted | `useCallback` ref + `useDeferredValue` | minimal | minimal | LOW |

The third was demoted because the dominant cost is the row count, not the
per-row work. The cached-per-id ref pattern (Rule P11.A11.1 in the agent
playbook) remains correct hygiene but not perf-critical post-virtualization
since only ~20 rows are mounted at a time.

## `<perf_evidence>` block for the virtualization fix

Per Rule P11 of the agent playbook, the virtualization commit's
`<perf_evidence>` block should be:

```xml
<perf_evidence>
  <top_line_metric>warm switch-back wall time on conversation a70251a5-...</top_line_metric>
  <instrument_used>Playwright MCP — MessageChannel macrotask sampler + MutationObserver + PerformanceObserver longtask</instrument_used>
  <corpus>real corpus, conversation a70251a5-b932-4b61-aba1-16a70410b98e (21,114 raw messages, 4,051 visible bubbles, 141K DOM nodes)</corpus>
  <baseline_number>10,279 ms wall, 8,565 ms long-task total [EMPIRICAL]</baseline_number>
  <artifact_ref>PLANS/PERFORMANCE_BASELINE_2026-05-23.md + /tmp/perf-baseline-2026-05-23.json</artifact_ref>
  <timeline_phase>render</timeline_phase>
  <suspect_dominant_cost>React synchronous commit phase of `visibleMessages.map(<MessageBubble />)` at ConversationPage.tsx:826, owning ~83% of the 10.3s warm-switch wall</suspect_dominant_cost>
  <falsification_threshold>if warm switch-back stays above 2,000 ms post-fix on this same corpus, virtualization is not the fix</falsification_threshold>
  <deployment_context>localhost single-user dev (V1 ship target); also relevant for any users with multi-thousand-message conversations in the wild</deployment_context>
</perf_evidence>
```

## Risk surface for virtualization (must-map in design)

Per the prior council's enumeration, the following code paths interact
with `messageRefs` / the rendered bubble set and need explicit handling
in any virtualization design:

1. `useLayoutEffect` anchor restoration on "Expand/Collapse all tools" at
   `ConversationPage.tsx:159-189` (captures bubble viewport top BEFORE the
   transition, restores scrollTop by delta after)
2. Search-hit highlight effect at `:379-424` — runs `setTimeout(100)` then
   `querySelector('[data-message-uuid=...]')`. Needs to ensure the
   virtualizer has SCROLLED-TO-AND-RENDERED the target bubble before the
   querySelector fires.
3. Compact-marker auto-expand (`forceOpen` prop wiring) — needs to
   handle the case where the target marker isn't yet rendered.
4. `scrollBubbleIntoView` helper — needs virtualizer-aware variant
   (`virtualizer.scrollToIndex(idx)` then post-settle correction).
5. Keyboard nav (Cmd+G, j/k, arrows) — needs to map over the FULL
   message list, not just mounted rows.
6. PDF / Markdown export at `:680-720`-ish — already iterates the full
   `messages` array (not the rendered subset), so should be unaffected.
7. Image lightbox at `:812` (`ConversationLightboxProvider`) —
   currently sees all messages via props; needs to continue working
   when bubbles aren't mounted.
8. `messageRefs.current.set/delete` callbacks at `:835-841` and
   `:869-875` — Rule P11.A11.1 violation regardless of virtualization;
   inline arrow refs re-fire per parent render. Fix with cached-per-id
   `Map<string, RefCallback>` per the agent playbook example.

## Library choice (open question for next round)

- **`@tanstack/react-virtual`** — small, headless, used widely. Variable
  heights via dynamic measurement. Requires manual scroll restoration but
  exposes the API needed.
- **`react-virtuoso`** — opinionated, batteries-included. Handles variable
  heights more automatically. Slightly heavier.

Both councils should evaluate in Round 1 of the next session and converge
on one.

## Next round (gates on user re-approval per Rule P0)

Virtualization is the recommended next commit. The user has greenlit the
direction; the next council session should:

1. Validate the baseline numbers above against a fresh measurement (sanity
   check that nothing's regressed between this PLAN and the implementation)
2. Pick the library
3. Map each risk-surface item from §8 above to a TDD test
4. Ship with the `<perf_evidence>` block above as the falsification gate
