import type { RunAgentPayload } from '@jini-ai/protocol';
import { modelIdentityKind } from '@jini-ai/agent-runtime';
/** Status metadata comes from CLI/RPC frames, never generated text. Dedupe repeats and record
 * each observed transition separately so durable run events can describe model switches. */
export function createModelReceiptTracker(startingModel?: string): (payload: RunAgentPayload) => RunAgentPayload | null {
  let current = startingModel;
  return (payload) => {
    if (payload.type !== 'status' || !payload.model || typeof payload.model !== 'string') return null;
    if (modelIdentityKind(payload.model) !== 'concrete') return null;
    if (payload.model === current) return null;
    const prior = current;
    current = payload.model;
    return { type: 'status', label: prior ? 'model_switch' : 'observed_model', model: current,
      ...(prior ? { previousModel: prior, detail: `Previous model: ${prior}` } : {}) };
  };
}
