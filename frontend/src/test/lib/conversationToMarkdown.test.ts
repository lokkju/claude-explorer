import { describe, it, expect } from 'vitest'
import { conversationToMarkdown, isExcludableMarker, messageToMarkdown } from '@/lib/utils'
import type { Message } from '@/lib/types'

/**
 * V1 polish cleanup (2026-05-13): "Copy as Markdown" (client-side
 * `conversationToMarkdown` in utils.ts) MUST mirror the backend
 * `export._is_excludable_marker` predicate so the clipboard payload
 * matches both the viewer's rendered output and the backend export
 * bundles. Spec invariant "one truth, three (now four) surfaces":
 * viewer + search + server export + client copy.
 *
 * Bidirectional contracts pinned here:
 *
 *   NEGATIVE (exclusion):
 *     - argless /exit marker (is_command_marker=true) -> NOT in clipboard
 *     - prelude marker (is_prelude=true → is_command_marker=true) -> NOT in clipboard
 *     - both argless markers AND regular messages in the same conversation:
 *       only the regular messages survive
 *
 *   POSITIVE (inclusion):
 *     - argful /coding marker (is_command_marker=false) -> IS in clipboard
 *       (carries the user's real prose)
 *     - regular user message with /exit literally in body
 *       (is_command_marker=false) -> IS in clipboard
 *     - assistant reply with no marker fields -> IS in clipboard
 *
 *   INVERSE: title is ALWAYS in the clipboard regardless of message
 *   filtering — the conversation header is metadata, not content.
 */

function makeMessage(over: Partial<Message>): Message {
  return {
    uuid: over.uuid ?? 'u-default',
    sender: over.sender ?? 'human',
    text: over.text ?? '',
    content: over.content ?? [{ type: 'text', text: over.text ?? '' }],
    created_at: over.created_at ?? '2026-05-13T00:00:00Z',
    updated_at: over.updated_at ?? '2026-05-13T00:00:00Z',
    truncated: over.truncated ?? false,
    parent_message_uuid: over.parent_message_uuid ?? null,
    attachments: over.attachments ?? [],
    files: over.files ?? [],
    is_command_marker: over.is_command_marker,
    is_prelude: over.is_prelude,
    slash_command: over.slash_command,
  }
}

describe('isExcludableMarker', () => {
  it('returns true for argless command markers (is_command_marker=true)', () => {
    const m = makeMessage({
      uuid: 'u1',
      sender: 'human',
      text: 'Session: /exit',
      is_command_marker: true,
      slash_command: '/exit',
    })
    expect(isExcludableMarker(m)).toBe(true)
  })

  it('returns true for prelude markers (always argless per invariant)', () => {
    const m = makeMessage({
      uuid: 'u1',
      sender: 'human',
      text: 'Session: /clear',
      is_command_marker: true,
      is_prelude: true,
      slash_command: '/clear',
    })
    expect(isExcludableMarker(m)).toBe(true)
  })

  it('returns false for argful markers (is_command_marker=false)', () => {
    const m = makeMessage({
      uuid: 'u1',
      sender: 'human',
      text: 'Double-check your plan with the LLM council.',
      is_command_marker: false,
      slash_command: '/coding',
    })
    expect(isExcludableMarker(m)).toBe(false)
  })

  it('returns false for regular messages with no marker fields', () => {
    const m = makeMessage({
      uuid: 'u1',
      sender: 'human',
      text: 'Hello, Claude.',
    })
    expect(isExcludableMarker(m)).toBe(false)
  })

  it('returns false when is_command_marker is undefined (Desktop messages)', () => {
    const m = makeMessage({
      uuid: 'u1',
      sender: 'human',
      text: 'Hello from Desktop.',
    })
    // No is_command_marker key at all.
    expect(isExcludableMarker(m)).toBe(false)
  })

  it('uses strict === true, not truthiness — defensive against type drift', () => {
    // String "true" must NOT trigger exclusion (the strict identity
    // check defends against any future JSON-deserialization path that
    // might leak string-typed flags).
    const m = makeMessage({
      uuid: 'u1',
      sender: 'human',
      text: 'Body text.',
      // @ts-expect-error — deliberate type-system bypass to verify runtime guard
      is_command_marker: 'true',
    })
    expect(isExcludableMarker(m)).toBe(false)
  })
})

