// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useExportPassword } from '../use-export-password.hooks.js';

afterEach(cleanup);

const labels = { revealFailed: 'reveal failed', copyFailed: 'copy failed' };
const describeError = ({ e, fallback }: { e: unknown; fallback: string }) => (e instanceof Error ? `${fallback}: ${e.message}` : fallback);

function setup({ canManageSavedKeys = true, reveal = vi.fn(async () => ({ password: 'pw-1' })), copyText = vi.fn(async () => true) } = {}) {
  const hook = renderHook((props: { canManageSavedKeys: boolean; identity: string }) => useExportPassword({
    port: { revealSharePassword: reveal }, labels, describeError, copyText, ...props,
  }), { initialProps: { canManageSavedKeys, identity: 'a' } });
  return { ...hook, reveal, copyText };
}

describe('useExportPassword', () => {
  it('reveals a password for the requested share', async () => {
    const { result, reveal } = setup();
    await act(() => result.current.revealPassword({ shareId: 's1' }));
    expect(reveal).toHaveBeenCalledWith({ shareId: 's1' });
    expect(result.current.revealedPassword).toEqual({ shareId: 's1', password: 'pw-1' });
    expect(result.current.revealingId).toBeNull();
  });

  it('refuses to reveal or copy without saved-keys permission', async () => {
    const { result, reveal, copyText } = setup({ canManageSavedKeys: false });
    await act(() => result.current.revealPassword({ shareId: 's1' }));
    await act(() => result.current.copyPassword());
    expect(reveal).not.toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled();
    expect(result.current.revealedPassword).toBeNull();
  });

  it('formats a failed reveal through the injected formatter and label', async () => {
    const { result } = setup({ reveal: vi.fn(async () => { throw new Error('boom'); }) });
    await act(() => result.current.revealPassword({ shareId: 's1' }));
    expect(result.current.passwordError).toBe('reveal failed: boom');
    expect(result.current.revealingId).toBeNull();
  });

  it('discards a late response after dismissal', async () => {
    let resolve!: (value: { password: string }) => void;
    const reveal = vi.fn(() => new Promise<{ password: string }>((r) => { resolve = r; }));
    const { result } = setup({ reveal });
    let pending!: Promise<void>;
    act(() => { pending = result.current.revealPassword({ shareId: 's1' }); });
    expect(result.current.revealingId).toBe('s1');
    act(() => result.current.hidePassword());
    await act(async () => { resolve({ password: 'late' }); await pending; });
    expect(result.current.revealedPassword).toBeNull();
    expect(result.current.revealingId).toBeNull();
  });

  it('copies the revealed password through the injected clipboard and reports it', async () => {
    const { result, copyText } = setup();
    await act(() => result.current.revealPassword({ shareId: 's1' }));
    await act(() => result.current.copyPassword());
    expect(copyText).toHaveBeenCalledWith({ text: 'pw-1' });
    expect(result.current.passwordCopied).toBe(true);
  });

  it('reports a failed copy with the injected label', async () => {
    const { result } = setup({ copyText: vi.fn(async () => false) });
    await act(() => result.current.revealPassword({ shareId: 's1' }));
    await act(() => result.current.copyPassword());
    expect(result.current.passwordCopied).toBe(false);
    expect(result.current.passwordError).toBe('copy failed');
  });

  it('clears display state when the identity changes', async () => {
    const { result, rerender } = setup();
    await act(() => result.current.revealPassword({ shareId: 's1' }));
    rerender({ canManageSavedKeys: true, identity: 'b' });
    await waitFor(() => expect(result.current.revealedPassword).toBeNull());
  });
});

it("does not show a copy error for an old share after a new password is revealed", async () => {
  let complete!: (copied: boolean) => void;
  const copyText = vi.fn(() => new Promise<boolean>(resolve => { complete = resolve; }));
  const { result } = setup({ copyText });
  await act(() => result.current.revealPassword({ shareId: "older-share" }));
  let pending!: Promise<void>;
  act(() => { pending = result.current.copyPassword(); });
  expect(copyText).toHaveBeenCalledExactlyOnceWith({ text: "pw-1" });
  await act(() => result.current.revealPassword({ shareId: "new-share" }));
  await act(async () => { complete(false); await pending; });
  expect(result.current.revealedPassword).toEqual({ shareId: "new-share", password: "pw-1" });
  expect(result.current.passwordCopied).toBe(false);
  expect(result.current.passwordError).toBeNull();
});
