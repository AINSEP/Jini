/**
 * @file The stop decision every provider's tool loop makes once a request settles, shared so the
 * five loops (Anthropic, Azure, Google, Ollama, OpenAI) cannot drift apart.
 */

/** What a tool loop does after one request: stop (emitting `emit` as the end reason when set), or
 *  run the requested tools when `stop` is false. */
export interface ToolLoopVerdict<R extends string> {
  readonly stop: boolean;
  readonly emit: R | 'stop' | null;
}

/**
 * A turn that already ended mid-request stops with nothing more to emit. Otherwise the provider's
 * own exit reason stops it, and so does a missing executor: pending tool calls were already emitted
 * as `tool_use` events, so with nothing to run them the turn ends with `'stop'` rather than
 * silently retrying forever. `exitReason` is only consulted for a turn that has not ended.
 */
export function toolLoopVerdict<R extends string>(
  { ended, hasExecutor, exitReason }: { ended: boolean; hasExecutor: boolean; exitReason: () => R | null },
): ToolLoopVerdict<R> {
  if (ended) return { stop: true, emit: null };
  const emit = exitReason() || (hasExecutor ? null : 'stop');
  return { stop: emit !== null, emit };
}
