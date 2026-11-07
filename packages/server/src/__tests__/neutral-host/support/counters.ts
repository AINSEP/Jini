/**
 * Cost counters for the neutral host. Each counter names one operation the extraction must not make
 * more expensive: a move is accepted when the counts after it equal the counts before it, across the
 * same complete calls. Nothing here optimizes; it only counts.
 *
 * The counters wrap host ports from the outside, so the code under test never knows it is counted.
 * This folder imports only public `@jini-ai/*` entries and `node:*`, so it also runs outside the repo.
 */

/** Every counted operation. Grouped by the operation it measures. */
export const COST_COUNTER_NAMES = [
  // MCP list: envelope opens per settings or list call.
  'sealerOpens', 'sealerOpenBytes',
  // Plugin-state write: vault listing per settings write.
  'vaultListCalls', 'vaultListRows', 'vaultListBytes',
  // Token lookup: contribution loads and credential opens per token read.
  'contributionLoads', 'credentialOpens',
  // Skill tool call: one bounded file per call.
  'fileReads', 'fileReadBytes',
  // Tool catalog: bytes per turn.
  'toolCatalogBytes',
  // Trusted-package scan: per refresh, never per tool call.
  'trustedPackageScans', 'toolCalls',
  // Mail send: settings reads, credential listings, ledger calls, catalog loads.
  'mailSettingsReads', 'mailCredentialListCalls', 'mailCredentialRows', 'mailLedgerCalls', 'mailCatalogLoads',
] as const;

export type CostCounterName = typeof COST_COUNTER_NAMES[number];
export type CostCounts = Readonly<Record<CostCounterName, number>>;

export interface CostCounters {
  add(required: { readonly name: CostCounterName }, optional?: { readonly by?: number }): void;
  snapshot(required?: Record<string, never>): CostCounts;
  /** Counts accumulated since `before`, for one complete call. */
  since(required: { readonly before: CostCounts }): CostCounts;
}

function zero(): Record<CostCounterName, number> {
  return Object.fromEntries(COST_COUNTER_NAMES.map(name => [name, 0])) as Record<CostCounterName, number>;
}

/** A fresh, all-zero set of counters. */
export function createCostCounters(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): CostCounters {
  const counts = zero();
  return {
    add: ({ name }, optional = {}) => { counts[name] += optional.by ?? 1; },
    snapshot: () => ({ ...counts }),
    since: ({ before }) => {
      const delta = zero();
      for (const name of COST_COUNTER_NAMES) delta[name] = counts[name] - before[name];
      return delta;
    },
  };
}

/** Trusted-package scans per tool call over a window: the gate is 0. */
export function scansPerToolCall(required: { readonly counts: CostCounts }, _optional: Record<string, never> = {}): number {
  const { trustedPackageScans, toolCalls } = required.counts;
  return toolCalls === 0 ? 0 : trustedPackageScans / toolCalls;
}

/** Byte length of a value's JSON or of a string, as the counters measure payloads. */
export function byteLength(required: { readonly value: unknown }, _optional: Record<string, never> = {}): number {
  const { value } = required;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  if (value instanceof Uint8Array) return value.byteLength;
  return value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/** The tool catalog's size as the model sees it: its descriptors' JSON. */
export function countToolCatalog(required: { readonly descriptors: readonly unknown[]; readonly counters: CostCounters }, _optional: Record<string, never> = {}): number {
  const bytes = byteLength({ value: required.descriptors });
  required.counters.add({ name: 'toolCatalogBytes' }, { by: bytes });
  return bytes;
}

type ReadFile = (...args: never[]) => Promise<unknown>;

/** Wraps a filesystem port so every `readFile` counts one read and its bytes. Other calls pass through. */
export function countFilesystem<F extends { readonly readFile: ReadFile }>(required: { readonly filesystem: F; readonly counters: CostCounters }, _optional: Record<string, never> = {}): F {
  const { filesystem, counters } = required;
  const readFile = (async (...args: never[]) => {
    const result = await filesystem.readFile(...args);
    counters.add({ name: 'fileReads' });
    counters.add({ name: 'fileReadBytes' }, { by: byteLength({ value: result }) });
    return result;
  }) as F['readFile'];
  return { ...filesystem, readFile };
}
