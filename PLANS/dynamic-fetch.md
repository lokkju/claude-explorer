# Dynamic Desktop Fetch

## Goal

Make Desktop conversation data feel live rather than manually refreshed. The user shouldn't have to think about whether their archive is stale.

## Proposed Behavior

- When the user initiates a search (Cmd+K or sidebar filter), the backend checks the Claude Desktop API for new conversations before returning results.
- If new conversations are found, fetch them incrementally before responding (or stream results as they arrive).
- Manual Fetch button and `claude-explorer fetch` CLI remain for full/forced refreshes.

## Open Questions

- How do we handle latency? The incremental fetch could take several seconds for an active account. Options: optimistic return of cached results + background refresh, or a spinner with a short timeout before falling back to cached.
- Session key expiry: if the key is stale, fail gracefully and surface a "re-run capture" prompt rather than blocking search.
- Should this be opt-in (setting) or always-on?
- Rate limiting: how often should we hit the API? Per-search is probably too aggressive; a TTL-based approach (e.g. check at most once per minute) may be more appropriate.

## Out of Scope (for now)

- Push/webhook from Anthropic (no such API exists).
- Auto-fetch on backend startup.
