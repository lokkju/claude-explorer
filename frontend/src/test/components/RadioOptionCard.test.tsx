import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioGroup } from '@/components/ui/radio-group';
import { RadioOptionCard } from '../../components/ui/RadioOptionCard';

/**
 * P1.3 — RadioOptionCard contract.
 *
 * Encapsulates the ~10x-repeated "card-shaped Radix radio with bordered
 * label + cursor-pointer + active-state border swap" pattern that was
 * pasted into SettingsPage (Theme x3, Keyboard Mode x2, Export Mode x3)
 * and MarkdownExportDialog (Export Mode x3) — each carrying its own copy
 * of the `oxlint-disable-next-line react-doctor/label-has-associated-control`
 * rationale comment.
 *
 * The component supports two layouts because the existing surfaces
 * diverge:
 *
 *   - `inline`: icon + single label on one row (Theme cards).
 *   - `stacked`: title row + description sub-row (Keyboard cards,
 *     Export Mode cards in both Settings and Dialog).
 *
 * The `active` flag controls the border-color swap; pass `undefined` to
 * suppress the active-highlight (e.g., the Dialog's variant where the
 * surrounding RadioGroup handles selection visuals via Radix's own
 * `data-state="checked"` styling).
 */

describe('RadioOptionCard — inline layout', () => {
  it('renders the Radix item, title text, and icon for the inline layout', () => {
    const { container } = render(
      <RadioGroup value="" onValueChange={() => {}}>
        <RadioOptionCard
          value="light"
          title="Light"
          icon={<span data-testid="theme-icon">sun</span>}
          active={false}
          layout="inline"
        />
      </RadioGroup>
    );

    expect(screen.getByText('Light')).toBeInTheDocument();
    expect(screen.getByTestId('theme-icon')).toBeInTheDocument();
    // Radix RadioGroupItem renders as button[role="radio"].
    expect(container.querySelector('[role="radio"][value="light"]')).not.toBeNull();
  });

  it('applies the active-border class when active=true', () => {
    const { container, rerender } = render(
      <RadioGroup value="" onValueChange={() => {}}>
        <RadioOptionCard
          value="light"
          title="Light"
          active={false}
          layout="inline"
        />
      </RadioGroup>
    );

    // Inactive: hover border style only
    const inactiveLabel = container.querySelector('label');
    expect(inactiveLabel?.className).toMatch(/border-zinc-200/);
    expect(inactiveLabel?.className).not.toMatch(/border-zinc-900/);

    rerender(
      <RadioGroup value="" onValueChange={() => {}}>
        <RadioOptionCard
          value="light"
          title="Light"
          active={true}
          layout="inline"
        />
      </RadioGroup>
    );
    const activeLabel = container.querySelector('label');
    expect(activeLabel?.className).toMatch(/border-zinc-900/);
  });
});

describe('RadioOptionCard — stacked layout', () => {
  it('renders title + description in a stacked layout', () => {
    render(
      <RadioGroup value="" onValueChange={() => {}}>
        <RadioOptionCard
          value="bundle-obsidian"
          title="Bundle Obsidian"
          description="Same as CommonMark but uses Obsidian wikilinks."
          active={false}
          layout="stacked"
        />
      </RadioGroup>
    );

    expect(screen.getByText('Bundle Obsidian')).toBeInTheDocument();
    expect(
      screen.getByText('Same as CommonMark but uses Obsidian wikilinks.')
    ).toBeInTheDocument();
  });
});

describe('RadioOptionCard — click wiring', () => {
  it('clicking the label fires onValueChange via Radix containment', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <RadioGroup value="" onValueChange={onValueChange}>
        <RadioOptionCard
          value="dark"
          title="Dark"
          active={false}
          layout="inline"
        />
      </RadioGroup>
    );
    // Click the visible card text — bubbles to the contained
    // RadioGroupItem.
    await user.click(screen.getByText('Dark'));
    expect(onValueChange).toHaveBeenCalledWith('dark');
  });
});
