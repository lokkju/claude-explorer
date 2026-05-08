# Testing Rules — Claude Explorer

**Read this when writing or reviewing tests.** Other agents can skip.
The rules below are the result of bugs we shipped and bugs we caught
late; each section names the incident in case the principle drifts and
someone wants to bisect why.

---

## 1 · Black-box, spec-driven discipline

When the same session writes both the feature and its tests, the tests
silently encode the implementation's quirks instead of verifying the
contract. Two real outcomes from this codebase:

- **CFR1 (filter v2 redesign).** Tests written alongside the impl
  asserted on `data-testid` everywhere. The shipped impl rendered
  Behavior + Mode + Match radios as `<button aria-pressed>` instead
  of `role="radio"`. The same agent's tests passed because they
  used the test-ids; an a11y-aware contract test would have failed.
- **2026-05-07 trash-icon regression.** The original canary asserted
  `toBeVisible()` + a row-anchored bounding-box check. Both passed
  even when the trash button was clipped by an `overflow: hidden`
  ancestor. The test was tuned to "the impl renders something" and
  not to "the user can see/click it".

### The contract

The UI contract lives in `UX.md`. The API contract lives in the
Pydantic models under `backend/models.py` and the FastAPI route
signatures. Backend test contracts also live in the OpenAPI shape
each route produces. Tests verify those — not the implementation.

### Selector priority (UI tests)

1. `getByRole('button', { name: /…/i })`
2. `getByLabel(/…/i)`
3. `getByPlaceholder(/…/i)`
4. `getByText(/…/i)` *(prefer the above; this catches non-interactive elements)*
5. `data-testid="…"` ONLY when the spec dictates a test-id

`getByRole` is load-bearing because it forces the implementation to be
accessible. If you find yourself reaching for `data-testid` because
`getByRole` "doesn't work", that is a finding to surface — the impl
likely shipped a div-with-onclick where the spec wanted a real button,
or a `<button aria-pressed>` where the spec said "radio". Don't
silently route around it; report.

### Spec-driven test files

For non-trivial features, write a small set of `spec-*.spec.ts` tests
derived from the spec **alone** — no implementation reads while
writing. These sit alongside the implementation-coupled tests and
catch contract drift those tests can't see.

Files in this codebase that use this pattern:

- `frontend/e2e/spec-filters-*.spec.ts` (54 tests; covers UX.md §615-738).

Add new `spec-*.spec.ts` files for new features. The "no app code
reads" rule is a discipline, not an enforcement — keep an explicit
allowlist of files you may consult while writing the spec test
(usually `UX.md`, the relevant plan doc, `frontend/e2e/fixtures.ts`,
and `frontend/src/lib/types.ts`). Read no others.

---

## 2 · Bidirectional verification

A new test must demonstrate BOTH:

1. It passes against the correct implementation, AND
2. It FAILS against a deliberately-broken implementation.

If you can't make it fail by reverting the fix, the test is asserting
something the bug doesn't violate.

The 2026-05-07 trash canary "passed on first run" — that should have
been a red flag that the assertions were too lax. Four separate
assertions (`toHaveCount` + `toBeVisible` + `toBeInViewport` +
row-anchored bounding-box) all passed even with the trash button
visually clipped. The fix: rewrote the canary with a real
clip-ancestor check, then verified bidirectionally — passed against
the fix, FAILED against the reverted-fix state.

### Workflow for bug-fix commits

1. **Reproduce the bug live first.** Take a screenshot. Note the
   actual broken state — not what you assume the bug is.
2. **Write the failing test FIRST.** Run it; verify it fails.
   Verify it fails *for the right reason* (read the failure message;
   if it's "selector not found" but the bug is "selector clipped",
   the test is targeting the wrong thing).
3. **Fix the code.** Run the test; verify it passes.
4. **Revert the fix temporarily** (`git stash` or `git revert
   --no-commit`); re-run the test; confirm it fails again with the
   informative message you'd want to see in the future. Re-apply the
   fix.

For non-bug-fix changes, write the test against the spec FIRST, fix
any spec drift the test surfaces, THEN ship. Same bidirectional rule.

### "Tests pass" proves nothing on its own

Always pair a green run with at least one falsification: run the test
in isolation against a known-broken state, OR have the test fail in CI
on a parallel branch that intentionally regressed the behavior. If the
test never fails, it never tested anything.

---

## 3 · Playwright-specific gotchas

These bit us. Encode them now so the next agent doesn't relearn them.

### `toBeVisible()` does NOT detect ancestor clipping

Playwright's `toBeVisible()` definition: non-empty bounding box +
`display !== 'none'` + `visibility !== 'hidden'`. An ancestor's
`overflow: hidden` doesn't change any of those — the element's own box
remains non-empty and its computed style is unchanged.

`toBeInViewport()` checks intersection with the **browser viewport**,
not an inner scroll container. Same blind spot.

A row-anchored bounding-box check (button-inside-row) doesn't help
either: when the row itself is clipped by the same ancestor, both row
and button are inside the row's logical box but both are clipped
together.

**Fix: use a helper that walks up to the nearest
`overflow:hidden|auto|scroll|clip` ancestor and asserts containment.**

