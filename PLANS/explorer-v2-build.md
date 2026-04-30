# Explorer v2 — Build Log

Working plan for the v2 implementation push. Each feature is a TDD pair: failing test commit → implementation commit. The authoritative spec is `explorer-improvements-build.md`; this file tracks decisions and progress.

## Order

1. Build-7 — Compact markers (CC only)
2. Build-6 — URL-parameter navigation
3. Build-5 — Persistent rich title-based sidebar filters
4. Build-4 — Message bookmarks
5. Build-8 #5 — Per-message tool-block toggle
6. Build-8 #6 — Branch switching wire-up
7. Build-8 #7 — Dark-mode runtime breakage
8. Build-8 #9 — Mobile responsive layout
9. "Force update single conversation" affordance

## Notes

- Pre-existing vitest baseline: 5 failures in `MessageBubble.test.tsx` from a mismatch between the tests' assumption `showToolCalls=true` and `SettingsContext`'s default of `false`. These predate v2; do not regress further but do not fix as part of v2 unless trivially adjacent.
- Backend test suite green at v2 start: 39 pytests pass.

## Build-7 — Compact markers

- Backend: extract `compact_markers` per conversation in `claude_code_reader.py`, classify auto/manual via `<command-args>` lookahead window of 8 entries. Emit `summary_text`, `timestamp`, `kind`, `user_prompt`.
- Frontend: `CompactMarker.tsx` component, full-width dashed divider with pill `Compacted · HH:MM` (purple/indigo). Pill button toggles `<details>`. Inline `[ Prev ]` `[ Next ]` buttons in the expanded panel.
- Keyboard: `[` / `]` for prev/next; `Shift+[` / `Shift+]` for first/last (deferred — may collide with default editor bindings; verify).
- View → Hide compact markers toggle in `SettingsContext`. Default ON.
