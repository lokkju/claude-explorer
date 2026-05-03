# Persistent Right-Side Search Panel

Replace the Cmd+K centered modal with a persistent right-side overlay panel for full-text search.

## Design Decisions (Council-approved)

- Cmd+K → toggles the right search panel (replaces modal)
- Panel **overlays** main content (fixed position, doesn't push content area)
- Context toggle: **Snippet** (3 lines, default) vs **Full** (entire message, max-height + scroll)
- Panel closes only via: Cmd+K toggle, Escape (2nd press), or close button
- Panel stays open on: result click, left-sidebar navigation, main-area click, app focus loss
- Cmd+G works globally (even when panel is closed — reopens it)
- Active match highlighted simultaneously in panel and main view

## Progress

| Wave | Task | Status | Owner |
|------|------|--------|-------|
| 1    | A — Backend `context_size` param | ✅ done | agent |
| 1    | B — `SearchPanelContext` + FocusArea extension | ✅ done | agent |
| 2    | C — `SearchPanel` component | ✅ done | agent |
| 2    | D — Keyboard shortcut wiring | ✅ done | agent |
| 3    | E — Layout integration + CommandPalette removal | ✅ done | agent |

### Task D follow-up carried into E
Task D chose Option B (`data-allow-shortcuts` attribute) for input-focus exception. The SearchPanel's `<input>` needs this attribute set so Escape inside the input triggers the clear-then-close cascade. Task E handles this.

---

## Wave 1 — Parallel (independent)

### Task A: Backend `context_size` support

**Files:** `backend/search.py`, `backend/routers/search.py`

Add `context_size: Literal['snippet', 'full'] = 'snippet'` query param to `GET /api/search`.

- **snippet** (default): current behavior — `SNIPPET_CONTEXT = 50` chars around match, with `match_start`/`match_end` positions
- **full**: return entire message text. Set `match_start`/`match_end` to position in full text. No ellipsis or truncation.

No model changes needed — `MessageSnippet` already has `snippet`, `match_start`, `match_end`.

**Verification:** Hit `/api/search?q=foo&context_size=full` and confirm snippets are full message text; `context_size=snippet` behaves identically to current.

### Task B: `SearchPanelContext` + FocusArea extension

**New file:** `frontend/src/contexts/SearchPanelContext.tsx`

Context with state `{ isOpen, query, contextSize, activeMatchIndex, flatMatches }` and actions `{ open, close, toggle, setQuery, setContextSize, nextMatch, prevMatch, setActiveMatchIndex }`.

Persist `isOpen` and `contextSize` in `localStorage`. Derive `flatMatches` via `useSearch(query, source, contextSize)` flattening the same way `CommandPalette.tsx` lines 44–69 do today.

**Modify:** `frontend/src/contexts/KeyboardNavigationContext.tsx` — add `'search'` to `FocusArea` type. Update Tab-cycle in `useKeyboardShortcuts.ts` so Tab only rotates between `'list'` and `'detail'` (skip `'search'`); Escape from `'search'` returns to previous focusArea.

**Modify:** `frontend/src/hooks/useConversations.ts` — update `useSearch` signature to accept `contextSize` param; plumb through to `api.search`.

**Modify:** `frontend/src/lib/api.ts` — add `context_size` query param to `api.search()`.

**Modify:** `frontend/src/App.tsx` — wrap with `<SearchPanelProvider>` inside `<QueryClientProvider>`.

**Verification:** Context provider mounts without errors. `useSearchPanel()` hook returns expected shape. Existing app functionality unchanged.

---

## Wave 2 — Parallel (both depend on B)

### Task C: `SearchPanel` component

**New file:** `frontend/src/components/search/SearchPanel.tsx`

Fixed right panel: `fixed right-0 top-0 h-full z-40 w-96`, styled after `Sidebar`. CSS transform for slide-in/out (`translate-x-0` open, `translate-x-full` closed) with `transition-transform duration-200`. Always mounted in DOM to preserve React Query state.

Structure:
- Header: search input + close (×) button, below it a 2-option context toggle (`Snippet` / `Full`), below that "N of M matches" counter
- Result list grouped by conversation with timestamp section headers
- Per result card: sender icon, highlighted snippet (`<mark class="bg-yellow-200 dark:bg-yellow-800">` for `match_start..match_end`), click → `navigateToMatch`
- Full mode: result cards get `max-h-48 overflow-y-auto`
- Active match: `ring-2 ring-blue-500`, scroll into view when `activeMatchIndex` changes

Navigation logic: reuse the same `navigateToMatch` + `prefetchNearby` logic from current `CommandPalette.tsx`. Respect existing `useSourceFilter()`.

Loading/empty states: `<2` chars → prompt, `isLoading` → skeleton, `[]` data → "No matches for 'query'".

**Verification:** Panel renders. Input debounces. Results display with highlights. Context toggle switches between snippet/full views. Clicking a result navigates + panel stays open.

### Task D: Keyboard shortcut wiring

**Modify:** `frontend/src/hooks/useKeyboardShortcuts.ts`

Register in the centralized handler (remove any scattered listeners from `CommandPalette.tsx`):

- **Cmd+K / Cmd+F** → `searchPanel.toggle()` + focus input if opening
- **Cmd+G** → `searchPanel.nextMatch()`; if panel is closed, `open()` first then advance
- **Cmd+Shift+G** → `searchPanel.prevMatch()`
- **Escape cascade:** `query !== ''` → `setQuery('')`; else if panel open → `close()`; else → existing Escape handling

Also: relocate the match counter overlay. Currently `fixed right-4 top-4` — with the panel open, the counter now lives inside the panel header, so the fallback "panel closed but Cmd+G pressed" case should render at `fixed right-4 bottom-4` instead.

**Modify:** `frontend/src/components/search/CommandPalette.tsx` — remove the `document.addEventListener('keydown', ...)` block (lines ~175–222) entirely. Shortcuts now live in the centralized handler.

**Verification:** All shortcuts trigger panel actions correctly. No double-firing. Cmd+G from main area reopens panel.

---

## Wave 3 — Integration and cleanup

### Task E: Layout integration + CommandPalette removal

**Files:** `frontend/src/components/layout/RootLayout.tsx`, `frontend/src/App.tsx`, `frontend/src/components/search/CommandPalette.tsx` (delete)

`RootLayout.tsx`:
```tsx
<div className="flex h-screen bg-white dark:bg-zinc-950">
  <Sidebar />
  <main className="flex-1 overflow-hidden">
    <Outlet />
  </main>
  <SearchPanel />   {/* Always mounted; visibility controlled via CSS transform */}
</div>
```

`App.tsx`: remove `<CommandPalette />` render; `<SearchPanelProvider>` wrapping (from Task B) stays.

Delete `frontend/src/components/search/CommandPalette.tsx` — all logic migrated to `SearchPanel` and `useKeyboardShortcuts`.

**Verification:**
1. `./restart.sh` → Cmd+K opens panel from right
2. Type query → results appear with highlights
3. Toggle Full → cards expand
4. Click result → navigates, panel stays open, result has active ring
5. Cmd+G → cycles matches; from main area reopens panel if closed
6. Escape: 1st clears query, 2nd closes panel
7. Navigate left sidebar → panel stays open
8. `cd frontend && npm run build` → no TypeScript errors
