import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '../utils';
import { KeyboardHelpModal } from '../../components/KeyboardHelpModal';
import { useKeyboardNavigation } from '../../contexts/KeyboardNavigationContext';

/**
 * Build-8 #4: the help modal renders ⌘ on macOS and Ctrl on other
 * platforms. The decision is driven by navigator.platform.
 */

function HelpModalOpener() {
  const { setIsHelpOpen } = useKeyboardNavigation();
  setIsHelpOpen(true);
  return null;
}

describe('KeyboardHelpModal platform glyph', () => {
  let originalDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      'platform',
    );
  });

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(window.navigator, 'platform', originalDescriptor);
    }
    vi.restoreAllMocks();
  });

  function setPlatform(value: string) {
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      get: () => value,
    });
  }

  it('renders ⌘ glyph in the Global shortcuts section on macOS', () => {
    setPlatform('MacIntel');
    render(
      <>
        <HelpModalOpener />
        <KeyboardHelpModal />
      </>,
    );
    const globalHeading = screen.getByText('Global');
    const globalSection = globalHeading.parentElement!;
    expect(globalSection.textContent).toContain('⌘');
  });

  it('renders Ctrl in the Global shortcuts section on Windows', () => {
    setPlatform('Win32');
    render(
      <>
        <HelpModalOpener />
        <KeyboardHelpModal />
      </>,
    );
    const globalHeading = screen.getByText('Global');
    const globalSection = globalHeading.parentElement!;
    expect(globalSection.textContent).toContain('Ctrl');
    expect(globalSection.textContent).not.toContain('⌘');
  });
});
