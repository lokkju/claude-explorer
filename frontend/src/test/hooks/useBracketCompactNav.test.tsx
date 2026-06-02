import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBracketCompactNav } from '../../hooks/useBracketCompactNav';

/**
 * P1.4 Commit A — useBracketCompactNav extracted from ConversationPage.
 *
 * Pins the contract:
 *   - `]` advances focusCompactMarker(activeCompactIdx + 1) (or 0 from null)
 *   - `[` goes back (or to last from null)
 *   - Modifier keys (cmd/ctrl/alt) are ignored
 *   - Typing in INPUT / TEXTAREA / contentEditable is ignored
 *   - No-op when compactMarkers.length === 0 (listener not mounted)
 */

function dispatchKey(key: string, init: Partial<KeyboardEventInit> = {}) {
  const evt = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  window.dispatchEvent(evt);
  return evt;
}

describe('useBracketCompactNav', () => {
  // Recovery 2026-05-30 REG-5: type the mock to the hook's exact
  // signature so the props object is assignable to
  // `UseBracketCompactNavArgs` without `as unknown as` casts.
  let focusCompactMarker: ReturnType<typeof vi.fn<(index: number) => void>>;

  beforeEach(() => {
    focusCompactMarker = vi.fn<(index: number) => void>();
  });

  it(']  advances from null to index 0', () => {
    renderHook(() =>
      useBracketCompactNav({
        compactMarkers: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        activeCompactIdx: null,
        focusCompactMarker,
      })
    );
    dispatchKey(']');
    expect(focusCompactMarker).toHaveBeenCalledWith(0);
  });

  it(']  advances from idx 1 to idx 2', () => {
    renderHook(() =>
      useBracketCompactNav({
        compactMarkers: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        activeCompactIdx: 1,
        focusCompactMarker,
      })
    );
    dispatchKey(']');
    expect(focusCompactMarker).toHaveBeenCalledWith(2);
  });

  it('[  from null goes to LAST', () => {
    renderHook(() =>
      useBracketCompactNav({
        compactMarkers: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        activeCompactIdx: null,
        focusCompactMarker,
      })
    );
    dispatchKey('[');
    expect(focusCompactMarker).toHaveBeenCalledWith(2);
  });

  it('[  from idx 2 goes to idx 1', () => {
    renderHook(() =>
      useBracketCompactNav({
        compactMarkers: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        activeCompactIdx: 2,
        focusCompactMarker,
      })
    );
    dispatchKey('[');
    expect(focusCompactMarker).toHaveBeenCalledWith(1);
  });

  it('Cmd+]  does NOT navigate (browser tab nav)', () => {
    renderHook(() =>
      useBracketCompactNav({
        compactMarkers: [{ id: 'a' }, { id: 'b' }],
        activeCompactIdx: null,
        focusCompactMarker,
      })
    );
    dispatchKey(']', { metaKey: true });
    expect(focusCompactMarker).not.toHaveBeenCalled();
  });

  it('typing in an INPUT does NOT navigate', () => {
    renderHook(() =>
      useBracketCompactNav({
        compactMarkers: [{ id: 'a' }, { id: 'b' }],
        activeCompactIdx: null,
        focusCompactMarker,
      })
    );
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const evt = new KeyboardEvent('keydown', {
      key: ']',
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(evt);
    document.body.removeChild(input);
    expect(focusCompactMarker).not.toHaveBeenCalled();
  });

  it('empty compactMarkers: no listener mounted, key press is a no-op', () => {
    renderHook(() =>
      useBracketCompactNav({
        compactMarkers: [],
        activeCompactIdx: null,
        focusCompactMarker,
      })
    );
    dispatchKey(']');
    dispatchKey('[');
    expect(focusCompactMarker).not.toHaveBeenCalled();
  });

  it('listener is removed on unmount', () => {
    const { unmount } = renderHook(() =>
      useBracketCompactNav({
        compactMarkers: [{ id: 'a' }, { id: 'b' }],
        activeCompactIdx: null,
        focusCompactMarker,
      })
    );
    unmount();
    dispatchKey(']');
    expect(focusCompactMarker).not.toHaveBeenCalled();
  });
});
