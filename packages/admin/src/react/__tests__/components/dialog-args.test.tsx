import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.js';
import type { UseConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.hooks.js';
import { resolveTone, toneClassName } from '../../types.js';

it('passes required dialog state and ports separately from optional pending state', () => {
  const onCancel = vi.fn();
  const useDialog = vi.fn<UseConfirmDialog>(() => ({
    titleId: 'fixture-title', dialogRef: { current: null }, cancelRef: { current: null },
    handleNativeCancel: vi.fn(), handleBackdropClick: vi.fn(),
  }));
  render(<ConfirmDialog open pending title="Remove record?" body="Fixture" confirmLabel="Remove"
    onCancel={onCancel} onConfirm={vi.fn()} useDialog={useDialog} />);
  expect(useDialog).toHaveBeenCalledWith({ open: true, onCancel, document }, { pending: true });
});

it('keeps tone precedence and class selection with the new arguments', () => {
  expect(resolveTone({}, { tone: 'warning', destructive: true })).toBe('warning');
  expect(resolveTone({}, { destructive: true })).toBe('danger');
  expect(resolveTone({})).toBe('default');
  expect(toneClassName({ tone: 'warning' })).toBe('btn-warning');
  expect(toneClassName({ tone: 'default' })).toBeUndefined();
});
