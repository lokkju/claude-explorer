"""
Bulk fetch all conversations from Claude Desktop.

Reads credentials captured by mitmproxy_addon.py and downloads
all conversations to ~/.claude-exporter/conversations/

Usage:
    uv run python -m fetcher.bulk_fetch [OPTIONS]

Options:
    --output-dir PATH      Where to save JSON files
    --credentials PATH     Path to credentials file
    --session-key KEY      Session key (overrides credentials file)
    --org-id ID            Org ID (overrides credentials file)
    --incremental          Skip already-saved conversations (default)
    --full-refresh         Re-fetch all conversations
    --delay FLOAT          Seconds between requests (default: 0.3)
    --limit INT            Max conversations to fetch
    --verbose              Show detailed output
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import click
from curl_cffi import requests as curl_requests


# Default paths
DEFAULT_CREDENTIALS_PATH = Path.home() / ".claude-exporter" / "credentials.json"
DEFAULT_OUTPUT_DIR = Path.home() / ".claude-exporter" / "conversations"

# Claude API base URL
API_BASE = "https://claude.ai/api"

# Request settings
DEFAULT_DELAY = 0.3
REQUEST_TIMEOUT = 30.0


class ClaudeFetcher:
    """Fetches conversations from the Claude API."""

    def __init__(
        self,
        session_key: str,
        org_id: str,
        output_dir: Path,
        delay: float = DEFAULT_DELAY,
        incremental: bool = True,
        verbose: bool = False,
        cf_bm: str | None = None,
        cf_clearance: str | None = None,
    ):
        self.session_key = session_key
        self.org_id = org_id
        self.output_dir = output_dir
        self.delay = delay
        self.incremental = incremental
        self.verbose = verbose

        # Build cookies dict
        self.cookies = {"sessionKey": session_key}
        if cf_bm:
            self.cookies["__cf_bm"] = cf_bm
        if cf_clearance:
            self.cookies["cf_clearance"] = cf_clearance

    def _log(self, message: str) -> None:
        """Print message if verbose mode is on."""
        if self.verbose:
            click.echo(message)

    def _api_url(self, path: str) -> str:
        """Build API URL with org ID."""
        return f"{API_BASE}/organizations/{self.org_id}/{path}"

    def _get(self, url: str) -> curl_requests.Response:
        """Make a GET request with Chrome impersonation."""
        return curl_requests.get(
            url,
            cookies=self.cookies,
            impersonate="chrome",
            timeout=REQUEST_TIMEOUT,
        )

    def fetch_conversation_list(self) -> list[dict]:
        """Fetch list of all conversations."""
        conversations = []

        # Fetch recent conversations (includes pagination cursor)
        url = self._api_url("chat_conversations")
        self._log(f"Fetching conversation list from {url}")

        while url:
            response = self._get(url)
            response.raise_for_status()
            data = response.json()

            # Handle both list and paginated object responses
            if isinstance(data, list):
                conversations.extend(data)
                break
            elif isinstance(data, dict):
                conversations.extend(data.get("conversations", data.get("items", [])))
                # Check for pagination cursor
                cursor = data.get("cursor") or data.get("next_cursor")
                if cursor:
                    url = f"{self._api_url('chat_conversations')}?cursor={cursor}"
                    time.sleep(self.delay)
                else:
                    break
            else:
                break

        self._log(f"Found {len(conversations)} conversations")
        return conversations

    def fetch_conversation(self, uuid: str) -> dict | None:
        """Fetch full conversation content."""
        url = self._api_url(f"chat_conversations/{uuid}")
        self._log(f"Fetching conversation {uuid}")

        try:
            response = self._get(url)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            status = getattr(getattr(e, 'response', None), 'status_code', None)
            if status == 404:
                click.echo(f"  Warning: Conversation {uuid} not found (404)", err=True)
            elif status == 401:
                click.echo(f"  Error: Session expired (401). Re-run credential capture.", err=True)
                raise
            elif status == 429:
                click.echo(f"  Rate limited. Waiting 60 seconds...", err=True)
                time.sleep(60)
                return self.fetch_conversation(uuid)  # Retry
            else:
                click.echo(f"  Error fetching {uuid}: {e}", err=True)
            return None

    def save_conversation(self, conversation: dict) -> None:
        """Save conversation to JSON file."""
        uuid = conversation.get("uuid", "unknown")
        path = self.output_dir / f"{uuid}.json"

        with open(path, "w") as f:
            json.dump(conversation, f, indent=2)

        self._log(f"Saved {path}")

    def save_index(self, conversations: list[dict]) -> None:
        """Save conversation index file."""
        index = {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "org_id": self.org_id,
            "total": len(conversations),
            "conversations": [
                {
                    "uuid": c.get("uuid"),
                    "name": c.get("name", "Untitled"),
                    "created_at": c.get("created_at"),
                    "updated_at": c.get("updated_at"),
                    "model": c.get("model", ""),
                    "is_starred": c.get("is_starred", False),
                }
                for c in conversations
            ],
        }

        path = self.output_dir / "_index.json"
        with open(path, "w") as f:
            json.dump(index, f, indent=2)

        self._log(f"Saved index to {path}")

    def run(self, limit: int | None = None) -> None:
        """Run the full fetch process."""
        # Ensure output directory exists
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Get existing UUIDs if incremental
        existing_uuids = set()
        if self.incremental:
            existing_uuids = {
                p.stem for p in self.output_dir.glob("*.json") if p.stem != "_index"
            }
            if existing_uuids:
                click.echo(f"Found {len(existing_uuids)} existing conversations (incremental mode)")

        # Fetch conversation list
        click.echo("Fetching conversation list...")
        conversations = self.fetch_conversation_list()

        if limit:
            conversations = conversations[:limit]

        # Filter out existing if incremental
        if self.incremental:
            to_fetch = [c for c in conversations if c.get("uuid") not in existing_uuids]
            click.echo(f"Will fetch {len(to_fetch)} new conversations (skipping {len(conversations) - len(to_fetch)} existing)")
        else:
            to_fetch = conversations
            click.echo(f"Will fetch {len(to_fetch)} conversations")

        # Fetch each conversation
        fetched = []
        for i, conv in enumerate(to_fetch, 1):
            uuid = conv.get("uuid", "")
            name = conv.get("name", "Untitled")[:40]
            click.echo(f"[{i}/{len(to_fetch)}] Fetching: {name}...")

            if not uuid:
                continue

            full_conv = self.fetch_conversation(uuid)
            if full_conv:
                self.save_conversation(full_conv)
                fetched.append(full_conv)

            if i < len(to_fetch):
                time.sleep(self.delay)

        # Save index with all conversations (existing + newly fetched)
        all_conversations = conversations  # Use the list from API which has all
        self.save_index(all_conversations)

        click.echo(f"\nDone! Fetched {len(fetched)} conversations.")
        click.echo(f"Saved to: {self.output_dir}")


def load_credentials(credentials_path: Path) -> dict:
    """Load credentials from JSON file."""
    if not credentials_path.exists():
        raise click.ClickException(
            f"Credentials file not found: {credentials_path}\n"
            f"Run the mitmproxy addon first to capture credentials."
        )

    with open(credentials_path) as f:
        return json.load(f)


@click.command()
@click.option(
    "--output-dir",
    type=click.Path(path_type=Path),
    default=DEFAULT_OUTPUT_DIR,
    help="Where to save JSON files",
)
@click.option(
    "--credentials",
    type=click.Path(path_type=Path),
    default=DEFAULT_CREDENTIALS_PATH,
    help="Path to credentials file",
)
@click.option("--session-key", help="Session key (overrides credentials file)")
@click.option("--org-id", help="Org ID (overrides credentials file)")
@click.option(
    "--incremental/--full-refresh",
    default=True,
    help="Skip already-saved conversations (default: incremental)",
)
@click.option(
    "--delay",
    type=float,
    default=DEFAULT_DELAY,
    help="Seconds between requests",
)
@click.option("--limit", type=int, help="Max conversations to fetch")
@click.option("--verbose", is_flag=True, help="Show detailed output")
def main(
    output_dir: Path,
    credentials: Path,
    session_key: str | None,
    org_id: str | None,
    incremental: bool,
    delay: float,
    limit: int | None,
    verbose: bool,
) -> None:
    """Fetch all conversations from Claude Desktop."""
    # Get credentials
    if session_key and org_id:
        # Use CLI args
        pass
    else:
        # Load from file
        creds = load_credentials(credentials)
        session_key = session_key or creds.get("session_key")
        org_id = org_id or creds.get("org_id")

    if not session_key or not org_id:
        raise click.ClickException(
            "Missing session_key or org_id. "
            "Run mitmproxy addon first or provide --session-key and --org-id."
        )

    # Run fetcher
    fetcher = ClaudeFetcher(
        session_key=session_key,
        org_id=org_id,
        output_dir=output_dir,
        delay=delay,
        incremental=incremental,
        verbose=verbose,
    )

    fetcher.run(limit=limit)


if __name__ == "__main__":
    main()
