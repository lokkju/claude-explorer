/**
 * Multi-token snippet highlighting (V1 polish 2026-05-14, Bug 1 second fix).
 *
 * Why this exists: the backend's `MessageSnippet` carries a SINGLE
 * `match_start`/`match_end` pair (located by the first token's first
 * occurrence — see `backend/search.py` comments around line 535).
 * When the user types a multi-word query like `comprehensive medium`
 * the snippet contains both words but the backend only points at
 * `comprehensive`. The visible UX bug is "second word isn't yellow."
 *
 * Fix approach: parse the live query in the frontend (same rules as
 * backend `parse_user_query`), then case-insensitively scan the snippet
 * for ALL occurrences of every token (or the literal phrase in phrase
 * mode). Merge overlapping AND adjacent ranges so the `<mark>` DOM never
 * nests and never produces ugly abutting splits. The backend's reported
 * range is seeded too — that preserves the existing fallback for stemmer /
 * diacritic drift (FTS5 hit on `running` for query `run`; the literal
 * regex below won't find `run` in the snippet, so the seeded range keeps
 * a highlight visible).
 *
 * Why this duplicates `parse_user_query` rather than refactoring
 * `SearchPanelContext.tsx`'s client-side filter: shipping a presentation
 * fix without expanding blast radius into the data pipeline. The query
 * parser is exported so a future follow-up can unify both call sites in
 * one shot.
 */

/** Half-open range [start, end). */
export interface HighlightRange {
  start: number
  end: number
}

/**
 * Hard cap on number of ranges returned. Defense-in-depth against
 * pathological short-token queries (e.g. `aa ee` against a 300-char
 * snippet → ~50 yellow marks). Snippet bounds keep the realistic case
 * well under this number. If this cap fires the user sees a still-
 * helpful highlighted snippet; we do NOT silently drop the backend's
 * seeded range (it's prepended before capping kicks in).
 */
const MAX_RANGES = 50

/**
 * Minimum length of a meaningful highlight token in token mode. Mirrors
 * the SearchPanel's "Type at least 2 characters" gate (SearchPanel.tsx
 * around line 147) — when the whole-query length floor exists, the
 * per-token floor must exist too, otherwise mid-typing a multi-word
 * query (e.g. `comprehensive m` between `comprehensive ` and
 * `comprehensive medium`) produces a token list of
 * `["comprehensive", "m"]` and `findAllOccurrences` happily wraps
 * every single `m` letter in the snippet in `<mark>`. That's the
 * user-reported "every single letter m is highlighted" bug.
 *
 * Phrase mode (`"m"` — quoted) bypasses this floor — the quotes are
 * an explicit literal-search signal we don't second-guess.
 */
const MIN_TOKEN_LEN = 2

/**
 * Parse a user query into either a phrase (exact literal, when the
 * entire query is wrapped in matching double quotes) or a list of
 * tokens (whitespace-split AND-of-substrings). Mirrors the Python
 * `parse_user_query` at `backend/search.py:216` exactly so client +
 * server stay in sync on what counts as a phrase vs a token list.
 */
export function parseUserQuery(
  query: string,
): { mode: 'phrase'; phrase: string } | { mode: 'tokens'; tokens: string[] } {
  const stripped = query.trim()
  if (!stripped) return { mode: 'tokens', tokens: [] }
  // Phrase mode: entire query wrapped in double quotes (>= 3 chars so
  // `""` alone isn't treated as a phrase). Matches the backend's
  // narrow detection — no mixed `foo "bar baz"` support.
  if (
    stripped.length >= 3 &&
    stripped.startsWith('"') &&
    stripped.endsWith('"')
  ) {
    const inner = stripped.slice(1, -1).trim()
    if (inner) return { mode: 'phrase', phrase: inner }
  }
  // Token mode: drop empty tokens AND tokens shorter than MIN_TOKEN_LEN.
  // The 1-char-token floor is the Bug A v3 fix — without it, typing
  // `comprehensive medium` passes through the intermediate state
  // `comprehensive m` where the helper would wrap every `m` letter.
  // The same `>=2` floor is enforced at the whole-query level by
  // SearchPanel.tsx's "Type at least 2 characters" copy.
  const tokens = stripped
    .split(/\s+/)
    .filter((t) => t.length >= MIN_TOKEN_LEN)
  return { mode: 'tokens', tokens }
}

/**
 * Find every case-insensitive occurrence of `needle` in `text` as
 * `[start, end)` ranges. Pure substring scan via `indexOf` on
 * lower-cased strings — no regex construction, so user-typed special
 * chars (`.`, `*`, `[`, etc.) are matched literally. The slight cost
 * of two `toLowerCase()` calls per invocation is irrelevant at our
 * snippet sizes (~300 chars) and avoids the escape-regex landmine.
 */
