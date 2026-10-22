// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssetGridKeyboardShortcuts, type UseAssetGridKeyboardShortcutsParams } from '../useAssetGridKeyboardShortcuts.js';

function params(overrides: Partial<UseAssetGridKeyboardShortcutsParams>, _options = {}): UseAssetGridKeyboardShortcutsParams {
  return {
    active: true, enabled: true, hasAssets: true, hasSelection: true, isPreviewOpen: false,
    onSelectAll: vi.fn(), onClearSelection: vi.fn(), onRequestDeleteSelected: vi.fn(), ...overrides,
  };
}

describe('asset-grid keyboard L161 characterization', () => {
  afterEach(() => { cleanup(); document.body.replaceChildren(); });

  it.each([
    { key: 'a', metaKey: true }, { key: 'A', metaKey: true },
    { key: 'a', ctrlKey: true }, { key: 'A', ctrlKey: true },
  ])('selects all and prevents default for $key meta=$metaKey ctrl=$ctrlKey', (input) => {
    const callbacks = params({ isPreviewOpen: true });
    renderHook(() => useAssetGridKeyboardShortcuts(callbacks));
    const event = new KeyboardEvent('keydown', { ...input, cancelable: true });
    window.dispatchEvent(event);
    expect(callbacks.onSelectAll).toHaveBeenCalledTimes(1);
    expect(callbacks.onClearSelection).not.toHaveBeenCalled();
    expect(callbacks.onRequestDeleteSelected).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it.each(['Delete', 'Backspace'])('requests deletion and prevents default for %s', (key) => {
    const callbacks = params({});
    renderHook(() => useAssetGridKeyboardShortcuts(callbacks));
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    window.dispatchEvent(event);
    expect(callbacks.onRequestDeleteSelected).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    { active: false }, { enabled: false }, { hasAssets: false },
  ])('does not consume select-all with gate %j', (overrides) => {
    const callbacks = params(overrides);
    renderHook(() => useAssetGridKeyboardShortcuts(callbacks));
    const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(callbacks.onSelectAll).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(['input', 'textarea', 'select'])('defers select-all and deletion while focused in %s', (tag) => {
    const target = document.createElement(tag);
    document.body.append(target);
    target.focus();
    const callbacks = params({});
    renderHook(() => useAssetGridKeyboardShortcuts(callbacks));
    for (const input of [{ key: 'A', ctrlKey: true }, { key: 'Delete' }, { key: 'Backspace' }]) {
      const event = new KeyboardEvent('keydown', { ...input, cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(callbacks.onSelectAll).not.toHaveBeenCalled();
    expect(callbacks.onRequestDeleteSelected).not.toHaveBeenCalled();
  });

  it('defers select-all and deletion in a contenteditable surface', () => {
    const target = document.createElement('div');
    target.setAttribute('contenteditable', 'true');
    target.tabIndex = 0;
    document.body.append(target);
    target.focus();
    expect(document.activeElement).toBe(target);
    const callbacks = params({});
    renderHook(() => useAssetGridKeyboardShortcuts(callbacks));
    for (const input of [{ key: 'a', metaKey: true }, { key: 'Delete' }, { key: 'Backspace' }]) {
      const event = new KeyboardEvent('keydown', { ...input, cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(callbacks.onSelectAll).not.toHaveBeenCalled();
    expect(callbacks.onRequestDeleteSelected).not.toHaveBeenCalled();
  });

  it.each([
    { active: false }, { enabled: false }, { hasSelection: false }, { isPreviewOpen: true },
  ])('defers Escape and delete keys with gate %j', (overrides) => {
    const callbacks = params(overrides);
    renderHook(() => useAssetGridKeyboardShortcuts(callbacks));
    for (const key of ['Escape', 'Delete', 'Backspace']) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(callbacks.onClearSelection).not.toHaveBeenCalled();
    expect(callbacks.onRequestDeleteSelected).not.toHaveBeenCalled();
  });

  it('clears on Escape even while typing, without preventing default', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const callbacks = params({});
    renderHook(() => useAssetGridKeyboardShortcuts(callbacks));
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(event);
    expect(callbacks.onClearSelection).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(['a', 'A', 'Enter', 'x'])('ignores unrelated/unmodified key %s', (key) => {
    const callbacks = params({});
    renderHook(() => useAssetGridKeyboardShortcuts(callbacks));
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    window.dispatchEvent(event);
    expect(callbacks.onSelectAll).not.toHaveBeenCalled();
    expect(callbacks.onClearSelection).not.toHaveBeenCalled();
    expect(callbacks.onRequestDeleteSelected).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
