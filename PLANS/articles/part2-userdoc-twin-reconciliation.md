# Part 2 userdoc twin reconciliation

**Created:** 2026-05-31
**Status:** Deferred — run once the long-form is frozen (see Preconditions)
**Owner task:** bring `articles/part_2_web_app_userdoc.md` (userdoc twin) back into sync
with `articles/part_2_web_app.md` (long-form) after a session of heavy long-form edits.

## Problem

The long-form Part 2 (`articles/part_2_web_app.md`) absorbed a large batch of edits
this session (pane renames, the Performance reorg below Security, the `#### Snippet or
full message` subsection, the Emacs `⌘+F`/`Ctrl+F`/`forward-char` caveat, the
cross-platform `Option`/`Alt` note, the `surfaces`→`returns` verb fix, heading
capitalization, fabrication fixes, and more). The userdoc twin
(`articles/part_2_web_app_userdoc.md`) got *most* of the twin-shared changes, but the
author is ~99% sure some updates were missed. We need a reliable way to close the gap
without losing the userdoc's hand-tuned, already-approved prose.

## Decision: hybrid "twin reconciliation" (NOT a from-scratch rewrite, NOT a blind diff-replay)

Drive the pass from the **final long-form** (so coverage is guaranteed), but **edit the
existing userdoc surgically** (so approved prose and voice survive). Section by section.

### Why not a full from-scratch rewrite (the tempting "cleaner" option)
- Throws away approved, voice-tuned userdoc prose the author has corrected over many
  sessions (Emacs caveat, cross-platform note, pane names, "combined filter" wording…).
- Explodes the author's re-proofread burden: every paragraph becomes new and must be
  re-verified.
- Reopens the fabrication / paraphrase-drift door (cf. the SGI / Quantify slips).

### Why not a pure diff-replay
- The diff baseline is polluted: uncommitted session edits + author's Obsidian edits +
  an earlier write conflict mean `git diff` won't yield a clean changeset. Replaying an
  inaccurate diff is exactly how updates keep getting missed.
- Diffs miss *structure*: long-form reorgs (Performance moved) and new subsections
  (`#### Snippet or full message`) change the userdoc's shape, not just its text.

## Preconditions (do not start early)

- The long-form is **frozen**: ideally committed, or at minimum the author has stopped
  proofreading, so the reconciliation isn't chasing a moving target.
- Dual-editor hazard is real (a second Claude Code session and/or Obsidian have both
  written to these files). Confirm no other writer is active before editing. Re-snapshot
  the long-form right before starting.

## Procedure

1. **Walk the long-form outline** (its `##`/`###`/`####` sections) top to bottom. The
   long-form is the source of truth and the final state, so a full walk guarantees we
   can't silently miss a section.
2. **Classify each section against the userdoc**, one of:
   - **present-and-correct** → leave the userdoc prose untouched.
   - **present-but-stale** → surgical fix (smallest edit that makes it true).
   - **missing** → add a *compressed* userdoc version (behavior in plain English; stop).
   - **intentionally-omitted** → backend internals that the userdoc deliberately drops;
     record the reason so the omission is auditable, not accidental.
3. **Produce a reconciliation table for author review BEFORE editing** — one row per
   long-form section with its classification. Lets the author sanity-check the
   "belongs in userdoc / doesn't" calls without re-reading everything.
4. **Apply edits surgically**, preserving approved prose; keep the userdoc's own
   structure (it need not mirror the long-form 1:1).
5. **Guard checks** after editing:
   - **No-internals grep** (expect zero hits):
     ```bash
     rg -nE 'backend/|/api/|FTS5|schema v[0-9]+|isCompactSummary|launchd|systemd|sqlite|orjson|ThreadPoolExecutor' \
       articles/part_2_web_app_userdoc.md
     ```
   - **Voice scan** per `PROCESS/99_voice_cheatsheet.md`: active voice, no em-dashes,
     no "X, not Y", no verbless fragments, ⌘ glyph, "back end"/"front end" nouns.
   - **Twin-parity on claims**: every user-visible claim in the userdoc must match (not
     contradict) the long-form; the userdoc may say *less*, never something *different*.
6. **Diff cross-check at the end** (not as the driver): `git diff` the long-form since
   the last commit and confirm every change maps to a userdoc decision (applied, or
   intentionally-omitted with a reason).

## Deliverable

The reconciliation table (step 3) for author sign-off, then the surgically-updated
`articles/part_2_web_app_userdoc.md`, passing all step-5 guards.

## Notes / known deltas to verify during the walk (non-exhaustive)

These are long-form changes from this session whose userdoc counterparts should be
explicitly checked (some already applied, some may be the missed ones):

- Pane terminology: Conversation List / Conversation Pane / Search Pane (Title Case).
- `surfaces` → `returns` ("search never returns a hit you couldn't see in the viewer").
- `#### Snippet or full message` subsection (Snippet / Full toggle).
- Emacs section: `⌘+F` (and `Ctrl+F`) opens search vs `forward-char`; the decades-of-Emacs
  aside; `Option`/`Alt` cross-platform note; `⌘+F`/`⌘+C` removed from the nav list.
- Heading capitalization consistency.
- Any Performance-section deltas are long-form-only (internals) → userdoc omits by design.

## Scope

Primarily the Part 2 twins. The same reconciliation method generalizes to any
long-form ↔ userdoc twin pair in `articles/`.
