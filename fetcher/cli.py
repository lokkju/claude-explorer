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


@main.command("reindex-search")
@click.option(
    "--full/--drift",
    default=True,
    help="--full rebuilds from scratch (DROP+rebuild). --drift only re-indexes files whose mtime changed.",
)
def reindex_search(full: bool) -> None:
    """Manually rebuild the SQLite FTS5 search index.

    NOTE: this runs automatically in the background every time
    ``claude-explorer serve`` starts, and the watcher keeps it in sync.
    You should rarely need to invoke this CLI manually — it's a one-shot
    override for cases like:

      * the index file got corrupted (delete it and re-run);
      * you want to verify a fresh build matches your data;
      * you bumped the schema version and want to force a rebuild
        without restarting the server.

    Idempotent: re-runs are cheap because the upsert is a no-op for
    unchanged files (mtime check).
    """
    from backend.search_index import (
        build_full_index,
        get_search_index,
        update_drifted_files,
    )
    from backend.store import ConversationStore

    idx = get_search_index()
    if idx is None:
        raise click.ClickException(
            "FTS5 not available in this sqlite3 build. Search will use "
            "linear-scan fallback. Check your Python install: "
            "`python -c \"import sqlite3; "
            "sqlite3.connect(':memory:').execute('CREATE VIRTUAL TABLE x USING fts5(c)')\"`"
        )

    store = ConversationStore()
    if full:
        click.echo("Wiping index and rebuilding from scratch...")
        idx.clear_all()

        def _progress(i: int, total: int) -> None:
            if i % 50 == 0 or i == total:
                click.echo(f"  [{i}/{total}] conversations indexed")

        files, msgs = build_full_index(store, index=idx, on_progress=_progress)
        click.echo("")
        click.echo(f"Done. Indexed {files} files / {msgs} messages.")
    else:
        click.echo("Drift pass: re-indexing only files whose mtime changed...")
        updated = update_drifted_files(store, index=idx)
        click.echo(f"Done. Re-indexed {updated} file(s).")


_PLACEHOLDER_TEXT = "This block is not supported on your current device yet."


@main.command("rehydrate")
@click.option(
    "--data-dir",
    type=click.Path(path_type=Path, file_okay=False),
    default=Path.home() / ".claude-exporter" / "conversations",
    help="Where conversations live.",
)
@click.option(
    "--credentials",
    type=click.Path(path_type=Path, dir_okay=False),
    default=Path.home() / ".claude-exporter" / "credentials.json",
    help="Path to credentials.json.",
)
@click.option(
    "--limit",
    type=int,
    default=None,
    help="Cap on number of conversations to attempt (default: all).",
)
@click.option(
    "--dry-run",
    is_flag=True,
    help="List candidates without re-fetching.",
)
def rehydrate(
    data_dir: Path,
    credentials: Path,
    limit: int | None,
    dry_run: bool,
) -> None:
    """Re-fetch on-disk Desktop conversations whose tool_use / tool_result
    blocks are stored as the legacy "This block is not supported on your
    current device yet." placeholder string.

    Background: claude.ai's chat_conversations API only returns
    structured tool blocks when ``?render_all_tools=true`` is set. Our
    fetcher has used that flag since 2026-03-09 (commit c94ce6f), but
    conversations fetched BEFORE that date are stuck with the legacy
    placeholder strings. This command finds them and re-fetches with the
    correct flag.

    claude.ai aggressively garbage-collects old Desktop conversations,
    so many candidates will return 404 — those are logged and skipped
    (not retried; the data is upstream-gone).

    Idempotent. Re-runs are cheap because already-rehydrated
    conversations no longer have the placeholder + empty content[]
    pattern that flags them as candidates.
    """
    import json
    import time
    from collections import defaultdict

    from fetcher.bulk_fetch import ClaudeFetcher
    from fetcher.credentials import load_credentials

    click.echo(f"Scanning {data_dir} for placeholder-affected conversations...")

    # Discover the on-disk layout (by-org/<org>/<uuid>.json or flat <uuid>.json).
    by_org_root = data_dir / "by-org"
    if by_org_root.exists():
        candidate_paths = sorted(by_org_root.glob("*/*.json"))
    else:
        candidate_paths = sorted(data_dir.glob("*.json"))

    # Identify candidates: file contains the placeholder string AND no
    # message has populated content[] (meaning the structured blocks are
    # entirely missing, not just nested-as-verbatim-file-content).
    candidates: list[dict] = []
    for path in candidate_paths:
        try:
            raw = path.read_text()
        except OSError:
            continue
        if _PLACEHOLDER_TEXT not in raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        has_structured_content = any(
            (msg.get("content") or [])
            for msg in (data.get("chat_messages") or [])
        )
        if has_structured_content:
            continue
        org_id = data.get("organization_id")
        if not org_id:
            org_id = path.parent.name if by_org_root.exists() else None
        if not org_id:
            click.echo(
                f"  ⚠ {path.name}: cannot determine organization_id; skipping",
                err=True,
            )
            continue
        candidates.append({
            "path": path,
            "uuid": data.get("uuid", path.stem),
            "org_id": org_id,
            "name": data.get("name", "")[:60],
        })

    if limit is not None:
        candidates = candidates[:limit]

    click.echo(f"Found {len(candidates)} candidate conversation(s).")
    if not candidates:
        return
    if dry_run:
        for c in candidates:
            click.echo(
                f"  {c['uuid']} (org {c['org_id'][:8]}) {c['name']!r}"
            )
        return

    # Group by org so we instantiate one ClaudeFetcher per org.
    by_org: dict[str, list[dict]] = defaultdict(list)
    for c in candidates:
        by_org[c["org_id"]].append(c)

    creds = load_credentials(credentials)

    rescued = 0
    upstream_gone = 0
    errors = 0

    for org_id, org_candidates in by_org.items():
        # Build the orgs list for ClaudeFetcher (it requires its own
        # primary_org_id to be one of the entries).
        orgs_for_fetcher = [
            {"uuid": o.get("uuid"), "name": o.get("name")}
            for o in (creds.get("orgs") or [])
        ]
        if org_id not in {o["uuid"] for o in orgs_for_fetcher}:
            # Fallback: synthesize a one-entry list. Matches the on-disk
            # convention; the API only cares about the uuid in the URL.
            orgs_for_fetcher = [{"uuid": org_id, "name": org_id}]

        fetcher = ClaudeFetcher(
            session_key=creds["session_key"],
            orgs=orgs_for_fetcher,
            primary_org_id=org_id,
            output_dir=data_dir,
            cf_bm=creds.get("cf_bm"),
            cf_clearance=creds.get("cf_clearance"),
            verbose=False,
        )

        click.echo(
            f"Re-fetching {len(org_candidates)} candidate(s) for org "
            f"{org_id[:8]}..."
        )
        for c in org_candidates:
            try:
                full = fetcher.fetch_conversation(c["uuid"])
            except Exception as e:  # noqa: BLE001
                errors += 1
                click.echo(
                    f"  ⚠ {c['uuid']} {c['name']!r}: {e}", err=True
                )
                time.sleep(0.3)
                continue
            if full is None:
                upstream_gone += 1
                click.echo(
                    f"  ❌ {c['uuid']} {c['name']!r}: 404 (upstream-gone)"
                )
            else:
                # save_conversation downloads file attachments + injects
                # organization metadata + atomic-writes to by-org/<org>/.
                fetcher.save_conversation(full)
                rescued += 1
                click.echo(
                    f"  ✅ {c['uuid']} {c['name']!r}: rehydrated"
                )
            time.sleep(0.3)

    click.echo("")
    click.echo("Done.")
    click.echo(f"  rescued:        {rescued}")
    click.echo(f"  upstream-gone:  {upstream_gone}")
    click.echo(f"  errors:         {errors}")


