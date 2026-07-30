/**
 * Wire + UI-view-model types for the memory slice. Ported from the pinned
 * source's OD contracts-package imports (`MemoryEntry`, `MemoryListResponse`,
 * `MemoryExtractionRecord`, `ConnectorMemorySuggestionResponse`, etc.) — that
 * package is not available here, so this file defines the same shapes
 * locally, scoped to exactly what this slice's ported hooks/components/rules
 * consume. See `packages/ui/source-map.md` for the full provenance note.
 *
 * Connector-shaped fields reuse `@jini-ai/ui`'s own `features/connectors` types
 * (`Connector`/`ConnectorStatusMap`/`ConnectorActionResult`) instead of a
 * separate near-duplicate — see the source-map note on the
 * connector-reconciliation-reducer decision.
 */
import type { IconName } from '../../react/components/Icon.js';

// ─── Memory entries / tree ──────────────────────────────────────────────────

export type MemoryType = 'profile' | 'user' | 'feedback' | 'project' | 'reference' | 'rule';

export interface MemoryEntrySummary {
  id: string;
  name: string;
  description: string;
  type: MemoryType;
}

export interface MemoryEntry extends MemoryEntrySummary {
  body: string;
}

export type MemoryTreeNodeKind = 'folder' | 'entry';

export interface MemoryTreeNode {
  id: string;
  kind: MemoryTreeNodeKind;
  name: string;
  path?: string | undefined;
  parentId?: string | undefined;
  description?: string | undefined;
}

/** The shape `fetchMemoryList()`'s shared read path returns. `entries`,
 *  `rootDir`, and `index` are consumed directly with no fallback by
 *  `useMemoryEntries.reload()`; `enabled` is consumed directly by
 *  `useMemoryConfig.hydrate()`. The four per-hook flags keep their
 *  established legacy-default semantics (`!== false`) in `hydrate()`, so
 *  their absence is intentionally not a contract break — see
 *  `dependencies.ts`'s `fetchMemoryList` and the source-map's bug-fix note. */
export interface MemoryListResponse {
  entries: MemoryEntrySummary[];
  rootDir: string;
  index: string;
  enabled: boolean;
  chatExtractionEnabled?: boolean | undefined;
  profileEnabled?: boolean | undefined;
  rewriteEnabled?: boolean | undefined;
  verifyEnabled?: boolean | undefined;
}

export interface MemoryTreeListResponse {
  tree: MemoryTreeNode[];
}

/** Body for both create (`POST`) and update (`PUT`) — `id` present selects update. */
export interface UpsertMemoryRequest {
  id?: string | undefined;
  name: string;
  description: string;
  type: MemoryType;
  body: string;
}

export interface UpdateMemoryConfigRequest {
  enabled?: boolean | undefined;
  chatExtractionEnabled?: boolean | undefined;
  profileEnabled?: boolean | undefined;
  rewriteEnabled?: boolean | undefined;
  verifyEnabled?: boolean | undefined;
}

/** A memory entry being created or edited in the manual editor form. */
export interface DraftEntry {
  id?: string | undefined;
  name: string;
  description: string;
  type: MemoryType;
  body: string;
}

// ─── Extraction history ─────────────────────────────────────────────────────

/** The four phases a real extraction attempt renders; `deleted`/`cleared` are
 *  pseudo-phases that ride the SSE channel when a row is evicted and never
 *  show up in a fetched `extractions[]` list. */
export type MemoryExtractionPhase = 'running' | 'success' | 'skipped' | 'failed' | 'deleted' | 'cleared';

export type MemoryExtractionSkipReason =
  | 'no-provider'
  | 'memory-disabled'
  | 'chat-disabled'
  | 'empty-message'
  | 'no-match';

export interface MemoryExtractionProvider {
  kind?: 'anthropic' | 'azure' | 'google' | 'ollama' | 'openai' | string | undefined;
  credentialSource?: 'chat-cli' | string | undefined;
}

export interface MemoryExtractionRecord {
  id: string;
  phase: MemoryExtractionPhase;
  kind?: 'llm' | 'heuristic' | 'connector' | undefined;
  reason?: MemoryExtractionSkipReason | undefined;
  provider?: MemoryExtractionProvider | undefined;
  error?: string | undefined;
  userMessagePreview?: string | undefined;
  writtenCount?: number | undefined;
  writtenIds?: string[] | undefined;
  startedAt: number;
  finishedAt?: number | undefined;
}

/** Same wire shape as a fetched record — a live SSE frame is just one more
 *  version of a record, including the two pseudo-phases. */
export type MemoryExtractionEvent = MemoryExtractionRecord;

export interface MemoryExtractionsResponse {
  extractions: MemoryExtractionRecord[];
}

// ─── Connector-memory suggestions ───────────────────────────────────────────

export interface MemorySuggestion {
  id: string;
  name: string;
  description?: string | undefined;
  type: MemoryType;
  body: string;
  source?:
    | {
        connectorName?: string | undefined;
        toolTitle?: string | undefined;
      }
    | undefined;
}

export type ConnectorMemoryAttemptStatus = 'succeeded' | 'failed' | 'skipped';

export interface ConnectorMemoryAttempt {
  connectorId: string;
  connectorName?: string | undefined;
  status: ConnectorMemoryAttemptStatus;
  toolName?: string | undefined;
  toolTitle?: string | undefined;
  error?: string | undefined;
  summary?: string | undefined;
}

export interface ConnectorMemorySuggestionResponse {
  suggestions: MemorySuggestion[];
  attemptedLLM: boolean;
  connectors: ConnectorMemoryAttempt[];
  contextBytes: number;
}

/** A human-readable rendering of a failed extraction, ready for the banner.
 *  Every branch of `describeExtractionFailure` supplies a recovery `action`, so
 *  it is required — consumers can render it without a presence check. */
export interface FriendlyExtractionFailure {
  title: string;
  detail: string;
  action: string;
}

/** The transient confirmation pill kinds shown after a manual action. */
export type FlashKind = 'created' | 'saved' | 'deleted' | 'indexSaved' | 'pathCopied';

/** The source sub-tabs inside the memories view. */
export type MemoryTab = 'profile' | 'manual' | 'chat' | 'connected';

/** One entry in the add-modal source-tab bar (label + caption + glyph). */
export interface MemorySourceTab {
  id: MemoryTab;
  label: string;
  caption: string;
  icon: IconName;
}

/** Props a host's own orchestrator wraps this slice's pieces with. */
export interface MemorySectionProps {
  onOpenConnectors?: (() => void) | undefined;
  chatAgentId?: string | null | undefined;
  chatModel?: string | null | undefined;
}
