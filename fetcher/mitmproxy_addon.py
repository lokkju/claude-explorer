"""
mitmproxy addon to capture Claude Desktop session credentials.

Usage:
    mitmproxy -s fetcher/mitmproxy_addon.py --listen-port 8080

Then launch Claude Desktop through the proxy:
    macOS:   open -a "Claude" --args --proxy-server="127.0.0.1:8080"
    Windows: "Claude.exe" --proxy-server="127.0.0.1:8080"
    Linux:   claude --proxy-server="127.0.0.1:8080"

The addon will automatically capture credentials when you use Claude Desktop
and save them to ~/.claude-exporter/credentials.json
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from mitmproxy import http, ctx


# Where to save captured credentials
DEFAULT_CREDENTIALS_PATH = Path.home() / ".claude-exporter" / "credentials.json"

# Patterns for extracting data
SESSION_KEY_PATTERN = re.compile(r"sessionKey=([^;]+)")
ORG_ID_PATTERN = re.compile(r"/api/organizations/([a-f0-9-]{36})/")


class ClaudeCredentialCapture:
    """mitmproxy addon that captures Claude Desktop session credentials."""

    def __init__(self):
        self.credentials_path = DEFAULT_CREDENTIALS_PATH
        self.session_key: str | None = None
        self.org_id: str | None = None
        self.captured = False

    def request(self, flow: http.HTTPFlow) -> None:
        """Intercept requests to claude.ai and extract credentials."""
        # Only process claude.ai requests
        if not self._is_claude_request(flow.request.host):
            return

        # Extract session key from cookies
        cookie_header = flow.request.headers.get("cookie", "")
        session_key = self._extract_session_key(cookie_header)
        if session_key:
            self.session_key = session_key

        # Extract org ID from URL path
        org_id = self._extract_org_id(flow.request.path)
        if org_id:
            self.org_id = org_id

        # Save credentials once we have both
        if self.session_key and self.org_id and not self.captured:
            self._save_credentials()
            self.captured = True
            self._print_success()

    def _is_claude_request(self, host: str) -> bool:
        """Check if request is to Claude's API."""
        return host in ("claude.ai", "api.claude.ai", "www.claude.ai")

    def _extract_session_key(self, cookie_header: str) -> str | None:
        """Extract sessionKey from cookie header."""
        match = SESSION_KEY_PATTERN.search(cookie_header)
        if match:
            return match.group(1)
        return None

    def _extract_org_id(self, path: str) -> str | None:
        """Extract organization ID from API path."""
        match = ORG_ID_PATTERN.search(path)
        if match:
            return match.group(1)
        return None

    def _save_credentials(self) -> None:
        """Save captured credentials to file."""
        self.credentials_path.parent.mkdir(parents=True, exist_ok=True)

        credentials = {
            "session_key": self.session_key,
            "org_id": self.org_id,
            "captured_at": datetime.now(timezone.utc).isoformat(),
        }

        with open(self.credentials_path, "w") as f:
            json.dump(credentials, f, indent=2)

        ctx.log.info(f"Credentials saved to {self.credentials_path}")

    def _print_success(self) -> None:
        """Print success message with next steps."""
        ctx.log.alert("=" * 60)
        ctx.log.alert("✅ CREDENTIALS CAPTURED SUCCESSFULLY!")
        ctx.log.alert("=" * 60)
        ctx.log.alert(f"   Session key: {self.session_key[:20] if self.session_key else ''}...")
        ctx.log.alert(f"   Org ID: {self.org_id}")
        ctx.log.alert(f"   Saved to: {self.credentials_path}")
        ctx.log.alert("")
        ctx.log.alert("   You can now quit mitmproxy (press 'q') and close Claude Desktop.")
        ctx.log.alert("   Then run: uv run python -m fetcher.bulk_fetch")
        ctx.log.alert("=" * 60)


# mitmproxy entry point
addons = [ClaudeCredentialCapture()]
