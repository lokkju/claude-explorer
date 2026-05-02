"""
CLI entry point for claude-explorer.

Usage:
    claude-explorer capture [OPTIONS]  Log into Claude and capture credentials
    claude-explorer fetch [OPTIONS]    Fetch conversations from Claude Desktop API
    claude-explorer serve [OPTIONS]    Start the web server

Note: Claude Code sessions are read directly from ~/.claude/projects/
      at runtime - no import step needed.
"""

import subprocess
from pathlib import Path

import click


@click.group()
@click.version_option(version="0.1.0")
def main():
    """Claude Explorer - Export and browse your Claude conversations."""
    pass


@main.command()
@click.option(
    "--output-dir",
    type=click.Path(path_type=Path),
    default=Path.home() / ".claude-exporter" / "conversations",
    help="Where to save JSON files",
)
@click.option(
    "--files-dir",
    type=click.Path(path_type=Path),
    default=Path.home() / ".claude-exporter" / "files",
    help="Where to save downloaded files (images, PDFs)",
)
@click.option(
    "--credentials",
    type=click.Path(path_type=Path),
    default=Path.home() / ".claude-exporter" / "credentials.json",
    help="Path to credentials file",
)
@click.option("--session-key", help="Session key (overrides credentials file)")
@click.option("--org-id", help="Org ID (overrides credentials file)")
@click.option(
    "--incremental/--full-refresh",
    default=True,
    help="Skip already-saved conversations",
)
@click.option(
    "--download-files/--no-download-files",
    default=True,
    help="Download attached images/PDFs (default: yes)",
)
@click.option("--delay", type=float, default=0.3, help="Seconds between requests")
@click.option("--limit", type=int, help="Max conversations to fetch")
@click.option("--verbose", is_flag=True, help="Show detailed output")
def fetch(
    output_dir: Path,
    files_dir: Path,
    credentials: Path,
    session_key: str | None,
    org_id: str | None,
    incremental: bool,
    download_files: bool,
    delay: float,
    limit: int | None,
    verbose: bool,
):
    """Fetch all conversations from Claude Desktop.

    Requires credentials captured via the mitmproxy addon.
    Run 'claude-explorer capture' first if you haven't yet.
    """
    from fetcher.bulk_fetch import ClaudeFetcher, load_credentials

    # Get credentials
    cf_bm = None
    cf_clearance = None
    if session_key and org_id:
        pass
    else:
        creds = load_credentials(credentials)
        session_key = session_key or creds.get("session_key")
        org_id = org_id or creds.get("org_id")
        cf_bm = creds.get("cf_bm")
        cf_clearance = creds.get("cf_clearance")

    if not session_key or not org_id:
        raise click.ClickException(
            "Missing credentials. Run 'claude-explorer capture' first."
        )

    fetcher = ClaudeFetcher(
        session_key=session_key,
        org_id=org_id,
        output_dir=output_dir,
        files_dir=files_dir,
        delay=delay,
        incremental=incremental,
        verbose=verbose,
        download_files=download_files,
        cf_bm=cf_bm,
        cf_clearance=cf_clearance,
    )

    fetcher.run(limit=limit)


@main.command()
@click.option(
    "--output",
    "-o",
    type=click.Path(path_type=Path),
    default=Path.home() / ".claude-exporter" / "credentials.json",
    help="Where to save credentials",
)
@click.option(
    "--timeout",
    "-t",
    type=int,
    default=300,
    help="Max seconds to wait for login (default: 300)",
)
@click.option(
    "--proxy",
    is_flag=True,
    help="Use mitmproxy method (for when you can't log in but Claude Desktop is still authenticated)",
)
@click.option(
    "--port",
    default=8080,
    help="Proxy port when using --proxy method (default: 8080)",
)
def capture(output: Path, timeout: int, proxy: bool, port: int):
    """Capture Claude session credentials.

    By default, opens a browser window where you can log into Claude normally.
    Once logged in, credentials are automatically extracted and saved.

    Use --proxy for the mitmproxy method, which captures credentials from
    Claude Desktop traffic. This is useful when you can't log in via web
    (e.g., lost access to SSO) but Claude Desktop is still authenticated.
    """
    if proxy:
        _capture_via_proxy(port)
    else:
        _capture_via_browser(output, timeout)


