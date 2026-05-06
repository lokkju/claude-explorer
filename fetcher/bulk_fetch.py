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
import logging
import random
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterator

import click
from curl_cffi import requests as curl_requests
from curl_cffi.requests.errors import RequestsError


logger = logging.getLogger(__name__)


# Default paths
DEFAULT_CREDENTIALS_PATH = Path.home() / ".claude-exporter" / "credentials.json"
DEFAULT_OUTPUT_DIR = Path.home() / ".claude-exporter" / "conversations"
DEFAULT_FILES_DIR = Path.home() / ".claude-exporter" / "files"

# Claude API base URL
API_BASE = "https://claude.ai/api"
WEB_BASE = "https://claude.ai"

# Request settings
DEFAULT_DELAY = 0.3
REQUEST_TIMEOUT = 30.0


# ---------------------------------------------------------------------------
# Bug A: Transient-error retry layer.
#
# A first-of-process call to claude.ai through curl_cffi can fail with
# a TLS handshake error (libcurl code 35) because the TLS context has
# not been warmed yet. Cloudflare's edge also occasionally returns 5xx
# during deploys. Both classes of failure recover on the very next call.
#
# We classify upstream errors into three domain exceptions so the SSE
# router can decide what to do without importing curl_cffi types.
# ---------------------------------------------------------------------------

# libcurl numeric codes we treat as transient.
#   7  CURLE_COULDNT_CONNECT
#   28 CURLE_OPERATION_TIMEDOUT
#   35 CURLE_SSL_CONNECT_ERROR  (the cold-start case the user hit)
#   52 CURLE_GOT_NOTHING
#   55 CURLE_SEND_ERROR
#   56 CURLE_RECV_ERROR
#   5  CURLE_COULDNT_RESOLVE_PROXY (DNS / proxy failure during transient outage)
#   6  CURLE_COULDNT_RESOLVE_HOST  (network down during fetch)
TRANSIENT_CURL_CODES: frozenset[int] = frozenset({5, 6, 7, 28, 35, 52, 55, 56})

# HTTP statuses we treat as transient (will retry).
TRANSIENT_HTTP_STATUSES: frozenset[int] = frozenset({502, 503, 504})

# HTTP statuses that mean the credentials are no longer valid. Never
# retry these — surface immediately so the SSE pipeline can launch
# capture once.
AUTH_HTTP_STATUSES: frozenset[int] = frozenset({401, 403})


class FetchError(Exception):
    """Base class for all domain errors raised by the fetcher."""


class FetchAuthError(FetchError):
    """Credentials are invalid / blocked. The router should run capture."""


class FetchTransientError(FetchError):
    """Transient transport-layer failure (TLS, connection, 5xx).

    Wraps the underlying exception in `__cause__`. Raised after retry
    attempts have been exhausted, OR raised directly when the caller
    asked us not to retry but the failure was still transient.
    """


class FetchTerminalError(FetchError):
    """Anything else — unrecoverable. The router emits a sticky toast."""


class TransientHTTPError(Exception):
    """Sentinel raised inside _get when status_code is in TRANSIENT_HTTP_STATUSES.

    Internal to the retry layer; we never let it leak past `with_retry`.
    """

    def __init__(self, status: int, msg: str = "") -> None:
        super().__init__(f"HTTP {status} {msg}".strip())
        self.status = status


def _retry_sleep(seconds: float) -> None:
    """Indirection so tests can patch sleep without touching time.sleep globally."""
    time.sleep(seconds)


def _jittered_backoff(base_delay: float, attempt: int) -> float:
    """Exponential backoff with ±20% jitter."""
    delay = base_delay * (3 ** (attempt - 1))
    jitter = delay * 0.2
    return max(0.0, delay + random.uniform(-jitter, jitter))


def _classify_http_error(exc: BaseException) -> type[FetchError] | None:
    """Inspect a `raise_for_status()`-style HTTPError and pick a domain class.

    Returns None if the exception isn't an HTTP-status failure we recognize.
    The caller is responsible for handling the None case.
    """
    response = getattr(exc, "response", None)
    if response is None:
        return None
    status = getattr(response, "status_code", None)
    if status is None:
        return None
    if status in AUTH_HTTP_STATUSES:
        return FetchAuthError
    if status in TRANSIENT_HTTP_STATUSES:
        return FetchTransientError
    if 400 <= status < 500:
        return FetchTerminalError
    if 500 <= status < 600:
        return FetchTransientError
    return None


