import { createElement, createRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { nativeKit } from '../native/index.js';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('honors the feature initial focus target and restores the trigger without scrolling', () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  const focus = vi.spyOn(opener, 'focus'); const ref = createRef<HTMLDialogElement>();
  const { unmount } = render(createElement(nativeKit.Dialog, { ref, open: true, title: 'Editor', onClose() {},
    children: createElement('input', { 'aria-label': 'Title', 'data-jini-autofocus': true }) }));
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Title' })); expect(ref.current!.scrollTop).toBe(0);
  unmount(); expect(focus).toHaveBeenCalledWith({ preventScroll: true }); opener.remove();
});
