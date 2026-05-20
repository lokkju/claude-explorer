"""
Read Claude Code conversations directly from local JSONL files.

Claude Code (CLI and Desktop Code tab) stores conversations locally at:
    ~/.claude/projects/{project-path-encoded}/{session-uuid}.jsonl

This module reads those JSONL files on-the-fly without copying them.
Features:
- orjson for fast JSON parsing (3-10x faster than stdlib)
- Memory cache with mtime-based invalidation
- Parallel file reading with ThreadPoolExecutor
"""

import hashlib
import inspect
import logging
import os
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
import orjson
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .cache import (
    get_conversation_cache,
    parse_jsonl_fast,
)

logger = logging.getLogger(__name__)

# Default Claude directory
DEFAULT_CLAUDE_DIR = Path.home() / ".claude"


def parse_jsonl_file(path: Path) -> list[dict]:
    """Parse a JSONL file and return all entries.

    Uses orjson for ~5x faster parsing than stdlib json.
    """
    return parse_jsonl_fast(path)


def _parse_datetime(dt_str: str | None) -> datetime:
    """Parse datetime string from Claude's format."""
    if not dt_str:
        return datetime.now(timezone.utc)
    try:
        if dt_str.endswith("Z"):
            dt_str = dt_str[:-1] + "+00:00"
        dt = datetime.fromisoformat(dt_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return datetime.now(timezone.utc)


def _get_message_text(entry: dict) -> str:
    """Extract text content from a message entry."""
    msg = entry.get("message", {})
    content = msg.get("content", "")
    if isinstance(content, str):
        return content
    elif isinstance(content, list):
        text_parts = [b.get("text", "") for b in content if b.get("type") == "text"]
        return " ".join(text_parts)
    return ""


_COMPACT_LOOKAHEAD = 8
_COMPACT_COMMAND_NAME = "<command-name>/compact</command-name>"
_COMPACT_ARGS_RE = re.compile(r"<command-args>(.*?)</command-args>", re.DOTALL)

# Local-command boilerplate collapse (V1 polish, 2026-05-12):
# Claude Code emits a 1-3 row triplet around every slash command:
#   1. <local-command-caveat>Caveat: ...</local-command-caveat>
#   2. <command-name>/foo</command-name><command-args>...</command-args>
#   3. <local-command-stdout>...</local-command-stdout>
# Rows 1 and 3 are pure boilerplate. Row 2 carries the actual command.
# Raw, these dominate the top of any session that started with /exit or /clear.
# We collapse the consecutive run into a single synthetic marker on the FIRST
# row's slot (keeping its uuid for parent_message_uuid bridging) and drop the
# rest. /compact is handled separately by `extract_compact_markers` — we skip
# it here so the two systems don't fight.
#
# Args-preservation extension (V1 polish round 3, 2026-05-12):
# Slash commands like /coding, /plan, /compact, /metaprompt carry the
# USER'S REAL PROMPT inside <command-args>...</command-args>. The original
# collapser threw those args away, leaving an empty "Session: /coding"
# marker bubble — silent data loss of the user's actual message text.
# We now ALSO extract the args body and use it as the marker's `text`
# when non-empty (fallback to "Session: /foo" only when args is empty
# or absent). A separate `slash_command` field carries the command name
# so the frontend can render a small `[/coding]` badge above the body.
#
# REGEX CHOICES:
#   * `_LOCAL_CMD_NAME_RE`: unchanged — name is a non-whitespace, non-`<`
#     token following `<command-name>`. The leading `/` is required.
#   * `_LOCAL_CMD_ARGS_RE`: non-greedy body anchored to a domain-specific
#     trailing-context lookahead. Reads as:
#         <command-args>(.*?)</command-args>(?=\s*(?:<command-name>|$))
#     i.e. capture the shortest body that ends at a `</command-args>`
#     CLOSE TAG which is followed by either (a) the start of the NEXT
#     command triplet `<command-name>`, or (b) end-of-row. This:
#       1) Bug 1 (V1 polish, 2026-05-14): tolerates a literal
#          `<command-name>` SUBSTRING inside the args body (e.g. the user
#          pastes a prompt explaining CC's XML format). The previous
#          tempered-greedy regex `((?:(?!<command-name>).)*)` forbade
#          this and returned None, silently dropping the user's prompt
#          and falling back to the argless marker label.
#       2) Preserves the original user-paste tolerance: a literal
#          `</command-args>` inside the args body is NOT a valid match
#          terminator unless what follows it is `\s*<command-name>` or
#          end-of-row — so a body of `Explain </command-args> means...`
#          inside a wrapper still anchors at the REAL wrapper close at
#          end-of-row.
#       3) Bounds multi-block rows correctly: in a row with two glued
#          triplets `...</command-args><command-name>...</command-name>
#          <command-args>...`, the lookahead matches at the FIRST close
#          (next char is `<command-name>`), so the args body correctly
#          stops at the first block — no over-match across blocks.
#       4) Why anchor on `<command-name>` specifically and not a generic
#          `<|$`? GPT-5.2 (LLM council, 2026-05-14) flagged that a
#          permissive `<|$` lookahead would mis-terminate when the args
#          body itself ends with a literal `</command-args>` immediately
#          before the real wrapper close (`...</command-args></command-args>`
#          shape) — the next char is `<` but it's the wrapper close, not
#          a new triplet. Tying the lookahead to the actual sentinel
#          (`<command-name>`) keeps the parser pinned to the real
#          structural boundary CC emits and avoids that whole class of
#          truncation bugs.
#     Performance: classic non-greedy `(.*?)` plus a fixed-length
#     lookahead. No nested quantifiers ⇒ no catastrophic-backtracking
#     shape. Worst case is O(n·k) where k is the number of candidate
#     close tags that fail the lookahead — fine for typical args bodies
#     of 100–1000 chars.
_LOCAL_CMD_NAME_RE = re.compile(r"<command-name>(/[^<\s]+)", re.DOTALL)
_LOCAL_CMD_ARGS_RE = re.compile(
    r"<command-args>(.*?)</command-args>(?=\s*(?:<command-name>|$))",
    re.DOTALL,
)


def _local_command_kind(text: str) -> str | None:
    """Classify a message-text string as local-command boilerplate.

    Returns one of: 'caveat', 'command', 'stdout', 'stderr', or None.
    The caller uses this to detect adjacent runs that should be collapsed
    into a single marker. Pattern set mirrors `_is_system_message` so the
    two stay in sync; if you add a new pattern there, add it here too.
    """
    if not isinstance(text, str):
        return None
    if text.startswith("<local-command-caveat>") or text.startswith(
        "Caveat: The messages below were generated"
    ):
        return "caveat"
    if text.startswith("<command-name>"):
        return "command"
    if text.startswith("<local-command-stdout>"):
        return "stdout"
    if text.startswith("<local-command-stderr>"):
        return "stderr"
    return None


def _extract_local_command_name(text: str) -> str | None:
    """Pull the `/foo` slash-command name out of a <command-name> block."""
    if not isinstance(text, str):
        return None
    m = _LOCAL_CMD_NAME_RE.search(text)
    return m.group(1) if m else None


def _extract_local_command_name_and_args(text: str) -> tuple[str | None, str | None]:
    """Pull both the `/foo` name and the `<command-args>...</command-args>`
    body out of a single command row.

    Returns `(name, args)` where either may be None:
      * `name` is None when the row has no <command-name>/foo block (e.g.
        an orphan caveat run with no command-name row at all).
      * `args` is None when the row has no `<command-args>` block. It is
        `""` when the block exists but is empty (`<command-args></command-args>`,
        which is what CC emits for argless commands like /exit).

    The caller distinguishes "no args" (None) from "empty args" (""):
      * BOTH fall through to the "Session: /foo" label in the marker.
      * Only a NON-EMPTY (post-strip) args body becomes the marker's text.
    """
    if not isinstance(text, str):
        return None, None
    m_name = _LOCAL_CMD_NAME_RE.search(text)
    m_args = _LOCAL_CMD_ARGS_RE.search(text)
    name = m_name.group(1) if m_name else None
    args = m_args.group(1) if m_args else None
    return name, args


def _collapse_local_command_triplets(messages: list[dict]) -> list[dict]:
    """Collapse runs of local-command boilerplate into a single marker.

    Walks `messages` (already in chronological order, output of
    `_merge_entries_to_message`). A "run" is a maximal sequence of adjacent
    messages whose text classifies as local-command boilerplate (caveat,
    command, stdout, stderr) per `_local_command_kind`. Each run is replaced
    with a SINGLE synthetic marker message that:

      * Reuses the FIRST run-member's uuid + parent_message_uuid (so any
        downstream message that links to it via parent_message_uuid keeps
        a valid pointer — this is the "bridge" Gemini-3-Pro flagged in the
        council review). The frontend currently renders by array order, not
        by parent_message_uuid, so this is a belt-and-suspenders safeguard.
      * Carries a short, clean `text` like `"Session: /exit"` (or generic
        `"Session: Local command"` if no <command-name> row was found in the
        run — e.g. an orphan caveat).
      * Sets `is_command_marker: true` so the frontend can style it muted
        (italic / smaller / etc.) — but the field is optional; if the
        frontend ignores it the bubble just renders as a short user message.
      * Skips runs that look like /compact — those are owned by the existing
        `extract_compact_markers` system and have their own UI affordance.

    Bidirectional guarantees:
      * A session with `[caveat, command(/exit), stdout, real_user, assistant]`
        collapses to `[marker(/exit), real_user, assistant]` (3 -> 1).
      * A session with `[caveat]` alone (pure phantom) collapses to
        `[marker(local-command)]` — never blanks the view. This preserves
        `test_phantom_caveat_carveout.py:140`'s `len(chat_messages) >= 2`
        invariant when paired with a real message.
    """
    if not messages:
        return messages

    result: list[dict] = []
    i = 0
    n = len(messages)
    while i < n:
        msg = messages[i]
        # Only USER messages can be boilerplate (CC emits these as type:"user").
        if msg.get("sender") != "human":
            result.append(msg)
            i += 1
            continue

        kind = _local_command_kind(msg.get("text", ""))
        if kind is None:
            result.append(msg)
            i += 1
            continue

        # Start of a run. Scan forward while consecutive user messages
        # remain boilerplate. Also break on /compact (owned by the
        # compact-marker system).
        run_start = i
        run_end = i  # inclusive
        command_name: str | None = None
        # `command_args` follows the same three-state convention as
        # `_extract_local_command_name_and_args`: None means no
        # `<command-args>` block was seen in the run; "" means the block
        # was present but empty (CC's argless triplet); a non-empty
        # string is the real user-supplied args body.
        command_args: str | None = None
        is_compact_run = False
        j = i
        while j < n:
            cand = messages[j]
            if cand.get("sender") != "human":
                break
            ctext = cand.get("text", "")
            ckind = _local_command_kind(ctext)
            if ckind is None:
                break
            if ckind == "command":
                cname, cargs = _extract_local_command_name_and_args(ctext)
                if cname == "/compact":
                    # Leave the /compact triplet alone — it's tracked by
                    # the parallel compact_markers system and has its own UI.
                    is_compact_run = True
                    break
                if cname:
                    command_name = cname
                # Only overwrite `command_args` from a row that ACTUALLY
                # carried a <command-args> block. None means "no block in
                # this row" and must not clobber a previously-seen value
                # — though in practice each run has at most one command
                # row, this guard keeps the invariant explicit.
                if cargs is not None:
                    command_args = cargs
            run_end = j
            j += 1

        if is_compact_run:
            # Pass through every message in the consumed prefix unchanged
            # PLUS the /compact trigger row itself so the compact-markers
            # pipeline gets to handle it. Crucial: we must advance i past
            # the trigger row (j) — even if j == run_start (i.e. the run
            # STARTED with /compact and we consumed nothing before it),
            # leaving i = j would loop forever on the same row.
            for k in range(run_start, j + 1):
                result.append(messages[k])
            i = j + 1
            continue

        first = messages[run_start]
        last = messages[run_end]
        # Args-preservation logic (V1 polish round 3): when the user
        # supplied real prompt text via /coding <args>, surface it as the
        # marker's `text` so the bubble carries the user's actual content
        # (the original collapser threw args away). Empty / whitespace-
        # only args fall back to the "Session: /foo" label so an argless
        # /exit doesn't render a blank bubble.
        #
        # `is_argless` is the SOURCE OF TRUTH for the prelude-flag pass.
        # We do NOT detect argless markers by comparing text strings later
        # — that would mis-flag a user whose args literally happen to be
        # `"Session: /exit"` (rare but real, e.g. a bug report about CC's
        # own boilerplate). The flag is set here, once, definitively.
        args_stripped = (command_args or "").strip()
        is_argless = not args_stripped
        if args_stripped:
            text_payload = args_stripped
        elif command_name:
            text_payload = f"Session: {command_name}"
        else:
            text_payload = "Session: Local command"
        marker = {
            "uuid": first.get("uuid", ""),
            "sender": "human",
            "text": text_payload,
            "content": [{"type": "text", "text": text_payload}],
            "created_at": first.get("created_at", ""),
            "updated_at": last.get("updated_at", first.get("created_at", "")),
            "truncated": False,
            "parent_message_uuid": first.get("parent_message_uuid"),
            "attachments": [],
            "files": [],
            # V1 polish (2026-05-13): `is_command_marker` is True ONLY for
            # argless markers (/exit, /clear, etc. — pure conversational
            # chrome). Argful markers (/coding <prompt>, /plan <prose>) get
            # is_command_marker=False because they carry REAL user content
            # and downstream consumers (export filter, prelude pass, future
            # accessibility "skip markers" affordance) MUST NOT treat them
            # as noise to suppress. Spec invariant X1: argful is never a
            # marker. The badge still renders for both (driven by
            # `slash_command`, not by this flag).
            "is_command_marker": is_argless,
            # `slash_command` is the public, serialized field consumed by
            # the frontend `<SlashCommandBadge />`. None for orphan-caveat
            # runs (no <command-name> row found) — the frontend's
            # `if (message.slash_command)` guard correctly skips the badge
            # in that case.
            "slash_command": command_name,
            # `_argless_marker` is a PRIVATE, leading-underscore flag
            # consumed only by `_flag_leading_prelude_markers` below. It
            # is NOT declared on the Pydantic `Message` model, so it gets
            # silently dropped at serialization time (Pydantic v2 default
            # `extra='ignore'`). That's intentional — this is internal
            # state between two backend passes, not part of the public
            # API surface.
            "_argless_marker": is_argless,
        }
        result.append(marker)
        i = run_end + 1

    return result


# Canned-response fold + leading-prelude flag (V1 polish, 2026-05-12, council
# round 2): after `_collapse_local_command_triplets` turns each /exit triplet
# into a single `is_command_marker: True` marker, the JSONL ALSO contains the
# orphan assistant row CC emits in reply: an `assistant` message whose text
# is exactly the literal string `"No response requested."`. Raw, the top of
# a session that opened with two /exit runs looks like
#   [marker, "No response requested.", marker, "No response requested.",
#    real_user]
# which is confusing. The fold below absorbs each canned-response assistant
# into the preceding marker; the prelude-flag pass then marks the leading
# run of markers with `is_prelude: True` so the frontend can hide them
# behind a "Session prelude: N earlier /exit runs (show)" affordance.
#
# Deliberate conservatism:
#   * Fold matches ONLY the exact (post-`.strip()`) string. A future CC
#     version that changes the wording falls back to rendering the bubble
#     verbatim — visible, fixable, no silent erasure.
#   * Fold refuses to consume an assistant that carried tool_use /
#     tool_result blocks, even if the text happens to match — those carry
#     real history we MUST NOT drop.
#   * Both passes are pure-functional: shallow-copy `out` list, shallow-copy
#     only the dicts we modify. Input list and its member dicts are never
#     mutated. Callers can safely reuse the original list.
#   * Both passes are idempotent: a second run of the fold finds no
#     marker→canned-assistant pair (the assistant is gone); a second run of
#     the flag finds the same prefix and sets the same flags.
#
# Why a SEPARATE pass instead of folding into `_collapse_local_command_triplets`?
# The triplet collapse runs over USER messages only (CC emits the boilerplate
# as `type:"user"` rows); the canned response is an `assistant` row. Keeping
# them as ordered passes makes each invariant testable in isolation.
_CANNED_NO_RESPONSE_TEXT = "No response requested."


def _is_canned_no_response_assistant(msg: dict) -> bool:
    """True iff `msg` is an assistant whose ENTIRE text content is CC's
    literal canned-response string.

    Conservative guards: sender must be 'assistant', text must be a str whose
    post-strip value equals the canned string exactly, and the content array
    must contain only text blocks (no tool_use/tool_result — those carry real
    history and we MUST NOT drop them, even if the text happens to match).
    """
    if msg.get("sender") != "assistant":
        return False
    text = msg.get("text")
    if not isinstance(text, str):
        return False
    if text.strip() != _CANNED_NO_RESPONSE_TEXT:
        return False
    for block in msg.get("content", []):
        if not isinstance(block, dict):
            return False
        if block.get("type") != "text":
            return False
    return True


def _fold_canned_assistant_responses_into_marker(messages: list[dict]) -> list[dict]:
    """Absorb each `"No response requested."` assistant row into the preceding
    `is_command_marker: True` marker.

    Behavior:
      * When a fold happens, the marker gets
        `assistant_canned_response_consumed: True` and the absorbed assistant
        is dropped from the output list.
      * Handles a RUN of consecutive canned-response assistants after a single
        marker (CC glitch case): all are absorbed.
      * The first non-canned successor's `parent_message_uuid` is remapped
        from any absorbed assistant's uuid to the marker's uuid, so a
        downstream parent-chain walker (export pipelines, tree builders)
        doesn't lose its anchor.

    Pure-functional contract: the caller's list and the caller's dicts are
    NEVER mutated. We shallow-copy the list immediately on entry so any
    in-place rewrites stay local; we shallow-copy individual dicts only
    when we need to set new keys on them.
    """
    if not messages:
        return list(messages)

    # Local copy of the LIST so we can rewrite slots (the parent-chain
    # remap below) without mutating the caller's list. We never mutate
    # the caller's dicts — those are also shallow-copied at modification.
    local: list[dict] = list(messages)
    out: list[dict] = []
    i = 0
    n = len(local)
    while i < n:
        cur = local[i]
        if cur.get("is_command_marker") is not True:
            out.append(cur)
            i += 1
            continue

        # Scan forward for a run of consecutive canned-response assistants.
        # run_end is the LAST absorbed index (inclusive); equals i when no
        # fold should happen.
        run_end = i
        j = i + 1
        while j < n and _is_canned_no_response_assistant(local[j]):
            run_end = j
            j += 1

        if run_end == i:
            out.append(cur)
            i += 1
            continue

        marker = dict(cur)
        marker["assistant_canned_response_consumed"] = True
        out.append(marker)

        # Parent-chain bridge: build the set of absorbed-assistant uuids
        # (excluding None so a missing-uuid pair can't false-positive on
        # `None == None`). If the first surviving successor's
        # `parent_message_uuid` is in that set, rewrite the local slot
        # with a shallow-copied dict that points at the marker's uuid.
        absorbed_uuids = {
            local[k].get("uuid")
            for k in range(i + 1, run_end + 1)
            if local[k].get("uuid")
        }
        successor_idx = run_end + 1
        if successor_idx < n and absorbed_uuids:
            successor = local[successor_idx]
            if successor.get("parent_message_uuid") in absorbed_uuids:
                successor = dict(successor)
                successor["parent_message_uuid"] = marker.get("uuid")
                local[successor_idx] = successor

        # Advance past the absorbed run ONLY. Do NOT pre-emit the successor —
        # the main loop's next iteration picks it up and may fold AGAIN if
        # it's another marker (the canonical multi-/exit session looks like
        # [marker, canned, marker, canned, real] and needs two folds).
        i = run_end + 1

    return out


def _flag_leading_prelude_markers(messages: list[dict]) -> tuple[list[dict], int]:
    """Flag the leading run of ARGLESS `is_command_marker` messages with
    `is_prelude: True`. Returns `(new_list, prelude_hidden_count)`.

    Stops at the FIRST message that is either:
      * NOT a command marker (real user/assistant turn or /compact summary
        the triplet-collapser passed through), OR
      * an ARGFUL command marker — i.e. a /coding/ /plan/ /metaprompt/etc
        marker whose `text` carries the user's REAL prompt body. Hiding
        those behind the prelude affordance would silently bury real user
        content; the whole point of args preservation is to surface it.

    ARGLESS/ARGFUL DETECTION
    ------------------------
    We read the PRIVATE `_argless_marker` flag set by
    `_collapse_local_command_triplets` at marker-construction time. The
    flag is the source of truth and resistant to user-injected
    "Session: /foo" args text. Three cases:

      * `_argless_marker is True`  → argless; FLAG as prelude.
      * `_argless_marker is False` → argful; BREAK the prelude run.
      * Key absent                 → legacy fixture path. Fall back to
        the pre-args-preservation behavior: any leading command marker
        is prelude. This keeps pre-existing tests that synthesize
        markers WITHOUT the flag (e.g.
        `test_canned_response_fold_and_prelude.py::_marker`) working.
        REAL markers produced by the collapser always have the flag,
        so this fallback never fires on production data.

    Pure-functional: shallow-copies only the flagged dicts; non-flagged
    entries are reference-equal in the output. The `_argless_marker`
    key remains on the dict but is stripped at serialization time by
    Pydantic v2's default `extra='ignore'` (the `Message` model never
    declares it).
    """
    out: list[dict] = []
    count = 0
    in_prefix = True
    for msg in messages:
        if in_prefix and msg.get("is_command_marker") is True:
            argless_flag = msg.get("_argless_marker")
            # True → argless (flag); False → argful (break);
            # None/absent → legacy fixture path, fall back to "flag
            # any leading marker" pre-args-preservation behavior.
            if argless_flag is True or argless_flag is None:
                flagged = dict(msg)
                flagged["is_prelude"] = True
                out.append(flagged)
                count += 1
                continue
        in_prefix = False
        out.append(msg)
    return out, count


# Title-event rule (mirrors the existing "last summary wins" precedent —
# CC JSONLs are append-only chronological logs, so the most recent title
# event represents the active truth). CC writes these row types:
#   - `custom-title` with `customTitle`  (emitted by /rename in newer CCs)
#   - `agent-name`   with `agentName`    (sibling row, emitted alongside)
#   - `summary`      with `summary`      (auto-generated, older CCs)
# We treat ALL three as title events and pick the chronologically last
# valid (non-empty, stripped) one. Empty strings fall through to the
# next-most-recent candidate so a stray empty-customTitle row from a
# future CC version can't blank the title.
_TITLE_FIELD_BY_TYPE: dict[str, str] = {
    "custom-title": "customTitle",
    "agent-name": "agentName",
    "summary": "summary",
}


def _title_from_entry(entry: dict) -> str | None:
    """Return the trimmed title text for any title-emitting row, or None."""
    field = _TITLE_FIELD_BY_TYPE.get(entry.get("type", ""))
    if not field:
        return None
    raw = entry.get(field)
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    return text or None


def extract_compact_markers(entries: list[dict]) -> list[dict]:
    """Extract compact markers from a Claude Code JSONL entry list.

    Each marker is the synthetic user message with `isCompactSummary: true` that
    Claude Code injects when it compacts the conversation. Auto vs manual is
    determined by scanning the small window AFTER the marker for a replayed
    `<command-name>/compact</command-name>` user record; manual markers also
    surface the `<command-args>` text so the UI can render the user's prompt.

    Returns a list of dicts: `{message_uuid, summary_text, timestamp, kind, user_prompt}`.
    """
    markers: list[dict] = []
    for idx, entry in enumerate(entries):
        if entry.get("isCompactSummary") is not True:
            continue
        kind = "auto"
        user_prompt: str | None = None
        end = min(len(entries), idx + 1 + _COMPACT_LOOKAHEAD)
        for j in range(idx + 1, end):
            other = entries[j]
            if other.get("isCompactSummary") is True:
                break
            text = _get_message_text(other)
            if _COMPACT_COMMAND_NAME in text:
                kind = "manual"
                m = _COMPACT_ARGS_RE.search(text)
                user_prompt = m.group(1).strip() if m else ""
                break
        markers.append({
            "message_uuid": entry.get("uuid", ""),
            "summary_text": _get_message_text(entry),
            "timestamp": entry.get("timestamp", ""),
            "kind": kind,
            "user_prompt": user_prompt,
        })
    return markers


def _is_system_message(entry: dict) -> bool:
    """Check if a user entry is a system message (Caveat, bash I/O, tool results, commands)."""
    msg = entry.get("message", {})
    content = msg.get("content", "")

    if isinstance(content, list):
        # Check for tool_result blocks (these are not real user messages)
        if any(b.get("type") == "tool_result" for b in content):
            return True

    text = _get_message_text(entry)

    # Skip system-generated messages and command infrastructure
    return (
        text.startswith("Caveat: The messages below were generated")
        or text.startswith("<local-command-caveat>")
        or text.startswith("<bash-input>")
        or text.startswith("<bash-stdout>")
        or text.startswith("<bash-stderr>")
        or text.startswith("<command-message>")
        or text.startswith("<command-name>")
        or text.startswith("Unknown skill:")
        or text.startswith("Unknown command:")
    )


def _extract_title_from_message(entry: dict) -> str | None:
    """Extract a clean title from a message, handling XML tags and special formats."""
    text = _get_message_text(entry)
    if not text:
        return None

    # Try to extract command name from <command-name>/foo</command-name>
    cmd_match = re.search(r"<command-name>(/[^<]+)</command-name>", text)
    if cmd_match:
        return cmd_match.group(1)

    # Skip messages that are just XML infrastructure
    if text.startswith("<") and ">" in text:
        # Check if there's useful content after the XML tags
        # Remove all XML tags and see what's left
        clean = re.sub(r"<[^>]+>", "", text).strip()
        if clean and len(clean) > 10:
            text = clean
        else:
            return None

    # Clean up markdown and get first meaningful line
    lines = text.strip().split("\n")
    for line in lines:
        # Strip markdown headers and whitespace
        clean_line = re.sub(r"^#+\s*", "", line).strip()
        # Skip empty lines and short fragments
        if clean_line and len(clean_line) > 5:
            return clean_line[:100]

    return text[:100].strip() if text.strip() else None


def read_conversation_summary_fast(jsonl_path: Path) -> dict[str, Any] | None:
    """Read metadata from a JSONL file for fast listing.

    Scans the entire file to:
    - Find first user/assistant entries for metadata
    - Count all user entries and unique assistant message IDs
    """
    latest_title: str | None = None  # Last non-empty title from any title row
    first_user = None
    first_real_user = None  # First user message that's not a system "Caveat" message
    first_assistant = None
    first_timestamp = None

    # Message counting
    user_count = 0
    assistant_message_ids: set[str] = set()

    try:
        with open(jsonl_path, "rb") as f:  # Binary mode for orjson
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = orjson.loads(line)
                    entry_type = entry.get("type")

                    # Extract metadata from first occurrences
                    ts = entry.get("timestamp")
                    if ts and first_timestamp is None:
                        first_timestamp = ts

                    # Title-event rows (custom-title / agent-name / summary):
                    # last non-empty value wins. See `_TITLE_FIELD_BY_TYPE`.
                    title_candidate = _title_from_entry(entry)
                    if title_candidate:
                        latest_title = title_candidate

                    if entry_type == "user":
                        user_count += 1
                        if not first_user:
                            first_user = entry
                        # Track first real user message for title extraction
                        if not first_real_user and not _is_system_message(entry):
                            first_real_user = entry
                    elif entry_type == "assistant":
                        # Dedupe by message.id to handle streaming chunks
                        msg = entry.get("message", {})
                        msg_id = msg.get("id")
                        if msg_id:
                            assistant_message_ids.add(msg_id)
                        if not first_assistant:
                            first_assistant = entry

                except orjson.JSONDecodeError:
                    pass
    except (OSError, IOError):
        return None

    if not first_user:
        return None

    # Build metadata - prefer the most recent title-event (custom-title /
    # agent-name / summary). Fall back to first-real-user truncation only
    # when no title rows exist (e.g. unrenamed sessions on older CC).
    name = latest_title
    if not name and first_real_user:
        name = _extract_title_from_message(first_real_user)

    if not name:
        name = jsonl_path.stem

    # Detect phantom sessions (local command artifacts with no real conversation)
    # A phantom session starts with "Caveat:" AND has no assistant responses
    is_phantom = (
        name.startswith("Caveat: The messages below were generated")
        and len(assistant_message_ids) == 0
    )

    session_id = first_user.get("sessionId", jsonl_path.stem)
    cwd = first_user.get("cwd", "")
    git_branch = first_user.get("gitBranch", "")

    # Get model
    model = ""
    if first_assistant:
        msg = first_assistant.get("message", {})
        model = msg.get("model", "")

    # Use file mtime for updated_at (fast)
    created_at = _parse_datetime(first_timestamp)
    try:
        mtime = jsonl_path.stat().st_mtime
        updated_at = datetime.fromtimestamp(mtime, tz=timezone.utc)
    except OSError:
        updated_at = created_at

    # Total messages = user messages + unique assistant responses
    message_count = user_count + len(assistant_message_ids)

    return {
        "uuid": session_id,
        "name": name,
        "summary": "",
        "model": model,
        "created_at": created_at.isoformat(),
        "updated_at": updated_at.isoformat(),
        "is_starred": False,
        "is_temporary": False,
        "project_path": cwd,
        "git_branch": git_branch,
        "source": "CLAUDE_CODE",
        "message_count": message_count,
        "human_message_count": user_count,
        "has_branches": False,
        "is_phantom": is_phantom,
    }


# Source-hash of the fast metadata reader. Bumps every time the function
# body changes (including whitespace + comments — acceptable since the
# function changes rarely and the trade-off is "never serve cached rows
# from an out-of-date producer"). Stored in
# ``conversation_summaries_meta.value`` and compared at lifespan startup;
# mismatch → :meth:`backend.summary_cache.SummaryCache.clear_on_logic_mismatch`
# wipes the cache table.
#
# inspect.getsource is stable for module-level functions in CPython
# (verified manually); if it ever returns something fragile we can fall
# back to a manually-maintained version string.
LOGIC_VERSION = hashlib.sha256(
    inspect.getsource(read_conversation_summary_fast).encode()
).hexdigest()[:16]


# Threshold above which we pay the process-pool spawn overhead for the
# first-install / cold-cache case. Below this, the sequential path is
# faster than either thread or process pool (no pool overhead).
# Empirically tuned: at ~50 misses the process-pool spawn cost (~150ms
# on macOS) starts being amortized; at 1,000 misses it's the difference
# between 1.8s (process pool) and 5.6s (sequential).
_PROCESS_POOL_THRESHOLD = 50


def _read_summaries_parallel(paths: list[Path]) -> dict[Path, dict[str, Any] | None]:
    """Run :func:`read_conversation_summary_fast` across paths concurrently.

    Returns a dict keyed by the input ``Path``; the value is either the
    metadata dict the fast reader returned, or ``None`` for files that
    were empty / unreadable (the caller should skip those rather than
    cache them).

    Concurrency strategy (empirically tuned, NOT the original
    "threads + GIL-releasing orjson" plan):

      * 0 paths → empty dict (no pool spinup).
      * 1 to ``_PROCESS_POOL_THRESHOLD`` paths → sequential. ProcessPool
        spawn overhead (~150ms on macOS) dominates over the work below
        this threshold.
      * Above the threshold → ``ProcessPoolExecutor`` with 8 workers.
        The pure-Python ``for line in f / entry.get(...)`` cycle inside
        ``read_conversation_summary_fast`` is GIL-bound (orjson.loads
        is only ~46% of cumulative time per a cProfile run), so
        threads actually run SLOWER than sequential on 970 files
        (8.94s vs 5.62s) due to GIL contention. Processes sidestep
        the GIL entirely (970 files in 1.81s, ~3x faster than
        sequential, ~5x faster than threads).
      * Process-pool failure (sandboxed Python, fork restrictions,
        ImportError on the child side, etc.) → fall back to a
        ThreadPoolExecutor pass. Worst case the cold-install
        benchmark gets slow; warm-path latency is unaffected because
        the warm path doesn't hit this function at all.
    """
    if not paths:
        return {}

    if len(paths) < _PROCESS_POOL_THRESHOLD:
        return {p: read_conversation_summary_fast(p) for p in paths}

    # ProcessPoolExecutor.map preserves input order, which we don't
    # strictly need (we key by Path), but it also chunks more
    # efficiently than submit-per-task. chunksize=20 keeps the
    # per-process work meaningful without starving the pool.
    try:
        with ProcessPoolExecutor(max_workers=8) as executor:
            results = list(
                executor.map(
                    read_conversation_summary_fast, paths, chunksize=20,
                )
            )
        return dict(zip(paths, results))
    except Exception:  # noqa: BLE001
        # ProcessPoolExecutor failure modes are platform-specific
        # (sandboxed Python without fork, frozen executable that
        # can't re-import the module, etc.) and rare. Fall back to
        # threads so we still return SOMETHING; the cold-install
        # benchmark suffers but no warm requests are affected.
        logger.warning(
            "claude_code_reader: ProcessPoolExecutor unavailable; "
            "falling back to ThreadPoolExecutor (cold-cache requests "
            "will be slower than designed)",
            exc_info=True,
        )

    out: dict[Path, dict[str, Any] | None] = {}
    with ThreadPoolExecutor(max_workers=8) as executor:
        future_to_path = {
            executor.submit(read_conversation_summary_fast, p): p
            for p in paths
        }
        for future in as_completed(future_to_path):
            path = future_to_path[future]
            try:
                out[path] = future.result()
            except Exception:  # noqa: BLE001
                logger.exception(
                    "claude_code_reader: parallel summary read failed for %s",
                    path,
                )
                out[path] = None
    return out


def _extract_conversation_metadata(entries: list[dict], jsonl_path: Path) -> dict:
    """Extract metadata from JSONL entries."""
    # Title rule: scan all title-emitting rows (custom-title, agent-name,
    # summary), keep the last non-empty value. See `_TITLE_FIELD_BY_TYPE`.
    # Bug-fix (2026-05-12): user-renamed sessions (`/rename`) write
    # `type:"custom-title"` rows; the old code only looked at `summary`
    # and silently fell back to first-user-message truncation, hiding
    # the friendly title shown in CC's own UI.
    name: str | None = None
    for entry in entries:
        candidate = _title_from_entry(entry)
        if candidate:
            name = candidate

    # Get user and assistant messages
    user_entries = [e for e in entries if e.get("type") == "user"]
    assistant_entries = [e for e in entries if e.get("type") == "assistant"]

    # Timestamps from all entries
    all_timestamps = []
    for e in entries:
        ts = e.get("timestamp")
        if ts:
            try:
                all_timestamps.append(datetime.fromisoformat(ts.replace("Z", "+00:00")))
            except (ValueError, TypeError):
                pass

    created_at = min(all_timestamps) if all_timestamps else datetime.now(timezone.utc)
    updated_at = max(all_timestamps) if all_timestamps else datetime.now(timezone.utc)

    # Fallback name from first real (non-system) user message
    if not name and user_entries:
        for entry in user_entries:
            if not _is_system_message(entry):
                name = _extract_title_from_message(entry)
                if name:
                    break

    if not name:
        name = jsonl_path.stem

    # Get metadata from first user entry (has cwd, version, etc.)
    first_user_entry = user_entries[0] if user_entries else {}
    first_entry = entries[0] if entries else {}
    session_id = first_user_entry.get("sessionId") or first_entry.get("sessionId") or jsonl_path.stem
    cwd = first_user_entry.get("cwd", "")
    git_branch = first_user_entry.get("gitBranch", "")
    version = first_user_entry.get("version", "")

    # Get model from first assistant message
    model = ""
    if assistant_entries:
        msg = assistant_entries[0].get("message", {})
        model = msg.get("model", "")

    return {
        "uuid": session_id,
        "name": name,
        "summary": "",
        "model": model,
        "created_at": created_at,
        "updated_at": updated_at,
        "cwd": cwd,
        "git_branch": git_branch,
        "version": version,
    }


def _get_message_key(entry: dict) -> str | None:
    """Get a unique key for grouping streaming chunks of the same message.

    Assistant messages have message.id, user messages use entry uuid.
    """
    entry_type = entry.get("type")
    if entry_type not in ("user", "assistant"):
        return None

    msg = entry.get("message", {})
    # Assistant messages have message.id for grouping streaming chunks
    if entry_type == "assistant" and msg.get("id"):
        return f"assistant:{msg['id']}"
    # User messages use entry uuid
    return f"user:{entry.get('uuid', '')}"


def _merge_entries_to_message(entries: list[dict]) -> dict | None:
    """Merge multiple streaming entries into a single message.

    Claude Code streams messages as multiple entries, each with different
    content blocks (thinking, text, tool_use, etc.). This merges them all.
    """
    if not entries:
        return None

    first_entry = entries[0]
    last_entry = entries[-1]
    entry_type = first_entry.get("type")

    if entry_type not in ("user", "assistant"):
        return None

    # Collect ALL content blocks from ALL entries
    all_content_blocks = []
    text_parts = []

    for entry in entries:
        message_data = entry.get("message", {})
        content = message_data.get("content", "")

        if isinstance(content, str):
            if content:
                all_content_blocks.append({"type": "text", "text": content})
                text_parts.append(content)
        elif isinstance(content, list):
            for block in content:
                all_content_blocks.append(block)
                if block.get("type") == "text":
                    text_parts.append(block.get("text", ""))

    text = "\n".join(text_parts)

    timestamp = first_entry.get("timestamp", datetime.now(timezone.utc).isoformat())

    # Use first entry's uuid as the message uuid (for parent chain)
    # Use first entry's parentUuid to link to previous message
    return {
        "uuid": first_entry.get("uuid", ""),
        "sender": "human" if entry_type == "user" else "assistant",
        "text": text,
        "content": all_content_blocks,
        "created_at": timestamp,
        "updated_at": last_entry.get("timestamp", timestamp),
        "truncated": False,
        "parent_message_uuid": first_entry.get("parentUuid"),
        "attachments": [],
        "files": [],
    }


def _convert_entry_to_message(entry: dict) -> dict | None:
    """Convert a JSONL entry to a chat message format.

    Note: For streaming conversations, use _merge_entries_to_message instead.
    """
    entry_type = entry.get("type")

    if entry_type not in ("user", "assistant"):
        return None

    message_data = entry.get("message", {})

    # Extract text content
    content = message_data.get("content", "")
    if isinstance(content, str):
        text = content
        content_blocks = [{"type": "text", "text": content}] if content else []
    elif isinstance(content, list):
        content_blocks = content
        text_parts = []
        for block in content:
            if block.get("type") == "text":
                text_parts.append(block.get("text", ""))
        text = "\n".join(text_parts)
    else:
        text = ""
        content_blocks = []

    timestamp = entry.get("timestamp", datetime.now(timezone.utc).isoformat())

    return {
        "uuid": entry.get("uuid", ""),
        "sender": "human" if entry_type == "user" else "assistant",
        "text": text,
        "content": content_blocks,
        "created_at": timestamp,
        "updated_at": timestamp,
        "truncated": False,
        "parent_message_uuid": entry.get("parentUuid"),
        "attachments": [],
        "files": [],
    }


def read_claude_code_conversation(jsonl_path: Path) -> dict[str, Any] | None:
    """Read a single Claude Code conversation from a JSONL file.

    Handles Claude Code's streaming format where multiple entries represent
    chunks of the same message. Groups entries by message ID and merges them.
    """
    entries = parse_jsonl_file(jsonl_path)
    if not entries:
        return None

    metadata = _extract_conversation_metadata(entries, jsonl_path)

    # Group entries by message key (handles streaming chunks)
    from collections import OrderedDict
    message_groups: OrderedDict[str, list[dict]] = OrderedDict()

    for entry in entries:
        key = _get_message_key(entry)
        if key:
            if key not in message_groups:
                message_groups[key] = []
            message_groups[key].append(entry)

    # Build mapping from any entry UUID to the merged message's UUID
    # Include ALL entries (user, assistant, system, progress, etc.)
    # Non-message entries map to the most recent message's UUID
    uuid_remap: dict[str, str] = {}
    last_message_uuid: str | None = None

    for entry in entries:
        entry_uuid = entry.get("uuid", "")
        if not entry_uuid:
            continue

        key = _get_message_key(entry)
        if key:
            # This is a user/assistant entry - find its merged UUID
            group = message_groups.get(key, [])
            if group:
                merged_uuid = group[0].get("uuid", "")
                uuid_remap[entry_uuid] = merged_uuid
                last_message_uuid = merged_uuid
        else:
            # Non-message entry (system, progress, etc.) - map to last message
            if last_message_uuid:
                uuid_remap[entry_uuid] = last_message_uuid

    # Merge each group into a single message
    messages = []
    for group_entries in message_groups.values():
        msg = _merge_entries_to_message(group_entries)
        if msg:
            # Remap parent_message_uuid to point to merged message UUID
            parent = msg.get("parent_message_uuid")
            if parent and parent in uuid_remap:
                msg["parent_message_uuid"] = uuid_remap[parent]
            messages.append(msg)

    # V1 polish (2026-05-12): collapse <local-command-caveat>/<command-name>/
    # <local-command-stdout> triplets that CC emits around slash commands
    # (e.g. /exit, /clear) into a single short "Session: /foo" marker. Done
    # AFTER streaming-chunk merge so the boilerplate-vs-real-message
    # classification operates on whole logical messages — not interleaved
    # chunks. See `_collapse_local_command_triplets` docstring for the
    # full contract + bidirectional guarantees.
    messages = _collapse_local_command_triplets(messages)
    # V1 polish (2026-05-12, council round 2): absorb CC's canned
    # `"No response requested."` assistant reply into the preceding marker,
    # then flag the leading run of markers as `is_prelude` so the frontend
    # can hide them behind a "Session prelude: N earlier /exit runs (show)"
    # affordance. Prelude markers stay in `chat_messages` with a flag — no
    # silent erasure. See module-level comments above for the full rationale.
    messages = _fold_canned_assistant_responses_into_marker(messages)
    messages, prelude_hidden_count = _flag_leading_prelude_markers(messages)

    result = {
        "uuid": metadata["uuid"],
        "name": metadata["name"],
        "summary": metadata["summary"],
        "model": metadata["model"],
        "created_at": metadata["created_at"].isoformat(),
        "updated_at": metadata["updated_at"].isoformat(),
        "is_starred": False,
        "is_temporary": False,
        "project_path": metadata["cwd"],
        "git_branch": metadata["git_branch"],
        "claude_code_version": metadata["version"],
        "source": "CLAUDE_CODE",
        "chat_messages": messages,
        "current_leaf_message_uuid": messages[-1]["uuid"] if messages else "",
        "compact_markers": extract_compact_markers(entries),
        "prelude_hidden_count": prelude_hidden_count,
    }

    # P4a-fix (2026-05-06): populate ~/.claude-explorer/cc-images/ as a
    # side effect of reading. The original wiring lived in
    # `fetcher/local_claude_code.py`, which is an unwired migration tool
    # — the live read path is here, so the cache directory was never
    # being created. Failures are logged and swallowed so a transient
    # I/O error never breaks the conversation render.
    try:
        from .cc_image_cache import cache_all_markers

        cache_all_markers(result)
    except Exception:  # noqa: BLE001
        logger.exception("cache_all_markers failed for %s", jsonl_path)

    return result


def discover_jsonl_files(claude_dir: Path = DEFAULT_CLAUDE_DIR) -> Iterator[Path]:
    """Find all JSONL session files in the Claude directory."""
    projects_dir = claude_dir / "projects"

    if not projects_dir.exists():
        return

    for project_dir in projects_dir.iterdir():
        if not project_dir.is_dir():
            continue

        for jsonl_file in project_dir.glob("*.jsonl"):
            # Skip agent sub-conversations
            if jsonl_file.name.startswith("agent-"):
                continue
            yield jsonl_file


def read_agent_summary_fast(agent_path: Path) -> tuple[str | None, dict | None]:
    """Read agent metadata quickly without full parsing.

    Returns (session_id, summary_dict) or (None, None) if invalid.
    Only reads first ~20 lines for speed.
    """
    first_user = None
    first_assistant = None
    first_timestamp = None
    agent_id = None
    lines_read = 0
    max_lines = 20

    try:
        with open(agent_path, "rb") as f:  # Binary mode for orjson
            for line in f:
                lines_read += 1
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = orjson.loads(line)
                    entry_type = entry.get("type")

                    if agent_id is None:
                        agent_id = entry.get("agentId")

                    ts = entry.get("timestamp")
                    if ts and first_timestamp is None:
                        first_timestamp = ts

                    if entry_type == "user" and not first_user:
                        first_user = entry
                    elif entry_type == "assistant" and not first_assistant:
                        first_assistant = entry

                    # Stop once we have what we need
                    if first_user and first_assistant:
                        break

                except orjson.JSONDecodeError:
                    pass

                if lines_read >= max_lines:
                    break
    except (OSError, IOError):
        return None, None

    if not first_user:
        return None, None

    session_id = first_user.get("sessionId")
    if not session_id:
        return None, None

    if not agent_id:
        agent_id = agent_path.stem.replace("agent-", "")

    # Get name from first user message
    name = f"Agent {agent_id}"
    first_msg = first_user.get("message", {})
    content = first_msg.get("content", "")
    if isinstance(content, str) and content.strip():
        name = content[:80].strip()
    elif isinstance(content, list):
        text_parts = [b.get("text", "") for b in content if b.get("type") == "text"]
        text = " ".join(text_parts)[:80].strip()
        if text:
            name = text

    model = ""
    if first_assistant:
        msg = first_assistant.get("message", {})
        model = msg.get("model", "")

    # Use file mtime for updated_at
    created_at = _parse_datetime(first_timestamp)
    try:
        mtime = agent_path.stat().st_mtime
        updated_at = datetime.fromtimestamp(mtime, tz=timezone.utc)
    except OSError:
        updated_at = created_at

    summary = {
        "uuid": agent_id,
        "agent_id": agent_id,
        "name": name,
        "model": model,
        "created_at": created_at,
        "updated_at": updated_at,
        "message_count": 0,  # Not counted for speed
    }

    return session_id, summary


def build_agent_index_with_summaries(claude_dir: Path = DEFAULT_CLAUDE_DIR) -> dict[str, list[dict]]:
    """Build a mapping of sessionId -> list of agent summaries.

    This scans all agent files once and extracts both sessionId and summary data,
    avoiding repeated file reads when listing conversations.
    """
    index: dict[str, list[dict]] = {}
    projects_dir = claude_dir / "projects"

    if not projects_dir.exists():
        return index

    for project_dir in projects_dir.iterdir():
        if not project_dir.is_dir():
            continue

        # Find all agent files in this project directory
        for agent_file in project_dir.glob("agent-*.jsonl"):
            session_id, summary = read_agent_summary_fast(agent_file)
            if session_id and summary:
                if session_id not in index:
                    index[session_id] = []
                index[session_id].append(summary)

    return index


def discover_agent_files(project_dir: Path, session_id: str) -> list[Path]:
    """Find all agent JSONL files belonging to a session.

    Note: This function reads each agent file to verify ownership.
    For batch operations, use build_agent_index() instead.
    """
    agent_files = []

    # Agent files can be directly in project dir or in session subdirectory
    for pattern in [
        project_dir / "agent-*.jsonl",
        project_dir / session_id / "**" / "agent-*.jsonl",
    ]:
        for agent_file in project_dir.glob(pattern.name if pattern.parent == project_dir else str(pattern.relative_to(project_dir))):
            # Verify this agent belongs to the session by checking sessionId in file
            entries = parse_jsonl_file(agent_file)
            if entries:
                first_user = next((e for e in entries if e.get("type") == "user"), None)
                if first_user and first_user.get("sessionId") == session_id:
                    agent_files.append(agent_file)

    return agent_files


def _extract_agent_metadata(entries: list[dict], agent_path: Path) -> dict:
    """Extract metadata from agent JSONL entries."""
    user_entries = [e for e in entries if e.get("type") == "user"]
    assistant_entries = [e for e in entries if e.get("type") == "assistant"]

    # Get agent ID from first entry
    first_entry = entries[0] if entries else {}
    agent_id = first_entry.get("agentId", agent_path.stem.replace("agent-", ""))

    # Timestamps
    all_timestamps = []
    for e in entries:
        ts = e.get("timestamp")
        if ts:
            try:
                all_timestamps.append(datetime.fromisoformat(ts.replace("Z", "+00:00")))
            except (ValueError, TypeError):
                pass

    created_at = min(all_timestamps) if all_timestamps else datetime.now(timezone.utc)
    updated_at = max(all_timestamps) if all_timestamps else datetime.now(timezone.utc)

    # Get name from first user message
    name = f"Agent {agent_id}"
    if user_entries:
        first_msg = user_entries[0].get("message", {})
        content = first_msg.get("content", "")
        if isinstance(content, str):
            name = content[:80].strip() or name
        elif isinstance(content, list):
            text_parts = [b.get("text", "") for b in content if b.get("type") == "text"]
            name = " ".join(text_parts)[:80].strip() or name

    # Get model
    model = ""
    if assistant_entries:
        msg = assistant_entries[0].get("message", {})
        model = msg.get("model", "")

    # Count messages
    message_count = len(user_entries) + len(assistant_entries)

    return {
        "uuid": agent_id,
        "agent_id": agent_id,
        "name": name,
        "model": model,
        "created_at": created_at,
        "updated_at": updated_at,
        "message_count": message_count,
    }


def read_agent_summary(agent_path: Path) -> dict[str, Any] | None:
    """Read summary metadata for an agent conversation."""
    entries = parse_jsonl_file(agent_path)
    if not entries:
        return None

    return _extract_agent_metadata(entries, agent_path)


def _load_conversation_cached(jsonl_path: Path) -> dict[str, Any] | None:
    """Load a full conversation with caching."""
    cache = get_conversation_cache()
    return cache.get_or_load(jsonl_path, read_claude_code_conversation)


def list_claude_code_conversations(
    claude_dir: Path = DEFAULT_CLAUDE_DIR,
    full_content: bool = False,
    include_phantom: bool = False,
) -> list[dict[str, Any]]:
    """List all Claude Code conversations from local JSONL files, including subagents.

    Args:
        claude_dir: Path to Claude config directory
        full_content: If True, read full conversation content (for search).
                     If False, only read metadata (fast, for listing).
        include_phantom: If True, include phantom sessions (local command artifacts).
                        Default False to hide these empty sessions.

    Features:
    - Uses orjson for ~5x faster JSON parsing
    - Caches parsed conversations with mtime-based invalidation
    - Parallel file reading when loading full content
    """
    # Build agent index once upfront - reads each agent file once and extracts summaries
    agent_index = build_agent_index_with_summaries(claude_dir)

    # Collect all file paths
    jsonl_paths = list(discover_jsonl_files(claude_dir))

    if full_content:
        # Use cache + parallel loading for full content
        cache = get_conversation_cache()
        conversations_raw = cache.load_many_parallel(
            jsonl_paths,
            read_claude_code_conversation,
        )
    else:
        # Metadata branch — read-through SQLite cache backed by
        # backend.summary_cache. The fast reader still opens every line
        # of every JSONL on a miss, but on a warm cache we only re-read
        # the small subset of files whose mtime/size has drifted since
        # the last request. orjson releases the GIL during decode so
        # the parallel-miss path scales with disk IO.
        from .summary_cache import get_summary_cache

        summary_cache = get_summary_cache()
        if summary_cache is None:
            # FTS5 missing or SQLite open failed — fall back to the
            # legacy sequential path. Same fallback discipline as
            # backend.search → linear-scan when the FTS5 index is
            # unavailable.
            conversations_raw = [
                read_conversation_summary_fast(p) for p in jsonl_paths
            ]
        else:
            # Pre-stat all paths once so both the hit and miss branches
            # share a single os.stat per file. Missing/unreadable paths
            # drop out here — read_conversation_summary_fast handles
            # the same case by returning None, which the filter below
            # already skips.
            stat_index: dict[Path, os.stat_result] = {}
            for p in jsonl_paths:
                try:
                    stat_index[p] = os.stat(p)
                except OSError:
                    continue

            # ``cached`` may map a path to None — that's a NEGATIVE
            # cache hit (the producer previously returned None for
            # this file and the file hasn't changed since). Treat
            # the presence of the key, not the value, as "hit".
            cached = summary_cache.get_many(jsonl_paths, stat_index)
            misses = [p for p in jsonl_paths if p not in cached]
            fresh = _read_summaries_parallel(misses)
            # Best-effort upsert. A SQLite write failure here just
            # means the next request takes the slow path again; it
            # must NOT block the response. We pass ``fresh`` as-is
            # so None entries get persisted as negative-cache rows.
            summary_cache.upsert_many(fresh, stat_index)

            # Preserve the original order so downstream sort/filter
            # behaves identically to the pre-cache path. None values
            # (from either negative cache hit or fresh None read)
            # propagate through; the downstream ``if conv:`` filter
            # drops them.
            conversations_raw = []
            for p in jsonl_paths:
                if p in cached:
                    conversations_raw.append(cached[p])
                elif p in fresh:
                    conversations_raw.append(fresh[p])
                else:
                    # stat failed earlier — preserve None so the
                    # downstream filter (``if conv:``) drops it.
                    conversations_raw.append(None)

    # Attach subagents to each conversation
    conversations = []
    for conv in conversations_raw:
        if conv:
            # Filter out phantom sessions unless explicitly requested
            if not include_phantom and conv.get("is_phantom", False):
                continue

            session_id = conv["uuid"]

            # Look up agent summaries from pre-built index (no additional file I/O)
            subagents = agent_index.get(session_id, [])

            # Sort subagents by created_at
            subagents = sorted(subagents, key=lambda a: a["created_at"])

            # Convert datetimes to ISO strings for JSON serialization
            for agent in subagents:
                if isinstance(agent["created_at"], datetime):
                    agent["created_at"] = agent["created_at"].isoformat()
                if isinstance(agent["updated_at"], datetime):
                    agent["updated_at"] = agent["updated_at"].isoformat()

            conv["subagents"] = subagents
            conversations.append(conv)

    return conversations