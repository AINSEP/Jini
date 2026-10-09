import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useConfirmRequest } from '../../components/ConfirmDialog/use-confirm-request.js';

const dialog = { title: 'Delete conversation', body: 'This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' as const };

describe('useConfirmRequest', () => {
  it.each([true, false])('waits for an explicit answer and resolves exactly once (%s)', async (answer) => {
    const { result } = renderHook(() => useConfirmRequest({}));
    expect(result.current.dialog.open).toBe(false);
    const settled = vi.fn();
    let response!: Promise<boolean>;
    act(() => { response = result.current.confirm({ dialog }); });
    void response.then(settled);
    await act(async () => { await Promise.resolve(); });
    expect(settled).not.toHaveBeenCalled();
    expect(result.current.dialog).toMatchObject({ ...dialog, open: true });
    const pending = result.current.dialog;
    act(() => { if (answer) pending.onConfirm(); else pending.onCancel(); });
    await expect(response).resolves.toBe(answer);
    expect(result.current.dialog.open).toBe(false);
    act(() => { pending.onConfirm(); pending.onCancel(); });
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith(answer);
  });

  it('cancels a replaced request and ignores its stale confirm callback', async () => {
    const { result } = renderHook(() => useConfirmRequest({}));
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => { first = result.current.confirm({ dialog }); });
    const staleConfirm = result.current.dialog.onConfirm;
    act(() => { second = result.current.confirm({ dialog: { ...dialog, title: 'Second conversation' } }); });
    await expect(first).resolves.toBe(false);
    act(() => staleConfirm());
    expect(result.current.dialog.open).toBe(true);
    expect(result.current.dialog.title).toBe('Second conversation');
    act(() => result.current.dialog.onCancel());
    await expect(second).resolves.toBe(false);
  });

  it('fails closed on unmount, including requests made through a retained callback', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result, unmount } = renderHook(() => useConfirmRequest({}), { wrapper });
    const confirm = result.current.confirm;
    let response!: Promise<boolean>;
    act(() => { response = confirm({ dialog }); });
    unmount();
    await expect(response).resolves.toBe(false);
    await expect(confirm({ dialog })).resolves.toBe(false);
  });
});
