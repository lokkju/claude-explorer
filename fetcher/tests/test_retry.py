"""Bug A: Retry transient transport errors at the curl_cffi layer.

A first-of-process call to claude.ai may fail with a libcurl TLS handshake
error (code 35) because curl_cffi has not yet warmed its TLS context, or
because Cloudflare's edge briefly returns a 5xx during a deploy. Both are
transient — the very next call succeeds.

This test module pins the contract for `with_retry`, the domain exception
hierarchy, and the integration into `ClaudeFetcher._get` / `_download_file`.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


def test_transient_curl_codes_present() -> None:
    """The set of retried libcurl codes must include the cold-start code 35."""
    from fetcher.bulk_fetch import TRANSIENT_CURL_CODES

    # 7  CURLE_COULDNT_CONNECT
    # 28 CURLE_OPERATION_TIMEDOUT
    # 35 CURLE_SSL_CONNECT_ERROR (the cold-start case the user hit)
    # 52 CURLE_GOT_NOTHING
    # 55 CURLE_SEND_ERROR
    # 56 CURLE_RECV_ERROR
    for code in (7, 28, 35, 52, 55, 56):
        assert code in TRANSIENT_CURL_CODES, f"libcurl code {code} should be transient"


def test_transient_http_statuses_present() -> None:
    from fetcher.bulk_fetch import TRANSIENT_HTTP_STATUSES

    for status in (502, 503, 504):
        assert status in TRANSIENT_HTTP_STATUSES


def test_domain_exceptions_exist() -> None:
    """Three-class hierarchy lives in fetcher.bulk_fetch so routers don't import curl_cffi."""
    from fetcher.bulk_fetch import (
        FetchAuthError,
        FetchError,
        FetchTerminalError,
        FetchTransientError,
    )

    assert issubclass(FetchAuthError, FetchError)
    assert issubclass(FetchTransientError, FetchError)
    assert issubclass(FetchTerminalError, FetchError)


def test_with_retry_returns_value_after_one_transient_failure() -> None:
    """First call raises RequestsError(code=35), second returns the value."""
    from curl_cffi.requests.errors import RequestsError

    from fetcher.bulk_fetch import with_retry

    calls = {"n": 0}

    def fn() -> str:
        calls["n"] += 1
        if calls["n"] == 1:
            raise RequestsError("ssl handshake", code=35)
        return "ok"

    result = with_retry(fn, max_attempts=3, base_delay=0.0)
    assert result == "ok"
    assert calls["n"] == 2


def test_with_retry_exhausts_after_three_5xx() -> None:
    """3 consecutive 5xx → wrapper raises FetchTransientError after 3 attempts."""
    from fetcher.bulk_fetch import (
        FetchTransientError,
        TransientHTTPError,
        with_retry,
    )

    calls = {"n": 0}

    def fn() -> None:
        calls["n"] += 1
        raise TransientHTTPError(503, "Service Unavailable")

    with pytest.raises(FetchTransientError):
        with_retry(fn, max_attempts=3, base_delay=0.0)

    assert calls["n"] == 3, "must attempt exactly max_attempts times"


def test_with_retry_does_not_retry_on_401() -> None:
    """A 401 (auth) must NOT be retried — fast-fail to FetchAuthError."""
    from fetcher.bulk_fetch import FetchAuthError, with_retry

    class FakeResp:
        status_code = 401
        text = "Unauthorized"

    class HTTPError(Exception):
        def __init__(self) -> None:
            super().__init__("401 Client Error: Unauthorized")
            self.response = FakeResp()

    calls = {"n": 0}

    def fn() -> None:
        calls["n"] += 1
        raise HTTPError()

    with pytest.raises(FetchAuthError):
        with_retry(fn, max_attempts=3, base_delay=0.0)

    assert calls["n"] == 1, "401 must fail on the first attempt"


def test_with_retry_does_not_retry_on_arbitrary_4xx() -> None:
    """A 404 (terminal) must NOT be retried — fast-fail to FetchTerminalError."""
    from fetcher.bulk_fetch import FetchTerminalError, with_retry

    class FakeResp:
        status_code = 404
        text = "Not Found"

    class HTTPError(Exception):
        def __init__(self) -> None:
            super().__init__("404 Client Error: Not Found")
            self.response = FakeResp()

    calls = {"n": 0}

    def fn() -> None:
        calls["n"] += 1
        raise HTTPError()

    with pytest.raises(FetchTerminalError):
        with_retry(fn, max_attempts=3, base_delay=0.0)

    assert calls["n"] == 1


def test_with_retry_invokes_on_retry_callback() -> None:
    """The on_retry callback is invoked once per retry, before the sleep."""
    from curl_cffi.requests.errors import RequestsError

    from fetcher.bulk_fetch import with_retry

    calls = {"n": 0}
    retries: list[tuple[int, int, str]] = []

    def fn() -> str:
        calls["n"] += 1
        if calls["n"] < 3:
            raise RequestsError("ssl handshake", code=35)
        return "ok"

    def on_retry(attempt: int, max_attempts: int, exc: Exception) -> None:
        retries.append((attempt, max_attempts, str(exc)))

    result = with_retry(fn, max_attempts=3, base_delay=0.0, on_retry=on_retry)
    assert result == "ok"
    assert len(retries) == 2, f"expected 2 retry callbacks, got {retries}"
    assert retries[0][0] == 1 and retries[0][1] == 3
    assert retries[1][0] == 2 and retries[1][1] == 3


def test_fetcher_get_retries_on_transient_failure(tmp_path: Path) -> None:
    """ClaudeFetcher._get must retry transient curl errors transparently."""
    from curl_cffi.requests.errors import RequestsError

    from fetcher.bulk_fetch import ClaudeFetcher

    fetcher = ClaudeFetcher(
        session_key="sk", org_id="org", output_dir=tmp_path
    )

    calls = {"n": 0}
    ok_response = MagicMock(status_code=200)
    ok_response.json.return_value = []

    def fake_get(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RequestsError("cold start TLS", code=35)
        return ok_response

    # Patch retry sleep to zero so the test is fast.
    with patch("fetcher.bulk_fetch.curl_requests.get", side_effect=fake_get), \
         patch("fetcher.bulk_fetch._retry_sleep", return_value=None):
        resp = fetcher._get("https://claude.ai/api/test")

    assert resp is ok_response
    assert calls["n"] == 2


def test_fetcher_records_retry_events_for_sse(tmp_path: Path) -> None:
    """ClaudeFetcher.retry_events records each transient retry for the SSE layer to drain."""
    from curl_cffi.requests.errors import RequestsError

    from fetcher.bulk_fetch import ClaudeFetcher

    fetcher = ClaudeFetcher(
        session_key="sk", org_id="org", output_dir=tmp_path
    )

    calls = {"n": 0}
    ok_response = MagicMock(status_code=200)
    ok_response.json.return_value = []

    def fake_get(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] < 3:
            raise RequestsError("ssl handshake", code=35)
        return ok_response

    with patch("fetcher.bulk_fetch.curl_requests.get", side_effect=fake_get), \
         patch("fetcher.bulk_fetch._retry_sleep", return_value=None):
        fetcher._get("https://claude.ai/api/test")

    assert len(fetcher.retry_events) == 2
    assert fetcher.retry_events[0]["attempt"] == 1
    assert fetcher.retry_events[0]["max_attempts"] == 3
    assert "hiccup" in fetcher.retry_events[0]["message"].lower() or \
           "retry" in fetcher.retry_events[0]["message"].lower()
