import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeMcpIntegrationsPort } from '@jini-ai/ui-core';
import { useCodexInstallToggle, useWiredCodexInstallToggle } from '../../../../../tabs/integrations/react/hooks/useCodexInstallToggle.js';

describe('useCodexInstallToggle', () => {
  it('starts unresolved (null) then resolves available/installed from the port', async () => {
    const port = createFakeMcpIntegrationsPort({ codexStatus: { available: true, installed: false } });
    const { result } = renderHook(() => useCodexInstallToggle(port));
    expect(result.current.available).toBeNull();
    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.installed).toBe(false);
  });

  it('reports available=false when the port has no fetchCodexInstallStatus at all', async () => {
    const { result } = renderHook(() => useCodexInstallToggle({}));
    await waitFor(() => expect(result.current.available).toBe(false));
  });

  it('reports available=false when fetchCodexInstallStatus itself rejects', async () => {
    const port = { fetchCodexInstallStatus: () => Promise.reject(new Error('daemon unreachable')) };
    const { result } = renderHook(() => useCodexInstallToggle(port));
    await waitFor(() => expect(result.current.available).toBe(false));
    expect(result.current.installed).toBe(false);
  });

  it('toggle() installs when not installed, and refreshes status', async () => {
    const port = createFakeMcpIntegrationsPort({ codexStatus: { available: true, installed: false } });
    const { result } = renderHook(() => useCodexInstallToggle(port));
    await waitFor(() => expect(result.current.available).toBe(true));
    act(() => result.current.toggle());
    expect(result.current.busy).toBe(true);
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.installed).toBe(true);
    expect(result.current.successKind).toBe('installed');
  });

  it('toggle() uninstalls when already installed', async () => {
    const port = createFakeMcpIntegrationsPort({ codexStatus: { available: true, installed: true } });
    const { result } = renderHook(() => useCodexInstallToggle(port));
    await waitFor(() => expect(result.current.installed).toBe(true));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.installed).toBe(false);
    expect(result.current.successKind).toBe('uninstalled');
  });

  it('clears successKind and error at the start of a new toggle', async () => {
    const port = createFakeMcpIntegrationsPort({ codexStatus: { available: true, installed: false } });
    const { result } = renderHook(() => useCodexInstallToggle(port));
    await waitFor(() => expect(result.current.available).toBe(true));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.successKind).toBe('installed'));
    act(() => result.current.toggle());
    expect(result.current.successKind).toBeNull();
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it('surfaces a toggle failure as an error message', async () => {
    const port = {
      fetchCodexInstallStatus: () => Promise.resolve({ available: true, installed: false }),
      installCodexMcp: () => Promise.reject(new Error('install failed')),
    };
    const { result } = renderHook(() => useCodexInstallToggle(port));
    await waitFor(() => expect(result.current.available).toBe(true));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.error).toBe('install failed');
    expect(result.current.successKind).toBeNull();
  });

  it('stringifies a non-Error toggle rejection', async () => {
    const port = {
      fetchCodexInstallStatus: () => Promise.resolve({ available: true, installed: false }),
      installCodexMcp: () => Promise.reject('install failed'),
    };
    const { result } = renderHook(() => useCodexInstallToggle(port));
    await waitFor(() => expect(result.current.available).toBe(true));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.error).toBe('install failed');
  });
});

describe('useWiredCodexInstallToggle', () => {
  it('resolves against the in-memory fake port with zero arguments', async () => {
    const { result } = renderHook(() => useWiredCodexInstallToggle());
    await waitFor(() => expect(result.current.available).not.toBeNull());
  });
});
