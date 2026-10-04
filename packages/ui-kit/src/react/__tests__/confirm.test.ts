import { createElement as h, forwardRef, useLayoutEffect } from 'react';
import { render, fireEvent, screen, waitFor, cleanup, act } from '@testing-library/react';
import { beforeAll, afterEach, describe, it, expect, vi } from 'vitest';
import { KitProvider, ToastRegion } from '../KitProvider.js';
import { ConfirmDialog } from '../confirm/ConfirmDialog.js';
import { createKit, extendKit, describeKit } from '../kit.js';
import { Button } from '../facade.js';
import { getSharedKitContext } from '../context.js';
import { nativeKit } from '../native/index.js';
import { createToastService } from '../../toast.js';
import type { AgentAttrsPort } from '../../attrs.js';
import type { ButtonProps, ConfirmViewProps, ConfirmDialogProps, ResolvedKit } from '../types.js';
const agent: AgentAttrsPort = ({ handle }, opts = {}) => ({ 'data-agent-element': handle, 'data-agent-label': opts.label, 'data-agent-role': opts.role });
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function fixture(props: Partial<ConfirmDialogProps> = {}, kit?: ResolvedKit, guard?: 'off' | 'fallback') {
  const onCancel = vi.fn(), onConfirm = vi.fn();
  const children = h(ConfirmDialog, { open: true, title: 'Delete record?', body: 'A record', confirmLabel: 'Delete', tone: 'danger', agentHandle: 'erase', onCancel, onConfirm, ...props });
  return { onCancel, onConfirm, ...render(h(KitProvider, { agent, ...(kit ? { kit } : {}), ...(guard ? { guard } : {}), children })) };
}
describe('confirmation controller/view binding', () => {
  it('focuses cancel, states the consequence and withholds the human-only confirm handle', () => {
    fixture({ agentMayConfirm: false });
    const cancel = screen.getByRole('button', { name: /Cancel/ });
    expect(document.activeElement).toBe(cancel);
    expect(cancel.getAttribute('data-agent-element')).toBe('erase-cancel');
    expect(screen.getByRole('button', { name: /^Delete/ }).getAttribute('data-agent-element')).toBeNull();
    expect(screen.getByRole('button', { name: /^Delete/ }).getAttribute('aria-label')).toBe('Delete — Delete record?; cannot be undone');
  });
  it('pending blocks escape, backdrop and both actions', () => {
    const { onCancel, onConfirm } = fixture({ pending: true });
    const dialog = screen.getByRole('alertdialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true })); fireEvent.click(dialog);
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ })); fireEvent.click(screen.getByRole('button', { name: /^Delete/ }));
    expect(onCancel).not.toHaveBeenCalled(); expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Cancel/ }).hasAttribute('disabled')).toBe(true);
  });
  it('an override only receives guarded prop bags even when it ignores disabled flags', () => {
    let captured: ConfirmViewProps | undefined;
    function Override(props: ConfirmViewProps) {
      captured = props;
      useLayoutEffect(() => { props.controller.cancel.onPress?.({}); props.controller.confirm.onPress?.({}); props.controller.requestDismiss({ reason: 'escape' }); }, []);
      return h(nativeKit.ConfirmDialog, props);
    }
    const { onCancel, onConfirm } = fixture({ pending: true }, createKit({ components: { ConfirmDialog: Override } }), 'off');
    expect(Object.keys(captured!)).toEqual(['controller']);
    expect('onConfirm' in captured!.controller).toBe(false); expect('onCancel' in captured!.controller).toBe(false);
    expect(onCancel).not.toHaveBeenCalled(); expect(onConfirm).not.toHaveBeenCalled();
  });
  it('a partial Button override flows into the native confirmation actions', async () => {
    const Custom = forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => h('span', { 'data-custom': 'house' }, h(nativeKit.Button, { ...props, ref })));
    const kit = extendKit({ base: createKit({}), components: { Button: Custom } }, { id: 'house' });
    fixture({}, kit);
    await waitFor(() => expect(document.querySelectorAll('[data-custom="house"]')).toHaveLength(2));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(describeKit({ kit }).violations).toEqual([]);
    expect(describeKit({ kit }).coverage.find(row => row.component === 'Button')?.source).toBe('override');
  });
  it('the dev guard reports a broken confirmation override and falls back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const kit = createKit({ components: { ConfirmDialog: () => h('div', null, 'broken') } });
    fixture({}, kit);
    await waitFor(() => expect(screen.getByRole('alertdialog').dataset.jiniPart).toBe('confirm.dialog'));
    expect(screen.queryByText('broken')).toBeNull();
    expect(describeKit({ kit }).violations).toEqual([{ component: 'ConfirmDialog', reasons: ['missing confirm frame'] }]);
    expect(describeKit({ kit }).coverage.find(row => row.component === 'ConfirmDialog')?.source).toBe('native-guard');
  });
  it('falls back to native actions when a Button override drops safety attrs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const BrokenButton = forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => h('button', { ref }, props.children));
    const kit = createKit({ components: { Button: BrokenButton } });
    fixture({}, kit);
    await waitFor(() => expect(describeKit({ kit }).violations).toHaveLength(1));
    expect(screen.getByRole('button', { name: /Delete —/ }).dataset.jiniPart).toBe('confirm.confirm');
  });
  it('guard off preserves a broken override and emits no fallback', async () => {
    const kit = createKit({ components: { ConfirmDialog: () => h('div', null, 'broken') } }, { guard: 'off' });
    fixture({}, kit);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(screen.getByText('broken').textContent).toBe('broken'); expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(describeKit({ kit }).violations).toEqual([]);
  });
  it('production does not run the development guard', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const kit = createKit({ components: { ConfirmDialog: () => h('div', null, 'production override') } });
      fixture({}, kit);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      expect(screen.getByText('production override').textContent).toBe('production override');
      expect(describeKit({ kit }).violations).toEqual([]);
    } finally { process.env.NODE_ENV = previous; }
  });
  it('blocks duplicate async confirmation and dismissal, shows failure and allows retry', async () => {
    let reject: (error: Error) => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((_resolve, r) => { reject = r; }));
    const { onCancel } = fixture({ onConfirm });
    const confirm = screen.getByRole('button', { name: /^Delete/ });
    fireEvent.click(confirm); fireEvent.click(confirm); fireEvent.click(screen.getByRole('alertdialog'));
    expect(onConfirm).toHaveBeenCalledTimes(1); expect(onCancel).not.toHaveBeenCalled();
    await act(async () => { reject(new Error('secret internal failure')); });
    expect(screen.getByRole('alert').textContent).toBe('The action failed. Please try again.');
    expect(confirm.hasAttribute('disabled')).toBe(false);
    fireEvent.click(confirm); expect(onConfirm).toHaveBeenCalledTimes(2);
    await act(async () => { reject(new Error('retry failed')); });
  });
  it('restores focus to the trigger when closed', () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const props = { open: true, title: 'Delete?', confirmLabel: 'Delete', onConfirm: vi.fn(), onCancel: vi.fn() };
    const rendered = render(h(ConfirmDialog, props));
    expect(document.activeElement?.getAttribute('data-jini-part')).toBe('confirm.cancel');
    rendered.rerender(h(ConfirmDialog, { ...props, open: false }));
    expect(document.activeElement).toBe(trigger); trigger.remove();
  });
});
describe('provider composition', () => {
  it('shares the global context across independently evaluated modules and warns on skew', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = getSharedKitContext({ version: '0.1.0' }), b = getSharedKitContext({ version: '0.1.1-test' });
    expect(a).toBe(b); expect(warn).toHaveBeenCalledTimes(1);
    vi.resetModules();
    const copy = await import('../context.js');
    expect(copy.KitContext).toBe(a);
    const Custom = () => h('button', null, 'shared');
    const kit = createKit({ components: { Button: Custom } });
    render(h(b.Provider, { value: { kit, agent: undefined, overlayContainer: null, toast: undefined, cancelLabel: 'Cancel', guard: 'off' } }, h(Button, null, 'original')));
    expect(screen.getByRole('button').textContent).toBe('shared');
  });
  it('uses native defaults without a provider', () => {
    const onPress = vi.fn(); render(h(Button, { onPress }, 'Run'));
    fireEvent.click(screen.getByRole('button')); expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button').dataset.jiniPart).toBe('kit.button');
  });
  it('renders and dismisses service toasts in the overlay', () => {
    const service = createToastService({}, { durationMs: 0 }); service.push({ message: 'Saved' });
    const overlay = document.createElement('div'); document.body.append(overlay);
    render(h(KitProvider, { toast: service, overlayContainer: overlay, children: h(ToastRegion) }));
    expect(overlay.querySelector('[role="status"]')?.textContent).toBe('Saved×');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(service.snapshot({})).toEqual([]); cleanup(); overlay.remove(); service.dispose({});
  });
});
