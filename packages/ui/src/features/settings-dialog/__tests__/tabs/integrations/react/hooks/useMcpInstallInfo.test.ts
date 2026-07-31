import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeMcpIntegrationsPort } from '@jini-ai/ui-core';
import type { McpInstallInfo } from '@jini-ai/ui-core';
import { useMcpInstallInfo, useWiredMcpInstallInfo } from '../../../../../tabs/integrations/react/hooks/useMcpInstallInfo.js';

describe('useMcpInstallInfo', () => {
  it('starts loading and resolves info from the port', async () => {
    const port = createFakeMcpIntegrationsPort();
    const { result } = renderHook(() => useMcpInstallInfo(port));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.info?.command).toBeTruthy();
    expect(result.current.error).toBeNull();
  });

  it('surfaces a fetch rejection as a plain error message, not a throw', async () => {
    const port = { fetchInstallInfo: () => Promise.reject(new Error('daemon 500')) };
    const { result } = renderHook(() => useMcpInstallInfo(port));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('daemon 500');
    expect(result.current.info).toBeNull();
  });

  it('stringifies a non-Error rejection', async () => {
    const port = { fetchInstallInfo: () => Promise.reject('daemon 500') };
    const { result } = renderHook(() => useMcpInstallInfo(port));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('daemon 500');
  });

  it('ignores a late success resolution after unmount (no state update on an unmounted hook)', async () => {
    let resolveFetch!: (data: McpInstallInfo) => void;
    const port = {
      fetchInstallInfo: () => new Promise<McpInstallInfo>((resolve) => (resolveFetch = resolve)),
    };
    const { result, unmount } = renderHook(() => useMcpInstallInfo(port));
    expect(result.current.loading).toBe(true);
    unmount();
    resolveFetch({ command: 'node', args: [], daemonUrl: '', platform: 'darwin', cliExists: true, nodeExists: true, buildHint: null });
    // Flush microtasks; if the hook ignored the cancelled flag it would
    // throw a "state update on an unmounted component" warning/error.
    await Promise.resolve();
    await Promise.resolve();
  });

  it('ignores a late rejection after unmount', async () => {
    let rejectFetch!: (err: Error) => void;
    const port = {
      fetchInstallInfo: () =>
        new Promise<never>((_resolve, reject) => {
          rejectFetch = reject;
        }),
    };
    const { unmount } = renderHook(() => useMcpInstallInfo(port));
    unmount();
    rejectFetch(new Error('too late'));
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe('useWiredMcpInstallInfo', () => {
  it('resolves against the in-memory fake port with zero arguments', async () => {
    const { result } = renderHook(() => useWiredMcpInstallInfo());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.info?.command).toBeTruthy();
  });
});
