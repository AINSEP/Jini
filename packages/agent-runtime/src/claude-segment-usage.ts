type Counters = Record<string, number>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

/** Sum each counter across every message observed in the segment. O(m·k). */
function sumObserved({ messages }: { messages: Map<string, Counters> }): Counters {
  const observed: Counters = {};
  for (const counters of messages.values()) {
    for (const [key, value] of Object.entries(counters)) observed[key] = (observed[key] ?? 0) + value;
  }
  return observed;
}

/** Overlay observed totals onto the reported usage, keeping the larger finite counter. */
function mergeUsage({ reported, observed }: { reported: unknown; observed: Counters }): unknown {
  const usage: Record<string, unknown> = { ...(isRecord(reported) ? reported : {}) };
  for (const [key, value] of Object.entries(observed)) {
    const current = usage[key];
    usage[key] = isFiniteNumber(current) ? Math.max(current, value) : value;
  }
  return Object.keys(usage).length ? usage : reported ?? null;
}

/** Sum the valid (finite, non-negative) per-model `costUSD` values the CLI reported. */
function sumModelCosts({ modelUsage }: { modelUsage: unknown }): number {
  const models = isRecord(modelUsage) ? Object.values(modelUsage) : [];
  return models.reduce<number>((sum, model) => {
    const cost = isRecord(model) ? model.costUSD : undefined;
    return sum + (isFiniteNumber(cost) && cost >= 0 ? cost : 0);
  }, 0);
}

/** Never infer a monetary charge from token counts: only CLI-reported costs are eligible. */
function resolveCostUsd({ result }: { result: Record<string, unknown> }): unknown {
  const reportedModelCost = sumModelCosts({ modelUsage: result.modelUsage });
  if (reportedModelCost <= 0) return result.total_cost_usd ?? null;
  return Math.max(typeof result.total_cost_usd === 'number' ? result.total_cost_usd : 0, reportedModelCost);
}

/** Prefer the CLI's positive duration; otherwise measure an active or interrupted segment. */
function resolveDurationMs({ duration, active, elapsedMs }: { duration: unknown; active: boolean; elapsedMs: number }): unknown {
  if (typeof duration === 'number' && duration > 0) return duration;
  return active ? Math.max(0, elapsedMs) : duration ?? null;
}

/** Token counters are per segment; Claude's dollar counter spans the session.
 * Aborted results can zero counters already streamed. */
export function createClaudeSegmentUsage(_required: Record<string, never>, { nowMs = Date.now, costBasis = 'session' }: { nowMs?: () => number; costBasis?: 'session' | 'run' } = {}) {
  const messages = new Map<string, Counters>();
  let startedAt = nowMs();
  let sessionId: string | undefined;

  /** Capture the CLI's identity so durable chat usage can reconcile resumed runs. */
  function setSession({ id }: { id: unknown }, _optional = {}): void {
    if (typeof id === 'string' && id.length > 0) sessionId = id;
  }

  /** Merge cumulative counters for one message; wrappers repeat the same streamed usage.
   * O(k) per snapshot in k reported counters; retained state is O(m·k) for m messages in a segment. */
  function observe({ messageId, usage }: { messageId: string; usage: unknown }, _optional = {}): void {
    if (!isRecord(usage)) return;
    const previous = messages.get(messageId) ?? {};
    for (const [key, value] of Object.entries(usage)) {
      if (isFiniteNumber(value) && value >= 0) previous[key] = Math.max(previous[key] ?? 0, value);
    }
    if (Object.keys(previous).length) messages.set(messageId, previous);
  }

  /** Preserve the cumulative snapshot rather than calling it a per-run charge. A zeroed
   * aborted result still uses the existing model-cost fallback for its interrupted segment. */
  function cumulativeCostOf({ costUsd, interrupted, result }: { costUsd: unknown; interrupted: boolean; result: Record<string, unknown> }): number | undefined {
    if (costBasis !== 'session' || sessionId === undefined) return undefined;
    if (!isFiniteNumber(costUsd) || costUsd < 0) return undefined;
    return interrupted && result.total_cost_usd === 0 ? undefined : costUsd;
  }

  /** Produce one segment's totals and release its snapshots. Never infer a monetary charge
   * from token counts: only CLI-reported costs are eligible. O(m·k), no external effects. */
  function finish({ result, interrupted }: { result: Record<string, unknown>; interrupted: boolean }, _optional = {}) {
    const usage = mergeUsage({ reported: result.usage, observed: sumObserved({ messages }) });
    const costUsd = resolveCostUsd({ result });
    const endedAt = nowMs();
    const durationMs = resolveDurationMs({ duration: result.duration_ms, active: messages.size > 0 || interrupted, elapsedMs: endedAt - startedAt });
    messages.clear();
    startedAt = endedAt;
    const cumulativeCostUsd = cumulativeCostOf({ costUsd, interrupted, result });
    return { usage,
      costUsd: cumulativeCostUsd === undefined ? costUsd : null, durationMs,
      ...(costBasis === 'session' && sessionId !== undefined ? { costSessionId: sessionId } : {}),
      ...(cumulativeCostUsd === undefined ? {} : { cumulativeCostUsd }),
    };
  }

  return { observe, finish, setSession, hasObserved: () => messages.size > 0 };
}
