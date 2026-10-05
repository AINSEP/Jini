import { createElement as h, createRef } from 'react';
import { render, renderHook, fireEvent, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { nativeKit } from '../native/index.js';
import { useNativeToast, useNativeNotice, useNativeSpinner } from '../native/Controls.hooks.js';
import { useNativeDialog } from '../native/Dialog.hooks.js';
import type { ConfirmController, DialogProps } from '../types.js';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('native status controls', () => {
  it('a danger toast is an alert; every other tone is a polite status', () => {
    expect(renderHook(() => useNativeToast({ message: 'Failed', tone: 'danger' })).result.current.props).toMatchObject({ role: 'alert', 'data-jini-variant': 'danger' });
    expect(renderHook(() => useNativeToast({ message: 'Saved' })).result.current.props).toMatchObject({ role: 'status', 'data-jini-variant': 'info' });
  });

  it('a danger notice maps to the error class and alert role', () => {
    expect(renderHook(() => useNativeNotice({ children: 'Broken', tone: 'danger' })).result.current.props)
      .toMatchObject({ className: 'jini-notice jini-notice-error', role: 'alert', 'data-jini-variant': 'danger' });
    expect(renderHook(() => useNativeNotice({ children: 'Heads up', tone: 'warning' })).result.current.props)
      .toMatchObject({ className: 'jini-notice jini-notice-warning', role: 'status' });
    expect(renderHook(() => useNativeNotice({ children: 'Fyi' })).result.current.props.className).toBe('jini-notice jini-notice-info');
  });

  it('a spinner names itself Loading unless given a label', () => {
    expect(renderHook(() => useNativeSpinner({})).result.current.props['aria-label']).toBe('Loading');
    expect(renderHook(() => useNativeSpinner({ label: 'Saving' })).result.current.props['aria-label']).toBe('Saving');
  });
});

describe('native dialog', () => {
  // jsdom has no showModal/close; a browser does. Install them so the browser path runs.
  function withModalApi() {
    const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
    const close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close });
    return { showModal, close, restore() {
      delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
      delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
    } };
  }

  it('opens modally through showModal and closes through close() in a browser', () => {
    const api = withModalApi();
    try {
      const props = { open: true, title: 'Edit', onClose() {} };
      const view = render(h(nativeKit.Dialog, props));
      expect(api.showModal).toHaveBeenCalledTimes(1);
      view.rerender(h(nativeKit.Dialog, { ...props, open: false }));
      expect(api.close).toHaveBeenCalledTimes(1);
    } finally { api.restore(); }
  });

  it('does not reopen an already-open dialog nor close one the browser already closed', () => {
    const api = withModalApi();
    try {
      const props = { open: true, title: 'Edit', onClose() {}, attrs: { open: true } as unknown as NonNullable<DialogProps['attrs']> };
      const view = render(h(nativeKit.Dialog, props));
      expect(api.showModal).not.toHaveBeenCalled();
      screen.getByRole('dialog', { hidden: true }).removeAttribute('open');
      view.rerender(h(nativeKit.Dialog, { ...props, attrs: {}, open: false }));
      expect(api.close).not.toHaveBeenCalled();
    } finally { api.restore(); }
  });

  it('falls back to focusing the dialog itself when it has no autofocus target or close button', () => {
    function Bare() { const vm = useNativeDialog({ open: true, title: 'Bare', onClose() {} }); return h('dialog', vm.props, 'content'); }
    render(h(Bare));
    expect(document.activeElement?.tagName).toBe('DIALOG');
  });

  it('closes on its own close button and on a backdrop click, but not on a click inside', () => {
    const onClose = vi.fn();
    render(h(nativeKit.Dialog, { open: true, title: 'Edit', onClose, children: h('p', null, 'Body') }));
    fireEvent.click(screen.getByText('Body'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('a pending dialog ignores its close button', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useNativeDialog({ open: false, title: 'Edit', onClose, pending: true }));
    expect(result.current.closeProps.disabled).toBe(true);
    result.current.closeProps.onPress();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the confirm dialog routes a native cancel to requestDismiss with reason close', () => {
    const requestDismiss = vi.fn(() => true), focusInitial = vi.fn();
    const controller: ConfirmController = {
      open: true, pending: false, title: 'Delete', body: null, consequence: undefined, error: null, titleAttrs: { id: 't' },
      frameAttrs: { id: 'f', role: 'alertdialog', 'aria-labelledby': 't' }, cancel: { children: 'Cancel' }, confirm: { children: 'Delete' },
      boundaryRef: createRef(), overlayContainer: null, agentMayConfirm: true, requestDismiss, focusInitial, nativeActions: true,
    };
    render(h(nativeKit.ConfirmDialog, { controller }));
    expect(focusInitial).toHaveBeenCalledWith({});
    fireEvent(screen.getByRole('alertdialog'), new Event('cancel', { cancelable: true }));
    expect(requestDismiss).toHaveBeenCalledWith({ reason: 'close' });
  });
});

describe('native tabs', () => {
  const items = [{ id: 'a', label: 'Alpha', content: 'First' }, { id: 'b', label: 'Bravo', content: 'Second' }, { id: 'c', label: 'Charlie', content: 'Third' }];

  it('selects the first enabled tab when the value matches none, and reports clicks', () => {
    const onValueChange = vi.fn();
    render(h(nativeKit.Tabs, { label: 'Sections', value: 'missing', onValueChange, items }));
    expect(screen.getByRole('tab', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Bravo' }));
    expect(onValueChange).toHaveBeenCalledWith({ value: 'b' });
  });

  it('End jumps to the last tab, ArrowLeft wraps, other keys do nothing', () => {
    const onValueChange = vi.fn();
    render(h(nativeKit.Tabs, { label: 'Sections', value: 'a', onValueChange, items }));
    const alpha = screen.getByRole('tab', { name: 'Alpha' });
    fireEvent.keyDown(alpha, { key: 'End' });
    expect(onValueChange).toHaveBeenLastCalledWith({ value: 'c' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Charlie' }));
    fireEvent.keyDown(alpha, { key: 'ArrowLeft' });
    expect(onValueChange).toHaveBeenLastCalledWith({ value: 'c' });
    onValueChange.mockClear();
    fireEvent.keyDown(alpha, { key: 'a' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('a tab list with every tab disabled ignores navigation keys', () => {
    const onValueChange = vi.fn();
    render(h(nativeKit.Tabs, { label: 'Sections', value: 'a', onValueChange, items: items.map(item => ({ ...item, disabled: true })) }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'Home' });
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe('native menu', () => {
  const items = (onPress = vi.fn()) => [
    { id: 'a', label: 'Archive', onPress }, { id: 'b', label: 'Blocked', disabled: true, onPress },
    { id: 'c', label: 'Copy', onPress }, { id: 'd', label: 'Delete', onPress, attrs: { 'data-jini-variant': 'danger' } },
  ];
  const open = () => { fireEvent.click(screen.getByRole('button', { name: 'Actions' })); return screen.getByRole('menu'); };

  it('marks danger items and moves focus with Home, End and ArrowUp, skipping disabled items', () => {
    render(h(nativeKit.Menu, { label: 'Actions', items: items() }));
    open();
    expect(screen.getByRole('menuitem', { name: 'Delete' }).className).toBe('jini-row-menu-item jini-btn-danger');
    expect(screen.getByRole('menuitem', { name: 'Archive' }).className).toBe('jini-row-menu-item');
    const archive = screen.getByRole('menuitem', { name: 'Archive' });
    fireEvent.keyDown(archive, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('Delete');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement?.textContent).toBe('Archive');
    fireEvent.keyDown(archive, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('Delete');
    fireEvent.keyDown(document.activeElement!, { key: 'x' });
    expect(document.activeElement?.textContent).toBe('Delete');
  });

  it('Tab closes without returning focus to the trigger', () => {
    render(h(nativeKit.Menu, { label: 'Actions', items: items() }));
    open();
    const archive = screen.getByRole('menuitem', { name: 'Archive' });
    fireEvent.keyDown(archive, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Actions' }));
  });

  it('a pointerdown outside closes it; inside the menu or on the trigger keeps it open', () => {
    render(h(nativeKit.Menu, { label: 'Actions', items: items() }));
    open();
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Copy' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('flips above the trigger when there is no room below, clamped to the viewport', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'menu'
        ? ({ top: 0, bottom: 120, left: 0, right: 200, width: 200, height: 120 } as DOMRect)
        : ({ top: 700, bottom: 730, left: 900, right: 1000, width: 100, height: 30 } as DOMRect);
    });
    render(h(nativeKit.Menu, { label: 'Actions', items: items() }));
    const menu = open();
    // window.innerHeight is 768 in jsdom: 730 + 120 + 4 overflows, so it opens at 700 - 120 - 4.
    expect(menu.style.top).toBe('576px');
    expect(menu.style.left).toBe(`${Math.min(1000 - 200, window.innerWidth - 200 - 4)}px`);
  });

  it('a disabled trigger ignores arrow keys', () => {
    render(h(nativeKit.Menu, { label: 'Actions', items: items(), disabled: true }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions' }), { key: 'ArrowDown' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('native tooltip', () => {
  it('closes on blur', () => {
    render(h(nativeKit.Tooltip, { content: 'More', children: 'Help', label: 'Help' }));
    const trigger = screen.getByLabelText('Help');
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip').textContent).toBe('More');
    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
