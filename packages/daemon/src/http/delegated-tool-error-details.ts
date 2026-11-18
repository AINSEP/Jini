import type { ToolDescriptor } from '@jini-ai/core';
import { schemaPropertyNames } from '@jini-ai/core/text/diagnostic-vocabulary';
import { err, type Result } from '@jini-ai/core/contracts/server';

/** The trusted names an error answer carries in `details`. */
export type DiagnosticDetails = { toolId: string; inputNames: string[]; executionId?: string };

/** The most input names one error answer lists. */
const MAX_INPUT_NAMES = 64;

/**
 * The trusted names an error answer for a resolved tool carries: the tool's id, the property names its
 * descriptor declares (sorted, top level and nested) and, when the executor settled the call, its execution id.
 * The names come from the descriptor only, never from the caller's input, and are the ones `describe_tool` already
 * shows for this run, so the answer discloses nothing new.
 *
 * @param required.descriptor - The descriptor the route's registry holds for the called tool.
 * @param optional.executionId - The executor's id for the call, when it settled.
 * @returns The `details` object for the error envelope.
 * @complexity O(schema nodes up to the vocabulary's depth bound) plus a sort of at most 512 names.
 */
export function diagnosticDetails(
  { descriptor }: { readonly descriptor: ToolDescriptor },
  { executionId }: { readonly executionId?: string } = {},
): DiagnosticDetails {
  const inputNames = schemaPropertyNames({ schema: descriptor.inputSchema }).sort().slice(0, MAX_INPUT_NAMES);
  return { toolId: descriptor.id, inputNames, ...(executionId === undefined ? {} : { executionId }) };
}

/**
 * `outcome` with {@link diagnosticDetails} on its error, when the call resolved to a tool. A success, an answer about
 * a call that resolved to no tool (`descriptor` absent) and every field the error already had are returned as they were.
 *
 * @param required.outcome - The route's answer.
 * @param required.descriptor - The resolved tool's descriptor, or `undefined` when nothing resolved.
 * @param optional.executionId - The executor's id for the call, when it settled.
 * @complexity As {@link diagnosticDetails}.
 */
export function withDiagnosticDetails<T>(
  { outcome, descriptor }: { readonly outcome: Result<T>; readonly descriptor: ToolDescriptor | undefined },
  optional: { readonly executionId?: string } = {},
): Result<T> {
  if (outcome.ok || descriptor === undefined || outcome.error === undefined || outcome.error.details !== undefined) return outcome;
  return err({ error: { ...outcome.error, details: diagnosticDetails({ descriptor }, optional) } });
}
