# Fetcher — Detailed Plan

## Overview

The fetcher is a two-step process:

1. **mitmproxy-addon.py** — Run alongside Claude Desktop to intercept HTTPS traffic,
   automatically extract the session cookie and org ID, and save them to a config file.
2. **bulk-fetch.py** — Use the captured credentials to download all conversations
   from the claude.ai API and save them as JSON files.

Users run these once (or whenever they want a fresh snapshot). The visualizer app
then reads from the saved JSON directory.

---

## Step 1: mitmproxy-addon.py

### Responsibilities
- Watch all intercepted requests to claude.ai
- Extract `sessionKey` from Cookie headers
- Extract `org_id` from URL paths (`/api/organizations/{org_id}/...`)
- Write credentials to `~/.claude-explorer/credentials.json` (or a path the user configures)
- Log captured API responses to a raw directory (optional, for debugging)
- Print clear status messages so the user knows when credentials are captured

### Credential file format
```json
{
  "session_key": "sk-ant-sid01-...",
  "org_id": "16bbdb44-0a33-470c-82e7-b628d9fdda8f",
  "captured_at": "2026-02-25T12:30:00Z",
  "account_email_hint": "r***@example.com"
}
```

### Launch command (documented for users)
```bash
# Terminal 1: start proxy
mitmproxy -s fetcher/mitmproxy-addon.py --listen-port 8080

# Terminal 2: launch Claude Desktop through proxy
open -a "Claude" --args --proxy-server="127.0.0.1:8080" --ignore-certificate-errors
```

### Auto-stop option
Once credentials are captured, print a clear message:
```
✅ Credentials captured! You can now quit mitmproxy (q) and close Claude Desktop.
   Run: python fetcher/bulk-fetch.py
```

---

## Step 2: bulk-fetch.py

### Responsibilities
- Read credentials from `~/.claude-explorer/credentials.json`
- Allow credential override via CLI args or environment variables
- Fetch paginated list of all conversations (starred + unstarred)
- Fetch full content of each conversation
- Save each as `{output_dir}/{uuid}.json`
- Save conversation index as `{output_dir}/_index.json`
- Support incremental fetch (skip UUIDs already on disk)
- Handle errors gracefully (log failures, continue)
- Print progress clearly
- Respect rate limits (configurable sleep, default 0.3s)

### Output directory
Default: `~/.claude-explorer/conversations/`
Override: `--output-dir /path/to/dir`

### Index file format
```json
{
  "fetched_at": "2026-02-25T12:45:00Z",
  "org_id": "...",
  "total": 57,
  "conversations": [
    {
      "uuid": "...",
      "name": "Conversation title",
      "created_at": "...",
      "updated_at": "...",
      "model": "claude-sonnet-4-6",
      "is_starred": false,
      "message_count": 42
    }
  ]
}
```

### CLI interface
```bash
python fetcher/bulk-fetch.py [OPTIONS]

Options:
  --output-dir PATH       Where to save JSON files (default: ~/.claude-explorer/conversations)
  --credentials PATH      Path to credentials file (default: ~/.claude-explorer/credentials.json)
  --session-key KEY       Session key (overrides credentials file)
  --org-id ID             Org ID (overrides credentials file)
  --incremental           Skip conversations already saved (default: true)
  --full-refresh          Re-fetch all conversations even if already saved
  --delay FLOAT           Seconds between requests (default: 0.3)
  --limit INT             Max conversations to fetch (default: all)
  --verbose               Show detailed output
```

---

## File Structure

```
fetcher/
├── README.md
├── mitmproxy-addon.py
├── bulk-fetch.py
└── tests/
    ├── __init__.py
    ├── test_mitmproxy_addon.py
    └── test_bulk_fetch.py
```

---

## Tests

### test_mitmproxy_addon.py
Test the credential extraction logic in isolation (without actually running mitmproxy):

- `test_extract_session_key_from_cookie_header` — parses `sessionKey=sk-ant-...` from cookie string
- `test_extract_org_id_from_url` — parses org ID from various API URL patterns
- `test_writes_credentials_file` — mock file write, verify JSON structure
- `test_skips_non_claude_urls` — verify non-claude.ai traffic is ignored
- `test_handles_missing_session_key` — cookie header without sessionKey
- `test_handles_malformed_urls` — URLs that don't contain org ID

### test_bulk_fetch.py
Use `responses` or `pytest-httpx` to mock the claude.ai API:

- `test_fetches_all_conversations_single_page` — 10 conversations, no pagination
- `test_fetches_all_conversations_paginated` — 65 conversations across 3 pages
- `test_skips_existing_files_in_incremental_mode` — files already on disk are skipped
- `test_full_refresh_overwrites_existing` — --full-refresh re-fetches everything
- `test_saves_index_file` — _index.json written correctly
- `test_saves_individual_conversation_files` — each UUID.json written correctly
- `test_handles_api_error_gracefully` — 500 on one conversation, continues rest
- `test_handles_rate_limit_response` — 429 response, backs off and retries
- `test_reads_credentials_from_file` — loads session_key + org_id from JSON
- `test_cli_args_override_credentials_file` — --session-key flag takes priority
- `test_starred_conversations_included` — both starred and unstarred fetched
- `test_respects_delay_between_requests` — verify sleep called between requests

---

## Open Questions / Risks

1. **cf_clearance**: Cloudflare challenge cookie. We need to test whether requests
   succeed with just `sessionKey` from the same IP. If not, we may need to also
   capture and pass cf_clearance (but it expires quickly).

2. **Truncated messages**: Some messages have `truncated: true`. Need to find if
   there's a per-message endpoint for full content. TODO: investigate during implementation.

3. **Session key expiry**: sessionKey will expire eventually. The fetcher should
   detect 401 responses and tell the user to re-run the mitmproxy step.

4. **Large accounts**: Users with hundreds of conversations need tested pagination
   and robust error handling.

5. **Proxy launch on Windows/Linux**: The `open -a "Claude"` command is macOS-only.
   Need platform detection for the launch command in README.
