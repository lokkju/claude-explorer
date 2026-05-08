"""P4.1 — `GET /api/conversations/{uuid}/tree` endpoint coverage.

Targets the route registered at ``backend/routers/conversations.py:70``.
Until this file landed, the endpoint had no dedicated test file (only a
single status-only 404 check in ``test_conversations.py``).

Frontend contract clauses asserted (see
``PLANS/2026.05.07-frontend-api-contract.md`` §3):

* ``TREE-200`` — known UUID → 200 with ``{uuid, root_messages, active_path}``.
* ``TREE-404`` — unknown UUID → 404 with ``detail``.
* ``TREE-200-ACTIVE`` — ``active_path[-1]`` equals ``current_leaf_message_uuid``.
* ``TREE-200-NODES`` — every ``MessageNode`` has ``message`` and ``children``.
* ``TREE-200-BRANCHED`` — for branched conversations, ≥1 node has
  ``len(children) > 1``.

Strong assertions per ``CLAUDE-TESTING.md`` §5.3 — exact node IDs, exact
path ordering, exact match counts. Negative-space per §5.4 — inactive
branch UUIDs MUST NOT appear in ``active_path``.

Two additional tests cover load-bearing guards in ``backend/store.py``
that aren't covered by frontend clauses but exist as documented
implementation contracts:

* Self-referential parent-link guard (``store.py:156-162``, ``:195-202``)
  — protects against ``PydanticSerializationError`` and infinite
  recursion. Without a test, a future refactor could regress to a
  ``RecursionError`` (which the route itself catches at ``:79`` and
  converts to 422 — but the guard is meant to prevent that path
  entirely).
* Empty-``chat_messages`` early-return (``store.py:146``).

Spec-driven discipline (``CLAUDE-TESTING.md`` §1): while authoring this
file the only allowed reference docs are ``UX.md`` (none relevant here),
``PLANS/2026.05.07-frontend-api-contract.md`` (TREE clauses),
``PLANS/2026.05.08 BACKEND TEST PLAN.md`` (P4.1 task spec), and the
Pydantic models in ``backend/models.py``. Implementation details from
``backend/store.py`` were consulted only to verify edge-case guards
exist; assertions target the contract, not the impl.
"""

from __future__ import annotations

import json
import uuid as uuid_lib
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from backend.main import app


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------


_CREATED_AT = "2026-05-01T12:00:00Z"


def _msg(
    uuid: str,
    parent: str | None,
    *,
    sender: str = "human",
    text: str = "",
) -> dict[str, Any]:
    """Build a single chat-message dict with explicit values for every field
    the store reads. Per CLAUDE-TESTING.md §5.7, no implicit fallbacks.
    """
    return {
        "uuid": uuid,
        "sender": sender,
        "text": text,
        "content": [{"type": "text", "text": text}] if text else [],
        "created_at": _CREATED_AT,
        "updated_at": _CREATED_AT,
        "parent_message_uuid": parent,
    }


