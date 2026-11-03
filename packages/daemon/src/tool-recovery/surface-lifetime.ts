import type { SurfaceEmitter } from '@jini-ai/core';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ToolExecutor } from '../tool-executor.js';

/** Bind every card type to the executing call, and make restoration re-enter this same stack.
 * No submitted answer is captured here: input is the original model-supplied invocation only.
 * @param required.inner The complete authorization, recovery and audit stack.
 * @returns An executor with the same cancellation and audit ports.
 * @complexity O(input size) to snapshot public arguments; O(1) lifecycle state per call.
 */
export function withSurfaceExchangeLifetime(
  { inner }: { inner: ToolExecutor }, _options: Record<string, never> = {},
): ToolExecutor {
  const execute: ToolExecutor['execute'] = async (required, options = {}) => {
    if (!options.emitSurface) return inner.execute(required, options);
    const invocation = { ...required, principal: structuredClone(required.principal),
      run: { ...required.run }, input: structuredClone(required.input) };
    // Remote execution adapters establish trusted site/run context around this call. A later
    // authenticated answer arrives in another async chain; restore that context before re-gating.
    const withinInvocation = AsyncLocalStorage.snapshot();
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const emit: SurfaceEmitter = Object.assign(
      (emission: Parameters<SurfaceEmitter>[0]) => options.emitSurface!(emission),
      { exchangeLifetime: {
        signal: controller.signal, runId: required.run.id, toolId: required.toolId, principalId: required.principal.id,
        retry: async ({ emit: replacement, signal }: { emit: SurfaceEmitter; signal: AbortSignal }) => {
          await withinInvocation(() => execute({ ...invocation, input: structuredClone(invocation.input) }, {
            ...options, signal, emitSurface: replacement,
          }));
        },
      } },
    );
    try { return await inner.execute(required, { ...options, signal: controller.signal, emitSurface: emit }); }
    finally {
      options.signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  };
  return { execute, cancel: inner.cancel.bind(inner), resumeConfirmation: inner.resumeConfirmation.bind(inner),
    getAuditRecord: inner.getAuditRecord.bind(inner) };
}
