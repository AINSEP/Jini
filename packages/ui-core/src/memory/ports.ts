// The memory slice's dependency on transport, expressed as an interface it owns.
// The slice depends on this port, never on a concrete adapter directly; a
// binding is supplied in `dependencies.ts`. Tests supply a hand-written fake —
// no global `fetch` mocking, no module-path mocks.
import type { Connector, ConnectorActionResult, ConnectorStatusMap } from '../connectors/index.js';
import type {
  ConnectorMemorySuggestionResponse,
  DraftEntry,
  MemoryEntry,
  MemoryExtractionRecord,
  MemoryListResponse,
  MemoryTreeNode,
  UpdateMemoryConfigRequest,
} from './types.js';

/** Transport the memory config cluster needs. */
export interface MemoryConfigPort {
  /**
   * PATCH a subset of the memory config. Resolves `true` on success, `false`
   * otherwise (callers roll optimistic toggles back on `false`).
   */
  patchConfig(patch: UpdateMemoryConfigRequest): Promise<boolean>;
}

/** Transport the memory entries/index cluster needs. */
export interface MemoryEntriesPort {
  fetchMemoryList(): Promise<MemoryListResponse>;
  fetchMemoryTree(): Promise<MemoryTreeNode[]>;
  /** Resolves `null` only for a genuine not-found; rejects on other failures. */
  fetchMemoryEntry(id: string): Promise<MemoryEntry | null>;
  saveMemoryEntry(draft: DraftEntry): Promise<MemoryEntry | null>;
  deleteMemoryEntry(id: string): Promise<boolean>;
  saveMemoryIndex(index: string): Promise<boolean>;
}

/** Transport the extraction-history cluster needs. */
export interface MemoryExtractionsPort {
  fetchExtractions(): Promise<MemoryExtractionRecord[]>;
  deleteExtraction(id: string): Promise<boolean>;
  clearExtractionHistory(): Promise<boolean>;
}

/**
 * Everything the memory-connectors cluster needs from the outside world: the
 * connector list/status/suggest transport, the entry-save transport (saving a
 * suggestion is just a memory write), and the non-subscription OAuth
 * side-effects (cross-tab notify + pending-auth persistence). The two OAuth
 * *subscriptions* (poll + popup-callback) are NOT here: they open accumulating
 * browser subscriptions, so a single-instance host orchestrator owns them and
 * drives the hook's `refreshConnectorStatuses` — see
 * `react/hooks/useMemoryConnectors.hooks.ts`'s file header.
 */
export interface MemoryConnectorsPort {
  fetchMemoryConnectors(): Promise<Connector[]>;
  fetchConnectorStatuses(): Promise<ConnectorStatusMap>;
  connectConnector(connectorId: string): Promise<ConnectorActionResult>;
  suggestConnectorMemories(
    connectorIds: string[],
    context: { chatAgentId?: string | null | undefined; chatModel?: string | null | undefined },
  ): Promise<ConnectorMemorySuggestionResponse | null>;
  saveMemoryEntry(draft: DraftEntry): Promise<MemoryEntry | null>;
  /** Read the connectors mid-authorization, persisted across reloads. */
  readPendingConnectorAuthIds(): Set<string>;
  /** Persist the connectors mid-authorization so a reload resumes polling. */
  writePendingConnectorAuthIds(ids: Set<string>): void;
  /** Broadcast a cross-tab "connectors changed" notification. */
  notifyConnectorsChanged(): void;
}
