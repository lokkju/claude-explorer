"""
CLI entry point for claude-exporter.

Usage:
    claude-exporter fetch [OPTIONS]    Fetch conversations from Claude Desktop
    claude-exporter serve [OPTIONS]    Start the web server
"""

import subprocess
from pathlib import Path

import click


@click.group()
@click.version_option(version="0.1.0")
def main():
    """Claude Desktop Message Exporter - Export and browse your Claude conversations."""
    pass


@main.command()
@click.option(
    "--output-dir",
    type=click.Path(path_type=Path),
    default=Path.home() / ".claude-exporter" / "conversations",
    help="Where to save JSON files",
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
@click.option("--delay", type=float, default=0.3, help="Seconds between requests")
@click.option("--limit", type=int, help="Max conversations to fetch")
@click.option("--verbose", is_flag=True, help="Show detailed output")
def fetch(
    output_dir: Path,
    credentials: Path,
    session_key: str | None,
    org_id: str | None,
    incremental: bool,
    delay: float,
    limit: int | None,
    verbose: bool,
):
    """Fetch all conversations from Claude Desktop.

    Requires credentials captured via the mitmproxy addon.
    Run 'claude-exporter capture' first if you haven't yet.
    """
    from fetcher.bulk_fetch import ClaudeFetcher, load_credentials

    # Get credentials
    if session_key and org_id:
        pass
    else:
        creds = load_credentials(credentials)
        session_key = session_key or creds.get("session_key")
        org_id = org_id or creds.get("org_id")

    if not session_key or not org_id:
        raise click.ClickException(
            "Missing credentials. Run 'claude-exporter capture' first."
        )

    fetcher = ClaudeFetcher(
        session_key=session_key,
        org_id=org_id,
        output_dir=output_dir,
        delay=delay,
        incremental=incremental,
        verbose=verbose,
    )

    fetcher.run(limit=limit)


@main.command()
@click.option("--port", default=8080, help="Proxy port (default: 8080)")
def capture(port: int):
    """Start mitmproxy to capture Claude Desktop credentials.

    This will start a proxy server. You need to launch Claude Desktop
    through the proxy to capture your session credentials.

    After running this command:
    1. Open a new terminal
    2. Run: open -a "Claude" --args --proxy-server="127.0.0.1:8080"
    3. Use Claude Desktop normally until credentials are captured
    4. Press 'q' to quit mitmproxy
    """
    addon_path = Path(__file__).parent / "mitmproxy_addon.py"

    click.echo("Starting mitmproxy to capture credentials...")
    click.echo(f"Proxy listening on port {port}")
    click.echo()
    click.echo("In another terminal, launch Claude Desktop through the proxy:")
    click.echo(f'  open -a "Claude" --args --proxy-server="127.0.0.1:{port}"')
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

    uvicorn.run(
        "backend.main:app",
        host=host,
        port=port,
        reload=reload,
    )


if __name__ == "__main__":
    main()
