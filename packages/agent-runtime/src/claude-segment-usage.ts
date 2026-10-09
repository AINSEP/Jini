/** Claude result totals are per segment. Aborted results can zero counters already streamed. */
export function createClaudeSegmentUsage(_required: Record<string, never>, { nowMs = Date.now }: { nowMs?: () => number } = {}) {
  const messages = new Map<string, Record<string, number>>();
  let startedAt = nowMs();

  /** Merge cumulative counters for one message; wrappers repeat the same streamed usage.
   * O(k) per snapshot in k reported counters; retained state is O(m·k) for m messages in a segment. */
  function observe({ messageId, usage }: { messageId: string; usage: unknown }, _optional = {}): void {
    if (!usage || typeof usage !== 'object') return;
    const previous = messages.get(messageId) ?? {};
    for (const [key, value] of Object.entries(usage)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) previous[key] = Math.max(previous[key] ?? 0, value);
    }
    if (Object.keys(previous).length) messages.set(messageId, previous);
  }

  /** Produce one segment's totals and release its snapshots. Never infer a monetary charge
   * from token counts: only CLI-reported costs are eligible. O(m·k), no external effects. */
  function finish({ result, interrupted }: { result: Record<string, unknown>; interrupted: boolean }, _optional = {}) {
    const usage: Record<string, unknown> = { ...((result.usage && typeof result.usage === 'object') ? result.usage : {}) };
    const observed: Record<string, number> = {};
    for (const counters of messages.values()) {
      for (const [key, value] of Object.entries(counters)) observed[key] = (observed[key] ?? 0) + value;
    }
    for (const [key, value] of Object.entries(observed)) {
      const reported = usage[key];
      usage[key] = typeof reported === 'number' && Number.isFinite(reported) ? Math.max(reported, value) : value;
    }
    const modelCosts = result.modelUsage && typeof result.modelUsage === 'object' ? Object.values(result.modelUsage) : [];
    const reportedModelCost = modelCosts.reduce<number>((sum, model) => {
      const cost = model && typeof model === 'object' ? (model as { costUSD?: unknown }).costUSD : undefined;
      return sum + (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : 0);
    }, 0);
    const costUsd = reportedModelCost > 0 ? Math.max(typeof result.total_cost_usd === 'number' ? result.total_cost_usd : 0, reportedModelCost) : result.total_cost_usd ?? null;
    const endedAt = nowMs();
    const duration = result.duration_ms;
    const durationMs = typeof duration === 'number' && duration > 0 ? duration
      : messages.size || interrupted ? Math.max(0, endedAt - startedAt) : duration ?? null;
    messages.clear();
    startedAt = endedAt;
    return { usage: Object.keys(usage).length ? usage : result.usage ?? null, costUsd, durationMs };
  }

  return { observe, finish, hasObserved: () => messages.size > 0 };
}
