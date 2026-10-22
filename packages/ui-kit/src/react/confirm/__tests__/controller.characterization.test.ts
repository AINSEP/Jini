import { createElement } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConfirmController } from '../ConfirmDialog.hooks.js';
import { KitContext } from '../../context.js';
import { createKit } from '../../kit.js';
import type { AgentAttrsPort } from '../../../attrs.js';
import type { ConfirmDialogProps, KitContextValue } from '../../types.js';

const agent: AgentAttrsPort = ({ handle }, options = {}) => ({ 'data-agent-element': handle, 'data-agent-label': options.label, 'data-agent-role': options.role });
const input: ConfirmDialogProps = { open: true, title: 'Record', confirmLabel: 'Delete', tone: 'danger', onConfirm() {}, onCancel() {} };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('confirmation action bindings characterization', () => {
  it.each([
    { names: undefined, handle: undefined, allowed: true, cancel: 'Cancel — no action taken', confirm: 'Delete — Record; cannot be undone', described: false },
    { names: undefined, handle: 'record', allowed: true, cancel: 'Cancel — leaves "Record" unconfirmed; no action taken', confirm: 'Delete — Record; cannot be undone', described: false },
    { names: { cancel: 'Keep', confirm: 'Erase' }, handle: 'record', allowed: false, cancel: 'Keep', confirm: 'Erase', described: true },
    { names: { cancel: '', confirm: '' }, handle: 'record', allowed: true, cancel: '', confirm: '', described: true },
  ])('keeps accessible names and agent policy: $cancel / $confirm', ({ names, handle, allowed, cancel, confirm, described }) => {
    const { result } = renderHook(() => useConfirmController({ ...input, ...(handle === undefined ? {} : { agentHandle: handle }), agentMayConfirm: allowed, ...(names === undefined ? {} : { actionAccessibleNames: names }) }, { agent }));
    const c = result.current, cancelAttrs = c.cancel.attrs!, confirmAttrs = c.confirm.attrs!, descriptionId = c.consequenceAttrs!.id;
    expect(cancelAttrs['aria-label']).toBe(cancel);
    expect(confirmAttrs['aria-label']).toBe(confirm);
    expect(confirmAttrs['data-agent-element']).toBe(allowed && handle ? 'record-confirm' : undefined);
    expect(cancelAttrs['aria-describedby']).toBe(described ? descriptionId : undefined);
    expect(confirmAttrs['aria-describedby']).toBe(described ? descriptionId : undefined);
    expect(cancelAttrs['data-jini-state']).toBe('ready');
    expect(Object.isFrozen(c.cancel.attrs)).toBe(true);
  });

  it('does not describe absent consequences and uses provider labels and agent ports unless overridden', () => {
    const context: KitContextValue = { kit: createKit({}), agent, overlayContainer: null, toast: undefined, cancelLabel: 'Keep', guard: 'off' };
    const explicit: AgentAttrsPort = ({ handle }) => ({ 'data-explicit': handle });
    const { result, rerender } = renderHook(({ override }: { override?: AgentAttrsPort }) => useConfirmController({ ...input, tone: 'default', agentHandle: 'r', actionAccessibleNames: { cancel: 'Stay', confirm: 'Go' } }, override ? { agent: override } : {}), {
      initialProps: {}, wrapper: ({ children }) => createElement(KitContext.Provider, { value: context }, children),
    });
    expect(result.current.cancel.children).toBe('Keep');
    expect(result.current.cancel.attrs?.['data-agent-element']).toBe('r-cancel');
    expect(result.current.confirm.attrs?.['aria-describedby']).toBeUndefined();
    rerender({ override: explicit });
    expect(result.current.confirm.attrs?.['data-explicit']).toBe('r-confirm');
    expect(result.current.confirm.attrs?.['data-agent-element']).toBeUndefined();
  });

  it('keeps pending action state while a confirmation port is unresolved', async () => {
    let finish = () => {};
    const onConfirm = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook((props: ConfirmDialogProps) => useConfirmController(props), { initialProps: { ...input, onConfirm } });
    let pressed: void | Promise<void> = undefined;
    act(() => { pressed = result.current.confirm.onPress?.({}); });
    expect(result.current.cancel.attrs).toMatchObject({ 'aria-busy': true, 'data-jini-state': 'pending' });
    expect(result.current.confirm.disabled).toBe(true);
    await act(async () => { finish(); await pressed; });
    expect(result.current.confirm.attrs).toMatchObject({ 'aria-busy': false, 'data-jini-state': 'ready' });
    rerender({ ...input, onConfirm, pending: true });
    expect(result.current.cancel.attrs?.['data-jini-state']).toBe('pending');
    expect(result.current.confirm.attrs?.['aria-busy']).toBe(true);
  });

  it('keeps absent agent ports from publishing metadata', () => {
    const { result } = renderHook(() => useConfirmController({ ...input, agentHandle: 'record' }));
    expect(result.current.cancel.attrs?.['data-agent-element']).toBeUndefined();
    expect(result.current.cancel.attrs?.['aria-label']).toBe('Cancel — leaves "Record" unconfirmed; no action taken');
  });
});
