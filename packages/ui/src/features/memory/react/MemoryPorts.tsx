import { createContext, useContext, type ReactNode } from 'react';
import type { MemoryConfigPort, MemoryConnectorsPort, MemoryEntriesPort, MemoryExtractionsPort } from '../ports.js';

/** Hosts own authentication, endpoint paths and connector discovery; memory UI owns no transport. */
export interface MemoryPorts {
  config: MemoryConfigPort;
  entries: MemoryEntriesPort;
  extractions: MemoryExtractionsPort;
  connectors: MemoryConnectorsPort;
}
const MemoryPortsContext = createContext<MemoryPorts | null>(null);

/** Bind one host's memory services to its subtree. Independent hosts never share these ports. */
export function MemoryPortsProvider({ ports, children }: { ports: MemoryPorts; children: ReactNode }) {
  return <MemoryPortsContext.Provider value={ports}>{children}</MemoryPortsContext.Provider>;
}

/** Fail at composition when no host was bound, before a hook can attempt network I/O. */
export function useMemoryPorts(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): MemoryPorts {
  const ports = useContext(MemoryPortsContext);
  if (!ports) throw new Error('Memory hooks require MemoryPortsProvider');
  return ports;
}
