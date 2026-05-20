import { describe, it, expect } from 'vitest'
import {
  computeHighlightRanges,
  parseUserQuery,
} from '@/components/search/highlightRanges'

/**
 * Unit tests for the multi-token highlight helper. Pins the edge cases
 * the LLM council called out: overlapping tokens, adjacent ranges, case-
 * insensitivity, phrase mode, regex-special chars, empty tokens, drift
 * fallback, and the soft cap.
 */
describe('parseUserQuery', () => {
  it('returns empty tokens for empty/whitespace input', () => {
    expect(parseUserQuery('')).toEqual({ mode: 'tokens', tokens: [] })
    expect(parseUserQuery('   ')).toEqual({ mode: 'tokens', tokens: [] })
  })

  it('splits unquoted whitespace into tokens', () => {
    expect(parseUserQuery('comprehensive medium')).toEqual({
      mode: 'tokens',
      tokens: ['comprehensive', 'medium'],
    })
  })

  it('collapses double spaces', () => {
    expect(parseUserQuery('  foo    bar  ')).toEqual({
      mode: 'tokens',
      tokens: ['foo', 'bar'],
    })
  })

  it('treats quoted query as a phrase', () => {
    expect(parseUserQuery('"comprehensive medium"')).toEqual({
      mode: 'phrase',
      phrase: 'comprehensive medium',
    })
  })

  it('unbalanced quote falls back to token mode', () => {
    expect(parseUserQuery('"comprehensive medium')).toEqual({
      mode: 'tokens',
      tokens: ['"comprehensive', 'medium'],
    })
  })

  it('empty quoted query yields no tokens (not a phrase)', () => {
    // `""` is < 3 chars so it's not detected as a phrase; falls through
    // to token mode where the whole `""` is a single token.
    expect(parseUserQuery('""')).toEqual({ mode: 'tokens', tokens: ['""'] })
  })

  // Bug A (V1 polish 2026-05-14, THIRD fix): mid-typing a multi-word query
  // produces a trailing 1-char token (e.g. `comprehensive m` between
  // `comprehensive ` and `comprehensive medium`). Without a min-length
  // floor, the helper highlights EVERY `m` in the snippet — the user-
  // visible "every single letter m is wrapped in <mark>" bug. The
  // SearchPanel already requires `query.length >= 2` before firing the
  // request (SearchPanel.tsx ~line 147); per-token floor mirrors that.
  it('drops single-character trailing tokens (mid-typing UX)', () => {
    expect(parseUserQuery('comprehensive m')).toEqual({
      mode: 'tokens',
      tokens: ['comprehensive'],
    })
  })

  it('drops single-character leading tokens too', () => {
    expect(parseUserQuery('m comprehensive')).toEqual({
      mode: 'tokens',
      tokens: ['comprehensive'],
    })
  })

  it('drops multiple single-character tokens', () => {
    expect(parseUserQuery('a b c')).toEqual({ mode: 'tokens', tokens: [] })
  })

  it('keeps two-character tokens (the floor)', () => {
    expect(parseUserQuery('comprehensive me')).toEqual({
      mode: 'tokens',
      tokens: ['comprehensive', 'me'],
    })
  })

  it('phrase mode preserves single-character phrases (explicit user signal)', () => {
    // Quoted single-char phrase is explicit: user typed quotes around it,
    // they meant it. Don't second-guess.
    expect(parseUserQuery('"m"')).toEqual({ mode: 'phrase', phrase: 'm' })
  })
})