```ts
async function expectInsideClipAncestor(target: Locator, label: string) {
  const result = await target.evaluate((el) => {
    const t = el.getBoundingClientRect()
    let n: Element | null = el.parentElement
    while (n) {
      const cs = getComputedStyle(n)
      const isClippy = (v: string) =>
        v === 'hidden' || v === 'auto' || v === 'scroll' || v === 'clip'
      if (isClippy(cs.overflowX) || isClippy(cs.overflowY)) {
        const r = n.getBoundingClientRect()
        return { t: { x: t.left, y: t.top, w: t.width, h: t.height },
                 a: { x: r.left, y: r.top, w: r.width, h: r.height,
                      tag: n.tagName,
                      cls: typeof n.className === 'string' ? n.className.slice(0, 80) : '',
                      ox: cs.overflowX, oy: cs.overflowY } }
      }
      n = n.parentElement
    }
    return { t: { x: t.left, y: t.top, w: t.width, h: t.height }, a: null }
  })
  expect(result.a, `${label}: no overflow-clipping ancestor found`).not.toBeNull()
  const t = result.t, a = result.a!, eps = 1
  expect(t.x, `${label}: clipped on the left by ${a.tag}.${a.cls}`).toBeGreaterThanOrEqual(a.x - eps)
  expect(t.x + t.w, `${label}: clipped on the right by ${a.tag}.${a.cls} (overflow-x: ${a.ox})`).toBeLessThanOrEqual(a.x + a.w + eps)
  expect(t.y, `${label}: clipped on the top by ${a.tag}`).toBeGreaterThanOrEqual(a.y - eps)
  expect(t.y + t.h, `${label}: clipped on the bottom by ${a.tag} (overflow-y: ${a.oy})`).toBeLessThanOrEqual(a.y + a.h + eps)
}
```

The reference implementation lives in
`frontend/e2e/spec-filters-trash-visible.spec.ts`. If you need it in
multiple specs, factor it into a shared helper at `frontend/e2e/helpers/clipAncestor.ts`.

### Add `.hover()` or `.click()` for actionability cross-checks

Playwright's actionability includes "element is at the click point".
A clipped element fails this. Adding a `.hover()` after the static
assertions catches the "user can reach this" property end-to-end.

```ts
await deleteButton.hover({ timeout: 2000 })
```

Use this on every test that asserts "the user can interact with X".
It's cheap and orthogonal to the static checks.

### shadcn `<Select>` quirks

- The Select trigger renders as `role="button"`, NOT `role="combobox"`.
  Prefer `getByLabel(/…/i)` for the trigger. The
  `data-testid="active-filter-select"` is the only acceptable test-id
  fallback (the spec names the picker structure unambiguously).
- Options live in a Portal with mount animations. Always:
  ```ts
  await trigger.click()
  await expect(page.getByRole('option', { name: /…/i })).toBeVisible()
  await page.getByRole('option', { name: /…/i }).click()
  ```
  Bare `.click()` on options races the mount.

### Radix `<ScrollArea>` quirks

- Radix `<ScrollArea>` Viewport wraps content in
  `style="display: table; min-width: 100%"` which auto-sizes to
  content width and lets rows overflow past the Viewport's bounded
  width. The outer `overflow: hidden` then clips the right end.
- Fix at the use site: append `[&>div>div]:!block` to the
  ScrollArea's `className`. The arbitrary-selector override forces
  the Radix wrapper to `display: block` so it inherits the Viewport's
  bounded width.
- See the `ManageFiltersModal.tsx` ScrollArea for the canonical
  application + comment.

### Strict-mode locator collisions

Playwright runs locators in strict mode by default; if a query matches
more than one element, it fails. Common pitfalls:

- `getByText('Foo')` matches every visible occurrence — use
  `.first()` deliberately, OR scope to a parent
  (`page.getByRole('dialog').getByText('Foo')`), OR add a more
  specific selector.
- `getByRole('combobox')` matches every `<Select>` trigger, every
  `<input role=combobox>`, etc. Always pair with `{ name: /…/i }` or
  scope to a parent.

### PATCH-spy ordering (LIFO route registration)

When a test seeds `mockBackend({ preferences: ... })` AND wants to
intercept later PATCH bodies, the `page.route('**/api/preferences')`
spy must register AFTER the seed. Playwright runs route handlers in
LIFO order; the latest-registered wins. If the spy is registered
before `mockBackend`, the seed mock catches the request and the spy
never fires.

```ts
await mockBackend({ preferences: seedBlob })
const patchBodies: any[] = []
await page.route('**/api/preferences', (route, req) => {
  if (req.method() === 'PATCH') patchBodies.push(JSON.parse(req.postData() ?? '{}'))
  route.continue()
})
```

---

## 4 · Test fixture design

Use realistic edge-case data, not minimal happy-path data. Each
fixture should answer the question: "what's the most likely thing the
user has that breaks the layout / logic?"

### Long strings

For any UI that can show user-entered text (filter names,
conversation titles, project paths, attachment names), include at
least one fixture whose string is long enough to trigger
truncation, overflow, or wrap. A short name doesn't reproduce layout
failures.

The 2026-05-07 row-clip bug shipped because the canary used
`"Foo filter"` (12 chars) instead of something like
`"automated run of a scheduled task"` (33 chars). The Radix
`display: table; min-width: 100%` wrapper grew past 100% only when
content forced it — short names never triggered the wrapper to
overflow.

When in doubt, include a name ≥30 characters. If the impl uses
`truncate`, that's a hint that long strings exist in the wild;
include them in tests.

### Many items

For any list, scroll-area, or quantifier (group members,
conversations, search hits), include enough items to trigger
scroll, pagination, or virtualization paths. Two items don't test
overflow; ten or fifty often do.

