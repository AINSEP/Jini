import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Button, Checkbox, Dialog, IconButton, Menu, Select, Switch, Tabs, TextArea, TextField } from '../facade.js';
import { ConfirmDialog } from '../confirm/ConfirmDialog.js';
import { KitProvider } from '../KitProvider.js';
import { createKit } from '../kit.js';
import { nativeKit } from '../native/index.js';
import type { ButtonProps } from '../types.js';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { cleanup(); document.body.innerHTML = ''; });
const noop = () => undefined;
const handle = (element: Element) => element.getAttribute('data-agent-element');

it('defaults every ordinary facade control on at its focusable leaf', () => {
  const { container } = render(h('div', null,
    h(Button, { children: 'Save' }), h(IconButton, { label: 'More' }),
    h(TextField, { label: 'Name', value: '', onValueChange: noop }),
    h(TextArea, { label: 'Body', value: '', onValueChange: noop }),
    h(Select, { label: 'Type', value: 'a', options: [{ value: 'a', label: 'A' }], onValueChange: noop }),
    h(Checkbox, { label: 'Agree', checked: false, onCheckedChange: noop }),
    h(Switch, { label: 'Enable', checked: false, onCheckedChange: noop })));
  const controls = [...container.querySelectorAll('button,input,textarea,select')];
  expect(controls).toHaveLength(7);
  expect(new Set(controls.map(handle)).size).toBe(7);
  for (const control of controls) expect(handle(control)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

it('keeps explicit attrs and lets an opt-out suppress caller addressing', () => {
  render(h('div', null,
    h(Button, { attrs: { 'data-agent-element': 'save-existing', 'data-agent-page': 'settings' }, children: 'Existing' }),
    h(Button, { agentHandle: 'save-override', children: 'Override' } as ButtonProps),
    h(Button, { agentHandle: false, attrs: { 'data-agent-element': 'must-remove', 'data-testid': 'opt-out' }, children: 'Private' } as ButtonProps)));
  expect(handle(screen.getByRole('button', { name: 'Existing' }))).toBe('save-existing');
  expect(handle(screen.getByRole('button', { name: 'Override' }))).toBe('save-override');
  expect(handle(screen.getByRole('button', { name: 'Private' }))).toBeNull();
  expect(screen.getByTestId('opt-out')).toBe(screen.getByRole('button', { name: 'Private' }));
});

it('keeps instance identity through duplicate labels, keyed reorder and independent roots', () => {
  function List({ ids }: { ids: string[] }) { return h('div', null, ids.map(id => h(Button, { key: id, attrs: { 'data-testid': id }, children: 'Same' }))); }
  const first = render(h(List, { ids: ['one', 'two'] }));
  const before = ['one', 'two'].map(id => handle(screen.getByTestId(id)));
  first.rerender(h(List, { ids: ['two', 'one'] }));
  expect(['one', 'two'].map(id => handle(screen.getByTestId(id)))).toEqual(before);
  const otherContainer = document.createElement('div'); document.body.append(otherContainer);
  const root = createRoot(otherContainer, { identifierPrefix: 'another-root' });
  act(() => root.render(h(Button, { children: 'Same' })));
  const other = otherContainer.querySelector('button')!;
  expect(handle(other)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  expect(before).not.toContain(handle(other));
  expect(handle(other)!.length).toBeLessThanOrEqual(128);
  act(() => root.unmount());
});

it('uses the injected attrs port for defaults and forwards metadata through overrides', () => {
  const port = vi.fn(({ handle: value }: { handle: string }) => ({ 'data-agent-element': value, 'data-agent-page': 'editor' }));
  const Override = (props: ButtonProps) => h('button', props.attrs, props.children);
  render(h(KitProvider, { agent: port, kit: createKit({ components: { Button: Override } }), children: h(Button, { children: 'Save' }) }));
  expect(port).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Save' }).getAttribute('data-agent-page')).toBe('editor');
  expect(handle(screen.getByRole('button', { name: 'Save' }))).toMatch(/^kit-/);
});

it('never regenerates a human-only confirmation handle through a nested facade', () => {
  const NestedButton = (props: ButtonProps) => h(Button, props);
  // This custom view deliberately renders the public Button facade, outside the override lookup.
  const ConfirmView = ({ controller }: Parameters<typeof import('../native/Dialog.js').NativeConfirmDialog>[0]) =>
    h('div', controller.frameAttrs, h(NestedButton, controller.cancel), h(NestedButton, controller.confirm));
  render(h(KitProvider, { guard: 'off', kit: createKit({ components: { ConfirmDialog: ConfirmView } }), children:
    h(ConfirmDialog, { open: true, title: 'Approve', confirmLabel: 'Allow', agentHandle: 'approval', agentMayConfirm: false, onConfirm: noop, onCancel: noop }) }));
  const confirm = screen.getByRole('button', { name: /^Allow/ });
  expect(handle(confirm)).toBeNull();
  expect(confirm.getAttributeNames().filter(name => name.startsWith('data-agent-'))).toEqual([]);
});

it('keeps menu and dialog leaves inside the provided overlay root and forwards page identity', () => {
  const root = document.createElement('div'); document.body.append(root);
  const press = vi.fn(), close = vi.fn();
  const view = render(h(KitProvider, { overlayContainer: root, children: h('div', null,
    h(Menu, { label: 'Actions', attrs: { 'data-agent-element': 'actions', 'data-agent-page': 'editor' }, items: [{ id: 'copy', label: 'Copy', onPress: press }] }),
    h(Dialog, { open: true, title: 'Details', attrs: { 'data-agent-element': 'details', 'data-agent-page': 'editor' }, onClose: close })) }));
  fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
  const item = screen.getByRole('menuitem', { name: 'Copy' });
  expect(root.contains(item)).toBe(true);
  expect(handle(item)).toBe('actions-copy');
  expect(item.getAttribute('data-agent-page')).toBe('editor');
  fireEvent.click(item); expect(press).toHaveBeenCalledOnce();
  const closeButton = screen.getByRole('button', { name: 'Close' });
  expect(handle(closeButton)).toBe('details-close');
  expect(closeButton.getAttribute('data-agent-page')).toBe('editor');
  fireEvent.click(closeButton); expect(close).toHaveBeenCalledOnce();
  view.unmount(); root.remove();
});

it('tags every tab using item identity and keeps hidden panel descendants inactive', () => {
  const items = [{ id: 'first', label: 'Same', content: h(Button, { children: 'Hidden action' }) }, { id: 'other', label: 'Same', content: 'Other' }];
  const { rerender } = render(h(Tabs, { label: 'Sections', value: 'first', items, onValueChange: noop }));
  const initial = screen.getAllByRole('tab').map(tab => [tab.getAttribute('data-tab-id'), handle(tab)]);
  expect(new Set(initial.map(([, value]) => value)).size).toBe(2);
  for (const [, value] of initial) expect(value).toMatch(/^kit-/);
  rerender(h(Tabs, { label: 'Sections', value: 'other', items: [...items].reverse(), onValueChange: noop }));
  expect(screen.getAllByRole('tab').map(tab => [tab.getAttribute('data-tab-id'), handle(tab)]).reverse()).toEqual(initial);
  expect(screen.getByText('Hidden action').closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true);
});

it('propagates an explicit composite opt-out through item attrs and nested close buttons', () => {
  const children = h('div', null,
    h(Menu, { agentHandle: false, label: 'Private menu', attrs: { 'data-agent-element': 'menu-must-go' }, items: [{ id: 'copy', label: 'Copy', attrs: { 'data-agent-element': 'item-must-go' }, onPress: noop }] }),
    h(Tabs, { agentHandle: false, label: 'Private tabs', attrs: { 'data-agent-element': 'tabs-must-go' }, value: 'one', onValueChange: noop, items: [{ id: 'one', label: 'One', content: 'Panel', attrs: { 'data-agent-element': 'tab-must-go' } }] }),
    h(Dialog, { agentHandle: false, open: true, title: 'Private dialog', attrs: { 'data-agent-element': 'dialog-must-go' }, onClose: noop }));
  render(h(KitProvider, { children }));
  fireEvent.click(screen.getByRole('button', { name: 'Private menu' }));
  for (const element of [screen.getByRole('button', { name: 'Private menu' }), screen.getByRole('menuitem'), screen.getByRole('tab'), screen.getByRole('button', { name: 'Close' })]) expect(handle(element)).toBeNull();
});

it('withholds explicit handles on private text areas and secret fields before and after reveal', () => {
  render(h('div', null,
    h(TextArea, { agentHandle: 'secret-area', label: 'Private text', value: 'secret', onValueChange: noop, attrs: { 'data-agent-private': '', 'data-agent-element': 'explicit-area' } }),
    h(TextField, { agentHandle: 'secret-password', label: 'Password', type: 'password', value: 'secret', onValueChange: noop, attrs: { 'data-agent-element': 'explicit-password' } })));
  const area = screen.getByLabelText('Private text'), password = screen.getByLabelText('Password'), toggle = screen.getByRole('button', { name: 'Show Password' });
  for (const element of [area, password, toggle]) {
    expect(handle(element)).toBeNull();
    expect(element.getAttribute('data-agent-private')).toBe('');
  }
  fireEvent.click(toggle);
  expect((password as HTMLInputElement).type).toBe('text');
  expect(handle(password)).toBeNull(); expect(handle(toggle)).toBeNull();
});

it('does not let an unset forwarded attribute erase a default handle', () => {
  render(h('div', null,
    h(Button, { attrs: { 'data-agent-element': undefined, 'data-agent-role': undefined }, children: 'Save' }),
    h(Menu, { label: 'Actions', agentHandle: 'actions', items: [{ id: 'copy', label: 'Copy', attrs: { 'data-agent-element': undefined }, onPress: noop }] }),
    h(Tabs, { label: 'Sections', value: 'one', onValueChange: noop, attrs: { 'data-agent-element': undefined }, items: [{ id: 'one', label: 'One', content: 'Panel' }] })));
  expect(handle(screen.getByRole('button', { name: 'Save' }))).toMatch(/^kit-/);
  expect(handle(screen.getByRole('tab'))).toMatch(/^kit-.*-tabs-one$/);
  fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
  expect(handle(screen.getByRole('menuitem', { name: 'Copy' }))).toBe('actions-copy');
});


it('keeps explicit-base tab identities stable when selection changes', () => {
  const items = [{ id: 'one', label: 'One', content: 'First' }, { id: 'two', label: 'Two', content: 'Second' }];
  const props = { agentHandle: 'settings', label: 'Sections', value: 'one', items, onValueChange: noop };
  const view = render(h(Tabs, props));
  const original = screen.getAllByRole('tab').map(handle);
  expect(original).toEqual(['settings-one', 'settings-two']);
  view.rerender(h(Tabs, { ...props, value: 'two' }));
  expect(screen.getAllByRole('tab').map(handle)).toEqual(original);
});

it('never restores raw caller addressing onto a private native tab', () => {
  render(h(nativeKit.Tabs, { label: 'Private tabs', value: 'one', onValueChange: noop,
    attrs: { 'data-agent-private': '', 'data-agent-element': 'private-parent' },
    items: [{ id: 'one', label: 'One', content: 'First', attrs: { 'data-agent-element': 'private-child' } }] }));
  expect(handle(screen.getByRole('tab'))).toBeNull();
  expect(screen.getByRole('tab').getAttribute('data-agent-private')).toBe('');
});

it('defaults ordinary feature confirmations on while keeping human-only decisions unpublished', () => {
  const view = render(h(ConfirmDialog, { open: true, title: 'Remove item', confirmLabel: 'Remove', onConfirm: noop, onCancel: noop }));
  const confirm = screen.getByRole('button', { name: /^Remove/ }), cancel = screen.getByRole('button', { name: /^Cancel/ });
  const before = [handle(cancel), handle(confirm)];
  expect(before[0]).toMatch(/^kit-.*-confirm-cancel$/);
  expect(before[1]).toMatch(/^kit-.*-confirm-confirm$/);
  view.rerender(h(ConfirmDialog, { open: true, title: 'Remove item', confirmLabel: 'Remove', agentMayConfirm: false, onConfirm: noop, onCancel: noop }));
  expect(handle(screen.getByRole('button', { name: /^Cancel/ }))).toBeNull();
  expect(handle(screen.getByRole('button', { name: /^Remove/ }))).toBeNull();
});

it('keeps opted-out approval actions untagged and forwards page identity to ordinary decisions', () => {
  const view = render(h(ConfirmDialog, { open: true, title: 'Approval', confirmLabel: 'Allow', agentHandle: false, attrs: { 'data-agent-element': 'cannot-restore' }, onConfirm: noop, onCancel: noop }));
  for (const button of screen.getAllByRole('button')) expect(handle(button)).toBeNull();
  view.rerender(h(ConfirmDialog, { open: true, title: 'Approval', confirmLabel: 'Allow', attrs: { 'data-agent-page': 'editor' }, onConfirm: noop, onCancel: noop }));
  for (const button of screen.getAllByRole('button')) expect(button.getAttribute('data-agent-page')).toBe('editor');
});

it('keeps composite semantic privacy ahead of opt-outs and undefined child overrides', () => {
  render(h(Menu, { label: 'Private actions', agentHandle: false, attrs: { 'data-agent-private': '' }, items:
    [{ id: 'copy', label: 'Copy', attrs: { 'data-agent-private': undefined, 'data-agent-element': 'must-remove' }, onPress: noop }] }));
  fireEvent.click(screen.getByRole('button', { name: 'Private actions' }));
  const item = screen.getByRole('menuitem');
  expect(handle(item)).toBeNull();
  expect(item.getAttribute('data-agent-private')).toBe('');
});
