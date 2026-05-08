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

## 5 · Backend tests (pytest)

The same principles apply, with these specifics:

- Use `httpx.AsyncClient` against a real `FastAPI` app + a real
  on-disk temp dir for the data layer. Don't mock the store layer —
  mock the HTTP boundary if you must, but route the rest through
  real code.
- Migration tests: write the legacy on-disk shape into a `tmp_path`
  and let the real migration code run against it. Assert the
  resulting on-disk shape and any side effects.
- Use `pytest.fixture(autouse=True)` on `monkeypatch.setenv`
  temporary env vars (e.g., `CLAUDE_EXPORTER_DATA_DIR`).
- For SSE tests, use `httpx.stream` and `aiter_lines()`; assert the
  exact event sequence.

---

## 6 · Test review checklist

Before declaring a new test sufficient, confirm:

- [ ] Selector uses `getByRole`/`getByLabel` first; `data-testid` only
      where spec dictates.
- [ ] At least one fixture exercises an edge case (long string, many
      items, special chars), not just the happy path.
- [ ] Visibility tests use `expectInsideClipAncestor` (or equivalent)
      when the assertion is "user can see this".
- [ ] An actionability check (`hover`/`click`) cross-tests
      reachability where it matters.
- [ ] Bidirectional verification: the test fails when the fix is
      reverted, with an informative error message.
- [ ] Strict-mode locator: every `getBy*` query is unambiguous, OR
      explicitly scoped/`.first()`d.
- [ ] PATCH/route spies are registered AFTER `mockBackend` for LIFO
      precedence.
- [ ] Spec docs (`UX.md` / API schemas) updated to match any new
      contract the test asserts.
- [ ] Test name names the contract, not the impl ("Manage Filters
      modal: every row exposes a visible, in-viewport, NOT-clipped
      delete affordance" — not "trash icon visible").

---

## Reference incidents

These are the bugs that produced this document. Read the linked
commits before adding a new section.

| Date | Class | Root cause | Fix |
|---|---|---|---|
| 2026-05-07 | overflow-clipping false-pass | `toBeVisible` + row-anchored bbox blind to ancestor `overflow: hidden`; tame fixtures (short names) didn't reproduce | `8cb85fd` (impl), `0f29d6f` (canary upgrade with `expectInsideClipAncestor`) |
| 2026-05-07 | role-blind selectors hid a11y drift | tests used `data-testid` everywhere; CFR1 shipped Behavior/Mode/Match as `button aria-pressed` instead of `role=radio`; tests passed | `e2190cf` (impl: real ARIA roles); spec-driven sweep caught it |
| 2026-05-06 | filter Pin desync | seeding logic ran once on first mount, decoupled `pinned` from `activeFilterIds`; tests passed in fixture mode (empty initial state) | `2c94860` (composable graph + sidebar picker) |

Add to this table when you ship a fix that surfaced a testing-discipline gap.
