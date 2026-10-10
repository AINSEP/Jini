import { type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryPortsProvider, type MemoryPorts } from '../../react/MemoryPorts.js';
import { useWiredMemoryConfig } from '../../react/hooks/useMemoryConfig.hooks.js';

function host({ accept }: { accept: boolean }) {
  const patches: unknown[] = [];
  const unused = async (): Promise<never> => { throw new Error('unused host method'); };
  const ports: MemoryPorts = {
    config: { patchConfig: async patch => { patches.push(patch); return accept; } },
    entries: { fetchMemoryList: unused, fetchMemoryTree: unused, fetchMemoryEntry: unused, saveMemoryEntry: unused, deleteMemoryEntry: unused, saveMemoryIndex: unused },
    extractions: { fetchExtractions: unused, deleteExtraction: unused, clearExtractionHistory: unused },
    connectors: { fetchMemoryConnectors: unused, fetchConnectorStatuses: unused, connectConnector: unused,
      suggestConnectorMemories: unused, saveMemoryEntry: unused, readPendingConnectorAuthIds: () => new Set(),
      writePendingConnectorAuthIds: () => {}, notifyConnectorsChanged: () => {} },
  };
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryPortsProvider ports={ports}>{children}</MemoryPortsProvider>;
  return { patches, wrapper };
}

describe('host-owned memory ports', () => {
  it('uses the bound host output to accept or roll back the same optimistic toggle', async () => {
    const accepted = host({ accept: true });
    const rejected = host({ accept: false });
    const first = renderHook(() => useWiredMemoryConfig(), { wrapper: accepted.wrapper });
    const second = renderHook(() => useWiredMemoryConfig(), { wrapper: rejected.wrapper });
    await act(async () => {
      await first.result.current.onToggleEnabled(false);
      await second.result.current.onToggleEnabled(false);
    });
    expect(accepted.patches).toEqual([{ enabled: false }]);
    expect(rejected.patches).toEqual([{ enabled: false }]);
    expect(first.result.current.enabled).toBe(false);
    expect(second.result.current.enabled).toBe(true);
  });

  it('fails before transport when a host did not bind its ports', () => {
    expect(() => renderHook(() => useWiredMemoryConfig())).toThrow('Memory hooks require MemoryPortsProvider');
  });
});
