# Skipped: Gmail-scanner sessions (2026-04-08)

## Why these sessions were excluded

On the evening of 2026-04-08 the user ran a short series of Gmail-scanning /
filtering / calendar-reconciliation agent loops from this working directory.
Because Claude Code tags sessions by `cwd`, all seven runs were auto-labeled
`project="claude-desktop-message-exporter"` — but none of them touched or
discussed the exporter's code. They are unrelated agent runs that happen to
share the project bucket, and they are excluded from the Medium-series
extraction pipeline.

## Session list

Total skipped: **89 messages across 7 sessions**.

| session_id | msgs | human | created |
|------------|------|-------|---------|
| `91aa583c-ba0f-47ed-9ce6-fed9563ca64c` | 18 | 10 | 2026-04-08 21:37 |
| `26796c2e-1207-4be4-8ab9-2cc92d86bfbc` | 22 | 12 | 2026-04-08 20:44 |
| `022544c7-8496-4380-9572-bb37af6f6912` | 9  | 6  | 2026-04-08 20:42 |
| `6d60d5ff-50fe-48fb-a672-4e1133a947e2` | 23 | 13 | 2026-04-08 20:27 |
| `d1411a68-c9d8-4641-ae3d-031a637538d5` | 7  | 4  | 2026-04-08 20:23 |
| `6f2818d6-d6c7-425b-b524-a876cbd8f0fa` | 8  | 5  | 2026-04-08 20:17 |
| `0fa2ebe8-052f-4b81-953e-1846a1364a16` | 2  | 1  | 2026-04-08 20:10 |

## Verification

A spot-check via
`mcp__claude-sessions__get_session_outline(session_id="91aa583c-ba0f-47ed-9ce6-fed9563ca64c")`
confirms the content is Gmail/Calendar automation, not exporter development.
The opening human turn reads:

> "Scan Gmail for meeting invites and event notifications from the last 2 days.
> For each one, check if it's already in Google Calendar. Create missing events
> and delete cancelled ones. Log all actions."

The other six sessions in this cluster follow the same pattern (Gmail search,
label management, unsubscribe / filter actions, calendar sync).

## User directive

User confirmed the skip during planning on 2026-04-19 (session
`76fe578b-7872-4263-bc24-f911c7f2efcc`).