def _capture_via_browser(output: Path, timeout: int):
    """Capture credentials by logging in via browser."""
    import asyncio

    # Check if playwright browsers are installed
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise click.ClickException(
            "Playwright not installed. Run: uv sync && uv run playwright install chromium"
        )

    from fetcher.playwright_capture import capture_credentials
    from fetcher.credentials import save_credentials

    click.echo("=" * 60)
    click.echo("  Claude Credential Capture (Browser)")
    click.echo("=" * 60)
    click.echo()

    # Check if browsers are installed
    try:
        credentials = asyncio.run(capture_credentials(timeout=timeout))
    except Exception as e:
        if "Executable doesn't exist" in str(e) or "browserType.launch" in str(e):
            raise click.ClickException(
                "Playwright browsers not installed.\n"
                "Run: uv run playwright install chromium"
            )
        raise

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


def _capture_via_proxy(port: int):
    """Capture credentials via mitmproxy (for Claude Desktop)."""
    addon_path = Path(__file__).parent / "mitmproxy_addon.py"

    click.echo("=" * 60)
    click.echo("  Claude Credential Capture (Proxy)")
    click.echo("=" * 60)
    click.echo()
    click.echo("This method intercepts Claude Desktop traffic to capture")
    click.echo("credentials. Useful when you can't log in via web but")
    click.echo("Claude Desktop is still authenticated.")
    click.echo()
    click.echo(f"Proxy listening on port {port}")
    click.echo()
    click.echo("In another terminal, launch Claude Desktop through the proxy:")
    click.echo()
    click.echo(f'  open -a "Claude" --args --proxy-server="127.0.0.1:{port}" --ignore-certificate-errors')
    click.echo()
    click.echo("Use Claude Desktop normally. Credentials will be captured automatically.")
    click.echo("Press 'q' to quit mitmproxy when done.")
    click.echo()

    try:
        subprocess.run(
            ["mitmproxy", "-s", str(addon_path), "--listen-port", str(port)],
            check=True,
        )
    except FileNotFoundError:
        raise click.ClickException(
            "mitmproxy not found. Install with: uv sync"
        )
    except subprocess.CalledProcessError as e:
        raise click.ClickException(f"mitmproxy exited with error: {e}")


@main.command()
@click.option(
    "--data-dir",
    type=click.Path(path_type=Path),
    default=Path.home() / ".claude-exporter" / "conversations",
    help="Conversations directory to migrate",
)
@click.option(
    "--credentials",
    type=click.Path(path_type=Path),
    default=Path.home() / ".claude-exporter" / "credentials.json",
    help="Path to credentials file (provides legacy_migration_target)",
)
def migrate(data_dir: Path, credentials: Path):
    """Run the v1 -> v2 per-org subdir migration explicitly.

    Useful for users with large data dirs who want to run the migration
    offline rather than blocking the SSE fetch or server startup.
    """
    from fetcher.migrate_to_v2 import migrate_to_v2

    click.echo(f"Migrating {data_dir}...")

    def _progress(moved: int, total: int) -> None:
        if total:
            click.echo(f"  {moved}/{total} files migrated")

    try:
        migrate_to_v2(
            data_dir=data_dir,
            credentials_path=credentials,
            on_progress=_progress,
            lock_command="cli_migrate",
        )
        click.echo("Migration complete.")
    except Exception as e:
        raise click.ClickException(f"Migration failed: {e}") from e


@main.command()
def mcp():
    """Start the MCP server (stdio transport).

    Exposes conversation sessions as MCP tools for use with
    Claude Desktop, Claude Code, or any MCP-compatible client.

    Configure in claude_desktop_config.json or .claude.json.
    """
    from mcp_server.server import main as mcp_main

    mcp_main()


@main.command()
@click.option("--host", default="127.0.0.1", help="Host to bind to")
@click.option("--port", default=8000, help="Port to bind to")
@click.option("--reload", is_flag=True, help="Enable auto-reload for development")
def serve(host: str, port: int, reload: bool):
    """Start the web server to browse conversations.

    The server provides both the API and the web UI.
    Open http://localhost:8000 in your browser to view conversations.
    """
    import uvicorn

    click.echo(f"Starting server on http://{host}:{port}")
    click.echo("Press Ctrl+C to stop.")

    try:
        uvicorn.run(
            "backend.main:app",
            host=host,
            port=port,
            reload=reload,
        )
    except OSError as e:
        if e.errno == 48 or "address already in use" in str(e).lower():
            click.echo(
                f"\nError: port {port} is already in use.\n"
                f"Another process is bound to {host}:{port}. "
                f"Either stop it, or pick a different port with --port <N>.",
                err=True,
            )
            raise SystemExit(1) from None
        raise


if __name__ == "__main__":
    main()
