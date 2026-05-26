/**
 * Perf-regression contract (2026-05-23) — MessageBubble must NOT
 * import `useSettings` from SettingsContext.
 *
 * THE BUG THIS TEST PINS:
 *
 * Live Playwright profiling on the user's 16K-message corpus showed
 * Cmd+F sometimes took ~3 seconds. Root cause: MessageBubble.tsx line
 * 50 called `const { showToolCalls, expandAllTools } = useSettings()`,
 * making every one of the 4014 rendered bubbles a direct
 * useContext(SettingsContext) consumer. Pressing Cmd+F when the right
 * pane was not already on 'search' triggered `setRightPaneTab('search')`
 * which mutated the SettingsContext value-object identity. React's
 * useContext invalidates EVERY consumer on identity change, bypassing
 * `React.memo`. With 4014 bubbles, that was ~3s of synchronous
 * re-render work.
 *
 * The fix: `showToolCalls` and `expandAllTools` are PROPS, sourced
 * by ConversationPage's existing top-level useSettings() call and
 * threaded down to MessageBubble. Bubbles then receive identity-
 * stable props on unrelated SettingsContext changes, so React.memo
 * correctly short-circuits the re-render.
 *
 * Why a STATIC GREP test instead of a runtime-render-counter test:
 *
 * A counter test would need a React Profiler harness and would only
 * detect the bug on the very render that fires. A static grep on
 * the source file is unconditional: if anyone adds back
 * `import { useSettings } from '@/contexts/SettingsContext'` to the
 * bubble, this test fails at the next CI run regardless of test
 * fixture coverage. Same pattern as the
 * `MessageBubble.searchQuery-prop.test.tsx` negative assertion.
 *
 * If a future requirement legitimately needs a setting inside the
 * bubble (e.g. a new toggle that affects rendering), the correct
 * answer is to thread it as a prop, not re-introduce the context
 * subscription. Update this test's allowlist comment if the contract
 * intentionally changes.
 */

import { describe, it, expect } from 'vitest'
// Vite's `?raw` query suffix loads the file as a string at bundle/test
// time. Cross-toolchain: works in tsc + vitest + production builds
// without needing Node `fs`/`@types/node` in the app tsconfig.
import messageBubbleSrc from '@/components/message/MessageBubble.tsx?raw'

describe('MessageBubble — does NOT import useSettings (perf regression pin)', () => {
  it('NEGATIVE: MessageBubble.tsx does not import useSettings', () => {
    const src = messageBubbleSrc
    // Match any import line that brings useSettings into scope. Two
    // common shapes:
    //   import { useSettings } from '@/contexts/SettingsContext'
    //   import { foo, useSettings } from '@/contexts/SettingsContext'
    // We anchor on `useSettings` rather than the full module path to
    // catch any aliasing (e.g. `useSettings as _us`).
    const importPattern = /import\s*\{[^}]*\buseSettings\b[^}]*\}\s*from/
    expect(
      importPattern.test(src),
      'MessageBubble.tsx must NOT import useSettings — see file header docs ' +
        'for the 2026-05-23 Cmd+F perf regression this pins.',
    ).toBe(false)
  })

  it('NEGATIVE: MessageBubble.tsx does not call useSettings()', () => {
    const src = messageBubbleSrc
    // Defense in depth — even if the import line drifts, the call
    // site must not appear. Allow occurrences inside /* */ or //
    // comments by stripping common comment forms first.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    expect(
      /\buseSettings\s*\(/.test(stripped),
      'MessageBubble.tsx must NOT call useSettings() — pass settings as props from ConversationPage.',
    ).toBe(false)
  })
})
