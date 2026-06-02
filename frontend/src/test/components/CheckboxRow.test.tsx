import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckboxRow } from '../../components/ui/CheckboxRow';

/**
 * P1.3 — CheckboxRow contract.
 *
 * Encapsulates the "checkbox nested in a <label> with sibling <span>"
 * pattern (WCAG implicit-label form) repeated across SettingsPage,
 * MarkdownExportDialog, Sidebar, and ConversationPage. Each prior site
 * carried its own `oxlint-disable-next-line
 * react-doctor/control-has-associated-label` rationale comment.
 */

describe('CheckboxRow', () => {
  it('renders the label text and checkbox', () => {
    render(
      <CheckboxRow
        label="Save as default"
        checked={false}
        onCheckedChange={() => {}}
      />
    );
    expect(screen.getByText('Save as default')).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it('reflects checked=true in the rendered checkbox', () => {
    render(
      <CheckboxRow
        label="Save as default"
        checked={true}
        onCheckedChange={() => {}}
      />
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('clicking the visible label text toggles the checkbox via implicit-label wiring', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <CheckboxRow
        label="Save as default"
        checked={false}
        onCheckedChange={onCheckedChange}
      />
    );
    // Click the text — implicit label containment means this toggles
    // the checkbox.
    await user.click(screen.getByText('Save as default'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('clicking the checkbox itself fires onCheckedChange', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <CheckboxRow
        label="Save as default"
        checked={true}
        onCheckedChange={onCheckedChange}
      />
    );
    await user.click(screen.getByRole('checkbox'));
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });
});