describe('conversationToMarkdown — argless-marker exclusion', () => {
  it('excludes argless /exit marker from the clipboard payload', () => {
    const messages = [
      makeMessage({
        uuid: 'u0',
        sender: 'human',
        text: 'Hello, Claude.',
        is_command_marker: false,
      }),
      makeMessage({
        uuid: 'a0',
        sender: 'assistant',
        text: 'Hi there.',
        is_command_marker: false,
      }),
      // The chrome row to be excluded.
      makeMessage({
        uuid: 'm1',
        sender: 'human',
        text: 'Session: /exit',
        is_command_marker: true,
        slash_command: '/exit',
      }),
    ]
    const md = conversationToMarkdown('Test', messages, false)

    // Header survives.
    expect(md).toContain('# Test')
    // Real conversation survives.
    expect(md).toContain('Hello, Claude.')
    expect(md).toContain('Hi there.')
    // Chrome is gone.
    expect(md).not.toContain('Session: /exit')
  })

  it('excludes prelude markers from the clipboard payload', () => {
    const messages = [
      makeMessage({
        uuid: 'p0',
        sender: 'human',
        text: 'Session: /clear',
        is_command_marker: true,
        is_prelude: true,
        slash_command: '/clear',
      }),
      makeMessage({
        uuid: 'u0',
        sender: 'human',
        text: 'Actual question.',
        is_command_marker: false,
      }),
    ]
    const md = conversationToMarkdown('Test', messages, false)
    expect(md).not.toContain('Session: /clear')
    expect(md).toContain('Actual question.')
  })

  it('keeps argful /coding markers (is_command_marker=false carries user prose)', () => {
    const messages = [
      makeMessage({
        uuid: 'u1',
        sender: 'human',
        text: 'Double-check your plan with the LLM council.',
        is_command_marker: false,  // argful → False per backend Fix-2
        slash_command: '/coding',
      }),
    ]
    const md = conversationToMarkdown('Test', messages, false)
    // The user's real prose MUST be in the clipboard. (slash_command
    // styling is a viewer-only badge concern; the copy is plain prose.)
    expect(md).toContain('Double-check your plan with the LLM council.')
  })

  it('keeps regular user messages whose body literally contains /exit', () => {
    // The strongest bidirectional inverse: the filter is keyed on
    // is_command_marker, not on textual heuristics. A user discussing
    // the /exit command in plain prose must NOT be filtered.
    const messages = [
      makeMessage({
        uuid: 'u1',
        sender: 'human',
        text: 'What does /exit do in Claude Code?',
        is_command_marker: false,
      }),
    ]
    const md = conversationToMarkdown('Test', messages, false)
    expect(md).toContain('What does /exit do in Claude Code?')
  })

  it('keeps assistant replies with no marker fields', () => {
    const messages = [
      makeMessage({
        uuid: 'a1',
        sender: 'assistant',
        text: 'Sure, here is the plan.',
      }),
    ]
    const md = conversationToMarkdown('Test', messages, false)
    expect(md).toContain('Sure, here is the plan.')
  })

  /**
   * V1 polish cleanup (2026-05-13): the per-block hover-copy icon in
   * MessageBubble bypasses conversationToMarkdown and calls
   * `messageToMarkdown(message, ...)` directly. The fix for that leak
   * lives at the RENDER surface (MessageBubble guards the hover icon
   * with `!isExcludableMarker(message)`), NOT inside the pure
   * `messageToMarkdown` data transformation. The tests below pin that
   * design choice so a future refactor that "helpfully" moves the
   * filter inside `messageToMarkdown` would break loudly here.
   *
   * Rationale for keeping the predicate at the render layer only:
   *   1. Single source of truth lives in `isExcludableMarker`; both
   *      surfaces (conversation-level filter + per-bubble render guard)
   *      reference it directly.
   *   2. `messageToMarkdown` stays a pure transformation that callers
   *      (e.g. future export pipelines, share-link generators) can
   *      reuse without needing to know about the chrome predicate.
   *   3. The UI tells the user the truth: chrome bubbles don't ADVERTISE
   *      a copy action, so users never see a no-op.
   */
  describe('messageToMarkdown — pure transformation, no built-in marker filter', () => {
    it('returns full body for an argless marker (filter lives at the render surface)', () => {
      // INVARIANT: messageToMarkdown does NOT itself filter argless
      // markers. Callers must filter upstream (conversationToMarkdown
      // does this) or guard at the render surface (MessageBubble does
      // this). If a future refactor adds exclusion inside this function,
      // we want to know — flip this expectation deliberately.
      const m = makeMessage({
        uuid: 'u1',
        sender: 'human',
        text: 'Session: /exit',
        is_command_marker: true,
        slash_command: '/exit',
      })
      const md = messageToMarkdown(m, false)
      expect(md).toContain('You:')
      expect(md).toContain('Session: /exit')
    })

    it('returns full body for an argful /coding marker (real user prose)', () => {
      const m = makeMessage({
        uuid: 'u1',
        sender: 'human',
        text: 'Double-check your plan with the LLM council.',
        is_command_marker: false,
        slash_command: '/coding',
      })
      const md = messageToMarkdown(m, false)
      expect(md).toContain('You:')
      expect(md).toContain('Double-check your plan with the LLM council.')
    })

    it('returns full body for a regular human message (no marker fields)', () => {
      const m = makeMessage({
        uuid: 'u1',
        sender: 'human',
        text: 'Hello, Claude.',
      })
      const md = messageToMarkdown(m, false)
      expect(md).toContain('You:')
      expect(md).toContain('Hello, Claude.')
    })

    it('returns full body for an assistant reply (no marker fields)', () => {
      const m = makeMessage({
        uuid: 'a1',
        sender: 'assistant',
        text: 'Sure, here is the plan.',
      })
      const md = messageToMarkdown(m, false)
      expect(md).toContain('Claude:')
      expect(md).toContain('Sure, here is the plan.')
    })
  })

  it('handles a conversation that is ONLY chrome — only header survives', () => {
    // Defensive: if every message is excludable chrome, the body is
    // empty but the header (and the trailing "\n\n") is still emitted.
    // No crash, no empty-string trail.
    const messages = [
      makeMessage({
        uuid: 'm1',
        sender: 'human',
        text: 'Session: /exit',
        is_command_marker: true,
        slash_command: '/exit',
      }),
      makeMessage({
        uuid: 'm2',
        sender: 'human',
        text: 'Session: /clear',
        is_command_marker: true,
        slash_command: '/clear',
      }),
    ]
    const md = conversationToMarkdown('Just chrome', messages, false)
    expect(md).toContain('# Just chrome')
    expect(md).not.toContain('Session: /exit')
    expect(md).not.toContain('Session: /clear')
  })
})

