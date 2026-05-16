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
DOMAINS=("projects" "image-cache")

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
Restore deleted Claude Code session JSONLs and image-cache PNGs from a
mounted macOS Time Machine volume.

USAGE
    utils/restore-deleted-sessions-and-images.sh --tm-disk <path> [options]

REQUIRED
    --tm-disk <path>   Directory containing per-snapshot subdirectories.
                       Typically one of:
                         /Volumes/.timemachine/<volume-uuid>/<machine-uuid>
                         /Volumes/<TM-disk>/Backups.backupdb/<hostname>

OPTIONS
    --dry-run          Print the plan; do not copy any files.
    --user <name>      Target user (default: $SUDO_USER if set, else $USER).
                       Determines which ~/.claude/{projects,image-cache}
                       under each TM snapshot is read AND where files are
                       restored to.
    --home <path>      Override the live HOME directory (default: resolved
                       from --user via dscl). Useful for testing or when
                       restoring into a non-standard location.
    -h, --help         Show this help and exit.

BEHAVIOR
    * Latest-copy-wins: newest snapshot containing a given relative path
      supplies the bytes.
    * Never overwrites a file that already exists on the live filesystem.
    * Restores into:
          $HOME/.claude/projects/<project>/<session>.jsonl
          $HOME/.claude/image-cache/<session-uuid>/<N>.png

EXAMPLES
    # Find your TM root:
    ls /Volumes/.timemachine/*/*  | head

    # Dry run:
    ./utils/restore-deleted-sessions-and-images.sh \
        --tm-disk /Volumes/.timemachine/<volume-uuid>/<machine-uuid> \
        --dry-run

    # Apply (FDA on the running terminal is required to read snapshots;
    # `sudo` is usually needed too):
    sudo ./utils/restore-deleted-sessions-and-images.sh \
        --tm-disk /Volumes/.timemachine/<volume-uuid>/<machine-uuid>
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
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

if [ -z "$TM_DISK" ]; then
    error "--tm-disk is required."
    echo "Try --help" >&2
    exit 2
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
# A "snapshot dir" is one that matches YYYY-MM-DD-HHMMSS.backup (modern
# APFS) OR YYYY-MM-DD-HHMMSS (older HFS+ TM destination). We look for
# entries directly inside $TM_DISK; if none match, descend one level to
# accommodate users who pointed --tm-disk at the volume root.

# Returns 0 if $1 matches a snapshot-dir name, 1 otherwise.
is_snapshot_name() {
    case "$1" in
        [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].backup) return 0 ;;
        [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9])        return 0 ;;
    esac
    return 1
}

# List snapshot dirs under $1, newest-first (by name; names are
# zero-padded so lexicographic sort == chronological sort).
list_snapshots_in() {
    local root="$1"
    if [ ! -d "$root" ]; then
        return 1
    fi
    # We use a portable for-loop instead of `find -maxdepth` so we don't
    # depend on GNU find. The 2>/dev/null suppresses noisy permission
    # errors; the real check is below when we read inside each snapshot.
    local entry name
    for entry in "$root"/*; do
        [ -d "$entry" ] || continue
        name="${entry##*/}"
        if is_snapshot_name "$name"; then
            printf '%s\n' "$entry"
        fi
    done 2>/dev/null | sort -r
}

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

note "Found ${#SNAPSHOTS[@]} snapshot(s). Newest: ${SNAPSHOTS[0]##*/}; Oldest: ${SNAPSHOTS[$((${#SNAPSHOTS[@]}-1))]##*/}"
echo

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
    local backup_name="${backup##*/}"
    local cands=(
        "$backup/$backup_name/Data/Users/$TARGET_USER/.claude/$domain"
        "$backup/Macintosh HD - Data/Users/$TARGET_USER/.claude/$domain"
        "$backup/Macintosh HD/Users/$TARGET_USER/.claude/$domain"
        "$backup/Data/Users/$TARGET_USER/.claude/$domain"
        "$backup/Users/$TARGET_USER/.claude/$domain"
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
        c="$v/Data/Users/$TARGET_USER/.claude/$domain"
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
    local live_root="$LIVE_BASE/$domain"

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