### Empty state

Every list and every dependent input has an empty case. Test it.
The "Manage filters with zero filters" test (in
`spec-filters-active-picker.spec.ts`) was added in the spec-driven
sweep precisely because this case was easy to forget.

### Migration / legacy state

When shipping a schema migration, seed the fixture with the on-disk
shape USERS WILL HAVE, not the new shape. Otherwise the migration
code never runs in the test.

For the v1→v2 filter migration:

```ts
preferences: {
  // legacy v1 shape — has polarity, no behavior, no _migratedV2
  filters: {
    nodes: { 'a': { id: 'a', type: 'atom', name: 'X',
                    enabled: true, polarity: 'exclude',
                    patterns: ['*X*'], mode: 'glob', target: 'title' } },
    activeId: 'a',
    _migratedV1: true,
  },
}
```

Then assert the post-migration shape (with `behavior: 'hide'`,
`_migratedV2: true`) was PATCHed back to the server.

### Special characters

Test names / patterns containing spaces, `*`, regex metas, Unicode,
line breaks, leading/trailing whitespace. Pattern-matching code is
where these bite first; UI rendering is where they bite second.

For the `name` field specifically, include a fixture with `*` in
the name (which the auto-fill rule's metachar-strip would otherwise
remove — useful for testing that the strip behaves as documented).

### Fixture seeding rule

Build the smallest fixture that reproduces the failure mode you're
testing. Don't reuse another spec's fixture by import — that ties
two tests' definitions together and makes failures harder to read.
Build clean fixtures from the spec.

---

## 5 · Backend test discipline (pytest, FastAPI, async)

The Playwright lessons from sections 1–4 transpose cleanly to pytest:
write tests against the contract, falsify them, build realistic
fixtures, beware of clip-ancestor-style false-positives. The shape of
the false-positives is different on the backend, but the discipline is
the same. The 11 sub-sections below are concrete failure modes we've
shipped or nearly shipped.

### 5.1 · Test isolation: lru_cache, env vars, module singletons, time

Backend false-pass class #1: a test passes because it's actually
running against state from a *previous* test.

**`get_settings()` is `@lru_cache`d.** If your test does
`monkeypatch.setenv("CLAUDE_EXPORTER_DATA_DIR", str(tmp_path))` but
doesn't clear the cache, every subsequent `get_settings()` call
returns the FIRST test's settings. `tmp_path` from this test is never
read. Fixture template:

```python
@pytest.fixture
def isolated_data_dir(tmp_path, monkeypatch):
    from backend import config
    monkeypatch.setenv("CLAUDE_EXPORTER_DATA_DIR", str(tmp_path))
    config.get_settings.cache_clear()
    yield tmp_path
    config.get_settings.cache_clear()  # don't leak this test's settings into the next
```

**Module-level singletons need explicit reset.** Examples in this
codebase: `_refresh_in_progress` flag in `backend/routers/fetch.py`,
the `_seen` set in `backend/cc_image_watcher.py`, the in-memory cache
in `backend/cache.py`. Each has a test-only `reset_for_tests()`
helper or equivalent — call it from a fixture.

**Time-dependent tests need `freezegun` or `monkeypatch`.** `migrate_to_v2`'s
sentinel uses `datetime.now()`; tests that race the sentinel can flake
on slow CI. `monkeypatch.setattr("backend.foo.datetime", FakeDatetime)`
or use `freezegun.freeze_time(...)`.

**`tmp_path` is per-test by default** but `tmp_path_factory` is
session-scoped and shared. Don't write user data to `tmp_path_factory`
unless you reset it.

**Constants imported by value need patching at every call site.**
`fetcher/credentials.py` defines `DEFAULT_CREDENTIALS_PATH = ...`, and
*three* other modules import the constant by value at module-load time:
`fetcher/bulk_fetch.py`, `backend/routers/fetch.py`, and re-imports in
tests. `monkeypatch.setattr("fetcher.credentials.DEFAULT_CREDENTIALS_PATH",
new)` ONLY rebinds the canonical name — the three by-value copies still
point at `~/.claude-exporter/credentials.json`. The fixture must patch
all four:

```python
@pytest.fixture
def _isolated_credentials_path(tmp_path, monkeypatch):
    creds = tmp_path / "credentials.json"
    for target in (
        "fetcher.credentials.DEFAULT_CREDENTIALS_PATH",
        "fetcher.bulk_fetch.DEFAULT_CREDENTIALS_PATH",
        "backend.routers.fetch.DEFAULT_CREDENTIALS_PATH",
    ):
        monkeypatch.setattr(target, creds)
    yield creds
```

Same pattern applies to any module that does
`from foo import CONSTANT` rather than `from foo import bar; bar.CONSTANT`.
Grep for the constant name globally; if it appears as a bare-name import
anywhere, patch each binding.

**`CLAUDE_DIR` and `CLAUDE_EXPORTER_DATA_DIR` are different knobs.**
`CLAUDE_DIR` controls where `~/.claude-exporter/` itself resolves
(used by capture, credentials, and the orgs router);
`CLAUDE_EXPORTER_DATA_DIR` controls where `conversations/` lives.
A test that only pins `CLAUDE_EXPORTER_DATA_DIR` can still scribble
into the user's real `~/.claude-exporter/credentials.json` if the
code under test goes through the credentials path. Pin both unless
you've verified the call graph never touches credentials.