function findAllOccurrences(text: string, needle: string): HighlightRange[] {
  if (!needle) return []
  const haystack = text.toLowerCase()
  const probe = needle.toLowerCase()
  const ranges: HighlightRange[] = []
  let from = 0
  // Hard ceiling on internal iterations too — pathological case where
  // needle is 1 char and text is 100k chars (shouldn't happen — snippet
  // is bounded — but defense-in-depth so we never live-lock the render
  // thread). MAX_RANGES * 2 keeps headroom for the merge step.
  const ceiling = MAX_RANGES * 2
  while (ranges.length < ceiling) {
    const idx = haystack.indexOf(probe, from)
    if (idx < 0) break
    ranges.push({ start: idx, end: idx + probe.length })
    // Advance at least one char so a zero-length needle (defensive)
    // can't infinite-loop.
    from = idx + Math.max(1, probe.length)
  }
  return ranges
}

/**
 * Merge overlapping AND adjacent ranges. "Adjacent" means
 * `next.start <= current.end` — abutting marks (`<mark>foo</mark><mark>bar</mark>`
 * for query `foo bar` against text `foobar`) look like a rendering glitch
 * and can pick up stray DOM artifacts (Tailwind padding / line-height
 * weirdness). Overlapping ranges MUST be merged because nested `<mark>`
 * tags would break the React tree.
 *
 * Assumes input is non-empty. Result is sorted ascending by `start`.
 */
function mergeRanges(ranges: HighlightRange[]): HighlightRange[] {
  if (ranges.length === 0) return ranges
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: HighlightRange[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    const cur = sorted[i]
    if (cur.start <= last.end) {
      // Overlap or adjacent — absorb into `last`.
      if (cur.end > last.end) {
        last.end = cur.end
      }
    } else {
      merged.push({ start: cur.start, end: cur.end })
    }
  }
  return merged
}

/**
 * Sanitize a backend-supplied range against the actual snippet text.
 * Defensive: if start/end are out of bounds or inverted, drop it.
 * This mirrors `HighlightedSnippet`'s old bounds check.
 */
function sanitizeBackendRange(
  text: string,
  start: number,
  end: number,
): HighlightRange | null {
  if (start < 0 || end <= start || start >= text.length || end > text.length) {
    return null
  }
  return { start, end }
}

/**
 * Build the merged list of highlight ranges for a snippet.
 *
 * @param text            The snippet text exactly as the backend returned it
 *                        (do NOT strip the leading/trailing `...` — the
 *                        indices below would go off-by-3).
 * @param query           The live user query (unparsed; this function does
 *                        its own quote / whitespace handling).
 * @param backendStart    The backend's reported `match_start`. Seeded into
 *                        the range set so stemmer / diacritic drift still
 *                        gets a visible highlight (FTS5 hit on `running`
 *                        for query `run` → literal substring scan misses,
 *                        but the backend range still wraps `running`).
 * @param backendEnd      Paired with `backendStart`.
 *
 * @returns Sorted, merged, capped list of `[start, end)` ranges to wrap
 *          in `<mark>`. Empty list means "render as plain text."
 */
export function computeHighlightRanges(
  text: string,
  query: string,
  backendStart: number,
  backendEnd: number,
): HighlightRange[] {
  const parsed = parseUserQuery(query)
  const collected: HighlightRange[] = []

  // Seed with the backend's range FIRST so it always wins under the cap.
  //
  // Bug A v3 seed-trap defense: in TOKEN mode, drop seeds shorter than
  // MIN_TOKEN_LEN whenever the user actually typed SOMETHING (i.e. the
  // stripped query is non-empty). This handles two cases:
  //   1. User typed `comprehensive m` — `m` is filtered from tokens,
  //      but the backend's seed points at a 1-char `m` range. Without
  //      this guard, the user STILL sees `<mark>m</mark>` from the seed.
  //   2. User typed `a b c` — all tokens filtered, but the backend's
  //      seed points at some 1-char range. Same problem.
  //
  // We KEEP short seeds when the input is truly empty (drift-fallback
  // contract: backend reports an FTS5 stemmer-drift hit for which the
  // client has no token to scan — the seed is the only highlight
  // signal). We also KEEP seeds in PHRASE mode regardless of length:
  // `"m"` is an explicit literal-search request.
  const seed = sanitizeBackendRange(text, backendStart, backendEnd)
  const inputNonEmpty = query.trim().length > 0
  const seedIsShortInTokenMode =
    parsed.mode === 'tokens' &&
    inputNonEmpty &&
    seed !== null &&
    seed.end - seed.start < MIN_TOKEN_LEN
  if (seed && !seedIsShortInTokenMode) collected.push(seed)

  if (parsed.mode === 'phrase') {
    // Phrase mode: ONE contiguous highlight per occurrence. Mirrors
    // backend `parse_user_query`'s exact-phrase semantics — quotes
    // mean literal.
    collected.push(...findAllOccurrences(text, parsed.phrase))
  } else {
    for (const tok of parsed.tokens) {
      collected.push(...findAllOccurrences(text, tok))
    }
  }

  const merged = mergeRanges(collected)
  // Hard cap — keeps DOM size sane for pathological short-token queries.
  // Backend's seeded range is sorted to whatever its `start` is; we cap
  // after merge so the cap covers the WHOLE snippet, not just the tail.
  return merged.length > MAX_RANGES ? merged.slice(0, MAX_RANGES) : merged
}
