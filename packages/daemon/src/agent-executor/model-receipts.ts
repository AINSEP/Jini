import type { RunAgentPayload } from '@jini-ai/protocol';
import { modelIdentityKind, type DiscoveredModel } from '@jini-ai/agent-runtime';
/** Status metadata comes from CLI/RPC frames, never generated text. Dedupe repeats and record
 * each observed transition separately so durable run events can describe model switches. */
export function createModelReceiptTracker(startingModel?: string, models: readonly DiscoveredModel[] = []): (payload: RunAgentPayload) => RunAgentPayload | null {
  // The catalog is launch-scoped evidence. Normalize both the pinned and reported names
  // so a CLI's alias/display spelling does not fabricate a durable model transition.
  const normalize = (id: string) => {
    const row = models.find(model => model.id === id) || models.find(model => model.label === id);
    return row?.resolvedId || row?.id || id;
  };
  let current = startingModel && normalize(startingModel);
  return (payload) => {
    if (payload.type !== 'status' || !payload.model || typeof payload.model !== 'string') return null;
    const observed = normalize(payload.model);
    if (modelIdentityKind(observed) !== 'concrete') return null;
    if (observed === current) return null;
    const prior = current;
    current = observed;
    return { type: 'status', label: prior ? 'model_switch' : 'observed_model', model: current,
      ...(prior ? { previousModel: prior, detail: `Previous model: ${prior}` } : {}) };
  };
}