**`isolated_data_dir` must be a SUBDIRECTORY of `tmp_path`, not
`tmp_path` itself.** `_resolve_path` uses
`data_dir.parent / "preferences.json"`, so `preferences.json` lives one
level up from the data dir. If the fixture uses `tmp_path` directly,
`preferences.json` lands in the pytest tmp root and bleeds across tests
on the same worker. The reference fixture uses `<tmp_path>/data` — `data/`
is the data dir, `<tmp_path>/preferences.json` is the prefs file.

**`real_async_client` is orthogonal to data isolation.** The `httpx.AsyncClient`
+ `ASGITransport(app=...)` fixture used for SSE/concurrency tests does NOT
imply isolated disk. Compose explicitly: a test that streams over real ASGI
AND touches preferences/credentials must use `real_async_client` PLUS
`isolated_data_dir` PLUS (if creds are involved) `_isolated_credentials_path`.
Don't fold them; an SSE test for a read-only endpoint shouldn't pay the
disk-isolation cost it doesn't need.

**Lifecycle tests must be order-independent.** Don't rely on file
collection order (`test_zz_step1_set_flag`, `test_zz_step2_observe_flag`);
pytest-randomly and pytest-xdist will reorder or split them across workers
and the second test will see uninitialized state. Pattern: extract the
fixture body into a plain helper (`def _reset_refresh_flag_body(...): ...`)
and have BOTH the fixture and any lifecycle test call the helper directly.
The test asserts on observable state after each helper invocation in the
same function body.

### 5.2 · Mock at the boundary, not the nesting

Backend false-pass class #2: the test mocks so much of the
implementation that the real bug never runs.

**Rule.** Mock at the HTTP boundary (outbound calls to claude.ai), or
at the filesystem boundary in the rare case where `tmp_path` won't
work. Let everything else run for real.

**Don't mock:** Pydantic models, serializers, migration code, the
prefs reader/writer, the store layer, the route handlers, the SSE
generators. They're cheap and they're where the bugs live.

**Counter-example.** The `/api/preferences` PATCH deep-merge contract
(`{savedFilters: null, activeFilterIds: null}` must explicitly null
legacy keys for the per-key overwrite to clear them). A test that
mocks `_write_atomic` and asserts "yes, _write_atomic was called with
the right body" passes — but the real bug is what lands on disk after
the round trip through `_read_blob() → merge → _write_atomic →
_read_blob()`. Only a real-`tmp_path` test catches it.

```python
# WRONG: mocks too much
def test_patch_merges(monkeypatch):
    seen = {}
    monkeypatch.setattr("backend.routers.preferences._write_atomic",
                        lambda p, d: seen.update(json.loads(d)))
    client.patch("/api/preferences", json={"data": {"theme": "dark"}})
    assert seen["data"]["theme"] == "dark"  # passes; doesn't test merge

# RIGHT: round-trip through real disk
def test_patch_merges(isolated_data_dir, client):
    # seed
    client.put("/api/preferences", json={"data": {"theme": "light", "lang": "en"}})
    # patch
    client.patch("/api/preferences", json={"data": {"theme": "dark"}})
    # round-trip read
    final = client.get("/api/preferences").json()["data"]
    assert final["theme"] == "dark"
    assert final["lang"] == "en"  # NEGATIVE-SPACE: must not be wiped
```

### 5.3 · Strong assertions, not "field exists"

Backend false-pass class #3: the assertion checks structure but not
semantic value. The field could be hardcoded to 0, an empty array,
`None`, or last-write-wins junk and the test still passes.

**Examples.**

- `assert "conversation_count" in data` — passed for weeks while
  `/api/config` returned a hardcoded `0`. The right test asserts
  against a value computed from a known fixture: with 3 conversation
  files in `tmp_path`, `/api/config/stats` returns `3`.
- `assert response.json()["bookmarks"]` — Python truthy. `[]` is
  falsy, `[None]` is truthy. Assert `assert response.json()["bookmarks"]
  == [{...expected...}]`.
- `assert response.status_code == 200` — most route bugs corrupt the
  body, not the status. Always also assert the body shape and key
  values.

**For PDF / image / binary outputs:** assert against a known fixture
byte signature, NOT just "≥1 image stream". WeasyPrint emits valid
streams for broken-image icons; "stream count" can't tell broken from
fixed. The P5 test (`backend/tests/test_export_pdf_images.py`) decodes
the FlateDecode XObject and matches a deterministic 6-byte RGB
sequence in the fixture image. Bytes-in, bytes-out.

### 5.4 · Negative-space assertions

Don't only assert what should change. Also assert what should NOT
change. This catches the entire class of "endpoint clobbers
unrelated state" bugs.

**Concrete patterns.**

