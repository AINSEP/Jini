import { fireEvent, render, renderHook, screen, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AGENT_ELEMENT_ATTRIBUTE } from '@jini-ai/agentic';
import { useConfirmButton } from '../../components/ConfirmButton/ConfirmButton.hooks.js';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.js';
import { useConfirmDialog, type UseConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.hooks.js';
import { confirmDialogAgentAttrs, withoutAccessibleName } from '../../components/ConfirmDialog/confirm-dialog-attrs.js';

describe('confirm dialog attribute helpers', () => {
  it('publishes selects as agent fields and forwards other roles and labels unchanged', () => {
    expect(confirmDialogAgentAttrs({ handle: 'pick-role' }, { role: 'select', label: 'Role' })).toEqual({
      [AGENT_ELEMENT_ATTRIBUTE]: 'pick-role', 'data-agent-role': 'field', 'data-agent-label': 'Role' });
    expect(confirmDialogAgentAttrs({ handle: 'go' }, { role: 'button' })).toEqual({ [AGENT_ELEMENT_ATTRIBUTE]: 'go', 'data-agent-role': 'button' });
  });

  it('omits role and label attributes the planner did not supply', () => {
    expect(confirmDialogAgentAttrs({ handle: 'go' })).toEqual({ [AGENT_ELEMENT_ATTRIBUTE]: 'go' });
    expect(confirmDialogAgentAttrs({ handle: 'go' }, { label: 'Go' })).toEqual({ [AGENT_ELEMENT_ATTRIBUTE]: 'go', 'data-agent-label': 'Go' });
  });

  it('drops only the kit accessible name, and yields no attributes for a missing set', () => {
    expect(withoutAccessibleName({ attrs: { 'aria-label': 'Cancel — no action taken', 'data-jini-part': 'confirm.cancel' } })).toEqual({ 'data-jini-part': 'confirm.cancel' });
    expect(withoutAccessibleName({ attrs: undefined })).toEqual({});
  });
});

describe('confirm guards', () => {
  it('ignores presses while pending or disabled, even through the hook directly', () => {
    const onConfirm = vi.fn();
    for (const options of [{ pending: true }, { disabled: true }]) {
      const { result } = renderHook(() => useConfirmButton({ onConfirm, document }, options));
      act(() => result.current.handleClick());
      act(() => result.current.handleClick());
      expect(result.current.confirming).toBe(false);
    }
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('routes Escape to cancel through a dialog adapter that passes no pending option', () => {
    const onCancel = vi.fn();
    const withoutPending: UseConfirmDialog = (required) => useConfirmDialog(required);
    render(<ConfirmDialog open title="Delete post?" body="" confirmLabel="Delete" onConfirm={vi.fn()} onCancel={onCancel} useDialog={withoutPending} />);
    fireEvent(document.querySelector('dialog')!, new Event('cancel', { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
});
