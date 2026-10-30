/** Shared discovery normalization and timeout/error contracts; no native adapters. */
import type { RuntimeModelOption } from '../types.js';
import type { DiscoveredModel, ModelCatalogSnapshot } from '../model-discovery-types.js';

export function modelIdentityKind(id: string): DiscoveredModel['identityKind'] {
  const token = id.slice(id.lastIndexOf('/') + 1);
  if (/^(default|auto|adaptive|smart|deep|rush|ultimate|premium|balanced|fast|vercel-ai-gateway|grok-build)$/i.test(token) || /(?:^|[-/])gateway$/i.test(id)) return 'routing-mode';
  if (/^(opus|sonnet|haiku|fable|best|latest|claude|gemini|gpt|codex|swe)(?:\[.*\])?$/i.test(token) || /(?:^|[-/])latest$/i.test(id)) return 'alias';
  return 'concrete';
}
export function normalizeDiscoveredModels(models: readonly RuntimeModelOption[]): DiscoveredModel[] {
  const seen = new Set<string>();
  return models.flatMap((row) => {
    if (!row.id || row.id === 'default' || seen.has(row.id)) return [];
    seen.add(row.id);
    const model = row as Partial<DiscoveredModel>;
    return [{ ...row, identityKind: model.identityKind ?? modelIdentityKind(row.id) }];
  });
}
type DefaultResolutionLike = { status: string; id?: string };

/** The concrete launch id a catalog row contributes, or undefined when it contributes none. */
function concreteRowId({ row }: { row: RuntimeModelOption }): string | undefined {
  const id = row.resolvedId || (row.identityKind === 'routing-mode' || row.identityKind === 'alias' ? undefined : row.id);
  return id && modelIdentityKind(id) === 'concrete' ? id : undefined;
}

/** Add one row's concrete choice; first position wins, a raw-id label is upgraded later. */
function addConcreteChoice({ choices, row }: { choices: Map<string, RuntimeModelOption>; row: RuntimeModelOption }): void {
  const id = concreteRowId({ row });
  if (!id) return;
  // Older cached inventories can attach a default-policy label to a resolved concrete ID.
  const label = row.id === 'default' || /^default\b/i.test(row.label) ? id : row.label;
  const existing = choices.get(id);
  if (!existing) {
    choices.set(id, { ...row, id, label, identityKind: 'concrete' });
    return;
  }
  if (existing.label === id && label !== id) choices.set(id, { ...existing, label });
}

/** The resolved concrete default id when it is missing from `choices`, else undefined. */
function missingResolvedDefaultId({ choices }: { choices: Map<string, RuntimeModelOption> }, { resolution }: { resolution?: DefaultResolutionLike | undefined } = {}): string | undefined {
  if (resolution?.status !== 'resolved' || !resolution.id) return undefined;
  return modelIdentityKind(resolution.id) === 'concrete' && !choices.has(resolution.id) ? resolution.id : undefined;
}

/** Concrete picker choices, shared with server-side selection validation.
 * Aliases contribute their resolved ID; routing modes never become launch IDs.
 * Preserves first position and upgrades raw labels. Pure; O(rows) time and space.
 */
export function concreteModelOptions({ models = [], supportsConcreteModelSelection, defaultModelResolution }: {
  models?: readonly RuntimeModelOption[];
  supportsConcreteModelSelection?: boolean;
  defaultModelResolution?: DefaultResolutionLike;
}, _options = {}): RuntimeModelOption[] {
  if (supportsConcreteModelSelection === false) return [];
  const choices = new Map<string, RuntimeModelOption>();
  for (const row of models) addConcreteChoice({ choices, row });
  const options: RuntimeModelOption[] = [...choices.values()];
  // A host may publish a resolved default outside its visible catalog. Preserve its concrete ID.
  const hiddenDefaultId = missingResolvedDefaultId({ choices }, { resolution: defaultModelResolution });
  if (hiddenDefaultId) options.unshift({ id: hiddenDefaultId, label: hiddenDefaultId, identityKind: 'concrete' });
  return options;
}
export class ProbeTimeout extends Error {}
/** Cancellation always reaches the effect port. A broken port cannot hold callers indefinitely. */
export async function withModelProbeTimeout<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
  if (parent?.aborted) throw new ProbeTimeout('Probe cancelled');
  const controller = new AbortController();
  let rejectStopped!: (reason: ProbeTimeout) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  // `parent` was not aborted above and nothing has awaited since, so listening is enough.
  const abortListener = () => { controller.abort(); rejectStopped(new ProbeTimeout('Probe cancelled')); };
  parent?.addEventListener('abort', abortListener, { once: true });
  const timer = setTimeout(() => { controller.abort(); rejectStopped(new ProbeTimeout('Probe timed out')); }, timeoutMs);
  try { return await Promise.race([work(controller.signal), stopped]); }
  finally { clearTimeout(timer); parent?.removeEventListener('abort', abortListener); }
}
export class ModelProbeError extends Error {
  constructor(readonly code: ModelCatalogSnapshot['diagnostics'][number]['code']) { super(code); }
}
