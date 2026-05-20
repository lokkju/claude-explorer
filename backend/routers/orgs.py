"""``/api/orgs`` endpoint — workspace selector source.

cowork-multi-org C6 / Council P1-2 + NEW-P0-C: the sidebar's workspace
selector reads from credentials.json (always known *before* any conversation
is fetched) rather than from ``useConversations({}).data`` (which would force
a 5-10k row reduction every render and flip set membership during streaming
SSE fetches).

Three-state response:

* ``200 {authenticated: true, orgs: [...]}`` — creds present + parseable.
* ``200 {authenticated: false, orgs: []}`` — creds file absent. Returns 200
  rather than 404 so the frontend's global ApiError toast doesn't fire.
* ``500 {error: "credentials_corrupt", detail: ...}`` — creds present but
  unreadable; the user needs to wipe and recapture.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from fetcher.credentials import (
    CredentialsCorruptError,
    DEFAULT_CREDENTIALS_PATH,
    load_credentials,
)

from ..models import Org, OrgsResponse


log = logging.getLogger(__name__)

router = APIRouter()


# Synthetic "_claude_code" pseudo-org is filtered out — it's a source, not
# a tenant (P1-1 orthogonality). No real claude.ai org id starts with an
# underscore.
def _is_synthetic(uuid: str) -> bool:
    return uuid.startswith("_")


@router.get("/orgs", response_model=OrgsResponse)
def get_orgs() -> OrgsResponse:
    """Return the list of workspaces available to the user.

    See module docstring for the three-state response shape. Returns
    a typed ``OrgsResponse`` (Task B Pydantic↔TS drift audit, 2026-05-18)
    so the OpenAPI schema documents the wire shape and the frontend
    ``OrgsResponse`` interface in ``lib/types.ts`` has a Pydantic
    counterpart that catches future drift.
    """
    if not DEFAULT_CREDENTIALS_PATH.exists():
        return OrgsResponse(authenticated=False, orgs=[])

    try:
        creds = load_credentials(DEFAULT_CREDENTIALS_PATH)
    except CredentialsCorruptError as e:
        log.warning("credentials.json is corrupt: %s", e)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "credentials_corrupt",
                "message": str(e),
            },
        )

    primary = creds.get("primary_org_id")
    out: list[Org] = []
    for org in creds.get("orgs", []):
        uuid = org.get("uuid")
        if not uuid or _is_synthetic(uuid):
            continue
        out.append(Org(
            org_id=uuid,
            name=org.get("name"),
            is_primary=uuid == primary,
        ))
    return OrgsResponse(authenticated=True, orgs=out)