@main.command("warm-cc-cache")
@click.option(
    "--limit",
    type=int,
    default=None,
    help="Cap on number of CC sessions to walk (default: all).",
)
def warm_cc_cache(limit: int | None) -> None:
    """Walk every Claude Code session and copy referenced image-cache
    files into ~/.claude-exporter/cc-images/.

    NOTE: this runs automatically in the background every time
    ``claude-explorer serve`` starts. You should rarely need to invoke
    this CLI manually — it's a one-shot override for cases like:
      * you have a long-running launchd-backed watcher but want to
        force a re-walk right now;
      * you fixed a broken JSONL that previously errored out;
      * you're running the CLI on a machine that doesn't run the
        backend (rare).

    Idempotent: re-runs are cheap because copy_marker_image_to_cache
    skips files already in cache.
    """
    from backend.cc_image_cache import warm_all_sessions

    def _print_progress(state: dict) -> None:
        i = state["sessions_walked"]
        total = state["total_sessions"]
        click.echo(
            f"  [{i}/{total}] sessions with cached markers: "
            f"{state['sessions_with_markers']}; files cached: "
            f"{state['files_cached']}"
        )

    state = warm_all_sessions(limit=limit, progress=_print_progress)

    click.echo("")
    click.echo("Done.")
    click.echo(f"  sessions walked:         {state['sessions_walked']}")
    click.echo(f"  sessions with markers:   {state['sessions_with_markers']}")
    click.echo(f"  files cached (incl. dupes): {state['files_cached']}")
    if state["sessions_failed"]:
        click.echo(f"  sessions failed to read: {state['sessions_failed']}", err=True)


_LAUNCHD_LABEL = "com.claude-explorer.cc-watcher"
_LAUNCHD_PLIST_PATH = Path.home() / "Library" / "LaunchAgents" / f"{_LAUNCHD_LABEL}.plist"