def with_retry(
    fn: Callable,
    *,
    max_attempts: int = 3,
    base_delay: float = 0.25,
    on_retry: Callable[[int, int, Exception], None] | None = None,
):
    """Run `fn`, retrying on transient transport errors.

    Transient set:
      - curl_cffi RequestsError with code in TRANSIENT_CURL_CODES.
      - TransientHTTPError raised by the caller for 5xx responses.

    Non-transient errors are mapped to a domain exception and re-raised
    immediately:
      - 401/403 (or the cf-mitigated marker) -> FetchAuthError.
      - Other 4xx -> FetchTerminalError.
      - Anything else -> propagated as-is.

    If retries are exhausted, the final transient error is re-raised as
    `FetchTransientError`. The original exception is set as __cause__.
    """
    last_exc: BaseException | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except RequestsError as exc:
            code = getattr(exc, "code", None)
            if code in TRANSIENT_CURL_CODES and attempt < max_attempts:
                if on_retry:
                    on_retry(attempt, max_attempts, exc)
                _retry_sleep(_jittered_backoff(base_delay, attempt))
                last_exc = exc
                continue
            if code in TRANSIENT_CURL_CODES:
                # Exhausted: wrap into FetchTransientError so the router
                # doesn't have to import curl_cffi types.
                raise FetchTransientError(
                    f"Transport error after {max_attempts} attempts: {exc}"
                ) from exc
            # Non-transient curl error: re-raise as terminal.
            raise FetchTerminalError(str(exc)) from exc
        except TransientHTTPError as exc:
            if attempt < max_attempts:
                if on_retry:
                    on_retry(attempt, max_attempts, exc)
                _retry_sleep(_jittered_backoff(base_delay, attempt))
                last_exc = exc
                continue
            raise FetchTransientError(
                f"HTTP {exc.status} after {max_attempts} attempts"
            ) from exc
        except FetchError:
            # Already classified (e.g. by the caller); re-raise as-is.
            raise
        except Exception as exc:
            # Catch HTTPError from raise_for_status() and classify by
            # inspecting `.response.status_code`. Everything else is
            # terminal.
            cls = _classify_http_error(exc)
            if cls is FetchTransientError and attempt < max_attempts:
                if on_retry:
                    on_retry(attempt, max_attempts, exc)
                _retry_sleep(_jittered_backoff(base_delay, attempt))
                last_exc = exc
                continue
            if cls is not None:
                raise cls(str(exc)) from exc
            # Heuristic fallback for stringly-typed errors (e.g. tests
            # that raise plain RuntimeError("401 Client Error: ...")).
            msg = str(exc).lower()
            if "401" in msg or "403" in msg or "cf-mitigated" in msg:
                raise FetchAuthError(str(exc)) from exc
            raise FetchTerminalError(str(exc)) from exc
    # Unreachable: every path either returns, retries (continues), or raises.
    raise FetchTransientError(
        f"Retry loop exited without value (last_exc={last_exc})"
    )


