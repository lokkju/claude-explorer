#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# restore-deleted-sessions-and-images.sh
#
# Restore deleted Claude Code session JSONLs and image-cache PNGs from a
# mounted macOS Time Machine volume back into:
#
#     ~/.claude/projects/<project>/<session>.jsonl
#     ~/.claude/image-cache/<session-uuid>/<N>.png
#
# Why this exists
# ---------------
# Claude Code's `cleanupPeriodDays` setting in ~/.claude/settings.json
# (default 30) periodically deletes old session JSONLs and image-cache
# files. A previous companion utility, scripts/macos-restore-claude-projects.py,
# restores ONLY the projects/ subdirs. This script supersedes it for the
# common case where you also want the image-cache restored in the same
# pass.
#
# (Claude Desktop has its own cleanup behavior controlled by a different
# setting; that is out of scope here. This script only touches files
# under ~/.claude/, not ~/Library/Application Support/Claude/.)
#
# Semantics
# ---------
# 1. Latest copy always wins: snapshots are iterated newest-first, and
#    the FIRST snapshot containing any given relative path supplies the
#    bytes. (Time Machine keeps hourly/daily/weekly snapshots so a given
#    file usually exists in many; we want the most recent.)
#
# 2. No overwrite, ever: if a destination already exists on the live
#    filesystem, it is left untouched. This is safe because:
#      - project session JSONLs are append-only (Claude Code appends to
#        the live file; any TM-snapshot copy is by definition older);
#      - image-cache PNGs are content-addressed by per-session sequence
#        number, so same path == same content in practice.
#    Enforced two ways: an explicit `[ -e "$dst" ]` test AND `cp -n`.
#
# 3. Dry-run mode (`--dry-run`) prints the full plan and exits without
#    writing anything.
#
# 4. Read-only with respect to the TM volume. We never write to the
#    Time Machine destination.
#
# 5. Never destructive on the live filesystem. We do not `rm`, `mv`, or
#    `chmod` any pre-existing live file. The script only creates new
#    files and the parent directories they need.
#
# Time Machine layout
# -------------------
# Modern (APFS local snapshots, macOS 11+):
#     /Volumes/.timemachine/<volume-uuid>/<machine-uuid>/
#         <YYYY-MM-DD-HHMMSS>.backup/
#             <YYYY-MM-DD-HHMMSS>.backup/Data/Users/<user>/.claude/...
#
# Older (HFS+ external Time Machine destination):
#     <tm-volume>/Backups.backupdb/<hostname>/
#         <YYYY-MM-DD-HHMMSS>/
#             Macintosh HD - Data/Users/<user>/.claude/...
#         (or just Users/<user>/.claude/...)
#
# Both shapes are handled. Point `--tm-disk` at whichever directory
# directly contains the per-snapshot subdirectories (the machine-uuid
# dir for modern, the hostname dir for older).
#
# Full Disk Access
# ----------------
# macOS SIP requires the terminal app running this script to have Full
# Disk Access (System Settings -> Privacy & Security -> Full Disk
# Access). Without it, reads on snapshot directories return "Operation
# not permitted". The script prints a clear hint if it sees that error.
#
# Usage
# -----
#   ./utils/restore-deleted-sessions-and-images.sh --help
#
#   # Dry-run against modern APFS TM snapshots:
#   ./utils/restore-deleted-sessions-and-images.sh \
#       --tm-disk /Volumes/.timemachine/<volume-uuid>/<machine-uuid> \
#       --dry-run
#
#   # Actually restore:
#   ./utils/restore-deleted-sessions-and-images.sh \
#       --tm-disk /Volumes/.timemachine/<volume-uuid>/<machine-uuid>
#
# Companion utility
# -----------------
# scripts/macos-restore-claude-projects.py — projects-only Python
# version. Same TM-layout fallback list. Either one is safe to run;
# this bash script additionally restores image-cache.
# ---------------------------------------------------------------------------

set -u
# NOTE: deliberately NOT using `set -e`. We want to continue on per-file
# errors (e.g. one unreadable snapshot) rather than abort the whole run.
# Errors are counted and reported in the final summary.

# ---------------------------------------------------------------------------
# Defaults & globals
# ---------------------------------------------------------------------------
TM_DISK=""
DRY_RUN=0
# When 0 (default): abort the run if any snapshot can't be mounted /
# accessed. When 1 (--continue-on-mount-failure): skip those snapshots
# and proceed with what works. See the mount-loop below for the full
# rationale. Default is strict because silent skipping was the source
# of the 2026-05-25 "found 37 files out of 5 months of activity" bug.
CONTINUE_ON_MOUNT_FAILURE=0
# Domains the script restores. "projects" + "image-cache" live under
# ~/.claude/; "cowork" is the Claude Desktop local-agent-mode-sessions
# tree under ~/Library/Application Support/Claude/. Per-domain path
# resolution happens via domain_home_suffix / domain_live_root below.
DOMAINS=("projects" "image-cache" "cowork")

# Per-domain path under the TARGET user's home in a TM snapshot.
domain_home_suffix() {
    case "$1" in
        projects|image-cache)
            printf '.claude/%s\n' "$1"
            ;;
        cowork)
            printf 'Library/Application Support/Claude/local-agent-mode-sessions\n'
            ;;
        *)
            return 1
            ;;
    esac
}

# Per-domain LIVE destination root (where we restore TO).
domain_live_root() {
    case "$1" in
        projects|image-cache)
            printf '%s/%s\n' "$LIVE_BASE" "$1"
            ;;
        cowork)
            printf '%s/Library/Application Support/Claude/local-agent-mode-sessions\n' \
                "$TARGET_HOME"
            ;;
        *)
            return 1
            ;;
    esac
}