- After a PATCH: GET back the resource and assert untouched fields.
- After a migration: assert the keys you didn't migrate are still
  there, and the values are byte-identical (`.read_bytes() ==
  expected_bytes` if it's a file).
- After copying to a cache: assert the source file is unchanged
  (mtime + bytes).
- After a delete: assert siblings/parents are unchanged.

**Fenced-block strip incident (2026-05-05 P1.3, council caught).** The
TOOL_PLACEHOLDER regex stripped placeholder text *inside* fenced code
blocks, killing the friendly badge. A "strip works" test passes
trivially. The real test is two-pronged: stripped *outside* fences;
*preserved* inside fences. Negative-space assertion as a first-class
test, not an afterthought.

```python
def test_tool_placeholder_strip_outside_fence_only():
    md = "before\n\nTOOL_PLACEHOLDER_TEXT here\n\n```\nTOOL_PLACEHOLDER_TEXT inside\n```\nafter"
    out = filter_tool_placeholders(md)
    assert "TOOL_PLACEHOLDER_TEXT here" not in out                  # stripped outside
    assert "TOOL_PLACEHOLDER_TEXT inside" in out                    # PRESERVED inside fence
```

### 5.5 · Migration tests MUST seed the legacy shape

Backend false-pass class #4 (and the most common): tests seed the new
schema, the migration code never runs, and the test happily verifies
the new schema is still the new schema.

**Rule.** Migration tests seed the on-disk shape USERS WILL HAVE
(legacy), then run the migration, then assert the post-migration
shape AND the full contract of what the migration was supposed to do
(tombstone keys, sentinel flags, side effects).

**v1 → v2 filter migration template.**

```python
def test_v1_to_v2_atom_polarity_promotes_to_behavior(isolated_data_dir, client):
    prefs = isolated_data_dir / "preferences.json"
    prefs.write_text(json.dumps({
        "version": 1,
        "data": {
            "filters": {
                "nodes": {
                    "atom-x": {
                        "id": "atom-x", "type": "atom", "name": "X",
                        "enabled": True,
                        "polarity": "exclude",   # legacy v1
                        # NO 'behavior' key
                        "patterns": ["*X*"], "mode": "glob", "target": "title",
                    },
                },
                "activeId": "atom-x",
                "_migratedV1": True,
                # NO _migratedV2
            },
        },
    }))
    # Trigger the migration via the normal path (a GET that the app uses
    # on first mount). Don't reach into private migration functions —
    # tests should exercise the public surface.
    client.get("/api/preferences")
    final = json.loads(prefs.read_text())["data"]["filters"]
    atom = final["nodes"]["atom-x"]
    assert atom["behavior"] == "hide"        # promoted
    assert "polarity" not in atom             # legacy stripped
    assert final["_migratedV2"] is True       # sentinel set
    assert final["activeId"] == "atom-x"      # active preserved
```

**Idempotency.** Run the migration twice. Assert the second run is a
no-op (no PATCH, no on-disk diff). The 2026-05-05 P3a fix uses a
sentinel for exactly this; if the sentinel can be bypassed, the
migration runs every page load and silently rewrites user state.

**Tombstone keys.** When a migration is supposed to clear legacy keys
(via the per-key-overwrite PATCH path), assert they're EXPLICITLY
nulled in the request body OR absent from the post-migration GET.
Omitting them from the PATCH leaves them on disk — that's exactly the
bug Gemini's council review caught in CFR1.

### 5.6 · SSE streaming tests

`/api/fetch/refresh`, `/api/fetch/start`, and any future SSE endpoint
have a contract that's ENTIRELY about the event stream. A test that
asserts `status_code == 200` proves none of it.

**The full SSE contract: event order, event types, payload shape per
event, termination.**

```python
@pytest.mark.asyncio
async def test_refresh_emits_start_progress_complete(client_with_real_app):
    events: list[tuple[str, dict]] = []
    async with client_with_real_app.stream("GET", "/api/fetch/refresh?incremental=true") as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")

        current_event: str | None = None
        async for line in resp.aiter_lines():
            if line.startswith("event:"):
                current_event = line.removeprefix("event:").strip()
            elif line.startswith("data:") and current_event:
                payload = json.loads(line.removeprefix("data:").strip())
                events.append((current_event, payload))
                if current_event in ("complete", "error"):
                    break

    # Order: start, then ≥1 progress, then complete (or error — assert which).
    kinds = [k for k, _ in events]
    assert kinds[0] == "start"
    assert "progress" in kinds
    assert kinds[-1] == "complete"            # NOT error in the happy path
    # Payload shape per event:
    start_payload = next(p for k, p in events if k == "start")
    assert "total" in start_payload
```

**Termination.** Every SSE stream must reach `complete` OR `error`.
Tests should assert the terminator and that the stream actually
closes (no hang). Use `asyncio.wait_for(..., timeout=5)` on the
`async for` loop.

**Reconnection.** If the impl supports SSE retry (`retry: N`), a test
should assert the retry directive is emitted and respected.

**Cancellation.** Disconnect mid-stream and assert the server-side
generator cleans up (no leaked threads, no half-written file). For
the cc-image watcher: assert the polling loop cancels cleanly when
the lifespan teardown fires.

### 5.7 · Realistic data sizes

Backend equivalent of the Playwright "long names" rule. Bugs that
only appear at scale:

- **Search / scoring loops** — fixtures with 1 message don't test
  per-message sort, dedup, or pagination boundaries. Build a fixture
  with at least 50 messages and a known token in only one of them.
- **Filesystem walks** — `discover_jsonl_files` paginates / dedups
  across orgs. With 1 file, you don't test the dedup. With 50 files
  spanning 3 orgs, you do.
- **Memory limits** — large attachments (multi-MB images) don't fit
  in a 1×1 PNG fixture. PDF export with 10+ images can hit
  WeasyPrint memory pressure; include at least one such test.
- **UUID / off-by-one bugs** — sequential UUIDs hide collisions and
  off-by-one errors. Use `uuid.uuid4()` in fixtures, not
  `f"uuid-{i}"`.
- **Long content** — message text > 100kB exercises the streaming-
  tokenizer code paths. Title/name strings ≥ 30 chars test the
  truncation paths the UI relies on.

**Fixture helper template.**

```python
def make_realistic_conversation(uuid: str, *, message_count: int = 50,
                                  needle_index: int | None = None) -> dict:
    """Build a fixture conversation with realistic structure.

    needle_index: if set, the message at this index contains the literal
    string 'NEEDLE_TOKEN' (for search/sort tests). Use a non-zero index
    so 'first match wins' bugs surface.
    """
    msgs = []
    for i in range(message_count):
        text = f"Message {i} body with some realistic content."
        if i == needle_index:
            text += " NEEDLE_TOKEN here."
        msgs.append({
            "uuid": str(uuid_lib.uuid4()),
            "sender": "human" if i % 2 == 0 else "assistant",
            "text": text,
            "content": [{"type": "text", "text": text}],
            "created_at": (BASE_TIME + timedelta(seconds=i)).isoformat(),
            "updated_at": (BASE_TIME + timedelta(seconds=i)).isoformat(),
            "files": [],
            "files_v2": [],
            "attachments": [],
        })
    return {
        "uuid": uuid,
        "name": "Realistic conversation with a long enough title to truncate",
        "model": "claude-opus-4-7",
        "created_at": BASE_TIME.isoformat(),
        "updated_at": (BASE_TIME + timedelta(seconds=message_count)).isoformat(),
        "chat_messages": msgs,
        "current_leaf_message_uuid": msgs[-1]["uuid"],
        ...
    }
```

### 5.8 · Concurrency and atomic-op tests

Endpoints that use locks, atomic ops, or shared state need explicit
race tests. The contract is "lock holds under contention" — and the
only way to exercise that is to actually contend.

**Lock under contention.** `/api/fetch/refresh` is serialized via
`asyncio.Lock` + `_refresh_in_progress`. The test fires concurrent
requests:

```python
@pytest.mark.asyncio
async def test_refresh_serialized(real_async_client):
    # Start two refreshes "simultaneously"; one must 409.
    r1, r2 = await asyncio.gather(
        real_async_client.get("/api/fetch/refresh"),
        real_async_client.get("/api/fetch/refresh"),
        return_exceptions=False,
    )
    statuses = sorted([r1.status_code, r2.status_code])
    assert statuses == [200, 409]
```

**Atomic write under crash.** When the impl uses `tmp + os.replace`,
inject a failure between write and replace. Assert (a) the original
file is intact and (b) the temp file is cleaned up.

```python
def test_atomic_write_recovers_from_replace_failure(isolated_data_dir, monkeypatch):
    target = isolated_data_dir / "preferences.json"
    target.write_text(json.dumps({"version": 1, "data": {"theme": "light"}}))
    original_bytes = target.read_bytes()

    # Force os.replace to fail.
    def boom(*a, **k): raise OSError("simulated rename failure")
    monkeypatch.setattr("os.replace", boom)

    with pytest.raises(OSError):
        write_preferences({"version": 1, "data": {"theme": "dark"}})

    # Original survived.
    assert target.read_bytes() == original_bytes
    # No temp leaked.
    assert not list(isolated_data_dir.glob("preferences.json.tmp*"))
```

**Filesystem ordering in migrations.** What happens if the user kills
the process mid-migration? Test the partial states. If migration
writes files A, B, C in order, simulate a crash after each and assert
recovery on next mount.

**SQLite WAL contention.** If we ever use SQLite, test concurrent
readers + a writer; assert no `database is locked` errors leak to the
client. (Currently no SQLite — but the cache.db hint suggests it
might be relevant; flag if so.)

### 5.9 · Security-adjacent inputs

Every route that takes a path / URL / pattern / external input needs
explicit malicious-input tests. The test passes when the route
*refuses* the input (4xx with no leakage), not when it serves
something.

**Path traversal.** `/api/cc-image?path=../../../etc/passwd` — assert
403 or 400, not 200 with /etc/passwd content. Same for
`/api/attachments/<conv>/<file>/<variant>`. Real pattern: the route
must `Path(...).resolve(strict=True).relative_to(allowed_root)` and
404 on `ValueError`.

**Symlink resolution.** Place a symlink in `tmp_path` pointing
outside the data dir. Assert the route doesn't follow it.

**Permission bits.** After writing `~/.claude-exporter/credentials.json`
or `preferences.json`, assert `os.stat(p).st_mode & 0o777 == 0o600`.
The atomic-write path is what writes mode bits; if it
`os.replace()`s a `tmp` file with `0o644`, the permission slips. We
have this test for credentials but not preferences — write it.

**Regex DoS.** If the user can supply regex patterns
(`AtomFilter.mode == 'regex'`), a pathological pattern like
`(a+)+$` with a long input can hang. Assert the matcher terminates
within a small time budget OR validates pattern complexity.

**Auth headers.** Routes that expect headers (X-Org-ID,
Authorization, etc.) should 401 on missing headers, 403 on
malformed. Don't rely on FastAPI's default behavior; explicit tests
prevent regressions.

**Header / form smuggling.** Tests that supply unexpected
content-type, oversized JSON, or duplicate headers should produce
4xx with a useful detail body, not 500.

### 5.10 · Async / await pitfalls

Backend false-pass class #5: a coroutine is created but not awaited.
The test happily passes; the assertion runs against the coroutine
object instead of its resolved value.

**Concrete trap.**

```python
# WRONG — silent pass
def test_get_config(client):
    response = client.get("/api/config")  # if `client` is AsyncClient, returns a coroutine
    assert response.status_code == 200    # `response` is a coroutine; status_code attribute access throws AttributeError
                                           # ...but if you got the imports wrong AsyncClient might be a sync mock,
                                           # silently passing.
```

**Discipline.**

1. `pyproject.toml` sets `asyncio_mode = "auto"` so all `async def`
   tests run via `pytest-asyncio` automatically. Or use
   `asyncio_mode = "strict"` and decorate explicitly with
   `@pytest.mark.asyncio`. Don't mix.
2. CI runs with `-W error::RuntimeWarning` so "coroutine was never
   awaited" is a test failure, not a silent warning.
3. For the simple HTTP tests, use FastAPI's `TestClient` (sync) — it
   wraps `httpx.AsyncClient` internally and you write plain
   `def test_…`. For SSE / streaming / explicit async behavior, use
   `httpx.AsyncClient` + `async def test_…`.
4. Never `asyncio.run()` inside a test; always let `pytest-asyncio`
   manage the loop.

**Warning hygiene.** `filterwarnings` in `pyproject.toml` should NOT
contain a blanket `ignore::DeprecationWarning`. Real deprecations
from third-party libs are how we learn about upgrade requirements.
Filter only the specific warnings you've consciously decided to live
with, with a comment explaining why.

### 5.11 · Pydantic / FastAPI specifics

**Strict input validation.** Input models should declare
`model_config = ConfigDict(extra='forbid')` so unknown fields produce
422, not silent acceptance. Tests should send a payload with one
extra field and assert 422 with a useful detail.

**Edge cases for every input model.**

- empty list, empty dict, empty string for required-non-empty fields
- `null` for required fields → 422
- Type coercion: `"1"` (string) where `int` is required — assert the
  coercion happens AND the right cases reject (e.g. `"abc"` → 422).
- Float / int boundary: `1.0` for `int` field; `2**53 + 1` for large
  ints (JSON precision loss).
- Datetime: ISO-8601 with and without timezone; assert tz handling.

**Response model coercion only runs through HTTP.** Calling a route
handler directly skips `response_model`. Always test via
`httpx.AsyncClient`/`TestClient`, not by importing the handler.

**Schema migration tests.** When you add a response field, write a
test that consumes the OLD response shape and adapts (proves
backwards compat). When you remove a field, write a test that the
new response does NOT contain it (proves you actually removed it,
didn't accidentally keep it for one extra release).

**`Depends()` overrides.** Use `app.dependency_overrides[get_settings]
= lambda: TestSettings()` for unit testing. Do NOT monkeypatch
`get_settings` globally — that breaks lru_cache discipline (5.1).

**Status codes are part of the contract.** A 200/201/204/404/422 etc
distinction matters to clients. Tests should assert the *exact* code,
not "≥ 200 and < 300".

**Test the error path.** For every route, assert at least one error
case explicitly: missing data → 404; bad input → 422; conflict → 409;
internal failure → 500 with a sanitized detail (no traceback in body
for production responses).

---

## 6 · Test review checklist

Before declaring a new test sufficient, confirm:

### Universal (UI + backend)

- [ ] Bidirectional verification: the test fails when the fix is
      reverted, with an informative error message. ("Test passes"
      proves nothing; can you make it fail?)
- [ ] Test name names the contract, not the impl. ("Manage Filters
      modal: every row exposes a visible, in-viewport, NOT-clipped
      delete affordance" — not "trash icon visible".)
- [ ] At least one fixture exercises an edge case (long string, many
      items, special chars), not just the happy path.
- [ ] Spec docs (`UX.md` for UI, the relevant model / route docstring
      for backend) updated to match any new contract the test
      asserts.
- [ ] Negative-space assertion when the contract has one: assert
      what should NOT change, not just what should.

### UI / Playwright

- [ ] Selector uses `getByRole`/`getByLabel` first; `data-testid` only
      where spec dictates.
- [ ] Visibility tests use `expectInsideClipAncestor` (or equivalent)
      when the assertion is "user can see this".
- [ ] An actionability check (`hover`/`click`) cross-tests
      reachability where it matters.
- [ ] Strict-mode locator: every `getBy*` query is unambiguous, OR
      explicitly scoped/`.first()`d.
- [ ] PATCH/route spies are registered AFTER `mockBackend` for LIFO
      precedence.

### Backend / pytest

- [ ] Test seeds the LEGACY shape (what users have on disk), not the
      new shape, when migration code is under test. Otherwise the
      migration code never runs.
- [ ] Real `tmp_path` for filesystem ops; no mocking the store /
      writer / serializer layer. Mock at the HTTP boundary or the
      filesystem boundary, not in between.
- [ ] Strong value assertion (not just "field exists"). If a field is
      hardcoded by design, the test asserts the meaningful expected
      value computed from a known fixture.
- [ ] Async test uses `async def` + `await` AND the pytest config
      surfaces "coroutine was never awaited" as a failure
      (`-W error::RuntimeWarning`).
- [ ] `lru_cache.cache_clear()` called after `monkeypatch.setenv` for
      any settings/config function that's cached.
- [ ] Module-level singletons (`_refresh_in_progress`, `_seen` sets,
      in-memory caches) reset per test via fixture.
- [ ] Migration test asserts: (a) post-migration on-disk shape; (b)
      tombstone keys explicitly nulled; (c) idempotency (running
      twice is a no-op); (d) sentinel flag set.
- [ ] SSE tests assert event ORDER + types + payload shape +
      termination; never just `status_code == 200`.
- [ ] Concurrency test where a lock or atomic op is part of the
      contract.
- [ ] Security-adjacent input test for every route taking a path /
      URL / pattern / external input (path traversal, symlinks,
      permission bits, regex DoS).
- [ ] For PDF / image / binary output: assert against a known fixture
      byte signature, not "≥1 stream present".
- [ ] Status code asserted EXACTLY (not "2xx") and at least one
      error path tested explicitly.

---

## Reference incidents

These are the bugs that produced this document. Read the linked
commits before adding a new section.

### UI / Playwright

| Date | Class | Root cause | Fix |
|---|---|---|---|
| 2026-05-07 | overflow-clipping false-pass | `toBeVisible` + row-anchored bbox blind to ancestor `overflow: hidden`; tame fixtures (short names) didn't reproduce | `8cb85fd` (impl), `0f29d6f` (canary upgrade with `expectInsideClipAncestor`) |
| 2026-05-07 | role-blind selectors hid a11y drift | tests used `data-testid` everywhere; CFR1 shipped Behavior/Mode/Match as `button aria-pressed` instead of `role=radio`; tests passed | `e2190cf` (impl: real ARIA roles); spec-driven sweep caught it |
| 2026-05-06 | filter Pin desync | seeding logic ran once on first mount, decoupled `pinned` from `activeFilterIds`; tests passed in fixture mode (empty initial state) | `2c94860` (composable graph + sidebar picker) |

### Backend / pytest

| Date | Class | Root cause | Fix |
|---|---|---|---|
| 2026-05-05 | weak-assertion false-pass on PDF images | "≥1 image stream present" passed even when WeasyPrint emitted broken-image-icon streams; fixture image bytes were never checked end-to-end | `37e45e0` (P5: WeasyPrint url_fetcher + byte-signature test against a fixture image) |
| 2026-05-05 | regex stripped TOOL_PLACEHOLDER inside fenced code blocks | "strip works outside fences" tested only the positive path; missing negative-space assertion (preserved-inside-fence) | `ff7db06` (impl: fenced-aware strip); council caught during review |
| 2026-05-05 | `/api/preferences` PATCH-deep-merge needs real on-disk round-trip | a mock-the-write test asserts the body that goes IN, not what lands on disk after the read-merge-write cycle | `a8cff17` (impl uses real tmp_path tests; per-key overwrite verified end-to-end) |
| 2026-05-07 | weak existence assertion on `conversation_count` | `assert "conversation_count" in data` passed for weeks while the field was hardcoded to `0`; only tested presence, not semantic value | `74de39d` (refactor: dropped misleading hardcoded field; tests now assert exact value via `/config/stats`) |
| 2026-05-07 | migration tombstone-keys must be explicit `null` in PATCH | omitting `savedFilters` and `activeFilterIds` from the PATCH leaves them on disk because backend uses per-key overwrite, not deep-delete | `2c94860` migration test asserts the PATCH body explicitly contains `savedFilters: null, activeFilterIds: null` |
| 2026-05-08 | `/api/attachments` path traversal — read-leak | `file_dir = _attachments_root() / conv_uuid / file_uuid` had no validation before `is_dir()`; the downstream `chosen.resolve().relative_to(file_dir.resolve())` only validates the FINAL chosen file. `conv_uuid="../../etc"` and absolute-path injection (`Path("a") / "/abs" == Path("/abs")`) both fell through to a 200 with arbitrary on-disk file bytes when a `<variant>.*` glob matched | `e121e39` (RED: 3 traversal tests) + `1135f61` (GREEN: `file_dir.resolve().relative_to(_attachments_root().resolve())` 400-on-escape) — RED→GREEN two-commit pattern |
| 2026-05-08 | atomic-write `.tmp` leak on `os.replace` failure | `_write_atomic` (preferences.py) and `_write_all` (bookmarks.py) didn't wrap the rename in try/finally; if `os.replace` raised, the `.tmp` was orphaned in the user's `~/.claude-exporter/` dir. No data corruption (the original file is preserved by `os.replace` atomicity) but disk leaked across failed writes | `0955f29` — try/except BaseException + `tmp.unlink()` cleanup (FileNotFoundError-tolerant) + re-raise. Test pattern: monkeypatch `os.replace` to raise OSError, assert `pytest.raises` + filesystem invariants (original byte-identical + no `*.tmp` glob) |
| 2026-05-08 | `DEFAULT_CREDENTIALS_PATH` value-imported in 4 modules, not 2 or 3 | `fetcher/credentials.py` defines it; `fetcher/bulk_fetch.py`, `backend/routers/fetch.py`, AND `backend/routers/orgs.py` each `from … import` it by value at module load. A test that only patches the canonical name leaves three handlers reading the user's real `~/.claude-exporter/credentials.json`. Discovered while implementing P4.2 (orgs corrupt-creds test) | `ea6781b` — conftest `_isolated_credentials_path` patches all 4 bindings; pattern documented in §5.1 ("constants imported by value need patching at every call site") |

Add to the appropriate sub-table when you ship a fix that surfaced a testing-discipline gap. The "class" column should name the FAILURE MODE, not the feature; the goal is to make the next agent recognize the same shape if it appears in a different feature.
