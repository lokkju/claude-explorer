"""
Capture Claude session credentials using Playwright.

Opens a browser window for the user to log into Claude, then
extracts the session credentials automatically.

Usage:
    uv run python -m fetcher.playwright_capture

Or via CLI:
    claude-explorer capture
"""

import json
import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path

import click
from playwright.async_api import async_playwright, Page, BrowserContext


# Where to save captured credentials
DEFAULT_CREDENTIALS_PATH = Path.home() / ".claude-exporter" / "credentials.json"

# Claude URLs
CLAUDE_LOGIN_URL = "https://claude.ai/login"
CLAUDE_HOME_URL = "https://claude.ai"
CLAUDE_API_BASE = "https://claude.ai/api"


async def wait_for_login(page: Page) -> bool:
    """Wait for user to complete login.

    Returns True if logged in, False if window was closed.
    """
    click.echo("Waiting for you to log in...")
    click.echo("(Complete the login process in the browser window)")

    try:
        # Wait for navigation away from login page, or for a logged-in indicator
        # The home page after login will have a different URL pattern
        while True:
            await asyncio.sleep(1)

            # Check if we're on a logged-in page
            url = page.url
            if "/login" not in url and "/chat" in url or url == "https://claude.ai/":
                # Give it a moment to fully load
                await asyncio.sleep(2)
                return True

            # Check for the chat input or new chat button as indicators of login
            try:
                # Look for elements that only appear when logged in
                logged_in = await page.locator('[data-testid="composer-input"], [data-testid="new-chat-button"], .ProseMirror').first.is_visible(timeout=500)
                if logged_in:
                    return True
            except:
                pass

    except Exception as e:
        click.echo(f"Error waiting for login: {e}", err=True)
        return False


async def extract_cookies(context: BrowserContext) -> dict[str, str]:
    """Extract relevant cookies from browser context."""
    cookies = await context.cookies()

    result = {}
    for cookie in cookies:
        if cookie["name"] == "sessionKey":
            result["session_key"] = cookie["value"]
        elif cookie["name"] == "__cf_bm":
            result["cf_bm"] = cookie["value"]
        elif cookie["name"] == "cf_clearance":
            result["cf_clearance"] = cookie["value"]

    return result


async def get_org_id(page: Page) -> str | None:
    """Get the organization ID by calling the organizations API."""
    try:
        # Navigate to get organizations
        response = await page.request.get(f"{CLAUDE_API_BASE}/organizations")
        if response.ok:
            data = await response.json()
            # Response is a list of organizations, get the first one
            if isinstance(data, list) and len(data) > 0:
                return data[0].get("uuid")
    except Exception as e:
        click.echo(f"Warning: Could not fetch org ID via API: {e}", err=True)

    # Fallback: try to extract from page content or URL
    try:
        # Look for org ID in any visible API calls or page data
        url = page.url
        if "/chat/" in url:
            # Sometimes the org ID is in the URL
            parts = url.split("/")
            for part in parts:
                if len(part) == 36 and "-" in part:  # UUID format
                    return part
    except:
        pass

    return None


async def capture_credentials(
    headless: bool = False,
    timeout: int = 300,
) -> dict | None:
    """Open browser, wait for login, and capture credentials.

    Args:
        headless: Run browser in headless mode (not useful for login)
        timeout: Max seconds to wait for login

    Returns:
        Credentials dict or None if failed
    """
    async with async_playwright() as p:
        # Launch browser - must be headed for user to log in
        browser = await p.chromium.launch(
            headless=headless,
            args=["--disable-blink-features=AutomationControlled"],
        )

        # Create context with realistic settings
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )

        page = await context.new_page()

        try:
            # Navigate to Claude
            click.echo(f"Opening {CLAUDE_HOME_URL}...")
            await page.goto(CLAUDE_HOME_URL, wait_until="networkidle")

            # Check if already logged in
            url = page.url
            if "/login" in url:
                click.echo("\nPlease log in to your Claude account in the browser window.")
                click.echo("This window will close automatically once login is complete.\n")

                # Wait for login with timeout
                try:
                    logged_in = await asyncio.wait_for(
                        wait_for_login(page),
                        timeout=timeout,
                    )
                    if not logged_in:
                        click.echo("Login was not completed.", err=True)
                        return None
                except asyncio.TimeoutError:
                    click.echo(f"Login timed out after {timeout} seconds.", err=True)
                    return None
            else:
                click.echo("Already logged in!")

            # Extract cookies
            click.echo("Extracting session credentials...")
            cookies = await extract_cookies(context)

            if not cookies.get("session_key"):
                click.echo("Error: Could not find sessionKey cookie.", err=True)
                return None

            # Get org ID
            click.echo("Fetching organization ID...")
            org_id = await get_org_id(page)

            if not org_id:
                click.echo("Error: Could not determine organization ID.", err=True)
                return None

            # Build credentials
            credentials = {
                "session_key": cookies.get("session_key"),
                "org_id": org_id,
                "cf_bm": cookies.get("cf_bm"),
                "cf_clearance": cookies.get("cf_clearance"),
                "captured_at": datetime.now(timezone.utc).isoformat(),
            }

            return credentials

        finally:
            await browser.close()


def save_credentials(credentials: dict, path: Path = DEFAULT_CREDENTIALS_PATH) -> None:
    """Save credentials to file with 0o600 perms; parent dir 0o700."""
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)

    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(credentials, f, indent=2)

    os.chmod(path, 0o600)

    click.echo(f"Credentials saved to {path}")


@click.command()
@click.option(
    "--output",
    "-o",
    type=click.Path(path_type=Path),
    default=DEFAULT_CREDENTIALS_PATH,
    help="Where to save credentials",
)
@click.option(
    "--timeout",
    "-t",
    type=int,
    default=300,
    help="Max seconds to wait for login (default: 300)",
)
def main(output: Path, timeout: int) -> None:
    """Capture Claude session credentials by logging in via browser.

    Opens a browser window where you can log into Claude normally.
    Once logged in, credentials are automatically extracted and saved.
    """
    click.echo("=" * 60)
    click.echo("  Claude Credential Capture")
    click.echo("=" * 60)
    click.echo()

    # Run async capture
    credentials = asyncio.run(capture_credentials(timeout=timeout))

    if credentials:
        save_credentials(credentials, output)

        click.echo()
        click.echo("=" * 60)
        click.echo("✅ CREDENTIALS CAPTURED SUCCESSFULLY!")
        click.echo("=" * 60)
        click.echo(f"   Session key: {credentials['session_key'][:20]}...")
        click.echo(f"   Org ID: {credentials['org_id']}")
        click.echo(f"   Saved to: {output}")
        click.echo()
        click.echo("   You can now fetch conversations:")
        click.echo("   claude-explorer fetch")
        click.echo("=" * 60)
    else:
        click.echo()
        click.echo("❌ Failed to capture credentials.", err=True)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