# Per-domain allow-list filter on the restore plan. Returns 0 if the
# relpath should be restored, 1 if it should be skipped. For projects /
# image-cache there's no filter (legacy semantics — restore everything
# under the domain). For cowork we restore ONLY the two files our
# reader actually consumes:
#   <deployment>/<org>/local_<uuid>.json           (sidecar)
#   <deployment>/<org>/local_<uuid>/audit.jsonl    (messages)
# Skipped: outputs/, uploads/, shim-lib/, shim-perm/, .claude/,
# .audit-key — these are Cowork runtime artifacts the explorer
# doesn't read and restoring them would bloat disk usage by ~10x.
domain_allow_relpath() {
    local domain="$1"
    local relpath="$2"
    case "$domain" in
        cowork)
            case "$relpath" in
                */audit.jsonl)              return 0 ;;
                */local_*.json)             return 0 ;;
                local_*.json)               return 0 ;;
                *)                          return 1 ;;
            esac
            ;;
        *)
            return 0
            ;;
    esac
}

# Resolve target user. If we're under sudo, prefer the original user.
if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
    TARGET_USER="$SUDO_USER"
    # Re-resolve HOME for that user via dscl (works on macOS).
    if command -v dscl >/dev/null 2>&1; then
        TARGET_HOME="$(dscl . -read "/Users/${TARGET_USER}" NFSHomeDirectory 2>/dev/null \
            | awk '{print $2}')"
    fi
    if [ -z "${TARGET_HOME:-}" ]; then
        TARGET_HOME="/Users/${TARGET_USER}"
    fi
else
    TARGET_USER="${USER:-$(id -un)}"
    TARGET_HOME="${HOME}"
fi

LIVE_BASE="${TARGET_HOME}/.claude"

# Counters (one set per domain, kept as parallel arrays so we stay
# bash-3.2 compatible: no associative arrays).
declare -a COUNT_FOUND
declare -a COUNT_SKIPPED
declare -a COUNT_RESTORED
declare -a COUNT_FAILED
for _ in "${DOMAINS[@]}"; do
    COUNT_FOUND+=(0)
    COUNT_SKIPPED+=(0)
    COUNT_RESTORED+=(0)
    COUNT_FAILED+=(0)
done

# Permission-denied tally (helps us print the FDA hint exactly once).
PERM_DENIED_SEEN=0

# Working dir for per-domain plan files (one line per (relpath, src)).
WORK_DIR=""

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
log()    { printf '%s\n' "$*"; }
warn()   { printf 'WARN: %s\n' "$*" >&2; }
error()  { printf 'ERROR: %s\n' "$*" >&2; }
plan()   { printf '[plan] %s\n' "$*"; }
note()   { printf '[info] %s\n' "$*"; }

