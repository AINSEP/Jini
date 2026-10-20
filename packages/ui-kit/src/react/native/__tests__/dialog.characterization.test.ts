import { createElement } from 'react';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNativeDialog } from '../Dialog.hooks.js';
import type { DialogProps } from '../../types.js';

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
function modalApi(required: { showModal?: (this: HTMLDialogElement) => void; close?: (this: HTMLDialogElement) => void }, _optional: Record<string, never> = {}) {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: required.showModal });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: required.close });
}
function Bare(required: { open: boolean; initialFocus?: () => void; document?: Pick<Document, 'activeElement'>; children?: DialogProps['children'] }) {
  const vm = useNativeDialog({ open: required.open, title: 'Editor', onClose() {} }, { ...(required.initialFocus ? { initialFocus: required.initialFocus } : {}), ...(required.document ? { document: required.document } : {}) });
  return createElement('dialog', vm.props, required.children);
}
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); document.body.innerHTML = '';
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow);
  else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
});

describe('native dialog lifecycle characterization', () => {
  it('does nothing when no dialog is mounted', () => {
    const initialFocus = vi.fn();
    const { unmount } = renderHook(() => useNativeDialog({ open: true, title: 'Editor', onClose() {} }, { initialFocus }));
    unmount(); expect(initialFocus).not.toHaveBeenCalled();
  });

  it('falls back to the open attribute, focuses the close action, and removes open on cleanup', () => {
    modalApi({});
    const { unmount } = render(createElement(Bare, { open: true, children: createElement('button', { 'data-jini-part': 'kit.dialog-close' }, 'Close') }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(document.activeElement?.textContent).toBe('Close');
    unmount(); expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('prioritizes explicit focus over autofocus and keeps the injected opener across content edits', () => {
    modalApi({});
    const opener = document.createElement('button'); document.body.append(opener);
    const focus = vi.spyOn(opener, 'focus');
    const initialFocus = vi.fn();
    const port: { activeElement: Element | null } = { activeElement: opener };
    const view = render(createElement(Bare, { open: true, document: port, initialFocus, children: createElement('input', { 'data-jini-autofocus': true }) }));
    expect(initialFocus).toHaveBeenCalledTimes(1);
    port.activeElement = document.body;
    view.rerender(createElement(Bare, { open: true, document: port, initialFocus, children: 'Changed' }));
    expect(initialFocus).toHaveBeenCalledTimes(1);
    view.rerender(createElement(Bare, { open: false, document: port, initialFocus }));
    // Cleanup and the closed-state layout setup both restore the saved opener.
    expect(focus).toHaveBeenCalledTimes(2);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it('focuses autofocus before close and otherwise focuses the dialog', () => {
    modalApi({});
    const view = render(createElement(Bare, { open: true, children: [createElement('button', { key: 'close', 'data-jini-part': 'kit.dialog-close' }, 'Close'), createElement('input', { key: 'input', 'data-jini-autofocus': true })] }));
    expect(document.activeElement?.tagName).toBe('INPUT');
    view.unmount();
    render(createElement(Bare, { open: true }));
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it.each(['connected', 'detached', 'svg', 'null'] as const)('restores only a connected HTML opener: %s', kind => {
    modalApi({});
    const opener = kind === 'null' ? null : kind === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement('button');
    if (opener) document.body.append(opener);
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const view = render(createElement(Bare, { open: true, document: { activeElement: opener } }));
    focus.mockClear();
    if (kind === 'detached') opener?.remove();
    view.rerender(createElement(Bare, { open: false, document: { activeElement: opener } }));
    expect(focus).toHaveBeenCalledTimes(kind === 'connected' ? 2 : 0);
  });

  it.each([false, true])('keeps modal API guards when the dialog starts open=%s', alreadyOpen => {
    const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
    const close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
    modalApi({ showModal, close });
    function View() {
      const vm = useNativeDialog({ open: true, title: 'Editor', onClose() {} });
      return createElement('dialog', { ...vm.props, open: alreadyOpen || undefined });
    }
    const { unmount } = render(createElement(View));
    expect(showModal).toHaveBeenCalledTimes(alreadyOpen ? 0 : 1);
    const dialog = screen.getByRole('dialog');
    if (alreadyOpen) dialog.removeAttribute('open');
    unmount(); expect(close).toHaveBeenCalledTimes(alreadyOpen ? 0 : 1);
  });
});
