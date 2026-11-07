/**
 * The test dispatcher: one tool call through the public kernel gate (`@jini-ai/core`'s registry and
 * `@jini-ai/daemon`'s executor), recording what a person would see. It shows, per call, whether the
 * call was denied before any I/O, refused for malformed input, how many human cards it raised,
 * whether it asked for write approval, and whether it was cancelled.
 *
 * It decides nothing itself: authorization stays in each tool's own policy and confirmation stays
 * in the executor. The scripted human answers each confirmation with the decision given per call.
 */
import { createToolRegistry, type Principal, type SurfaceEmission, type ToolRegistration, type ToolRegistry } from '@jini-ai/core';
import { createToolExecutor, type ConfirmationDecision, type ToolExecutionResult } from '@jini-ai/daemon';
import type { CostCounters } from './counters.ts';

export interface DispatchRecord {
  readonly result: ToolExecutionResult;
  /** Human cards the call emitted, in order. */
  readonly cards: readonly SurfaceEmission[];
  /** Confirmation prompts the executor raised for the call. */
  readonly confirmations: number;
}

export interface DispatchOptional {
  readonly principal?: Principal;
  /** The scripted human's answer to every confirmation this call raises. Default: confirm. */
  readonly decision?: ConfirmationDecision;
  /** Cancel the call once it raises its first card or confirmation. */
  readonly cancelOnPrompt?: boolean;
  readonly signal?: AbortSignal;
}

export interface TestDispatcher {
  readonly registry: ToolRegistry;
  register(required: { readonly registration: ToolRegistration }): void;
  dispatch(required: { readonly toolId: string; readonly input: unknown }, optional?: DispatchOptional): Promise<DispatchRecord>;
}

const DEFAULT_PRINCIPAL: Principal = { id: 'neutral-host-operator', roles: ['owner'] };

interface CallState { readonly decision: ConfirmationDecision; readonly prompted: () => void; confirmations: number }

/**
 * @param required.counters - Each dispatch adds one `toolCalls`, so scans per tool call can be read.
 */
export function createTestDispatcher(required: { readonly counters: CostCounters }, optional: { readonly runId?: string } = {}): TestDispatcher {
  const registry = createToolRegistry({});
  let current: CallState | undefined;
  const executor = createToolExecutor({ registry }, {
    delegate: {
      onConfirm: () => {
        if (current === undefined) return 'deny';
        current.confirmations += 1;
        current.prompted();
        return current.decision;
      },
    },
  });
  const run = { id: optional.runId ?? 'neutral-host-run' };
  return {
    registry,
    register: ({ registration }) => registry.register(registration),
    async dispatch({ toolId, input }, options = {}) {
      // Cancellation reaches the executor the way a transport's does: through the call's signal.
      const cancel = new AbortController();
      const prompted = () => { if (options.cancelOnPrompt === true) cancel.abort(); };
      const signal = options.signal === undefined ? cancel.signal : AbortSignal.any([cancel.signal, options.signal]);
      const state: CallState = { decision: options.decision ?? 'confirm', prompted, confirmations: 0 };
      const cards: SurfaceEmission[] = [];
      const emitSurface = async (emission: SurfaceEmission) => { cards.push(emission); prompted(); };
      current = state;
      required.counters.add({ name: 'toolCalls' });
      try {
        const result = await executor.execute({ principal: options.principal ?? DEFAULT_PRINCIPAL, run, toolId, input }, { emitSurface, signal });
        return { result, cards, confirmations: state.confirmations };
      } finally {
        current = undefined;
      }
    },
  };
}