def _branched_conversation() -> tuple[dict[str, Any], dict[str, str]]:
    """Build a 6-message branched conversation.

    Tree shape::

        m_root (parent=None)
        └── m_a (parent=m_root)
            ├── m_b1 (parent=m_a)              ← inactive branch
            │   └── m_c1 (parent=m_b1)
            └── m_b2 (parent=m_a)              ← active branch
                └── m_c2 (parent=m_b2)         ← current_leaf_message_uuid

    Expected ``active_path`` (root → leaf): ``[m_root, m_a, m_b2, m_c2]``.

    Returns:
        (conversation_dict, uuids_dict) — ``uuids_dict`` maps the symbolic
        names above to their generated UUID strings so tests can assert
        without re-generating UUIDs themselves.
    """
    conv_uuid = str(uuid_lib.uuid4())
    m_root = str(uuid_lib.uuid4())
    m_a = str(uuid_lib.uuid4())
    m_b1 = str(uuid_lib.uuid4())
    m_b2 = str(uuid_lib.uuid4())
    m_c1 = str(uuid_lib.uuid4())
    m_c2 = str(uuid_lib.uuid4())

    # IMPORTANT: ordering inside ``chat_messages`` controls BFS child order
    # in ``build_message_tree`` (the BFS appends children in their iteration
    # order). To pin the contract that ``children`` reflects insertion
    # order we list the inactive branch (b1, c1) BEFORE the active branch
    # (b2, c2).
    chat_messages = [
        _msg(m_root, None, sender="human", text="Root prompt body"),
        _msg(m_a, m_root, sender="assistant", text="Assistant reply A"),
        _msg(m_b1, m_a, sender="human", text="Inactive branch B1"),
        _msg(m_c1, m_b1, sender="assistant", text="Inactive branch C1"),
        _msg(m_b2, m_a, sender="human", text="Active branch B2"),
        _msg(m_c2, m_b2, sender="assistant", text="Active leaf C2"),
    ]

    conversation = {
        "uuid": conv_uuid,
        "name": "Branched conversation fixture",
        "summary": "P4.1 tree-endpoint fixture",
        "model": "claude-sonnet-4-6",
        "created_at": _CREATED_AT,
        "updated_at": _CREATED_AT,
        "is_starred": False,
        "is_temporary": False,
        "source": "CLAUDE_AI",
        "current_leaf_message_uuid": m_c2,
        "chat_messages": chat_messages,
    }

    return conversation, {
        "conv": conv_uuid,
        "root": m_root,
        "a": m_a,
        "b1": m_b1,
        "b2": m_b2,
        "c1": m_c1,
        "c2": m_c2,
    }


def _write_conversation(data_dir: Path, conv: dict[str, Any]) -> None:
    """Write a conversation JSON into the legacy flat layout.

    The store's ``_get_conversation_files`` discovers
    ``<data_dir>/<uuid>.json`` files when the ``by-org/.migrated_v2``
    sentinel is absent (which it is in our isolated tmp dirs).
    Filename must match ``[0-9a-f-]{36}\\.json`` per
    ``backend/store.py:_UUID_FILENAME_RE``.
    """
    (data_dir / f"{conv['uuid']}.json").write_text(json.dumps(conv))


# ---------------------------------------------------------------------------
# Tree-shape extraction helper (per Python expert review, Disagreement 2)
# ---------------------------------------------------------------------------


