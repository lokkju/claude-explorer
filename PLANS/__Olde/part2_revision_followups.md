# Part 2 Revision — Code Follow-ups

These are the gaps between what Part 2 of the Medium series describes and what the code at `/Users/rpeck/Source/claude-desktop-message-exporter` actually does today. The article keeps the descriptions because they reflect the *intended* product surface; this list is the audit trail of what must ship before the public repo announcement.

Items are in priority order. Items 1–3 are blockers for repo publish.

## 1. **BLOCKER — search-in-tool-usage is broken** *(article §"Full-Text Search")*

The article says `Cmd+K` searches across both sources, including `tool_use` and `tool_result` blocks. User reports the tool-block search is **not working** end-to-end. Fix before publishing the repo.

- Investigate: `backend/search.py` and the search endpoint in `backend/routers/`.
- Confirm tool blocks are tokenized and indexed in `parse_jsonl_fast` / `_parse_content_blocks` paths.
- Add an integration test that asserts a `tool_use` input string and a `tool_result` body string both produce hits.

## 2. **BLOCKER — credential file permissions are not restricted** *(article §"Install and First Run")*

`fetcher/playwright_capture.py:199-202` writes `~/.claude-explorer/credentials.json` with the umask default (typically world-readable). The article tells readers to "treat it like any other auth material" — the code should make that easy by writing 0o600.

```python
# fetcher/playwright_capture.py around line 199
path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    json.dump(credentials, f, indent=2)
```

Also `os.chmod` the parent dir to 0o700 in case it pre-existed.

## 3. **BLOCKER — port-conflict error is a stack trace** *(article §"Install and First Run")*

`fetcher/cli.py:267-272` calls `uvicorn.run()` bare. If port 8000 is busy, the user gets a Python traceback instead of an actionable message.

```python
try:
    uvicorn.run("backend.main:app", host=host, port=port, reload=reload)
except OSError as e:
    if "address already in use" in str(e).lower():
        click.secho(
            f"Port {port} is in use. Pass --port N or stop the process holding it.",
            fg="red",
        )
        sys.exit(1)
    raise
```

## 4. Help-modal glyphs should match platform *(article §"Three-Pane Keyboard Navigation")*

`frontend/src/hooks/useKeyboardShortcuts.ts` already accepts `metaKey || ctrlKey` (cross-platform), but the `?` help modal labels things `Cmd+K`. On Windows / Linux it should render `Ctrl+K`. Detect via `navigator.platform.startsWith("Mac")` or the equivalent and swap the glyph in `frontend/src/components/KeyboardHelpModal.tsx`.

## 5. Per-message tool-block toggle *(article §"Reading Individual Sessions")*

The article describes toggling tool blocks "in the conversation toolbar" and a global Expand/Collapse next to it. Ground truth: the global toggle exists at `frontend/src/routes/ConversationPage.tsx:258-277`; **per-message toggles do not exist**.

Feature request: add a per-bubble reveal/hide chevron on `tool_use` and `tool_result` blocks so a reader can spot-check one tool call without flipping the global state.

## 6. Branch switching is stubbed *(article §"Reading Individual Sessions")*

`frontend/src/routes/ConversationPage.tsx:350-353` is a `console.log` placeholder for `onSelectPath`. The TreeViewModal renders real tree data (good); selecting a branch path doesn't do anything.

Wire `onSelectPath` to the conversation-detail loader so picking a branch in the modal switches the active branch and reloads the message list. Likely needs a `branchUuid` query param on the conversation fetch.

## 7. Dark mode runtime breakage *(article §"Dark mode (Light, Dark, System)")*

The TS at `frontend/src/contexts/SettingsContext.tsx:85-98,125-133` looks correct (proper cleanup, recompute on `theme` and `systemPrefersDark`). User reports it does not actually work in the running app.

Investigation order:
1. Verify `.dark` class is reaching `document.documentElement` (DevTools → Elements).
2. Verify Tailwind dark-mode config in `frontend/tailwind.config.*` is `darkMode: "class"`.
3. Check the CSS bundle for `.dark` selectors — possible Tailwind v4 migration regression.
4. Add a Playwright `theme.spec.ts` assertion that toggles theme and checks `document.documentElement.classList`.

## 8. Esc closes Settings panel *(not currently in article; UX polish)*

`frontend/src/routes/SettingsPage.tsx` is a routed page, not a modal, with no Esc handler. Add a `useEffect` keyboard listener that calls `navigate(-1)` on `Esc`. Consistent with the focus-model story we tell elsewhere in the UI.

## 9. Mobile responsive layout *(article §"Mobile" — REMOVED from Part 2; needs implementation)*

`frontend/src/components/layout/RootLayout.tsx:7` uses `flex h-screen` two-pane regardless of viewport. The article previously claimed responsive collapse-to-drawer behavior; that does not exist.

Implement:
- Add a `useMediaQuery("(max-width: 768px)")` hook (or read a Tailwind `md` breakpoint).
- Below the breakpoint: render a single-pane layout with the sidebar as a slide-out drawer (`<Sheet>` from shadcn/ui).
- Selecting a conversation full-screens the detail pane and adds a back button.
- Once shipped, restore the §"Mobile" subsection to Part 2 (or to a Part 2 follow-up post).

## 10. "Copy" button label *(article §"Reading Individual Sessions")*

The button at `frontend/src/routes/ConversationPage.tsx:289` reads just `Copy`. The article calls it "Copy as Markdown." Rename the JSX label to match the article. Trivial fix.

## 11. Repository rename to `rpeck/claude-explorer` *(article §"Install and First Run")*

The GitHub repo is currently named with the legacy slug. Rename to `rpeck/claude-explorer`. Update:

- README clone URL.
- MCP-install path examples in README and Part 3 article when drafted.
- Any CI badges or shields.io URLs.
- The Part 1 / Part 2 hyperlinks if they reference the repo by slug.

GitHub auto-redirects the old slug for a while; still worth catching all the references in one pass.

---

## Article-side adjustments already applied (for cross-reference)

These are the items from the same review that landed in `PLANS/articles/part_2_web_app.md` directly rather than as code work:

- §"Mobile" subsection removed; section renamed "Appearance and Settings".
- §"Two-Pane Keyboard Navigation" renamed "Three-Pane Keyboard Navigation"; lede acknowledges the search palette as the third pane.
- "Cmd" replaced with `⌘` glyph throughout.
- "grin" → "makes me happy" in the Wrapping Up bridge; voice cheatsheet updated to ban "grin" / "grinning."
- Donald Norman shoutout added after first use of "affordances."
- FastAPI Medium-series link added to Install.
- `uv` install link + Python-3 platform note added.
- Capture-code GitHub link added so readers can audit the trust path.
- `useKeyboardShortcuts` excerpt expanded to show the actual focus-routing comments from the source file.
- "Expand/Collapse All Tools" relocation: described as upper-right next to Markdown / PDF export, not next to the global tool toggle.
- MCP teaser pulled out of Wrapping Up into its own H2 section ("Coming Up — Another Claude, Querying Yours") with a stronger hook and CTA.
