import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEmbedChatDialog } from '../dialog.hooks.js';

describe('useEmbedChatDialog focus and Escape edges', () => {
  it('returns focus to a launcher element that has no inner button', () => {
    const launcher = document.createElement('div');
    launcher.tabIndex = 0;
    const panel = document.createElement('section');
    document.body.replaceChildren(launcher, panel);
    const { rerender } = renderHook(({ open }) => useEmbedChatDialog({ open, onClose: vi.fn(), panelRef: { current: panel }, launcherRef: { current: launcher } }), { initialProps: { open: true } });
    rerender({ open: false });
    expect(document.activeElement).toBe(launcher);
  });

  it('does not listen for Escape while open without a mounted panel', () => {
    const onClose = vi.fn();
    renderHook(() => useEmbedChatDialog({ open: true, onClose, panelRef: { current: null }, launcherRef: { current: null } }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
