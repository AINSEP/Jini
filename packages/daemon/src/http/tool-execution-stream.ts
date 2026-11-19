/**
 * @file One tool call written as NDJSON lines on a {@link LineStream}: the surfaces the tool emits as
 * they happen, then exactly one terminal line (`result` or `throw`). The route returns the stream's
 * response straight away, so the headers leave before the work finishes; this function is the work.
 */
import type { SurfaceEmitter } from '@jini-ai/core';
import type { ToolExecutionResult, ToolExecutor } from "../tool-executor-types.js";
import type { ToolExecutionWireError, ToolExecutionWireRequest } from '../remote-tool-executor.js';
import type { LineStream } from './line-stream.js';

/** An error as the caller sees it: name, message and an optional string `code`. Never the stack. */
export function wireError(error: unknown): ToolExecutionWireError {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error) };
  const code = (error as { code?: unknown }).code;
  return { name: error.name, message: error.message, ...(typeof code === 'string' ? { code } : {}) };
}

/** Runs one call inside host context (e.g. an AsyncLocalStorage scope) built from the wire `context`. */
export type RunWithToolContext = <T>(required: { readonly context: unknown; readonly fn: () => Promise<T> }, optional?: Record<string, never>) => Promise<T>;

/**
 * Runs `call` through `executor`, writing its lines on `stream`, and ends the stream. Surfaces are
 * dropped once the call settled. The executor's signal is the stream's: it aborts when the caller goes away.
 * Never rejects: a throw from the executor is the terminal `throw` line.
 */
export async function writeToolExecution(
  { stream, call, executor }: { readonly stream: LineStream; readonly call: ToolExecutionWireRequest; readonly executor: Pick<ToolExecutor, 'execute'> },
  { runWithContext }: { readonly runWithContext?: RunWithToolContext } = {},
): Promise<void> {
  let settled = false;
  const emitSurface: SurfaceEmitter = async (emission) => { if (!settled) stream.write({ line: { type: 'surface', emission } }); };
  const run = (): Promise<ToolExecutionResult> => executor.execute(
    { principal: call.principal, run: call.run, toolId: call.toolId, input: call.input },
    { signal: stream.signal, emitSurface },
  );
  try {
    if (stream.signal.aborted) return;
    const result = runWithContext ? await runWithContext({ context: call.context, fn: run }) : await run();
    stream.write({ line: { type: 'result', result } });
  } catch (error) {
    stream.write({ line: { type: 'throw', error: wireError(error) } });
  } finally {
    settled = true;
    stream.end();
  }
}