usage() {
    cat <<'EOF'
Restore deleted Claude Code session JSONLs, image-cache PNGs, AND
Claude Desktop Cowork session files from a mounted macOS Time Machine
volume.

USAGE
    utils/restore-deleted-sessions-and-images.sh [options]

    With NO arguments: auto-detects the latest Time Machine snapshot
    via `tmutil latestbackup`. No need to dig out volume / machine
    UUIDs — just have a TM destination mounted and the script does the
    rest. To override (multi-TM setups, non-standard layouts), pass
    --tm-disk explicitly.

OPTIONS
    --tm-disk <path>   Directory containing per-snapshot subdirectories.
                       Auto-detected from `tmutil latestbackup` when
                       omitted. Explicit values typically look like:
                         /Volumes/.timemachine/<volume-uuid>             (APFS)
                         /Volumes/<TM-disk>/Backups.backupdb/<hostname>  (HFS+)
    --dry-run          Print the plan; do not copy any files. (Run
                       this FIRST every time — read the plan to make
                       sure the paths look right before applying.)
    --continue-on-mount-failure
                       Skip snapshots that cannot be mounted instead of
                       aborting. Default is strict (abort on any mount
                       failure) so a partial-history scan never silently
                       ships as if it were complete. Pass this when you
                       know some snapshots are unavailable and you want
                       the rest anyway. Without sudo, mounting is
                       always impossible — use this flag if you want
                       to scan whatever's already mounted.
    --user <name>      Target user (default: $SUDO_USER if set, else $USER).
                       Determines which user's home directory we read
                       from each TM snapshot AND where files are
                       restored to.
    --home <path>      Override the live HOME directory (default: resolved
                       from --user via dscl). Useful for testing or when
                       restoring into a non-standard location.
    -h, --help         Show this help and exit.

BEHAVIOR
    * Latest-copy-wins: newest snapshot containing a given relative path
      supplies the bytes.
    * Never overwrites a file that already exists on the live filesystem.
    * Three domains restored:
        $HOME/.claude/projects/<project>/<session>.jsonl
        $HOME/.claude/image-cache/<session-uuid>/<N>.png
        $HOME/Library/Application Support/Claude/local-agent-mode-sessions/...

REQUIREMENTS
    * macOS with an attached / mounted Time Machine destination.
    * Terminal needs Full Disk Access (System Settings -> Privacy &
      Security -> Full Disk Access). Without it, snapshot reads fail
      with "Operation not permitted" — the script detects and reports.

EXAMPLES
    # Dry-run with auto-detect (recommended starting point):
    ./utils/restore-deleted-sessions-and-images.sh --dry-run

    # Apply with auto-detect:
    ./utils/restore-deleted-sessions-and-images.sh

    # Override the auto-detected path (multi-TM, non-standard layouts):
    ./utils/restore-deleted-sessions-and-images.sh \
        --tm-disk /Volumes/.timemachine/<volume-uuid> \
        --dry-run

    # Find paths manually if auto-detect doesn't work:
    tmutil latestbackup            # newest snapshot full path
    ls /Volumes/.timemachine/*     # APFS volume UUIDs
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
# Capture the user's original argv so the "re-run with sudo" hint can
# echo it back verbatim. Defined before the parse loop consumes "$@".
ORIGINAL_ARGS="$*"

while [ $# -gt 0 ]; do
    case "$1" in
        --tm-disk)
            shift
            if [ $# -eq 0 ]; then
                error "--tm-disk requires a path argument"
                exit 2
            fi
            TM_DISK="$1"
            ;;
        --tm-disk=*)
            TM_DISK="${1#--tm-disk=}"
            ;;
        --dry-run)
            DRY_RUN=1
            ;;
        --continue-on-mount-failure)
            CONTINUE_ON_MOUNT_FAILURE=1
            ;;
        --user)
            shift
            if [ $# -eq 0 ]; then
                error "--user requires a username argument"
                exit 2
            fi
            TARGET_USER="$1"
            if command -v dscl >/dev/null 2>&1; then
                TARGET_HOME="$(dscl . -read "/Users/${TARGET_USER}" NFSHomeDirectory 2>/dev/null \
                    | awk '{print $2}')"
            fi
            if [ -z "${TARGET_HOME:-}" ]; then
                TARGET_HOME="/Users/${TARGET_USER}"
            fi
            LIVE_BASE="${TARGET_HOME}/.claude"
            ;;
        --user=*)
            TARGET_USER="${1#--user=}"
            if command -v dscl >/dev/null 2>&1; then
                TARGET_HOME="$(dscl . -read "/Users/${TARGET_USER}" NFSHomeDirectory 2>/dev/null \
                    | awk '{print $2}')"
            fi
            if [ -z "${TARGET_HOME:-}" ]; then
                TARGET_HOME="/Users/${TARGET_USER}"
            fi
            LIVE_BASE="${TARGET_HOME}/.claude"
            ;;
        --home)
            shift
            if [ $# -eq 0 ]; then
                error "--home requires a path argument"
                exit 2
            fi
            TARGET_HOME="$1"
            LIVE_BASE="${TARGET_HOME}/.claude"
            ;;
        --home=*)
            TARGET_HOME="${1#--home=}"
            LIVE_BASE="${TARGET_HOME}/.claude"
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        --)
            shift
            break
            ;;
        -*)
            error "Unknown option: $1"
            echo "Try --help" >&2
            exit 2
            ;;
        *)
            error "Unexpected positional argument: $1"
            echo "Try --help" >&2
            exit 2
            ;;
    esac
    shift
done

# ---------------------------------------------------------------------------
# Snapshot-discovery helpers (used by auto-detect AND main flow below).
# Hoisted above the auto-detect block so it can probe candidate dirs.
# ---------------------------------------------------------------------------

# Returns 0 if $1 matches a snapshot-dir name, 1 otherwise.
is_snapshot_name() {
    case "$1" in
        [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].backup) return 0 ;;
        [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9])        return 0 ;;
    esac
    return 1
}

# List snapshot dirs under $1, newest-first (lexicographic == chronological
# because names are zero-padded). Empty output ⇒ no snapshots here.
list_snapshots_in() {
    local root="$1"
    if [ ! -d "$root" ]; then
        return 1
    fi
    local entry name
    for entry in "$root"/*; do
        [ -d "$entry" ] || continue
        name="${entry##*/}"
        if is_snapshot_name "$name"; then
            printf '%s\n' "$entry"
        fi
    done 2>/dev/null | sort -r
}

