import { createElement as h, StrictMode } from 'react';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react';
import { afterEach, beforeAll, it, expect, vi } from 'vitest';
import { Tabs, Menu, Tooltip, Dialog, TextField, TextArea, Select, Checkbox, Switch, IconButton } from '../facade.js';
import { KitProvider, ToastRegion } from '../KitProvider.js';
import { useToast } from '../Kit.hooks.js';
import { createKit, createStrictKit, extendKit, describeKit } from '../kit.js';
import type { ToastService } from '../../toast.js';
import type { ReactKit } from '../types.js';
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => cleanup());
it('native controls publish semantic change events on the focusable element', () => {
  const text = vi.fn(), area = vi.fn(), select = vi.fn(), check = vi.fn(), toggle = vi.fn();
  const view = render(h('div', null,
    h(TextField, { label: 'Name', value: '', onValueChange: text, attrs: { 'data-agent-element': 'name' } }),
    h(TextArea, { label: 'Body', value: '', onValueChange: area }),
    h(Select, { label: 'Option', value: 'a', options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }], onValueChange: select }),
    h(Checkbox, { label: 'Agree', checked: false, onCheckedChange: check }),
    h(Switch, { label: 'Enable', checked: false, onCheckedChange: toggle }),
    h(IconButton, { label: 'Remove', children: '×' }),
  ));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Example' } });
  fireEvent.change(screen.getByLabelText('Option'), { target: { value: 'b' } });
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('switch'));
  expect(text).toHaveBeenCalledWith({ value: 'Ada' }); expect(area).toHaveBeenCalledWith({ value: 'Example' }); expect(select).toHaveBeenCalledWith({ value: 'b' });
  expect(check).toHaveBeenCalledWith({ checked: true }); expect(toggle).toHaveBeenCalledWith({ checked: true });
  expect(view.container.querySelector('[data-agent-element="name"]')?.tagName).toBe('INPUT');
  expect(screen.getByRole('button', { name: 'Remove' }).textContent).toBe('×');
});
it('tabs rove with keyboard, skip disabled tabs and associate panels', () => {
  const onValueChange = vi.fn();
  render(h(Tabs, { label: 'Sections', value: 'a', onValueChange,
    items: [{ id: 'a', label: 'Alpha', content: 'First' }, { id: 'b', label: 'Blocked', content: 'Blocked panel', disabled: true }, { id: 'c', label: 'Charlie', content: 'Last' }] }));
  const alpha = screen.getByRole('tab', { name: 'Alpha' }), charlie = screen.getByRole('tab', { name: 'Charlie' });
  alpha.focus(); fireEvent.keyDown(alpha, { key: 'ArrowRight' });
  expect(onValueChange).toHaveBeenCalledWith({ value: 'c' }); expect(document.activeElement).toBe(charlie);
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(alpha.id);
  fireEvent.keyDown(charlie, { key: 'Home' }); expect(document.activeElement).toBe(alpha);
});
it('menu supports safe keyboard selection and Escape restoration', () => {
  const onPress = vi.fn();
  render(h(Menu, { label: 'Actions', items: [{ id: 'a', label: 'Archive', onPress }, { id: 'b', label: 'Blocked', disabled: true, onPress }, { id: 'c', label: 'Copy', onPress }] }));
  const trigger = screen.getByRole('button', { name: 'Actions' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' }); expect(document.activeElement?.textContent).toBe('Archive');
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Archive' }), { key: 'ArrowDown' }); expect(document.activeElement?.textContent).toBe('Copy');
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Copy' }), { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull(); expect(document.activeElement).toBe(trigger); expect(onPress).not.toHaveBeenCalled();
  fireEvent.click(trigger); fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
  expect(onPress).toHaveBeenCalledTimes(1); expect(document.activeElement).toBe(trigger);
});
it('tooltip opens on focus and hover and closes on Escape', () => {
  render(h(Tooltip, { content: 'More information', children: 'Help', attrs: { 'data-agent-element': 'help' } }));
  const trigger = document.querySelector<HTMLElement>('[data-agent-element="help"]')!;
  fireEvent.focus(trigger); expect(screen.getByRole('tooltip').textContent).toBe('More information');
  expect(trigger.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
  fireEvent.keyDown(trigger, { key: 'Escape' }); expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.mouseEnter(trigger); expect(screen.getByRole('tooltip').textContent).toBe('More information');
  fireEvent.mouseLeave(trigger); expect(screen.queryByRole('tooltip')).toBeNull();
});
it('dialog remains controlled while pending and restores focus on close', () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const onClose = vi.fn(), props = { open: true, title: 'Edit record', pending: true, onClose, children: 'Example' };
  const view = render(h(Dialog, props));
  const dialog = screen.getByRole('dialog');
  fireEvent(dialog, new Event('cancel', { cancelable: true })); fireEvent.click(dialog); expect(onClose).not.toHaveBeenCalled();
  view.rerender(h(Dialog, { ...props, pending: false }));
  fireEvent(dialog, new Event('cancel', { cancelable: true })); expect(onClose).toHaveBeenCalledTimes(1);
  view.rerender(h(Dialog, { ...props, open: false })); expect(document.activeElement).toBe(trigger); trigger.remove();
});
it('an owned toast service survives StrictMode effect replay and disposes on actual unmount', async () => {
  let service: ToastService | undefined;
  function Probe() { service = useToast({}); return h(ToastRegion); }
  const view = render(h(StrictMode, null, h(KitProvider, { children: h(Probe) })));
  await act(async () => { await Promise.resolve(); service!.push({ message: 'Saved', durationMs: 0 }); });
  expect(screen.getByRole('status').textContent).toBe('Saved×');
  view.unmount(); await Promise.resolve();
  expect(() => service!.push({ message: 'Unmounted' })).toThrow('disposed');
});
it('kit resolution rejects invalid runtime components and preserves extension provenance', () => {
  expect(() => createKit({ components: { Button: null } as unknown as Partial<ReactKit> })).toThrow('not a component');
  expect(() => createStrictKit({ components: {} as ReactKit })).toThrow('missing ConfirmDialog');
  const base = createKit({ components: { Notice: () => null } });
  const kit = extendKit({ base, components: { Badge: () => null } }, { id: 'house' });
  expect(describeKit({ kit }).coverage.filter(row => row.source === 'override').map(row => row.component)).toEqual(['Notice', 'Badge']);
  expect(describeKit({ kit }).fallbacks).toContain('ConfirmDialog');
});
