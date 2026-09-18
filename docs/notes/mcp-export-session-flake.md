# `test_mcp_export_session_preserves_summary_on_sliced_copy` flakes under xdist

**Priority:** High — it fails CI on every PR, so the release pipeline is
never green.
**Discovery date:** 2026-09-18 (surfaced when Actions were first enabled
on this fork; the failure itself is older)
**Status:** NOT root-caused. Reproduced and localized; four hypotheses
eliminated.

## It is pre-existing

Measured at `2f5336f` — the commit before any of the 1.1.0 work, in a
clean worktree with its own venv:

```
BASE 2f5336f: 5/20 failed
```

My first check was 6 runs and came back clean, which at a ~25% rate has
a ~46% chance of showing zero failures. That nearly produced the wrong
conclusion. Any future check of this needs 20+ runs.

## Reproduction

```bash
uv run pytest mcp_server/tests/ -n0        # fails 10/10 -- DETERMINISTIC
uv run pytest mcp_server/tests/ -n 4       # fails ~1 in 4
uv run pytest mcp_server/tests/test_split_regression.py -n0   # passes
```

Serial is the reliable reproduction. Under xdist it depends on how the
suite shards, which is why `-n auto` on a many-core box looked clean and
a 4-worker GitHub runner did not. Do not "fix" this by pinning CI to
`-n0` -- that makes it red every time.

The failure needs the full suite: the file on its own passes, and the
minimal pair (the last test before it in collection order, plus the
target) also passes.

## What the failure actually looks like

`export_session` raises `ValueError: Session '<uuid>' not found.` from
`mcp_server/server.py:652`, i.e. `store.get_conversation(uuid)` returned
None. Instrumented at the moment of failure:

```
fixture data_dir  = /tmp/.../test_mcp_export_session_preser0/data
settings.data_dir = /tmp/.../test_mcp_export_session_preser0/data
store.data_dir    = /tmp/.../test_mcp_export_session_preser0/data
env DATA_DIR      = /tmp/.../test_mcp_export_session_preser0/data
files on disk     = ['2bd532a8-62c7-5cfb-8a42-10bb9dc37483.json']
looking for uuid  = 2bd532a8-62c7-5cfb-8a42-10bb9dc37483
```

Every path agrees, the file is on disk under exactly the uuid being
requested, and the lookup still returns None. That is the part worth
explaining, and it is why this might not be *only* a test-isolation
problem: `ConversationStore.get_conversation` returning None for a file
sitting right there is alarming on its own.

Note the uuid is deterministic (`mcp_data.uuid_for` is a uuid5), so the
same uuid recurs across tests and across runs while the tmp data dir
changes every test. Any uuid-keyed state that outlives a test will
collide.

## Hypotheses eliminated (each measured, not reasoned)

| Hypothesis | Result |
|---|---|
| `backend.cache` FileCache + `store._DETAIL_DICT_CACHE` leak across tests | cleared both per-test → **5/20**, unchanged |
| `summary_cache` singleton not reset (MCP conftest resets only the search index, backend resets both) | added the reset → **6/25**, unchanged |
| `test_server_version_does_not_require_installed_package_metadata` pops `mcp_server.server` from `sys.modules` and never restores it, so the test calls a stale module object | restored the original module → **10/10**, unchanged. Module identity confirmed IDENTICAL at failure: `bound.__globals__ is sys.modules["mcp_server.server"].__dict__` is True |
| Caused by the 1.1.0 work | base commit → **5/20**, pre-existing |
| Caused by adding `mcp_server/tests` to `testpaths` | CI runs `pytest mcp_server/tests/` with an explicit path, which ignores `testpaths` |

The summary-cache reset is still arguably correct on its own merits —
backend's conftest does it and the MCP mirror does not — but it does not
fix this, so it was reverted rather than shipped with a comment claiming
a fix it does not deliver.

## Where it has been narrowed to

Instrumented on the **live store instance** the failing tool call uses
(not a fresh import — that distinction mattered and cost a wrong
conclusion earlier):

```
store.data_dir  = /tmp/pytest-of-lokkju/pytest-477/test_mcp_export_session_preser0/data
files seen      = ['2bd532a8-62c7-5cfb-8a42-10bb9dc37483.json']
looking for     = 2bd532a8-62c7-5cfb-8a42-10bb9dc37483
```

So `_get_conversation_files()` **does** return the right file, in the
right directory, and the uuid being searched for matches the filename
exactly. The migration-sentinel theory is therefore dead too — the flat
file is visible.

That leaves the body of the Desktop loop in
`_find_conversation_data` (`backend/store.py`, ~line 740):

```python
for path in self._get_conversation_files():
    data = self._load_conversation(path)
    if data and data.get("uuid") == uuid:
        return data, path
```

Either `_load_conversation(path)` returns falsy for a file that exists,
or the parsed `data["uuid"]` is not what the filename says. `_load_conversation`
routes through the module-level `FileCache` singleton in
`backend/cache.py` (`_conversation_cache`, `max_workers=8`,
`max_entries=4096`), which is never reset between tests and is the only
remaining shared mutable state in the path.

**Next step:** print `self._load_conversation(path)` for that exact path
inside the loop, and compare against a direct `json.loads(path.read_text())`.
If the direct read works and the cached one does not, it is the
FileCache; check whether it can cache a negative/partial entry for a
path that was probed before the fixture wrote it.

## Interim handling

CI deselects this one test with a pointer to this note, so the other 104
still gate every PR. That is a quarantine and it is worth being blunt
about the cost: `ConversationStore.get_conversation` returning None for a
file it can see may be a real bug in the store rather than only a test
artifact, and deselecting stops CI from telling anyone about it. The
deselect should come out the moment the FileCache question above is
answered.

## Affected files

- `mcp_server/tests/test_split_regression.py` (the failing test)
- `mcp_server/tests/conftest.py` (isolation fixtures)
- `backend/store.py` (`_find_conversation_data`)
- `.github/workflows/test.yml` (the MCP pytest step)