# ---------------------------------------------------------------------------
# Auto-detect TM_DISK via `tmutil latestbackup` (2026-05-25 UX polish).
# Avoids forcing the user to dig out volume + machine UUIDs by hand.
#
# `tmutil latestbackup` returns the most recent snapshot path. Real shape:
#
#   Modern APFS: /Volumes/.timemachine/<vol-uuid>/<ts>.backup/<ts>.backup
#   Older HFS+:  /Volumes/<tm-vol>/Backups.backupdb/<host>/<ts>
#
# The snapshot-CONTAINING directory (what `--tm-disk` expects) is 1 or 2
# `dirname` levels above. We walk up looking for the first ancestor whose
# children look like snapshot dirs (per is_snapshot_name above). Bounded
# to 6 hops so a pathological tmutil output can't run away.
# ---------------------------------------------------------------------------
auto_detect_tm_disk() {
    command -v tmutil >/dev/null 2>&1 || return 1
    local latest
    latest=$(tmutil latestbackup 2>/dev/null) || return 1
    [ -n "$latest" ] || return 1

    local candidate="$latest"
    local hops=0
    while [ "$candidate" != "/" ] && [ "$candidate" != "." ] && [ $hops -lt 6 ]; do
        candidate="$(dirname "$candidate")"
        hops=$((hops + 1))
        if [ -n "$(list_snapshots_in "$candidate" 2>/dev/null || true)" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    return 1
}

if [ -z "$TM_DISK" ]; then
    if AUTO_DETECTED=$(auto_detect_tm_disk); then
        TM_DISK="$AUTO_DETECTED"
        note "Auto-detected --tm-disk via 'tmutil latestbackup': $TM_DISK"
    else
        error "--tm-disk is required and auto-detect via 'tmutil latestbackup' failed."
        if ! command -v tmutil >/dev/null 2>&1; then
            error "  (tmutil is not on PATH — auto-detect needs it. This script is macOS-only.)"
        else
            error "  ('tmutil latestbackup' returned no usable path. Is a Time Machine"
            error "   destination mounted? Try: tmutil destinationinfo)"
        fi
        echo "" >&2
        echo "To find the path manually, run one of:" >&2
        echo "  tmutil latestbackup            # newest snapshot full path" >&2
        echo "  ls /Volumes/.timemachine/*     # APFS TM volume UUIDs" >&2
        echo "Then pass the snapshot-CONTAINING directory as --tm-disk." >&2
        echo "See --help for examples." >&2
        exit 2
    fi
fi

if [ ! -d "$TM_DISK" ]; then
    error "--tm-disk does not exist or is not a directory: $TM_DISK"
    exit 1
fi

# Strip trailing slash for tidy output.
TM_DISK="${TM_DISK%/}"

note "Target user:      $TARGET_USER"
note "Target HOME:      $TARGET_HOME"
note "Live base:        $LIVE_BASE"
note "Time Machine:     $TM_DISK"
if [ "$DRY_RUN" -eq 1 ]; then
    note "Mode:             DRY RUN (no files will be written)"
else
    note "Mode:             APPLY (files will be copied; existing files NEVER overwritten)"
fi
echo

# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------
WORK_DIR="$(mktemp -d -t restore-claude.XXXXXX)" || {
    error "could not create temp dir"
    exit 1
}
trap 'rm -rf "$WORK_DIR"' EXIT

# ---------------------------------------------------------------------------
# Snapshot discovery
# ---------------------------------------------------------------------------
# Helpers (`is_snapshot_name`, `list_snapshots_in`) defined earlier so the
# auto-detect block above can use them.
#
# A "snapshot dir" is one that matches YYYY-MM-DD-HHMMSS.backup (modern
# APFS) OR YYYY-MM-DD-HHMMSS (older HFS+ TM destination). We look for
# entries directly inside $TM_DISK; if none match, descend one level to
# accommodate users who pointed --tm-disk at the volume root.

# Pre-flight FDA check on $TM_DISK itself. The shell `[ -d ]` builtin
# we relied on earlier never sets stderr on permission failures — and
# `list_snapshots_in` swallows stderr too — so without this an FDA-
# blocked TM root reads as "empty" and the user gets the misleading
# "no snapshot directories" error below. Probe with `ls`, which DOES
# emit "Operation not permitted" to stderr.
TM_DISK_PROBE_ERR="$WORK_DIR/tm_disk_probe.err"
if ! ls -- "$TM_DISK" >/dev/null 2>"$TM_DISK_PROBE_ERR"; then
    if grep -q 'Operation not permitted\|Permission denied' "$TM_DISK_PROBE_ERR"; then
        error "Cannot read --tm-disk: $TM_DISK"
        error "macOS requires Full Disk Access on the terminal app running this script."
        error "  1. Open System Settings -> Privacy & Security -> Full Disk Access"
        error "  2. Add (or enable) your terminal app (Terminal, iTerm, Ghostty, etc.)"
        error "  3. Re-launch the terminal, then re-run this script."
        error ""
        error "Probe error:"
        sed 's/^/    /' "$TM_DISK_PROBE_ERR" >&2
        exit 1
    fi
    error "ls failed on --tm-disk: $TM_DISK"
    sed 's/^/    /' "$TM_DISK_PROBE_ERR" >&2
    exit 1
fi

# Try $TM_DISK as the snapshot parent first; if nothing matches, descend
# one level. This lets the user pass either:
#   /Volumes/.timemachine/<volume-uuid>/<machine-uuid>   (preferred)
#   /Volumes/.timemachine/<volume-uuid>                  (we descend)
SNAPSHOTS_RAW="$(list_snapshots_in "$TM_DISK" || true)"
if [ -z "$SNAPSHOTS_RAW" ]; then
    # Descend one level
    for sub in "$TM_DISK"/*; do
        [ -d "$sub" ] || continue
        deeper="$(list_snapshots_in "$sub" || true)"
        if [ -n "$deeper" ]; then
            SNAPSHOTS_RAW="$deeper"
            note "Descended into: $sub"
            break
        fi
    done
fi

if [ -z "$SNAPSHOTS_RAW" ]; then
    error "no snapshot directories (matching YYYY-MM-DD-HHMMSS[.backup]) found under: $TM_DISK"
    echo "Hint: point --tm-disk at the directory that directly contains the" >&2
    echo "      per-snapshot folders. On modern macOS that is typically" >&2
    echo "      /Volumes/.timemachine/<volume-uuid>/<machine-uuid> (NOT the" >&2
    echo "      user-friendly /Volumes/<TM-name> mount, which only contains" >&2
    echo "      a 'Backups.backupdb' or symlink, not the snapshots themselves)." >&2
    echo "" >&2
    echo "      Discover the canonical path with (after granting FDA):" >&2
    echo "          tmutil destinationinfo" >&2
    echo "          tmutil latestbackup" >&2
    exit 1
fi

# Materialize into an array.
SNAPSHOTS=()
while IFS= read -r line; do
    [ -n "$line" ] && SNAPSHOTS+=("$line")
done <<EOF
$SNAPSHOTS_RAW
EOF

note "Found ${#SNAPSHOTS[@]} snapshot directory entries. Newest: ${SNAPSHOTS[0]##*/}; Oldest: ${SNAPSHOTS[$((${#SNAPSHOTS[@]}-1))]##*/}"

# ---------------------------------------------------------------------------
# Orphan-stub filter (APFS mode only).
#
# On the user's machine, /Volumes/.timemachine/<vol-uuid>/ had 767
# .backup directory entries but `diskutil apfs listSnapshots` reported
# only 37 real APFS snapshots. Apple keeps stub dirs after purging the
# backing data; reading them silently returns "" (the original
# "37 files / 5 months of activity" bug). Filter the array down to
# stubs whose basename appears in the real-snapshot list.
#
# HFS+ TM mode is untouched — no /Volumes/.timemachine/ path, no
# diskutil-snapshot model, the dirs hold actual files directly.
# ---------------------------------------------------------------------------
case "$TM_DISK" in
    /Volumes/.timemachine/*)
        # Inline device discovery (the dedicated helpers are defined
        # later in this file, alongside the mount-on-demand block).
        TM_VOL_UUID=$(printf '%s' "${SNAPSHOTS[0]}" | sed -nE 's|^/Volumes/\.timemachine/([0-9A-Fa-f-]+)(/.*)?$|\1|p')
        if [ -n "$TM_VOL_UUID" ]; then
            TM_DEV=$(diskutil info "$TM_VOL_UUID" 2>/dev/null | awk -F': +' '/Device Node:/ {gsub(/^[ \t]+/, "", $2); print $2; exit}')
        else
            TM_DEV=""
        fi
        if [ -n "$TM_DEV" ]; then
            REAL_NAMES_FILE="$WORK_DIR/real-snapshots.txt"
            diskutil apfs listSnapshots "$TM_DEV" 2>/dev/null | awk '
                /Name:[[:space:]]*com\.apple\.TimeMachine\./ {
                    name = $NF
                    sub(/^com\.apple\.TimeMachine\./, "", name)
                    print name
                }
            ' > "$REAL_NAMES_FILE"
            REAL_COUNT=$(wc -l < "$REAL_NAMES_FILE" | tr -d ' ')
            if [ "$REAL_COUNT" -gt 0 ]; then
                FILTERED=()
                for snap in "${SNAPSHOTS[@]}"; do
                    base="${snap##*/}"
                    if grep -Fxq -- "$base" "$REAL_NAMES_FILE"; then
                        FILTERED+=("$snap")
                    fi
                done
                ORPHAN_COUNT=$((${#SNAPSHOTS[@]} - ${#FILTERED[@]}))
                if [ "$ORPHAN_COUNT" -gt 0 ]; then
                    note "Filtered ${ORPHAN_COUNT} orphan stub dir(s) → ${#FILTERED[@]} real APFS snapshot(s) on ${TM_DEV}"
                fi
                SNAPSHOTS=("${FILTERED[@]}")
            else
                warn "diskutil apfs listSnapshots returned no results for $TM_DEV — proceeding with all stubs (mounts may fail for purged backups)"
            fi
        else
            warn "Could not resolve TM device via diskutil — proceeding with all stubs (mounts may fail)"
        fi
        ;;
esac

if [ "${#SNAPSHOTS[@]}" -eq 0 ]; then
    error "After orphan filter, no real APFS snapshots remain to scan."
    error "This usually means Time Machine purged all backup data."
    exit 1
fi
echo

# ---------------------------------------------------------------------------
# Pre-flight: non-root short-circuit.
#
# On the user's machine the mount loop tried to mount 766 snapshots
# (each call shells out to mount(8), ~30ms each → ~23s of wasted work)
# before aborting because none of them succeeded. Cause: snapshot
# mounting REQUIRES root; running without sudo is fundamentally
# unworkable against real APFS Time Machine snapshots.
#
# Peek at SNAPSHOTS[0]. If it's empty (i.e. mounting would be needed)
# AND we're not root AND --continue-on-mount-failure isn't set, bail
# immediately with the sudo hint. This costs ~5ms instead of ~23s on
# the failure path.
#
# We don't blanket-refuse non-root because the test suite passes
# pre-populated snapshot fixtures (ls -A returns content, no mounting
# needed) — the test path stays green and the real-user path stays
# fast.
# ---------------------------------------------------------------------------
if [ "$(id -u)" -ne 0 ] && [ "$CONTINUE_ON_MOUNT_FAILURE" -eq 0 ]; then
    if [ -z "$(ls -A -- "${SNAPSHOTS[0]}" 2>/dev/null | head -1)" ]; then
        error "Snapshot mounting requires root, but this script is running as"
        error "user $(id -un) (uid $(id -u))."
        error ""
        error "Time Machine on modern macOS stores APFS snapshots as empty"
        error "mount-point stubs; macOS lazily mounts the data on access via"
        error "a syscall that requires root. Without sudo we cannot read"
        error "snapshot contents."
        error ""
        error "Re-run with sudo:"
        if [ -n "$ORIGINAL_ARGS" ]; then
            error "  sudo $0 $ORIGINAL_ARGS"
        else
            error "  sudo $0"
        fi
        error ""
        error "Or pass --continue-on-mount-failure to scan only the snapshots"
        error "that happen to be already mounted (results will be incomplete"
        error "and likely misleading)."
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# Snapshot mount-on-demand (2026-05-25 — APFS Time Machine).
#
# Modern macOS Time Machine stores snapshots in two forms:
#
#   1. APFS snapshots on the backup volume — accessed via mount-point
#      stubs at /Volumes/.timemachine/<vol-uuid>/<ts>.backup/. The
#      stubs are empty until macOS lazy-mounts them on syscall access
#      (Finder + tmutil + the private MobileBackup framework).
#
#   2. Orphaned mount-point dirs — Apple keeps the directory entry
#      AFTER purging the underlying snapshot data, so a TM disk with
#      37 real snapshots can have 767 stub dirs (the user's machine).
#      Reading from an orphan returns "" / ENOENT — silent emptiness
#      was the original 2026-05-25 "37 files / 5 months of activity"
#      bug.
#
# Approach (after two failed mount-syntax attempts diagnosed via
# /tmp/tm-mount-probe.sh + /tmp/tm-snapshot-probe.sh on the user's
# machine):
#
#   * Get the canonical real-snapshot list from
#     `diskutil apfs listSnapshots <device>` and intersect it with the
#     stub-dir listing. We only try to mount paths that actually have
#     backing snapshot data.
#   * Mount each via `mount_apfs -s <name> -o ro,nobrowse <device>
#     <mount-point>`. We use `mount_apfs` directly because `mount -t
#     apfs -s` is rejected by mount(8) — `-s` is APFS-specific and
#     the front-end mount tool doesn't pass it through.
#   * Discover the device by extracting the <vol-uuid> from the
#     TM_DISK path and feeding it to `diskutil info`. Sniffing the
#     `mount` table works only when something is already mounted;
#     diskutil is reliable on a fresh boot.
#   * Track what we mounted; unmount at exit. Mounting requires root;
#     the upfront pre-flight (above) refuses non-root before we get
#     here.
# ---------------------------------------------------------------------------

# Track snapshots we mounted so we can unmount on exit.
MOUNTED_BY_US=()
unmount_us() {
    local snap
    for snap in "${MOUNTED_BY_US[@]:-}"; do
        umount -- "$snap" 2>/dev/null || true
    done
}
# Compose with existing rm trap: re-set trap to run BOTH.
trap 'unmount_us; rm -rf "$WORK_DIR"' EXIT

# Get the APFS device for the TM volume that owns the given snapshot
# mount-point path. Path shape:
#   /Volumes/.timemachine/<vol-uuid>/<ts>.backup
# The <vol-uuid> resolves via `diskutil info <uuid>` to a /dev/diskNsM
# device node. This works without root and without any snapshot being
# currently mounted — improves on the prior "sniff existing mounts"
# approach which returned nothing on a freshly-booted machine.
get_tm_device_for_path() {
    local snap_path="$1"
    local vol_uuid
    vol_uuid=$(printf '%s' "$snap_path" | sed -nE 's|^/Volumes/\.timemachine/([0-9A-Fa-f-]+)(/.*)?$|\1|p')
    if [ -z "$vol_uuid" ]; then
        return 1
    fi
    diskutil info "$vol_uuid" 2>/dev/null | awk -F': +' '/Device Node:/ {gsub(/^[ \t]+/, "", $2); print $2; exit}'
}

# Return the basenames of real APFS snapshots on $device whose names
# start with "com.apple.TimeMachine." — one per line, basename form
# (e.g., "2025-06-27-035911.backup"), matching the mount-stub dirname.
list_real_snapshot_basenames() {
    local device="$1"
    diskutil apfs listSnapshots "$device" 2>/dev/null | awk '
        /Name:[[:space:]]*com\.apple\.TimeMachine\./ {
            name = $NF
            sub(/^com\.apple\.TimeMachine\./, "", name)
            print name
        }
    '
}

# True if $1 is currently mounted (appears in `mount` output as a target).
is_snapshot_mounted() {
    mount | awk -v target=" on $1 " 'index($0, target) > 0 { found=1 } END { exit !found }'
}

# Try to mount snapshot $1. Returns 0 on success, 1 on failure.
# Captures stderr to $WORK_DIR/mount.err for first-failure diagnostics.
mount_snapshot() {
    local snap="$1"
    local name="${snap##*/}"  # e.g., 2026-05-24-125914.backup
    local device
    device=$(get_tm_device_for_path "$snap")
    if [ -z "$device" ]; then
        return 1
    fi
    # mount_apfs (NOT `mount -t apfs -s`): the front-end mount(8)
    # rejects `-s` as illegal. mount_apfs is the canonical Apple binary
    # for snapshot mounting; `man mount_apfs` documents the form
    # `mount_apfs [-o options] -s snap special node`.
    local err_log="$WORK_DIR/mount.err"
    if mount_apfs -s "com.apple.TimeMachine.${name}" -o ro,nobrowse "$device" "$snap" 2>>"$err_log"; then
        MOUNTED_BY_US+=("$snap")
        return 0
    fi
    return 1
}

# A snapshot dir is "accessible" if (a) it has any contents we can
# scan (already mounted, or a test fixture pre-populated by pytest)
# OR (b) we successfully mounted it ourselves. Empty-and-unmountable
# is the failure mode the abort guards against.
ensure_snapshot_accessible() {
    local snap="$1"
    # Has contents → already accessible.
    if [ -n "$(ls -A -- "$snap" 2>/dev/null | head -1)" ]; then
        return 0
    fi
    # Empty → likely unmounted APFS snapshot. Try to mount it.
    if mount_snapshot "$snap"; then
        return 0
    fi
    return 1
}

# Pre-flight: ensure every snapshot we'll scan is accessible.
MOUNT_FAIL_COUNT=0
MOUNT_FAIL_FIRST=""
for snap in "${SNAPSHOTS[@]}"; do
    if ! ensure_snapshot_accessible "$snap"; then
        MOUNT_FAIL_COUNT=$((MOUNT_FAIL_COUNT + 1))
        if [ -z "$MOUNT_FAIL_FIRST" ]; then
            MOUNT_FAIL_FIRST="$snap"
        fi
    fi
done

if [ "$MOUNT_FAIL_COUNT" -gt 0 ]; then
    if [ "$CONTINUE_ON_MOUNT_FAILURE" -eq 1 ]; then
        warn "${MOUNT_FAIL_COUNT} snapshot(s) were unmountable and will be skipped"
        warn "(--continue-on-mount-failure set). First failure: $MOUNT_FAIL_FIRST"
        if [ "$(id -u)" -ne 0 ]; then
            warn "Note: snapshot mounting requires root. Re-run with sudo to access more."
        fi
    else
        error "${MOUNT_FAIL_COUNT} snapshot(s) could not be mounted; aborting to avoid"
        error "shipping a misleading partial-history scan."
        error "First failure: $MOUNT_FAIL_FIRST"
        if [ "$(id -u)" -ne 0 ]; then
            error ""
            error "Snapshot mounting requires root. Re-run with sudo:"
            if [ -n "$ORIGINAL_ARGS" ]; then
                error "  sudo $0 $ORIGINAL_ARGS"
            else
                error "  sudo $0"
            fi
        fi
        error ""
        error "Or pass --continue-on-mount-failure to skip unmountable snapshots"
        error "and proceed with the rest."
        exit 1
    fi
fi
if [ "${#MOUNTED_BY_US[@]:-0}" -gt 0 ]; then
    note "Mounted ${#MOUNTED_BY_US[@]} snapshot(s) on demand (will unmount at exit)"
    echo
fi

# ---------------------------------------------------------------------------
# Full Disk Access probe
# ---------------------------------------------------------------------------
# macOS SIP blocks reads into Time Machine snapshots unless the terminal
# app running this script has Full Disk Access. The shell `[ -d ]`
# builtin used elsewhere never emits stderr on permission failures, so
# without this explicit probe a missing-FDA condition is indistinguish-
# able from "no Claude data in any snapshot". We probe with `ls` (which
# DOES emit "Operation not permitted" to stderr) against the newest
# snapshot and bail loudly if it's blocked.
FDA_PROBE_ERR="$WORK_DIR/fda_probe.err"
if ! ls -- "${SNAPSHOTS[0]}" >/dev/null 2>"$FDA_PROBE_ERR"; then
    if grep -q 'Operation not permitted\|Permission denied' "$FDA_PROBE_ERR"; then
        error "Cannot read inside Time Machine snapshots."
        error "macOS requires Full Disk Access on the terminal app running this script."
        error "  1. Open System Settings -> Privacy & Security -> Full Disk Access"
        error "  2. Add (or enable) your terminal app (Terminal, iTerm, Ghostty, etc.)"
        error "  3. Re-launch the terminal, then re-run this script (with sudo)."
        error ""
        error "Probe error (newest snapshot ${SNAPSHOTS[0]}):"
        sed 's/^/    /' "$FDA_PROBE_ERR" >&2
        exit 1
    fi
    # Some other failure (e.g. unmount race) — print and continue, since
    # later snapshots may still be readable.
    warn "ls failed on newest snapshot: ${SNAPSHOTS[0]}"
    warn "Continuing, but results may be incomplete."
fi
rm -f "$FDA_PROBE_ERR"

# ---------------------------------------------------------------------------
# Per-backup base path discovery
# ---------------------------------------------------------------------------
# For a single backup path and a single domain ("projects" or
# "image-cache"), return the first existing candidate path, or empty
# string if none.
resolve_domain_base_in_backup() {
    local backup="$1"
    local domain="$2"
    local suffix
    suffix="$(domain_home_suffix "$domain")" || return 1
    local backup_name="${backup##*/}"
    local cands=(
        "$backup/$backup_name/Data/Users/$TARGET_USER/$suffix"
        "$backup/Macintosh HD - Data/Users/$TARGET_USER/$suffix"
        "$backup/Macintosh HD/Users/$TARGET_USER/$suffix"
        "$backup/Data/Users/$TARGET_USER/$suffix"
        "$backup/Users/$TARGET_USER/$suffix"
    )
    # Note: `[ -d ]` is a shell builtin that exits 0/1; it does NOT emit
    # stderr on permission-denied. So we cannot detect FDA-blocked dirs
    # here — that check is done up front with an explicit `ls` probe.
    local c
    for c in "${cands[@]}"; do
        if [ -d "$c" ]; then
            printf '%s\n' "$c"
            return 0
        fi
    done
    # Last-resort: some snapshots nest under any *.backup grandchild.
    local v
    for v in "$backup"/*.backup; do
        [ -d "$v" ] || continue
        c="$v/Data/Users/$TARGET_USER/$suffix"
        if [ -d "$c" ]; then
            printf '%s\n' "$c"
            return 0
        fi
    done
    return 1
}

# ---------------------------------------------------------------------------
# Index phase: walk snapshots newest -> oldest, record first-seen src
# for every relative path under each domain.
# ---------------------------------------------------------------------------
#
# Plan-file format (one per domain), written to $WORK_DIR/plan.<domain>:
#     <relpath>\0<absolute-source-path>\0   (NUL-delimited pairs)
# NUL delimiters keep us safe against pathological filenames containing
# tabs or newlines. Built by appending only when the relpath is NEW
# (not already in seen set), enforced by a parallel seen-set file
# plan.<domain>.seen which we grep -F for membership.
#
# Bash 3.2 lacks associative arrays, so the seen-set is a sorted file
# checked with grep. For our scale (a few thousand files at most) this
# is plenty fast. The seen-set is newline-delimited; in the extremely
# unlikely case a relpath contains a literal newline, the dup guard
# might miss — but cp -n + [ -e dst ] in the apply phase prevent any
# overwrite or data loss regardless.

index_domain() {
    local domain_idx="$1"
    local domain="${DOMAINS[$domain_idx]}"
    local plan_file="$WORK_DIR/plan.$domain"
    local seen_file="$WORK_DIR/seen.$domain"
    : > "$plan_file"
    : > "$seen_file"

    local snap base relpath src
    for snap in "${SNAPSHOTS[@]}"; do
        base="$(resolve_domain_base_in_backup "$snap" "$domain" 2>/dev/null || true)"
        if [ -z "$base" ]; then
            continue
        fi
        # Walk all regular files under base. Use find with -print0 and
        # a while-read NUL loop to be safe with weird filenames.
        # Suppress permission errors but tally them.
        local find_err
        find_err="$WORK_DIR/find.err.$$"
        : > "$find_err"
        while IFS= read -r -d '' src; do
            relpath="${src#"$base"/}"
            # Skip if already seen (newer snapshot already supplied it).
            if grep -Fxq -- "$relpath" "$seen_file" 2>/dev/null; then
                continue
            fi
            # Per-domain allow-list. For cowork this drops everything
            # except audit.jsonl + local_<uuid>.json sidecars, so we
            # don't restore gigabytes of runtime artifacts (outputs/,
            # uploads/, etc.) the explorer doesn't read.
            if ! domain_allow_relpath "$domain" "$relpath"; then
                continue
            fi
            # NUL-delimited pair to plan file; newline-delimited
            # relpath to seen file (see comment above).
            printf '%s\0%s\0' "$relpath" "$src" >> "$plan_file"
            printf '%s\n' "$relpath" >> "$seen_file"
        done < <(find "$base" -type f -print0 2>"$find_err")

        if [ -s "$find_err" ]; then
            if grep -q 'Operation not permitted\|Permission denied' "$find_err"; then
                PERM_DENIED_SEEN=1
            fi
        fi
        rm -f "$find_err"
    done

    # Each record writes two NULs (relpath\0src\0); count NULs / 2.
    local nul_count
    nul_count=$(tr -cd '\0' < "$plan_file" | wc -c | tr -d ' ')
    COUNT_FOUND[domain_idx]=$((nul_count / 2))
}

# Run the index phase per domain.
for i in "${!DOMAINS[@]}"; do
    note "Indexing domain: ${DOMAINS[$i]} (across ${#SNAPSHOTS[@]} snapshot(s))"
    index_domain "$i"
    note "  Unique files ever seen in TM: ${COUNT_FOUND[$i]}"
done
echo

if [ "$PERM_DENIED_SEEN" -eq 1 ]; then
    warn "Some snapshot reads returned 'Operation not permitted'."
    warn "macOS requires Full Disk Access on the terminal app running this script."
    warn "  System Settings -> Privacy & Security -> Full Disk Access -> add your terminal."
    warn "Also re-run with 'sudo' if you haven't already."
    echo
fi

# ---------------------------------------------------------------------------
# Diff & restore phase
# ---------------------------------------------------------------------------
restore_domain() {
    local domain_idx="$1"
    local domain="${DOMAINS[$domain_idx]}"
    local plan_file="$WORK_DIR/plan.$domain"
    local live_root
    live_root="$(domain_live_root "$domain")" || {
        warn "Unknown domain: $domain"
        return
    }

    note "Domain: $domain"
    note "  Live root: $live_root"
    if [ ! -d "$live_root" ]; then
        note "  (live root does not exist yet; will be created on apply)"
    fi

    if [ ! -s "$plan_file" ]; then
        note "  Nothing found in TM for this domain; skipping."
        return
    fi

    local relpath src dst dst_parent
    local skipped=0 restored=0 failed=0
    # Read NUL-delimited (relpath, src) pairs. `read -d ''` reads until
    # NUL — valid in bash 3.2+.
    while IFS= read -r -d '' relpath && IFS= read -r -d '' src; do
        [ -z "$relpath" ] && continue
        dst="$live_root/$relpath"
        if [ -e "$dst" ]; then
            skipped=$((skipped + 1))
            continue
        fi
        # Print the planned action regardless of dry-run, so dry-run is
        # self-verifying and apply mode logs each move.
        if [ "$DRY_RUN" -eq 1 ]; then
            plan "would restore: $domain/$relpath"
            plan "         from: $src"
        else
            dst_parent="${dst%/*}"
            if ! mkdir -p "$dst_parent" 2>/dev/null; then
                error "  could not mkdir parent: $dst_parent"
                failed=$((failed + 1))
                continue
            fi
            # cp -n: never overwrite (belt-and-suspenders given the -e
            # check above). cp -p: preserve mode/timestamps so the
            # restored file doesn't look "fresh" to downstream
            # watchers.
            if cp -n -p -- "$src" "$dst" 2>/dev/null; then
                # Double-check the file actually arrived (cp -n on an
                # existing dest silently no-ops; the -e gate above
                # should prevent this, but verify anyway).
                if [ -e "$dst" ]; then
                    restored=$((restored + 1))
                    log "[restore] $domain/$relpath"
                else
                    error "  cp succeeded but dest missing? $dst"
                    failed=$((failed + 1))
                fi
            else
                error "  cp failed: $src -> $dst"
                failed=$((failed + 1))
            fi
        fi
    done < "$plan_file"

    COUNT_SKIPPED[domain_idx]=$skipped
    COUNT_RESTORED[domain_idx]=$restored
    COUNT_FAILED[domain_idx]=$failed
}

for i in "${!DOMAINS[@]}"; do
    echo
    restore_domain "$i"
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "============================================================"
echo "Summary ($([ "$DRY_RUN" -eq 1 ] && echo 'DRY RUN' || echo 'APPLIED'))"
echo "============================================================"
printf '%-14s  %10s  %10s  %10s  %10s\n' "domain" "in-TM" "skipped" "restored" "failed"
printf '%-14s  %10s  %10s  %10s  %10s\n' "--------------" "----------" "----------" "----------" "----------"
total_restored=0
total_failed=0
for i in "${!DOMAINS[@]}"; do
    printf '%-14s  %10s  %10s  %10s  %10s\n' \
        "${DOMAINS[$i]}" \
        "${COUNT_FOUND[$i]}" \
        "${COUNT_SKIPPED[$i]}" \
        "${COUNT_RESTORED[$i]}" \
        "${COUNT_FAILED[$i]}"
    total_restored=$((total_restored + COUNT_RESTORED[i]))
    total_failed=$((total_failed + COUNT_FAILED[i]))
done
echo
if [ "$DRY_RUN" -eq 1 ]; then
    note "DRY RUN — no files were written. Re-run without --dry-run to apply."
elif [ "$total_failed" -gt 0 ]; then
    error "Completed with $total_failed failure(s). See messages above."
    exit 1
else
    note "Restored $total_restored file(s)."
fi

exit 0
