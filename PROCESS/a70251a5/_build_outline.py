"""Phase B: Build outline.jsonl and outline_digest.md for session a70251a5.

Streams results directly to disk using the same internal code paths as
`mcp__claude-sessions__get_session_outline`. Intentionally does NOT return
the data back into the agent's context.
"""

from __future__ import annotations

import json
from pathlib import Path

from backend.store import ConversationStore
from mcp_server.server import _build_outline, _get_db

SESSION_ID = "a70251a5-b932-4b61-aba1-16a70410b98e"
OUT_DIR = Path(
    "/Users/rpeck/Source/claude-desktop-message-exporter/PROCESS/a70251a5"
)
JSONL = OUT_DIR / "outline.jsonl"
DIGEST = OUT_DIR / "outline_digest.md"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    store = ConversationStore()
    conv = store.get_conversation(SESSION_ID)
    if conv is None:
        raise SystemExit(f"Session {SESSION_ID} not found")

    conn = _get_db()
    try:
        rows = _build_outline(conn, conv.uuid, conv)
    finally:
        conn.close()

    # Write JSONL
    with JSONL.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(
                json.dumps(
                    {
                        "pos": r["position"],
                        "message_uuid": r["message_uuid"],
                        "sender": r["sender"],
                        "summary": r["summary"],
                        "char_count": r["char_count"],
                        "tool_count": r["tool_count"],
                        "timestamp": r["timestamp"],
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

    # Aggregate stats
    total = len(rows)
    human = sum(1 for r in rows if r["sender"] == "human")
    assistant = sum(1 for r in rows if r["sender"] == "assistant")
    other = total - human - assistant
    with_tools = sum(1 for r in rows if (r.get("tool_count") or 0) > 0)
    missing_summary = sum(
        1 for r in rows if not (r.get("summary") or "").strip()
    )
    timestamps = [r["timestamp"] for r in rows if r.get("timestamp")]
    first_ts = min(timestamps) if timestamps else ""
    last_ts = max(timestamps) if timestamps else ""
    first_date = first_ts[:10] if first_ts else "?"
    last_date = last_ts[:10] if last_ts else "?"

    # Build digest. Stride over all human messages (per spec), but also
    # provide a secondary scan restricted to humans with actual text content
    # (filtering out Claude Code tool_result "humans") so Phase C has
    # something useful to read.
    digest_entries_all: list[str] = []
    digest_entries_text: list[str] = []

    def _format_entry(r: dict) -> str:
        pos = r["position"]
        uuid = r["message_uuid"]
        ts = r.get("timestamp") or ""
        date = ts[:10] if ts else "?"
        summary = (r.get("summary") or "").strip()
        if not summary:
            summary = "(no text content \u2014 likely a tool_result message)"
        return (
            f"### pos={pos}  (msg_uuid={uuid}, {date})\n"
            f"> {summary}\n"
        )

    human_seen_all = 0
    human_seen_text = 0
    for r in rows:
        if r["sender"] != "human":
            continue
        if human_seen_all % 100 == 0:
            digest_entries_all.append(_format_entry(r))
        human_seen_all += 1
        if (r.get("summary") or "").strip():
            if human_seen_text % 100 == 0:
                digest_entries_text.append(_format_entry(r))
            human_seen_text += 1

    human_text = sum(
        1
        for r in rows
        if r["sender"] == "human" and (r.get("summary") or "").strip()
    )

    digest_lines: list[str] = []
    digest_lines.append("# Outline Digest \u2014 session a70251a5\u2026\n")
    digest_lines.append(f"- Total messages on active branch: {total}")
    digest_lines.append(f"- Human messages: {human}")
    digest_lines.append(
        f"  - Of which have non-empty text summary: {human_text} "
        f"(the rest are Claude Code tool_result messages recorded as sender=human)"
    )
    digest_lines.append(f"- Assistant messages: {assistant}")
    if other:
        digest_lines.append(f"- Other-sender messages: {other}")
    digest_lines.append(f"- Date span: {first_date} \u2192 {last_date}")
    digest_lines.append(f"- Messages with tool calls: {with_tools}")
    digest_lines.append(f"- Messages with empty summary: {missing_summary}")
    digest_lines.append("")
    digest_lines.append(
        "Note: session metadata reports 5207 total messages; the active branch "
        "has 5006. The 201 extra live on inactive branches (has_branches=True)."
    )
    digest_lines.append("")
    digest_lines.append("---")
    digest_lines.append("")
    digest_lines.append("## Scan: every 100th human message (as specified)")
    digest_lines.append("")
    digest_lines.extend(digest_entries_all)
    digest_lines.append("")
    digest_lines.append("---")
    digest_lines.append("")
    digest_lines.append(
        "## Scan: every 100th *text-bearing* human message (more useful for Phase C)"
    )
    digest_lines.append("")
    digest_lines.extend(digest_entries_text)

    DIGEST.write_text("\n".join(digest_lines), encoding="utf-8")

    # Print a short console line only (for Phase B logs); no full dump.
    print(
        f"wrote {total} rows; human={human} assistant={assistant} "
        f"tool_msgs={with_tools} missing_summary={missing_summary} "
        f"span={first_date}->{last_date}"
    )


if __name__ == "__main__":
    main()