/**
 * Null-safety regression for `messageToMarkdown` (2026-05-18 council
 * audit, mirror of backend H1-H4).
 *
 * The fallback branch at utils.ts:135 — when a message has no
 * `content[]` blocks — previously assigned `content = message.text`
 * unconditionally. The TypeScript type says `Message.text: string`,
 * but the same wire-drift class the backend just hardened against
 * could surface null here. The subsequent `content.trim()` at line
 * 167 would then throw `TypeError: Cannot read properties of null
 * (reading 'trim')` and crash the export pipeline.
 *
 * Fix mirrors the backend `(data.get(k) or "")` pattern with
 * `message.text ?? ''`.
 */
describe('messageToMarkdown — null-text safety (mirrors backend H1-H4)', () => {
  it('does NOT throw when message.text is null and content[] is absent', () => {
    // @ts-expect-error — deliberate type-system bypass to simulate API drift
    const m = makeMessage({ uuid: 'u1', sender: 'human', text: null, content: [] })
    // Pre-fix: TypeError: Cannot read properties of null (reading 'trim')
    expect(() => messageToMarkdown(m, false)).not.toThrow()
    const md = messageToMarkdown(m, false)
    expect(md).toContain('**You:**')
  })

  it('does NOT throw when message.text is undefined and content[] is absent', () => {
    // Note: `Partial<Message>` allows `text: undefined` at the type
    // level (Partial widens every required field to T | undefined),
    // so no @ts-expect-error needed. But the runtime guard still
    // matters: the production messageToMarkdown reads message.text
    // through a typed assertion that says `string`, so an undefined
    // leak would still crash without the `?? ''` coalesce.
    const m = makeMessage({ uuid: 'u1', sender: 'assistant', text: undefined, content: [] })
    expect(() => messageToMarkdown(m, false)).not.toThrow()
    const md = messageToMarkdown(m, false)
    expect(md).toContain('**Claude:**')
  })

  it('renders body normally when message.text is a real string', () => {
    const m = makeMessage({ uuid: 'u1', sender: 'human', text: 'hello world', content: [] })
    const md = messageToMarkdown(m, false)
    expect(md).toContain('**You:**')
    expect(md).toContain('hello world')
  })
})
