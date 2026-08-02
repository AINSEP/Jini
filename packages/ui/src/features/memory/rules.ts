// Pure rules for the memory slice: UI toggle intent -> wire patch, plus the
// connector list state-transforms this slice still owns locally. No React, no
// transport, no side effects, so they test with zero doubles.
//
// Connector-list reconciliation (merge/apply-statuses/status-changed) is NOT
// re-derived here. `@jini-ai/ui`'s `features/connectors/rules.ts` already ships
// `mergeConnectors`/`applyConnectorStatuses`/`hasConnectorStatusChanges`/
// `connectorAuthSnapshotChanged` — generified ports of the exact same
// reconciliation reducers OD's `connectors-state.ts` module has on
// its current `main` (confirmed by direct comparison; see
// `packages/ui/source-map.md`'s provenance note for this feature). This slice
// imports and reuses those instead of shipping a third near-duplicate copy,
// per `foundry/docs/jini-port/god-components-extraction-plan.md`'s Consolidation map,
// which flags this exact overlap and asks each future extraction to check
// for it. Only the two transforms with no equivalent in `features/connectors`
// stay here: the tool-cursor-aware single-connector merge this slice's
// discovery hydration needs, and the "mark pending authorization" transform.
import { applyConnectorStatuses, mergeConnectors } from '../connectors/rules.js';
import type { Connector, ConnectorStatusMap } from '../connectors/types.js';
import type { MemoryExtractionRecord, MemorySuggestion, MemoryType, UpdateMemoryConfigRequest } from './types.js';

/**
 * The per-hook config flags the hooks panel toggles individually. This union
 * mirrors the hook keys owned by the UI; it is a convenience type (duplication
 * is intentional per the slice conventions — only wire DTOs and transport
 * adapters are shared for correctness).
 */
export type MemoryConfigFlagKey = 'chatExtractionEnabled' | 'profileEnabled' | 'rewriteEnabled' | 'verifyEnabled';

/** Patch body for flipping the master memory switch. */
export function enabledPatch(enabled: boolean): UpdateMemoryConfigRequest {
  return { enabled };
}

/**
 * Patch body for flipping a single per-hook flag. The daemon merges any subset,
 * so sending just the one key leaves the others untouched.
 */
export function singleFlagPatch(flag: MemoryConfigFlagKey, value: boolean): UpdateMemoryConfigRequest {
  return { [flag]: value };
}

/**
 * The extraction rows that belong in the unified saved-memory list. Two
 * invariants: connector-kind records are shown only in the Connected tab's scan
 * history (never the main list), and extractions surface only under the `all`
 * filter — the per-type filter pills are entry-only. The orchestrator owns the
 * `useMemo` around this (it spans the entries + extractions clusters); this is
 * just the pure predicate so the rule is testable without React.
 */
export function visibleExtractionsFor(
  extractions: MemoryExtractionRecord[],
  filter: 'all' | MemoryType,
): MemoryExtractionRecord[] {
  return filter === 'all' ? extractions.filter((record) => record.kind !== 'connector') : [];
}

/** Only alphanumeric-underscore suggestion ids are safe to reuse as entry ids. */
export function memoryEntryIdForConnectorSuggestion(suggestion: MemorySuggestion): string | undefined {
  return /^[a-z0-9_]+$/.test(suggestion.id) ? suggestion.id : undefined;
}

/** Merge a single incoming connector detail into a list by id — a one-item
 *  convenience wrapper over the shared `mergeConnectors`, since this slice
 *  only ever has one freshly-connected/updated connector to fold in at a
 *  time. A `null` update (e.g. a failed connect with no connector payload) is
 *  a no-op. */
export function upsertMemoryConnector(current: Connector[], next: Connector | null): Connector[] {
  if (!next) return current;
  return mergeConnectors(current, [next]);
}

/** Apply a live status onto a single connector, dropping stale account/error
 *  fields — the one-item convenience form of the shared `applyConnectorStatuses`,
 *  used where only one connector's status is known (the synthetic catalogue
 *  row derivation in `useMemoryConnectors`). */
export function applyMemoryConnectorStatus(
  connector: Connector,
  status: ConnectorStatusMap[string],
): Connector {
  return applyConnectorStatuses([connector], { [connector.id]: status })[0]!;
}

/** Mark a connector as awaiting OAuth completion (available unless disabled).
 *  No equivalent in `features/connectors` — that feature's own auth flow
 *  tracks pending state separately rather than mutating the connector's
 *  displayed status, so this transform is genuinely local to this slice. */
export function connectorWithPendingAuthorization(connector: Connector): Connector {
  const { accountLabel: _accountLabel, lastError: _lastError, ...base } = connector;
  return {
    ...base,
    status: base.status === 'disabled' ? 'disabled' : 'available',
  };
}