describe('computeHighlightRanges — multi-token rendering', () => {
  const snippet = 'this is a comprehensive medium-form article about FTS5'
  // backend match_start/match_end normally point at first token.
  const compStart = snippet.indexOf('comprehensive')
  const compEnd = compStart + 'comprehensive'.length

  it('highlights all tokens for an unquoted multi-word query', () => {
    const ranges = computeHighlightRanges(
      snippet,
      'comprehensive medium',
      compStart,
      compEnd,
    )
    const matchedTexts = ranges.map((r) => snippet.slice(r.start, r.end))
    expect(matchedTexts).toContain('comprehensive')
    expect(matchedTexts).toContain('medium')
    // 2 separate ranges (comprehensive + medium), not merged because
    // there's whitespace between them.
    expect(ranges.length).toBe(2)
  })

  it('returns exactly one range for a single-token query', () => {
    const ranges = computeHighlightRanges(
      snippet,
      'comprehensive',
      compStart,
      compEnd,
    )
    expect(ranges).toHaveLength(1)
    expect(snippet.slice(ranges[0].start, ranges[0].end)).toBe('comprehensive')
  })

  it('case-insensitive matching', () => {
    const txt = 'See Comprehensive Medium-form notes'
    const ranges = computeHighlightRanges(txt, 'comprehensive medium', 0, 0)
    const matchedTexts = ranges.map((r) => txt.slice(r.start, r.end))
    expect(matchedTexts).toContain('Comprehensive')
    expect(matchedTexts).toContain('Medium')
  })

  it('phrase mode highlights one contiguous range, not each word', () => {
    const ranges = computeHighlightRanges(
      snippet,
      '"comprehensive medium"',
      0,
      0,
    )
    expect(ranges).toHaveLength(1)
    expect(snippet.slice(ranges[0].start, ranges[0].end)).toBe(
      'comprehensive medium',
    )
  })

  it('multiple occurrences of the same token all get highlighted', () => {
    const txt = 'foo and foo and foo'
    const ranges = computeHighlightRanges(txt, 'foo', 0, 0)
    expect(ranges).toHaveLength(3)
    for (const r of ranges) {
      expect(txt.slice(r.start, r.end)).toBe('foo')
    }
  })

  it('merges overlapping ranges (token containment)', () => {
    // Query `comp comprehensive` → "comp" matches inside "comprehensive";
    // ranges overlap and must merge to avoid nested <mark> in the DOM.
    const ranges = computeHighlightRanges(
      'comprehensive',
      'comp comprehensive',
      0,
      0,
    )
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toEqual({ start: 0, end: 'comprehensive'.length })
  })

  it('merges adjacent ranges (no gap between tokens)', () => {
    // Text "foobar", query "foo bar": foo=[0,3), bar=[3,6) — abutting,
    // must merge to one range covering [0,6).
    const ranges = computeHighlightRanges('foobar', 'foo bar', 0, 0)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toEqual({ start: 0, end: 6 })
  })

  it('regex special chars in tokens are matched literally', () => {
    const txt = 'use array[0] and a.b.c here'
    const ranges = computeHighlightRanges(txt, '[0] a.b', 0, 0)
    const matched = ranges.map((r) => txt.slice(r.start, r.end))
    expect(matched).toContain('[0]')
    expect(matched).toContain('a.b')
  })

  it('falls back to backend range when query is empty', () => {
    const ranges = computeHighlightRanges(snippet, '', compStart, compEnd)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toEqual({ start: compStart, end: compEnd })
  })

  it('keeps backend range as fallback on stemmer/diacritic drift', () => {
    // Snippet body is `running fast` — backend reports a hit for query
    // `run` (FTS5 porter-stemmed). Literal substring scan misses `run`,
    // but the seeded backend range still wraps `running`.
    const txt = 'they were running fast'
    const runIdx = txt.indexOf('running')
    const ranges = computeHighlightRanges(
      txt,
      'run',
      runIdx,
      runIdx + 'running'.length,
    )
    // Token scan finds `run` inside `running` → [runIdx, runIdx+3).
    // Backend seed → [runIdx, runIdx+7). They overlap → one merged
    // range covering `running`.
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toEqual({ start: runIdx, end: runIdx + 'running'.length })
  })

  it('ignores invalid backend ranges (out of bounds)', () => {
    // start beyond text length → seed dropped; pure token scan.
    const ranges = computeHighlightRanges(snippet, 'comprehensive', 9999, 10000)
    expect(ranges).toHaveLength(1)
    expect(snippet.slice(ranges[0].start, ranges[0].end)).toBe('comprehensive')
  })

  it('zero-token query with no backend range yields no ranges', () => {
    expect(computeHighlightRanges('hello world', '', -1, -1)).toEqual([])
  })

  it('soft-cap protects against pathological short-token spam', () => {
    // 100 repetitions of `a ` (200 chars), query `a` → would produce
    // 100 ranges without the cap. Cap at 50 means we get exactly 50.
    // After Bug A v3 fix: 1-char tokens are dropped → 0 ranges. We
    // assert the cap path with a 2-char token instead.
    const txt = 'aa '.repeat(100)
    const ranges = computeHighlightRanges(txt, 'aa', 0, 0)
    expect(ranges.length).toBeLessThanOrEqual(50)
    expect(ranges.length).toBeGreaterThan(10) // sanity: actually scanned
  })

  // Bug A (V1 polish 2026-05-14, THIRD fix) — integration of the
  // parseUserQuery token-floor with computeHighlightRanges.
  describe('Bug A — single-character token suppression', () => {
    it('mid-typing `comprehensive m` highlights ONLY comprehensive', () => {
      const txt =
        'this comprehensive matrix contains modules and a README.md ' +
        'with many enhancements'
      // Backend hasn't returned new results yet — match_start/match_end
      // still point at `comprehensive` from the previous query.
      const compStart = txt.indexOf('comprehensive')
      const compEnd = compStart + 'comprehensive'.length
      const ranges = computeHighlightRanges(
        txt,
        'comprehensive m',
        compStart,
        compEnd,
      )
      const matched = ranges.map((r) => txt.slice(r.start, r.end).toLowerCase())
      // Exactly one highlight, and it's `comprehensive`. No `m`-only marks.
      expect(matched).toEqual(['comprehensive'])
      for (const m of matched) {
        expect(m.length).toBeGreaterThanOrEqual(2)
      }
    })

    it('seed-trap defense: drops a 1-char backend seed when in token mode', () => {
      // Worst case: backend returns a match_start/match_end of length 1
      // pointing at the first `m` it found (mirrors the FTS5-finds-token-m
      // → snippet regex hits first `m` case). The helper must NOT emit
      // <mark>m</mark> based purely on that 1-char seed.
      const txt = 'modules and matrices have many m letters'
      const firstM = txt.indexOf('m')
      const ranges = computeHighlightRanges(
        txt,
        'comprehensive m',
        firstM,
        firstM + 1, // 1-char seed
      )
      // Token `m` is filtered. `comprehensive` isn't in the text. Seed is
      // dropped because len-1 in token mode is suspicious. Result: zero
      // highlights — the snippet renders plain. That's correct UX: no
      // distracting noise during mid-typing.
      expect(ranges).toEqual([])
    })

    it('seed-trap defense: KEEPS multi-char backend seed in token mode', () => {
      // Stemmer drift: FTS5 matched `running` for token `run`, backend
      // seed points at the full word `running`. After the v3 fix we still
      // need to preserve that seed (it's len-7, well above the floor).
      const txt = 'they were running fast'
      const start = txt.indexOf('running')
      const ranges = computeHighlightRanges(
        txt,
        'run',
        start,
        start + 'running'.length,
      )
      // Note: `run` (3 chars) passes the token floor, AND it's a literal
      // substring of `running` → finds + merges with the seed → one
      // highlight covering `running`.
      expect(ranges).toHaveLength(1)
      expect(txt.slice(ranges[0].start, ranges[0].end)).toBe('running')
    })

    it('all-1-char query collapses to zero highlights even with seed', () => {
      const txt = 'and a quick b c hop'
      // Backend returned some leftover seed pointing at `a`.
      const aIdx = txt.indexOf('a')
      const ranges = computeHighlightRanges(txt, 'a b c', aIdx, aIdx + 1)
      // No effective tokens, 1-char seed dropped → zero highlights. UX:
      // user sees plain text instead of spurious noise.
      expect(ranges).toEqual([])
    })

    it('phrase mode with single-char phrase still highlights (explicit signal)', () => {
      // User typed `"m"` (quoted) — explicit literal-search request.
      const txt = 'modular m systems'
      // Backend seed for the standalone `m`.
      const standaloneM = txt.indexOf(' m ') + 1
      const ranges = computeHighlightRanges(
        txt,
        '"m"',
        standaloneM,
        standaloneM + 1,
      )
      // Phrase mode → seed kept (phrase is explicit), token scan finds
      // every `m`. The user asked for it.
      const marked = ranges.map((r) => txt.slice(r.start, r.end))
      expect(marked.length).toBeGreaterThanOrEqual(2)
      for (const m of marked) {
        expect(m.toLowerCase()).toBe('m')
      }
    })
  })
})
