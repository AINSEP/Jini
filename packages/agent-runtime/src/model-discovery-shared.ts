/** Shared discovery normalization and timeout/error contracts; no native adapters. */
import type { RuntimeModelOption } from './types.js';
import type { DiscoveredModel, ModelCatalogSnapshot } from './model-discovery-types.js';

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
    return [{ ...row, identityKind: model.identityKind ?? modelIdentityKind(row.id), ...(model.resolvedId ? { resolvedId: model.resolvedId } : {}) }];
  });
}
/** Concrete picker choices, shared with server-side selection validation.
 * Aliases contribute their resolved ID; routing modes never become launch IDs.
 * Preserves first position and upgrades raw labels. Pure; O(rows) time and space.
 */
export function concreteModelOptions({ models = [], supportsConcreteModelSelection, defaultModelResolution }: {
  models?: readonly RuntimeModelOption[];
  supportsConcreteModelSelection?: boolean;
  defaultModelResolution?: { status: string; id?: string };
}, _options = {}): RuntimeModelOption[] {
  if (supportsConcreteModelSelection === false) return [];
  const choices = new Map<string, RuntimeModelOption>();
  for (const row of models) {
    const id = row.resolvedId || (row.identityKind === 'routing-mode' || row.identityKind === 'alias' ? undefined : row.id);
    if (!id || modelIdentityKind(id) !== 'concrete') continue;
    // Older cached inventories can attach a default-policy label to a resolved concrete ID.
    const label = row.id === 'default' || /^default\b/i.test(row.label) ? id : row.label;
    const existing = choices.get(id);
    if (!existing) choices.set(id, { ...row, id, label, identityKind: 'concrete' });
    else if (existing.label === id && label !== id) choices.set(id, { ...existing, label });
  }
  const options: RuntimeModelOption[] = [...choices.values()];
  const resolution = defaultModelResolution;
  // A host may publish a resolved default outside its visible catalog. Preserve its concrete ID.
  if (resolution?.status === 'resolved' && resolution.id && modelIdentityKind(resolution.id) === 'concrete' && !choices.has(resolution.id)) options.unshift({ id: resolution.id, label: resolution.id, identityKind: 'concrete' });
  return options;
}
export class ProbeTimeout extends Error {}
/** Cancellation always reaches the effect port. A broken port cannot hold callers indefinitely. */
export async function withModelProbeTimeout<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
  if (parent?.aborted) throw new ProbeTimeout('Probe cancelled');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    abortListener = () => { controller.abort(); reject(new ProbeTimeout('Probe cancelled')); };
    if (parent?.aborted) abortListener();
    else parent?.addEventListener('abort', abortListener, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(new ProbeTimeout('Probe timed out')); }, timeoutMs);
  });
  try { return await Promise.race([work(controller.signal), stopped]); }
  finally { if (timer) clearTimeout(timer); if (abortListener) parent?.removeEventListener('abort', abortListener); }
}
export class ModelProbeError extends Error {
  constructor(readonly code: ModelCatalogSnapshot['diagnostics'][number]['code']) { super(code); }
}