def _build_launchd_plist(python_bin: str, scan_interval: float) -> str:
    """Render a macOS launchd plist that runs the CC image watcher
    continuously, independent of `claude-explorer serve`.

    The plist runs a tiny inline script that loops `scan_once()` —
    no FastAPI machinery, just the watcher logic. ``RunAtLoad`` plus
    ``KeepAlive`` means launchd starts it at login and restarts on
    crash. Logs land in `~/Library/Logs/claude-explorer-cc-watcher.{out,err}`.
    """
    log_dir = Path.home() / "Library" / "Logs"
    inline_script = (
        "import time\n"
        "from backend.cc_image_watcher import scan_once\n"
        f"interval = {scan_interval}\n"
        "while True:\n"
        "    try:\n"
        "        scan_once()\n"
        "    except Exception as e:\n"
        "        print('scan failed:', e, flush=True)\n"
        "    time.sleep(interval)\n"
    )
    program_args = [python_bin, "-c", inline_script]
    args_xml = "\n        ".join(f"<string>{_xml_escape(a)}</string>" for a in program_args)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0">\n'
        '<dict>\n'
        '    <key>Label</key>\n'
        f'    <string>{_LAUNCHD_LABEL}</string>\n'
        '    <key>ProgramArguments</key>\n'
        '    <array>\n'
        f'        {args_xml}\n'
        '    </array>\n'
        '    <key>RunAtLoad</key>\n'
        '    <true/>\n'
        '    <key>KeepAlive</key>\n'
        '    <true/>\n'
        '    <key>StandardOutPath</key>\n'
        f'    <string>{log_dir}/claude-explorer-cc-watcher.out</string>\n'
        '    <key>StandardErrorPath</key>\n'
        f'    <string>{log_dir}/claude-explorer-cc-watcher.err</string>\n'
        '    <key>WorkingDirectory</key>\n'
        f'    <string>{Path.cwd()}</string>\n'
        '</dict>\n'
        '</plist>\n'
    )


def _xml_escape(s: str) -> str:
    return (s.replace('&', '&amp;')
             .replace('<', '&lt;')
             .replace('>', '&gt;')
             .replace('"', '&quot;'))


@main.command("install-watcher")
@click.option(
    "--python",
    "python_bin",
    type=click.Path(exists=True, dir_okay=False),
    default=None,
    help="Python interpreter to use (default: this venv's python).",
)
@click.option(
    "--interval",
    type=float,
    default=5.0,
    help="Scan interval in seconds (default: 5; lower = lower latency, higher CPU).",
)
@click.option(
    "--uninstall",
    is_flag=True,
    help="Unload and remove the launchd plist instead of installing.",
)
def install_watcher(python_bin: str | None, interval: float, uninstall: bool) -> None:
    """Install (or uninstall) the macOS launchd job that runs the CC
    image-cache watcher continuously, independent of `claude-explorer
    serve`.

    Why: without this, the watcher only runs while the dev server is
    up. Quitting the server (or never starting it) leaves Claude Code
    free to rotate images off disk before any reader has cached them
    — permanent data loss. The launchd job runs at login and stays up
    on crashes.

    Logs:
      ~/Library/Logs/claude-explorer-cc-watcher.out
      ~/Library/Logs/claude-explorer-cc-watcher.err

    Plist location:
      ~/Library/LaunchAgents/com.claude-explorer.cc-watcher.plist
    """
    import sys as _sys

    if uninstall:
        # launchctl unload (safe even if not loaded; ignore errors)
        if _LAUNCHD_PLIST_PATH.exists():
            subprocess.run(
                ["launchctl", "unload", str(_LAUNCHD_PLIST_PATH)],
                check=False,
                capture_output=True,
            )
            _LAUNCHD_PLIST_PATH.unlink()
            click.echo(f"Removed {_LAUNCHD_PLIST_PATH}")
        else:
            click.echo(f"Not installed: {_LAUNCHD_PLIST_PATH} does not exist")
        return

    if _sys.platform != "darwin":
        raise click.ClickException(
            "install-watcher is macOS-only (uses launchd). "
            "On Linux, run the watcher inside a systemd service instead."
        )

    if python_bin is None:
        python_bin = _sys.executable

    plist_body = _build_launchd_plist(python_bin, interval)
    _LAUNCHD_PLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    _LAUNCHD_PLIST_PATH.write_text(plist_body)
    click.echo(f"Wrote {_LAUNCHD_PLIST_PATH}")

    # Reload to pick up changes if already loaded.
    subprocess.run(
        ["launchctl", "unload", str(_LAUNCHD_PLIST_PATH)],
        check=False,
        capture_output=True,
    )
    result = subprocess.run(
        ["launchctl", "load", str(_LAUNCHD_PLIST_PATH)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise click.ClickException(
            f"launchctl load failed: {result.stderr.strip() or result.stdout.strip()}"
        )

    click.echo("")
    click.echo("Watcher installed and loaded.")
    click.echo(f"  interval:  {interval}s")
    click.echo(f"  python:    {python_bin}")
    click.echo(f"  cwd:       {Path.cwd()}")
    click.echo(f"  stdout:    ~/Library/Logs/claude-explorer-cc-watcher.out")
    click.echo(f"  stderr:    ~/Library/Logs/claude-explorer-cc-watcher.err")
    click.echo("")
    click.echo("Verify with: launchctl list | grep claude-explorer")
    click.echo(f"Uninstall:   {_sys.argv[0]} install-watcher --uninstall")


if __name__ == "__main__":
    main()