class ClaudeFetcher:
    """Fetches conversations from the Claude API.

    Multi-org (cowork-multi-org C3): the fetcher is constructed with a list of
    orgs and a designated primary. ``current_org`` is set to the primary by
    default; later commits (C5) will iterate ``orgs`` in ``run_all_orgs()``,
    flipping ``current_org`` per iteration. In C3 only the primary is fetched
    (``run()`` is single-org); the multi-org loop ships in C5.
    """

    def __init__(
        self,
        session_key: str,
        orgs: list[dict],
        primary_org_id: str,
        output_dir: Path,
        files_dir: Path | None = None,
        delay: float = DEFAULT_DELAY,
        incremental: bool = True,
        verbose: bool = False,
        download_files: bool = True,
        cf_bm: str | None = None,
        cf_clearance: str | None = None,
    ):
        if not orgs:
            raise ValueError("orgs must be a non-empty list")
        org_uuids = {o["uuid"] for o in orgs}
        if primary_org_id not in org_uuids:
            raise ValueError(
                f"primary_org_id {primary_org_id!r} not in orgs ({sorted(org_uuids)})"
            )

        self.session_key = session_key
        self.orgs: list[dict] = list(orgs)
        self.primary_org_id = primary_org_id
        self.current_org: dict = next(o for o in self.orgs if o["uuid"] == primary_org_id)
        self.output_dir = output_dir
        self.files_dir = files_dir or DEFAULT_FILES_DIR
        self.delay = delay
        self.incremental = incremental
        self.verbose = verbose
        self.download_files_flag = download_files

        # Build cookies dict
        self.cookies = {"sessionKey": session_key}
        if cf_bm:
            self.cookies["__cf_bm"] = cf_bm
        if cf_clearance:
            self.cookies["cf_clearance"] = cf_clearance

        # Bug A: SSE layer drains this list after each run_in_executor() to
        # surface "Network hiccup; retrying..." progress events.
        # See refresh_pipeline_stream in backend/routers/fetch.py.
        # NOTE: per CTO decision the drain is post-call, not real-time —
        # WWCMM if user UX feedback indicates the silence is jarring,
        # upgrade to asyncio.Queue + call_soon_threadsafe.
        self.retry_events: list[dict] = []

    @property
    def org_id(self) -> str:
        """Backward-compat shim for callers reading the old scalar attribute.

        Returns the *current* org being fetched (which is the primary in C3
        since run() is still single-org). C5 removes this shim.
        """
        return self.current_org["uuid"]

    def _log(self, message: str) -> None:
        """Print message if verbose mode is on."""
        if self.verbose:
            click.echo(message)

    def _api_url(self, path: str) -> str:
        """Build API URL scoped to the current org being fetched."""
        return f"{API_BASE}/organizations/{self.current_org['uuid']}/{path}"

    def _on_retry(self, attempt: int, max_attempts: int, exc: Exception) -> None:
        """Record a retry event for the SSE layer to drain.

        Also logs at WARNING so backend logs surface transient hiccups.
        """
        message = (
            f"Network hiccup; retrying ({attempt} of {max_attempts - 1})..."
        )
        self.retry_events.append(
            {
                "attempt": attempt,
                "max_attempts": max_attempts,
                "error": str(exc),
                "message": message,
            }
        )
        logger.warning(
            "Transient fetch error (attempt %d/%d): %s",
            attempt,
            max_attempts,
            exc,
        )

    def _get(self, url: str) -> curl_requests.Response:
        """Make a GET request with Chrome impersonation, retrying on transients.

        Maps libcurl transport errors and 5xx responses through the retry
        layer; 4xx (incl. 401/403) is fast-failed via the response's
        `raise_for_status()` path on the caller. We pre-flight 5xx here
        so the retry helper can treat them as transient.
        """

        def _do() -> curl_requests.Response:
            resp = curl_requests.get(
                url,
                cookies=self.cookies,
                impersonate="chrome",
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code in TRANSIENT_HTTP_STATUSES:
                raise TransientHTTPError(resp.status_code, resp.reason or "")
            return resp

        return with_retry(_do, on_retry=self._on_retry)

    def _download_file(self, url: str, dest_path: Path) -> tuple[bool, Path]:
        """Download a file from Claude's servers.

        Returns (success, actual_path) - path may have different extension based on Content-Type.

        Bug A: transparent retry on transient transport errors. Retries do NOT
        emit SSE events for file downloads (best-effort path); they are logged
        at WARNING. Auth/4xx/exhausted-transient still falls through to the
        existing return-False behavior.
        """
        try:
            # Handle relative URLs
            if url.startswith("/"):
                url = f"{WEB_BASE}{url}"

            def _do():
                resp = curl_requests.get(
                    url,
                    cookies=self.cookies,
                    impersonate="chrome",
                    timeout=REQUEST_TIMEOUT * 2,  # Longer timeout for files
                )
                if resp.status_code in TRANSIENT_HTTP_STATUSES:
                    raise TransientHTTPError(resp.status_code, resp.reason or "")
                return resp

            response = with_retry(_do)
            response.raise_for_status()

            # Determine correct extension from Content-Type
            content_type = response.headers.get("content-type", "")
            actual_ext = self._ext_from_content_type(content_type)
            if actual_ext and dest_path.suffix != actual_ext:
                dest_path = dest_path.with_suffix(actual_ext)

            dest_path.parent.mkdir(parents=True, exist_ok=True)
            with open(dest_path, "wb") as f:
                f.write(response.content)

            self._log(f"  Downloaded: {dest_path.name}")
            return True, dest_path
        except Exception as e:
            self._log(f"  Failed to download {url}: {e}")
            return False, dest_path

    def _ext_from_content_type(self, content_type: str) -> str | None:
        """Get file extension from Content-Type header."""
        content_type = content_type.split(";")[0].strip().lower()
        mapping = {
            "image/webp": ".webp",
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/gif": ".gif",
            "application/pdf": ".pdf",
            "image/svg+xml": ".svg",
        }
        return mapping.get(content_type)

    def download_conversation_files(
        self, conversation: dict, conv_uuid: str
    ) -> dict:
        """Download all files from a conversation and update paths."""
        if not self.download_files_flag:
            return conversation

        conv_files_dir = self.files_dir / conv_uuid
        files_downloaded = 0

        for message in conversation.get("chat_messages", []):
            # Process files field (images)
            for file_info in message.get("files", []):
                file_uuid = file_info.get("uuid") or file_info.get("id", "")
                file_name = file_info.get("file_name", f"{file_uuid}.bin")

                if not file_uuid:
                    continue

                file_dir = conv_files_dir / file_uuid

                # Download thumbnail if available
                thumb_url = file_info.get("thumbnail_url")
                if thumb_url:
                    ext = self._guess_extension(thumb_url, file_info.get("file_type"))
                    thumb_path = file_dir / f"thumbnail{ext}"
                    success, actual_path = self._download_file(thumb_url, thumb_path)
                    if success:
                        file_info["local_thumbnail"] = str(actual_path)
                        files_downloaded += 1

                # Download preview/full image if available
                preview_url = file_info.get("preview_url")
                if preview_url:
                    ext = self._guess_extension(preview_url, file_info.get("file_type"))
                    preview_path = file_dir / f"preview{ext}"
                    success, actual_path = self._download_file(preview_url, preview_path)
                    if success:
                        file_info["local_preview"] = str(actual_path)
                        files_downloaded += 1

                # Download original if URL exists
                original_url = file_info.get("original_url") or file_info.get("url")
                if original_url:
                    ext = self._guess_extension(original_url, file_info.get("file_type"))
                    original_path = file_dir / f"original{ext}"
                    success, actual_path = self._download_file(original_url, original_path)
                    if success:
                        file_info["local_original"] = str(actual_path)
                        files_downloaded += 1

                # P4c: Download non-image attachments (PDFs, txt, markdown, etc.).
                # These ship as Message.files[] entries with file_kind='document'
                # and a `document_url` carrying the bytes. The image branches
                # above never see these because thumbnail_url/preview_url are
                # absent for non-image kinds.
                document_url = file_info.get("document_url")
                if document_url:
                    file_name = file_info.get("file_name", "")
                    if file_name and "." in file_name:
                        ext = "." + file_name.rsplit(".", 1)[-1].lower()
                    else:
                        ext = self._guess_extension(document_url, file_info.get("file_type"))
                    doc_path = file_dir / f"document{ext}"
                    success, actual_path = self._download_file(document_url, doc_path)
                    if success:
                        file_info["local_document"] = str(actual_path)
                        files_downloaded += 1

            # Process files_v2 if present (different nested structure)
            for file_info in message.get("files_v2", []):
                file_uuid = (
                    file_info.get("file_uuid")
                    or file_info.get("uuid")
                    or file_info.get("id", "")
                )
                if not file_uuid:
                    continue

                file_dir = conv_files_dir / file_uuid
                file_name = file_info.get("file_name", "")

                # Handle thumbnail_asset (nested structure)
                thumb_asset = file_info.get("thumbnail_asset", {})
                thumb_url = thumb_asset.get("url") if thumb_asset else None
                if thumb_url:
                    ext = self._guess_extension(thumb_url, None)
                    thumb_path = file_dir / f"thumbnail{ext}"
                    success, actual_path = self._download_file(thumb_url, thumb_path)
                    if success:
                        file_info["local_thumbnail"] = str(actual_path)
                        files_downloaded += 1

                # Handle document_asset (PDFs and other documents)
                doc_asset = file_info.get("document_asset", {})
                doc_url = doc_asset.get("url") if doc_asset else None
                if doc_url:
                    # Use original filename extension if available
                    if file_name and "." in file_name:
                        ext = "." + file_name.rsplit(".", 1)[-1].lower()
                    else:
                        ext = self._guess_extension(doc_url, None)
                    doc_path = file_dir / f"document{ext}"
                    success, actual_path = self._download_file(doc_url, doc_path)
                    if success:
                        file_info["local_document"] = str(actual_path)
                        files_downloaded += 1

                # Handle preview_asset if present
                preview_asset = file_info.get("preview_asset", {})
                preview_url = preview_asset.get("url") if preview_asset else None
                if preview_url:
                    ext = self._guess_extension(preview_url, None)
                    preview_path = file_dir / f"preview{ext}"
                    success, actual_path = self._download_file(preview_url, preview_path)
                    if success:
                        file_info["local_preview"] = str(actual_path)
                        files_downloaded += 1

        if files_downloaded > 0:
            click.echo(f"  Downloaded {files_downloaded} file(s)")

        return conversation

    def _guess_extension(self, url: str, file_type: str | None) -> str:
        """Guess file extension from URL or MIME type."""
        # Check URL path for extension
        if "/thumbnail" in url:
            return ".jpg"  # Thumbnails are usually JPEG
        if "." in url.split("/")[-1].split("?")[0]:
            ext = "." + url.split("/")[-1].split("?")[0].split(".")[-1]
            if len(ext) <= 5:  # Reasonable extension length
                return ext

        # Guess from MIME type
        mime_to_ext = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/gif": ".gif",
            "image/webp": ".webp",
            "application/pdf": ".pdf",
        }
        if file_type and file_type in mime_to_ext:
            return mime_to_ext[file_type]

        return ".bin"

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
        # Include query params to get full content including tool calls
        url = self._api_url(f"chat_conversations/{uuid}?tree=True&rendering_mode=messages&render_all_tools=true")
        self._log(f"Fetching conversation {uuid}")

        try:
            response = self._get(url)
            response.raise_for_status()
            return response.json()
        except FetchAuthError:
            click.echo(
                "  Error: Session expired or blocked. Re-run credential capture.",
                err=True,
            )
            raise
        except FetchTransientError:
            # Retry layer already exhausted; bubble up to the SSE pipeline.
            raise
        except Exception as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status == 404:
                click.echo(f"  Warning: Conversation {uuid} not found (404)", err=True)
            elif status == 401 or status == 403:
                click.echo(
                    "  Error: Session expired or blocked. Re-run credential capture.",
                    err=True,
                )
                raise FetchAuthError(str(e)) from e
            elif status == 429:
                click.echo("  Rate limited. Waiting 60 seconds...", err=True)
                time.sleep(60)
                return self.fetch_conversation(uuid)  # Retry
            else:
                click.echo(f"  Error fetching {uuid}: {e}", err=True)
            return None

    def save_conversation(self, conversation: dict) -> None:
        """Save conversation to JSON file, downloading any attached files.

        cowork-multi-org C3: writes to ``output_dir/by-org/<current_org>/<uuid>.json``
        and injects ``organization_id`` + ``organization_name`` into the
        on-disk JSON. If the input dict already has a non-null
        ``organization_id``, it is left intact (re-fetches don't get
        retroactively re-tagged to the current scope).
        """
        uuid = conversation.get("uuid", "unknown")

        # Download files and update conversation with local paths
        conversation = self.download_conversation_files(conversation, uuid)

        # Inject org metadata only if missing — preserves any tag carried
        # by a re-fetched legacy file.
        if "organization_id" not in conversation or conversation["organization_id"] is None:
            conversation["organization_id"] = self.current_org["uuid"]
        if "organization_name" not in conversation or conversation["organization_name"] is None:
            conversation["organization_name"] = self.current_org.get("name")

        org_dir = self.output_dir / "by-org" / self.current_org["uuid"]
        org_dir.mkdir(parents=True, exist_ok=True)
        path = org_dir / f"{uuid}.json"
        with open(path, "w") as f:
            json.dump(conversation, f, indent=2)

        self._log(f"Saved {path}")

    def save_index(
        self,
        conversations: list[dict],
        *,
        status: str = "ok",
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> None:
        """Save the per-run status ledger for the **current org**.

        cowork-multi-org C3 + C5: writes the v2 schema. In single-org runs,
        the ``orgs`` array has one entry. In multi-org runs (``run_all_orgs``),
        each per-org call **merges** into the existing array — entries for
        other orgs are preserved untouched.

        NEW3-P1-C: when ``status != "ok"``, preserves
        ``last_successful_fetched_count`` and ``last_successful_fetched_at``
        from the prior on-disk index for the same org. First-ever-failed
        orgs get ``null`` (NEW4-P1-B), not ``0``.

        Atomicity: tmp + ``os.replace`` ensures crash-mid-write doesn't leave
        a torn ``_index.json`` (NEW-P1-L).
        """
        import os

        org_uuid = self.current_org["uuid"]
        org_name = self.current_org.get("name")
        now_iso = datetime.now(timezone.utc).isoformat()
        fetched_count = len(conversations) if status == "ok" else 0

        # Read prior index to (a) preserve last_successful_* on failure for
        # this org and (b) preserve other orgs' entries (multi-org merge).
        prior_orgs: dict[str, dict] = {}
        index_path = self.output_dir / "_index.json"
        if index_path.exists():
            try:
                with open(index_path) as f:
                    prior = json.load(f)
                if prior.get("schema_version") == 2:
                    for entry in prior.get("orgs", []):
                        if isinstance(entry, dict) and entry.get("org_id"):
                            prior_orgs[entry["org_id"]] = entry
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("Could not read prior _index.json: %s", e)

        prior_for_org = prior_orgs.get(org_uuid, {})
        if status == "ok":
            last_success_count = fetched_count
            last_success_at = now_iso
        else:
            # Preserve from prior — None on first-ever-failed (NEW4-P1-B).
            last_success_count = prior_for_org.get("last_successful_fetched_count")
            last_success_at = prior_for_org.get("last_successful_fetched_at")

        org_entry = {
            "org_id": org_uuid,
            "name": org_name,
            "status": status,
            "fetched_count": fetched_count,
            "last_successful_fetched_count": last_success_count,
            "last_successful_fetched_at": last_success_at,
            "skipped_count": 0,
            "error_code": error_code,
            "error_message": error_message,
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

        # Multi-org merge: replace this org's entry, preserve the rest.
        merged_orgs: dict[str, dict] = dict(prior_orgs)
        merged_orgs[org_uuid] = org_entry

        index = {
            "schema_version": 2,
            "fetched_at": now_iso,
            "orgs": list(merged_orgs.values()),
            # Legacy mirror — primary org id at top level for one minor
            # version. Removed in the version after.
            "org_id": self.primary_org_id,
        }

        # Atomic write (tmp + os.replace) — NEW-P1-L. ``status: ok`` is only
        # written here AFTER all conversations have already been persisted
        # by the caller (run_all_orgs), so a crash mid-org leaves the prior
        # entry intact rather than promoting to a fake 'ok'.
        self.output_dir.mkdir(parents=True, exist_ok=True)
        tmp = index_path.with_suffix(".json.tmp")
        with open(tmp, "w") as f:
            json.dump(index, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, index_path)

        self._log(f"Saved index to {index_path}")

    def existing_uuids_for_current_org(self) -> set[str]:
        """UUIDs of conversations already on disk under the current org's subdir.

        cowork-multi-org C3: per-org dedup uses the by-org/<current_org>/
        subdir only; conversations under other orgs do not block this org's
        fetch. C5's run_all_orgs() instead uses ``existing_pairs()`` for
        cross-org dedup, but this helper remains for single-org callers.
        """
        org_dir = self.output_dir / "by-org" / self.current_org["uuid"]
        if not org_dir.exists():
            return set()
        return {p.stem for p in org_dir.glob("*.json")}

    def existing_pairs(self) -> set[tuple[str, str]]:
        """All ``(org_id, uuid)`` pairs currently on disk.

        cowork-multi-org C5 (NEW2-P1-η): cross-org dedup is by
        ``(org_id, uuid)`` rather than UUID-only. The same conversation UUID
        appearing in two orgs (rare but possible per Council P0-2 — shared
        conversations across tenants) yields TWO files at
        ``by-org/A/X.json`` and ``by-org/B/X.json``; one must not shadow the
        other.
        """
        by_org = self.output_dir / "by-org"
        if not by_org.exists():
            return set()
        pairs: set[tuple[str, str]] = set()
        for p in by_org.glob("*/*.json"):
            pairs.add((p.parent.name, p.stem))
        return pairs

    @contextmanager
    def _scoped_org(self, org: dict) -> Iterator[None]:
        """Temporarily switch ``current_org`` and restore on exit.

        Used by :meth:`run_all_orgs` so a failure in one org doesn't leave
        the fetcher pointing at a stale org afterward (Python Expert
        recommendation, C5).
        """
        prev = self.current_org
        self.current_org = org
        try:
            yield
        finally:
            self.current_org = prev

    def run(self, limit: int | None = None) -> None:
        """Run the full fetch process."""
        # Ensure output directory exists
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Get existing UUIDs if incremental — scoped to current org's subdir.
        existing_uuids = set()
        if self.incremental:
            existing_uuids = self.existing_uuids_for_current_org()
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

    # ----------------------------------------------------------------- C5
    # Multi-org loop
    # ------------------------------------------------------------------

    def run_all_orgs(
        self,
        limit: int | None = None,
        on_event: Callable[[dict], None] | None = None,
    ) -> dict:
        """Iterate every org in ``self.orgs`` and fetch each.

        Behavior summary (cowork-multi-org C5):

        * Per org: fetch_conversation_list, then fetch_conversation+save for
          each new conversation (cross-org dedup via ``existing_pairs``).
        * Per-org status recorded in ``_index.json`` AFTER every conversation
          for that org has been persisted (NEW-P1-L atomicity).
        * **Primary 401**: hard abort the whole run (genuine session expiry).
        * **Primary 403/404**: log a warning, continue with the next org as
          best-effort. Auto-demote (clears primary_org_id, persists via
          credentials.update_primary_org_and_save) is invoked so the next
          run sees the new primary. NO_ACCESSIBLE_ORGS guardrail (NEW2-P1-γ)
          surfaces a special status when ALL orgs fail.
        * **Secondary 403/404**: ``status: skipped``, continue.
        * **Other failures per org**: ``status: failed``, continue.

        Heartbeats during long backoffs (NEW2-P0-ε) are deferred to a
        follow-up commit; a placeholder ``on_event`` callback receives every
        per-org event so the SSE wrapper can already pipe them into its
        stream and gain heartbeats later without changing the call site.

        Returns a summary dict ``{"orgs": [...], "primary_demoted_from":
        ..., "status": ...}`` for the SSE wrapper to use.
        """
        self.output_dir.mkdir(parents=True, exist_ok=True)
        existing_pairs = self.existing_pairs() if self.incremental else set()

        results: list[dict] = []
        primary_demoted_from: str | None = None

        for org in list(self.orgs):
            org_uuid = org["uuid"]
            org_name = org.get("name") or org_uuid[:8]
            is_primary = (org_uuid == self.primary_org_id)

            if on_event:
                on_event({"type": "org_start", "org_id": org_uuid, "name": org_name})

            try:
                with self._scoped_org(org):
                    convs_list = self.fetch_conversation_list()
                    if limit:
                        convs_list = convs_list[:limit]

                    if self.incremental:
                        to_fetch = [
                            c for c in convs_list
                            if (org_uuid, c.get("uuid", "")) not in existing_pairs
                        ]
                    else:
                        to_fetch = convs_list

                    fetched_convs: list[dict] = []
                    for i, conv in enumerate(to_fetch, 1):
                        uuid = conv.get("uuid", "")
                        if not uuid:
                            continue
                        full = self.fetch_conversation(uuid)
                        if full:
                            self.save_conversation(full)
                            fetched_convs.append(full)
                            existing_pairs.add((org_uuid, uuid))
                        if i < len(to_fetch):
                            time.sleep(self.delay)

                    # Status: ok recorded ONLY after every conversation for
                    # this org has been persisted.
                    self.save_index(convs_list, status="ok")
                    results.append({
                        "org_id": org_uuid,
                        "name": org_name,
                        "status": "ok",
                        "fetched_count": len(fetched_convs),
                        "total_in_list": len(convs_list),
                    })
                    if on_event:
                        on_event({
                            "type": "org_done",
                            "org_id": org_uuid,
                            "status": "ok",
                            "fetched_count": len(fetched_convs),
                        })

            except FetchAuthError as e:
                msg = str(e)
                is_401 = "401" in msg
                is_skip = ("403" in msg) or ("404" in msg)

                if is_primary and is_401:
                    # Hard abort. Record nothing; let the existing _index.json
                    # entries survive untouched.
                    raise

                # Secondary 403/404, OR primary 403/404 (auto-demote path).
                error_code = "HTTP_401" if is_401 else ("HTTP_403" if "403" in msg else "HTTP_404")
                with self._scoped_org(org):
                    self.save_index([], status="skipped", error_code=error_code, error_message=msg)
                results.append({
                    "org_id": org_uuid,
                    "name": org_name,
                    "status": "skipped",
                    "error_code": error_code,
                    "error_message": msg,
                })
                if on_event:
                    on_event({
                        "type": "org_done",
                        "org_id": org_uuid,
                        "status": "skipped",
                        "error_code": error_code,
                    })

                if is_primary and is_skip:
                    # Auto-demote — pick a new primary from the remaining
                    # orgs (NEW-P0-B). Persist via the credentials helper so
                    # the next run sees the new primary.
                    primary_demoted_from = self.primary_org_id
                    new_primary = self._pick_new_primary(exclude=[org_uuid])
                    if new_primary is not None:
                        self.primary_org_id = new_primary
                        self._persist_demote(new_primary)
                        if on_event:
                            on_event({
                                "type": "primary_demoted",
                                "from_org_id": primary_demoted_from,
                                "to_org_id": new_primary,
                                "reason": error_code,
                            })

            except Exception as e:
                # Any other failure: record as failed, continue.
                logger.warning("Org %s failed: %s", org_uuid, e)
                error_code = type(e).__name__
                with self._scoped_org(org):
                    self.save_index([], status="failed", error_code=error_code, error_message=str(e))
                results.append({
                    "org_id": org_uuid,
                    "name": org_name,
                    "status": "failed",
                    "error_code": error_code,
                    "error_message": str(e),
                })
                if on_event:
                    on_event({
                        "type": "org_done",
                        "org_id": org_uuid,
                        "status": "failed",
                        "error_code": error_code,
                    })

        # NO_ACCESSIBLE_ORGS guardrail (NEW2-P1-γ).
        oks = [r for r in results if r["status"] == "ok"]
        if not oks:
            return {
                "orgs": results,
                "primary_demoted_from": primary_demoted_from,
                "status": "NO_ACCESSIBLE_ORGS",
            }

        return {
            "orgs": results,
            "primary_demoted_from": primary_demoted_from,
            "status": "ok",
        }

    def _pick_new_primary(self, exclude: list[str]) -> str | None:
        """Deterministic re-pick after primary auto-demote (NEW-P0-B step 2-4).

        Excludes the demoted org. Returns None if no eligible orgs remain
        (single-org account guardrail).
        """
        candidates = [o for o in self.orgs if o["uuid"] not in exclude]
        if not candidates:
            return None
        chat_capable = [o["uuid"] for o in candidates if "chat" in (o.get("capabilities") or [])]
        if chat_capable:
            return sorted(chat_capable)[0]
        return sorted(o["uuid"] for o in candidates)[0]

    def _persist_demote(self, new_primary: str) -> None:
        """Persist a primary-org demotion to credentials.json.

        We don't hold the session_key on the fetcher (only on the credentials
        file), so we delegate to credentials.update_primary_org_and_save.
        Best-effort: if the credentials path can't be reached, log and
        continue — the in-memory primary_org_id is already updated.
        """
        try:
            from fetcher.credentials import (
                DEFAULT_CREDENTIALS_PATH,
                update_primary_org_and_save,
            )
            update_primary_org_and_save(new_primary, DEFAULT_CREDENTIALS_PATH)
        except Exception as e:
            logger.warning(
                "Could not persist primary-org demotion to credentials: %s", e
            )


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
    "--files-dir",
    type=click.Path(path_type=Path),
    default=DEFAULT_FILES_DIR,
    help="Where to save downloaded files (images, PDFs)",
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
    "--download-files/--no-download-files",
    default=True,
    help="Download attached images/PDFs (default: yes)",
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
    files_dir: Path,
    credentials: Path,
    session_key: str | None,
    org_id: str | None,
    incremental: bool,
    download_files: bool,
    delay: float,
    limit: int | None,
    verbose: bool,
) -> None:
    """Fetch all conversations from Claude Desktop."""
    creds_dict: dict | None = None
    if session_key and org_id:
        # CLI override path. Bootstrap a single-org orgs list.
        orgs = [{"uuid": org_id, "name": None, "capabilities": [], "seen_in_response": False}]
        primary = org_id
        cf_bm = None
        cf_clearance = None
    else:
        creds_dict = load_credentials(credentials)
        session_key = session_key or creds_dict.get("session_key")

        # Multi-org-aware: prefer the orgs array if present (v2 schema).
        # Fall back to the legacy scalar org_id (v1 file) so this code path
        # works during the cowork-multi-org rollout window.
        if "orgs" in creds_dict and creds_dict.get("orgs"):
            orgs = list(creds_dict["orgs"])
            primary = creds_dict.get("primary_org_id") or orgs[0]["uuid"]
        else:
            legacy_id = org_id or creds_dict.get("org_id")
            if not legacy_id:
                raise click.ClickException(
                    "Missing org_id. Run `claude-explorer capture` to refresh credentials."
                )
            orgs = [{"uuid": legacy_id, "name": None, "capabilities": [], "seen_in_response": False}]
            primary = legacy_id

        cf_bm = creds_dict.get("cf_bm")
        cf_clearance = creds_dict.get("cf_clearance")

    if not session_key:
        raise click.ClickException(
            "Missing session_key. Run `claude-explorer capture` first."
        )

    fetcher = ClaudeFetcher(
        session_key=session_key,
        orgs=orgs,
        primary_org_id=primary,
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


if __name__ == "__main__":
    main()
