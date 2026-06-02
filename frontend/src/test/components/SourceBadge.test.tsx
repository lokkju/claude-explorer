import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SourceBadge } from '../../components/conversation/SourceBadge';
import type { ConversationSource } from '@/lib/types';

/**
 * P1.2 — SourceBadge contract.
 *
 * Collapses the three-way ternary that lived in both
 * `ConversationPage.tsx` (header variant: Badge + icon + text label) and
 * `ConversationList.tsx` (row variant: bare title-wrapped icon only) into
 * a single component. Two render variants:
 *
 *   - `variant="header"` — full Badge with icon + label text, rendered
 *     under the conversation title.
 *   - `variant="row"`    — bare <span title="..."><Icon /></span>, used
 *     in the sidebar list row's footer line.
 *
 * Both variants share the same source → icon + color triple:
 *
 *     CLAUDE_CODE   → Terminal       + green
 *     CLAUDE_COWORK → Sparkles       + purple
 *     CLAUDE_AI     → MessageSquare  + blue ("Desktop")
 *
 * Tested via lucide-react's `.lucide-<name>` class on the rendered svg
 * (lucide adds both `lucide` and `lucide-<icon-name>` classes).
 */

const cases: Array<{
  source: ConversationSource;
  iconClass: string;
  wrongIconClasses: string[];
  label: string;
  rowTitle: string;
  colorFragment: string;
}> = [
  {
    source: 'CLAUDE_CODE',
    iconClass: 'lucide-terminal',
    wrongIconClasses: ['lucide-sparkles', 'lucide-message-square'],
    label: 'Code',
    rowTitle: 'Claude Code',
    colorFragment: 'green',
  },
  {
    source: 'CLAUDE_COWORK',
    iconClass: 'lucide-sparkles',
    wrongIconClasses: ['lucide-terminal', 'lucide-message-square'],
    label: 'Cowork',
    rowTitle: 'Claude Cowork',
    colorFragment: 'purple',
  },
  {
    source: 'CLAUDE_AI',
    iconClass: 'lucide-message-square',
    wrongIconClasses: ['lucide-terminal', 'lucide-sparkles'],
    label: 'Desktop',
    rowTitle: 'Claude Desktop',
    colorFragment: 'blue',
  },
];

describe('SourceBadge — header variant', () => {
  for (const c of cases) {
    it(`${c.source} renders ${c.label} + ${c.iconClass} in ${c.colorFragment}`, () => {
      const { container } = render(
        <SourceBadge source={c.source} variant="header" />
      );

      // Right icon present
      expect(container.querySelector(`.${c.iconClass}`)).not.toBeNull();
      // Wrong icons absent
      for (const wrong of c.wrongIconClasses) {
        expect(container.querySelector(`.${wrong}`)).toBeNull();
      }
      // Label text visible (header variant only)
      expect(screen.getByText(c.label)).toBeInTheDocument();
      // Color encoded somewhere in the rendered className
      expect(container.innerHTML).toMatch(new RegExp(c.colorFragment));
    });
  }
});

describe('SourceBadge — row variant', () => {
  for (const c of cases) {
    it(`${c.source} renders ${c.iconClass} with title="${c.rowTitle}", no label text`, () => {
      const { container } = render(
        <SourceBadge source={c.source} variant="row" />
      );

      // Right icon present
      expect(container.querySelector(`.${c.iconClass}`)).not.toBeNull();
      // Wrong icons absent
      for (const wrong of c.wrongIconClasses) {
        expect(container.querySelector(`.${wrong}`)).toBeNull();
      }
      // Row variant: title attribute on a wrapping span, NO visible label text
      const titled = container.querySelector(`[title="${c.rowTitle}"]`);
      expect(titled).not.toBeNull();
      expect(screen.queryByText(c.label)).not.toBeInTheDocument();
      // Color encoded in the inner svg/span className
      expect(container.innerHTML).toMatch(new RegExp(c.colorFragment));
    });
  }
});

describe('SourceBadge — boundary case', () => {
  it('falls back to Desktop arm for an unknown source value', () => {
    // Cast through unknown — runtime data could in principle hold an
    // unknown source string if the backend adds a new enum value before
    // the frontend ships an update. The component should degrade
    // gracefully rather than render nothing.
    const { container } = render(
      <SourceBadge
        source={'CLAUDE_MARS_ROVER' as unknown as ConversationSource}
        variant="header"
      />
    );
    expect(container.querySelector('.lucide-message-square')).not.toBeNull();
    expect(screen.getByText('Desktop')).toBeInTheDocument();
  });
});