def _extract_tree_shape(nodes: list[dict[str, Any]]) -> dict[str, Any]:
    """Flatten a ``root_messages`` array to a nested dict of UUIDs.

    For the fixture tree above this returns::

        {
            m_root: {
                m_a: {
                    m_b1: {m_c1: {}},
                    m_b2: {m_c2: {}},
                },
            },
        }

    Used by the structural test to drop ``children[0].children[0]...``
    chains and rely on pytest's diff for nested-dict ``==`` failures —
    the failure message points to the exact branch that diverged.
    """
    return {
        n["message"]["uuid"]: _extract_tree_shape(n["children"])
        for n in nodes
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test__get_conversations_tree__known_uuid__returns_200_with_tree_envelope(
    isolated_data_dir: Path,
) -> None:
    """TREE-200, TREE-200-NODES.

    Known UUID → 200 with body matching the ``ConversationTree`` envelope.
    Every node in the tree carries ``message`` and ``children`` fields.
    Also pins ``message.text`` echo for the root node so this test catches
    Pydantic serialization regressions on nested fields (per
    ``CLAUDE-TESTING.md`` §5.3 — "field exists" is a weak assertion;
    assert on a known fixture value).
    """
    conv, uuids = _branched_conversation()
    _write_conversation(isolated_data_dir, conv)

    client = TestClient(app)
    response = client.get(f"/api/conversations/{uuids['conv']}/tree")

    assert response.status_code == 200, response.text
    body = response.json()

    # Envelope shape — exactly these three top-level keys.
    assert set(body.keys()) == {"uuid", "root_messages", "active_path"}, (
        f"unexpected envelope keys: {sorted(body.keys())}"
    )
    assert body["uuid"] == uuids["conv"]
    assert isinstance(body["root_messages"], list)
    assert isinstance(body["active_path"], list)
    assert len(body["root_messages"]) == 1, (
        "branched fixture has exactly one root (m_root); got "
        f"{len(body['root_messages'])}"
    )

    # TREE-200-NODES: every node has `message` and `children`. Walk the
    # whole tree to prove the contract recursively, not just at the root.
    def _check_node(node: dict[str, Any]) -> None:
        assert set(["message", "children"]).issubset(node.keys()), (
            f"node missing required keys: {sorted(node.keys())}"
        )
        assert isinstance(node["children"], list)
        # Message envelope — at minimum must have uuid + sender + text.
        msg = node["message"]
        assert "uuid" in msg and "sender" in msg and "text" in msg
        for child in node["children"]:
            _check_node(child)

    for root in body["root_messages"]:
        _check_node(root)

    # Pydantic-serialization smoke test: text + sender of the root node
    # must echo what we wrote to disk. This catches regressions where
    # Pydantic instantiates an empty Message instead of the populated one.
    root_node = body["root_messages"][0]
    assert root_node["message"]["uuid"] == uuids["root"]
    assert root_node["message"]["text"] == "Root prompt body"
    assert root_node["message"]["sender"] == "human"


def test__get_conversations_tree__branched_conversation__resolves_parent_links_recursively(
    isolated_data_dir: Path,
) -> None:
    """TREE-200 + TREE-200-NODES (recursive structure).

    Walks the recursive ``MessageNode`` structure and asserts the entire
    tree shape via a single nested-dict equality check. Captures: exact
    UUIDs at each level, exact child counts, and exact insertion ordering
    (b1 before b2, mirroring ``chat_messages`` order).
    """
    conv, uuids = _branched_conversation()
    _write_conversation(isolated_data_dir, conv)

    client = TestClient(app)
    response = client.get(f"/api/conversations/{uuids['conv']}/tree")
    assert response.status_code == 200, response.text
    body = response.json()

    expected_shape = {
        uuids["root"]: {
            uuids["a"]: {
                uuids["b1"]: {uuids["c1"]: {}},  # inactive branch first
                uuids["b2"]: {uuids["c2"]: {}},  # active branch second
            },
        },
    }
    assert _extract_tree_shape(body["root_messages"]) == expected_shape

    # Negative-space (CLAUDE-TESTING.md §5.4): leaf nodes carry strict
    # empty lists, not ``None`` and not ``[<self>]``.
    leaf_c1 = body["root_messages"][0]["children"][0]["children"][0]["children"][0]
    leaf_c2 = body["root_messages"][0]["children"][0]["children"][1]["children"][0]
    assert leaf_c1["children"] == []
    assert leaf_c2["children"] == []
    assert leaf_c1["message"]["uuid"] == uuids["c1"]
    assert leaf_c2["message"]["uuid"] == uuids["c2"]


def test__get_conversations_tree__branched_conversation__has_node_with_multiple_children(
    isolated_data_dir: Path,
) -> None:
    """TREE-200-BRANCHED.

    For a branched conversation, exactly one node (``m_a``) must have
    ``len(children) > 1``. All other nodes must have ``≤1`` children.
    Negative-space: roots ≠ branch points; leaves have zero children.
    """
    conv, uuids = _branched_conversation()
    _write_conversation(isolated_data_dir, conv)

    client = TestClient(app)
    response = client.get(f"/api/conversations/{uuids['conv']}/tree")
    assert response.status_code == 200, response.text
    body = response.json()

    # Walk and count nodes with >1 children.
    def _collect_children_counts(
        nodes: list[dict[str, Any]],
    ) -> list[tuple[str, int]]:
        out: list[tuple[str, int]] = []
        for n in nodes:
            out.append((n["message"]["uuid"], len(n["children"])))
            out.extend(_collect_children_counts(n["children"]))
        return out

    counts = _collect_children_counts(body["root_messages"])

    branch_points = [(u, c) for u, c in counts if c > 1]
    assert len(branch_points) == 1, (
        f"expected exactly 1 branch point (m_a); got {branch_points}"
    )
    assert branch_points[0] == (uuids["a"], 2)

    # All non-branch-point nodes have ≤1 children. The leaves have 0.
    leaf_counts = {u: c for u, c in counts if c == 0}
    assert leaf_counts == {uuids["c1"]: 0, uuids["c2"]: 0}, (
        f"expected exactly two leaves (c1, c2); got {leaf_counts}"
    )


def test__get_conversations_tree__active_leaf__active_path_walks_parent_chain_to_leaf(
    isolated_data_dir: Path,
) -> None:
    """TREE-200-ACTIVE.

    ``active_path`` is the ordered chain root → ... → leaf where
    ``leaf == current_leaf_message_uuid``. For our fixture
    (``current_leaf_message_uuid = m_c2``) the path is exactly
    ``[m_root, m_a, m_b2, m_c2]``.

    Negative-space (§5.4): inactive-branch UUIDs (``m_b1``, ``m_c1``)
    MUST NOT appear in ``active_path`` — that's the whole point of
    branch resolution. A bug that walked the WRONG branch (or returned
    the full flat list) would surface here.
    """
    conv, uuids = _branched_conversation()
    _write_conversation(isolated_data_dir, conv)

    client = TestClient(app)
    response = client.get(f"/api/conversations/{uuids['conv']}/tree")
    assert response.status_code == 200, response.text
    body = response.json()

    expected_path = [uuids["root"], uuids["a"], uuids["b2"], uuids["c2"]]
    assert body["active_path"] == expected_path, (
        "active_path must walk root → leaf along the active branch; "
        f"expected {expected_path}, got {body['active_path']}"
    )

    # active_path[-1] equals current_leaf_message_uuid (TREE-200-ACTIVE
    # restated in the contract's own terms).
    assert body["active_path"][-1] == conv["current_leaf_message_uuid"]
    assert body["active_path"][-1] == uuids["c2"]

    # active_path[0] is a root in root_messages.
    root_uuids = {n["message"]["uuid"] for n in body["root_messages"]}
    assert body["active_path"][0] in root_uuids

    # Negative-space: inactive-branch UUIDs absent.
    assert uuids["b1"] not in body["active_path"]
    assert uuids["c1"] not in body["active_path"]

    # Length is exactly the depth of the active branch (4 nodes).
    assert len(body["active_path"]) == 4


def test__get_conversations_tree__unknown_uuid__returns_404(
    isolated_data_dir: Path,
) -> None:
    """TREE-404.

    Unknown UUID → 404 with a non-empty ``detail`` containing "not
    found". The frontend's ``React Query`` config (``queryClient.ts:9-11``)
    explicitly does NOT retry on 404, so this status is load-bearing.
    """
    # Seed ONE valid conversation so the data dir is not empty — proves
    # we 404 because of UUID mismatch, not because the dir is unreadable.
    conv, _ = _branched_conversation()
    _write_conversation(isolated_data_dir, conv)

    bogus_uuid = "00000000-0000-0000-0000-000000000000"

    client = TestClient(app)
    response = client.get(f"/api/conversations/{bogus_uuid}/tree")

    assert response.status_code == 404, response.text
    body = response.json()
    assert "detail" in body
    assert "not found" in body["detail"].lower()


def test__get_conversations_tree__circular_reference__breaks_cycle_gracefully(
    isolated_data_dir: Path,
) -> None:
    """Regression-prevention — load-bearing guard at ``store.py:156-162``,
    ``:195-202``.

    A message with ``parent_message_uuid == self`` would, without the
    guard, produce a ``MessageNode`` whose ``children`` list contains
    itself — Pydantic raises ``PydanticSerializationError: Circular
    reference detected`` and the route would 500. The guard rewrites
    the link to ``None`` so the message becomes a root.

    The route also has a ``RecursionError → 422`` safety net at line 79;
    if that path fires it means the BFS guard is missing. We assert 200,
    not 422, to pin "the BFS guard runs first."

    Not a frontend-derived clause but the impl explicitly documents
    "Handles circular references safely" — that's a contract worth
    locking in per CLAUDE-TESTING.md §5.7.
    """
    conv_uuid = str(uuid_lib.uuid4())
    m_self = str(uuid_lib.uuid4())  # self-loop
    m_normal = str(uuid_lib.uuid4())  # second root, sane parent=None

    chat_messages = [
        # Self-referential: claims its own UUID as parent. Guard at
        # store.py:161 rewrites this to a root.
        _msg(m_self, m_self, sender="human", text="Self-loop message"),
        _msg(m_normal, None, sender="assistant", text="Sane root message"),
    ]

    conv = {
        "uuid": conv_uuid,
        "name": "Cycle fixture",
        "summary": "",
        "model": "claude-sonnet-4-6",
        "created_at": _CREATED_AT,
        "updated_at": _CREATED_AT,
        "is_starred": False,
        "is_temporary": False,
        "source": "CLAUDE_AI",
        "current_leaf_message_uuid": m_normal,
        "chat_messages": chat_messages,
    }
    _write_conversation(isolated_data_dir, conv)

    client = TestClient(app)
    response = client.get(f"/api/conversations/{conv_uuid}/tree")

    assert response.status_code == 200, (
        f"cycle guard must keep the route at 200 (not 422 or 500); "
        f"got {response.status_code}: {response.text}"
    )
    body = response.json()

    # Both messages surface as roots (the self-loop one because of the
    # guard, the normal one because its real parent is ``None``).
    root_uuids = [n["message"]["uuid"] for n in body["root_messages"]]
    assert sorted(root_uuids) == sorted([m_self, m_normal])

    # Negative-space: the self-loop node MUST NOT contain itself in its
    # children list. This is the bug the guard prevents.
    self_node = next(
        n for n in body["root_messages"] if n["message"]["uuid"] == m_self
    )
    self_child_uuids = [c["message"]["uuid"] for c in self_node["children"]]
    assert m_self not in self_child_uuids, (
        "self-loop guard regression: the message appears in its own "
        f"children list ({self_child_uuids})"
    )


def test__get_conversations_tree__empty_messages__returns_empty_arrays(
    isolated_data_dir: Path,
) -> None:
    """Zero-state edge case — ``store.py:146`` early-return on empty
    ``chat_messages``.

    A conversation with no messages must return 200 with
    ``root_messages: []`` and ``active_path: []`` — not 404, not 500.
    The frontend treats 404 as "conversation gone" but an empty
    conversation is a legitimate state (e.g. just-created via
    force-refetch). Locking the contract in.
    """
    conv_uuid = str(uuid_lib.uuid4())
    conv = {
        "uuid": conv_uuid,
        "name": "Empty conversation",
        "summary": "",
        "model": "claude-sonnet-4-6",
        "created_at": _CREATED_AT,
        "updated_at": _CREATED_AT,
        "is_starred": False,
        "is_temporary": False,
        "source": "CLAUDE_AI",
        "current_leaf_message_uuid": "",
        "chat_messages": [],
    }
    _write_conversation(isolated_data_dir, conv)

    client = TestClient(app)
    response = client.get(f"/api/conversations/{conv_uuid}/tree")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {
        "uuid": conv_uuid,
        "root_messages": [],
        "active_path": [],
    }
