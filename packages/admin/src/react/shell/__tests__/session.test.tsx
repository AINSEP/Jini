import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAdminShellSession } from '../use-admin-shell-session.js';
import type { AdminShellContext, AdminShellSession, AdminShellSessionPort } from '../types.js';

// Generalized session-seam and mid-session expiry cases from the reference App suites.
const context: AdminShellContext = { apiBase: '/operator-api', workspace: { projectId: 'p1' } };
const session: AdminShellSession = { user: { id: 'u1', username: 'operator' }, effectivePermissions: ['records.read'] };

function fixture() {
  let invalidate: () => void = () => {};
  const unsubscribe = vi.fn();
  const port: AdminShellSessionPort = {
    read: vi.fn(async () => session),
    logout: vi.fn(async () => {}),
    onUnauthenticated: vi.fn(({ onUnauthenticated }) => {
      invalidate = onUnauthenticated;
      return unsubscribe;
    }),
  };
  return { port, unsubscribe, invalidate: () => invalidate() };
}

afterEach(cleanup);

it('loads through the injected port and forwards API/workspace context', async () => {
  const { port } = fixture();
  const { result } = renderHook(() => useAdminShellSession({ port, context }));
  expect(result.current.state.status).toBe('checking');
  await waitFor(() => expect(result.current.state).toEqual({ status: 'authenticated', session }));
  expect(port.read).toHaveBeenCalledWith(context);
});

it('an unrelated screen can invalidate the session through the host port', async () => {
  const f = fixture();
  const { result } = renderHook(() => useAdminShellSession({ port: f.port, context }));
  await waitFor(() => expect(result.current.state.status).toBe('authenticated'));
  act(f.invalidate);
  expect(result.current.state.status).toBe('anonymous');
});

it('a read started before invalidation cannot sign the operator back in', async () => {
  const f = fixture();
  let resolveRead!: (value: AdminShellSession | null) => void;
  f.port.read = vi.fn(() => new Promise<AdminShellSession | null>((resolve) => { resolveRead = resolve; }));
  const { result } = renderHook(() => useAdminShellSession({ port: f.port, context }));
  act(f.invalidate);
  await act(async () => resolveRead(session));
  expect(result.current.state.status).toBe('anonymous');
});

it('null means anonymous, and refreshing after login obtains effective permissions', async () => {
  const f = fixture();
  f.port.read = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(session);
  const { result } = renderHook(() => useAdminShellSession({ port: f.port, context }));
  await waitFor(() => expect(result.current.state.status).toBe('anonymous'));
  await act(() => result.current.refresh());
  expect(result.current.state).toEqual({ status: 'authenticated', session });
});

it('read errors are observable and a retry can recover', async () => {
  const f = fixture();
  const error = new Error('temporarily offline');
  f.port.read = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(session);
  const { result } = renderHook(() => useAdminShellSession({ port: f.port, context }));
  await waitFor(() => expect(result.current.state).toEqual({ status: 'error', error }));
  await act(() => result.current.refresh());
  expect(result.current.state.status).toBe('authenticated');
});

it('logout retires an in-flight read and passes the current context', async () => {
  const f = fixture();
  let resolveRead!: (value: AdminShellSession | null) => void;
  f.port.read = vi.fn(() => new Promise<AdminShellSession | null>((resolve) => { resolveRead = resolve; }));
  const { result } = renderHook(() => useAdminShellSession({ port: f.port, context }));
  await act(() => result.current.logout());
  await act(async () => resolveRead(session));
  expect(result.current.state.status).toBe('anonymous');
  expect(f.port.logout).toHaveBeenCalledWith(context);
});

it('a failed logout clears local authentication without another session read', async () => {
  const f = fixture();
  const error = new Error('logout unavailable');
  f.port.logout = vi.fn().mockRejectedValue(error);
  const { result } = renderHook(() => useAdminShellSession({ port: f.port, context }));
  await waitFor(() => expect(result.current.state.status).toBe('authenticated'));
  await act(() => result.current.logout());
  expect(result.current.state).toEqual({ status: 'anonymous' });
  expect(f.port.read).toHaveBeenCalledTimes(1);
});

it('a read completed after failed logout cannot restore the old principal', async () => {
  const f = fixture();
  let resolveRead!: (value: AdminShellSession | null) => void;
  f.port.read = vi.fn(() => new Promise<AdminShellSession | null>((resolve) => { resolveRead = resolve; }));
  f.port.logout = vi.fn().mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useAdminShellSession({ port: f.port, context }));
  await act(() => result.current.logout());
  expect(result.current.state.status).toBe('anonymous');
  await act(async () => resolveRead(session));
  expect(result.current.state.status).toBe('anonymous');
});

it('a concurrent refresh cannot supersede an unfinished logout', async () => {
  const f = fixture();
  let finishLogout!: () => void;
  f.port.logout = vi.fn(() => new Promise<void>((resolve) => { finishLogout = resolve; }));
  const { result } = renderHook(() => useAdminShellSession({ port: f.port, context }));
  await waitFor(() => expect(result.current.state.status).toBe('authenticated'));
  let pending!: Promise<void>;
  act(() => { pending = result.current.logout(); });
  await act(() => result.current.refresh());
  expect(f.port.read).toHaveBeenCalledTimes(1);
  await act(async () => { finishLogout(); await pending; });
  expect(result.current.state.status).toBe('anonymous');
});

it('a retired workspace read cannot replace the new workspace principal', async () => {
  const f = fixture();
  let resolveOld!: (value: AdminShellSession | null) => void;
  f.port.read = vi.fn().mockImplementationOnce(() => new Promise<AdminShellSession | null>((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce(null);
  const { result, rerender } = renderHook(({ owner }) => useAdminShellSession({ port: f.port, context: owner }), {
    initialProps: { owner: context },
  });
  rerender({ owner: { apiBase: '/next', workspace: { projectId: 'p2' } } });
  await waitFor(() => expect(result.current.state.status).toBe('anonymous'));
  await act(async () => resolveOld(session));
  expect(result.current.state.status).toBe('anonymous');
});

it('changing workspace hides the previous session before a new read completes', async () => {
  const f = fixture();
  const nextContext = { apiBase: '/other-api', workspace: { organizationId: 'o2' } };
  let resolveNext!: (value: AdminShellSession | null) => void;
  f.port.read = vi.fn().mockResolvedValueOnce(session).mockImplementationOnce(
    () => new Promise<AdminShellSession | null>((resolve) => { resolveNext = resolve; }),
  );
  const { result, rerender } = renderHook(({ owner }) => useAdminShellSession({ port: f.port, context: owner }), {
    initialProps: { owner: context },
  });
  await waitFor(() => expect(result.current.state.status).toBe('authenticated'));
  rerender({ owner: nextContext });
  expect(result.current.state.status).toBe('checking');
  await act(async () => resolveNext(null));
  expect(result.current.state.status).toBe('anonymous');
  expect(f.port.read).toHaveBeenLastCalledWith(nextContext);
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
});

it('unmount unsubscribes and retires unresolved reads', async () => {
  const f = fixture();
  let resolveRead!: (value: AdminShellSession | null) => void;
  f.port.read = vi.fn(() => new Promise<AdminShellSession | null>((resolve) => { resolveRead = resolve; }));
  const { result, unmount } = renderHook(() => useAdminShellSession({ port: f.port, context }));
  const refresh = result.current.refresh;
  unmount();
  await act(async () => resolveRead(session));
  await refresh();
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  expect(f.port.read).toHaveBeenCalledTimes(1);
});
