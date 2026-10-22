import { act, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.js';
import type { UseConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.hooks.js';
import { resolveTone, toneClassName } from '../../types.js';

it('passes required dialog state and ports separately from optional pending state', () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const useDialog = vi.fn<UseConfirmDialog>(() => ({
    titleId: 'fixture-title', dialogRef: { current: null }, cancelRef: { current: null },
    handleNativeCancel: vi.fn(), handleBackdropClick: vi.fn(),
  }));
  const view = render(<ConfirmDialog open pending title="Remove record?" body="Fixture" confirmLabel="Remove"
    onCancel={onCancel} onConfirm={onConfirm} useDialog={useDialog} />);
  expect(useDialog).toHaveBeenCalledWith({ open: true, onCancel: expect.any(Function), document }, { pending: true });
  // Lifecycle cancellation must pass through the shared guard, even when an injected hook retains it.
  const dismiss = useDialog.mock.calls[0]![0].onCancel;
  act(() => { dismiss(); });
  expect(onCancel).not.toHaveBeenCalled();
  view.rerender(<ConfirmDialog open pending={false} title="Remove record?" body="Fixture" confirmLabel="Remove"
    onCancel={onCancel} onConfirm={onConfirm} useDialog={useDialog} />);
  expect(useDialog).toHaveBeenLastCalledWith({ open: true, onCancel: expect.any(Function), document }, { pending: false });
  act(() => { dismiss(); });
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onCancel).toHaveBeenCalledWith();
  expect(onConfirm).not.toHaveBeenCalled();
});

it('keeps tone precedence and class selection with the new arguments', () => {
  expect(resolveTone({}, { tone: 'warning', destructive: true })).toBe('warning');
  expect(resolveTone({}, { destructive: true })).toBe('danger');
  expect(resolveTone({})).toBe('default');
  expect(toneClassName({ tone: 'warning' })).toBe('btn-warning');
  expect(toneClassName({ tone: 'default' })).toBeUndefined();
});
