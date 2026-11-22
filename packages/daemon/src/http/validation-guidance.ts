import type { ToolRegistry } from '@jini-ai/core';
import { missingArgumentGuidance } from '@jini-ai/core/tool-input-repairs';
import type { ToolExecutionResult } from '../index.js';

/**
 * A `validation` failure with the guidance its schema declares appended: for each required property
 * the call lacked, that the failure is about, and whose schema names a tool the route's registry
 * holds in `obtainFrom`, one sentence naming that tool. Every other result, and every validation
 * failure that is about something else, is returned as it came. The typed MCP path words the same
 * fact from the same function (`@jini-ai/core`'s `missingArgumentGuidance`).
 *
 * @param required.result - The executor's result; only `failed` with `errorKind: 'validation'` is touched.
 * @param required.toolId - The registered tool the call named.
 * @param required.input - The call's input, as sent.
 * @param required.registry - The route's registry; only `list` is called, so a lister the run cannot see is never named;
 *   a route mounted without one has nothing to read and answers as before.
 * @returns `result`, or a copy whose `error` ends with the guidance sentences.
 * @complexity O(n) for n registered tools; no effects.
 */
export function withValidationGuidance(
  { result, toolId, input, registry }: { readonly result: ToolExecutionResult; readonly toolId: string; readonly input: unknown; readonly registry: Pick<ToolRegistry, 'list'> | undefined },
  _optional: Record<string, never> = {},
): ToolExecutionResult {
  if (registry === undefined || result.status !== 'failed' || result.errorKind !== 'validation' || result.error === undefined) return result;
  const tools = registry.list({});
  const known = new Set(tools.map(({ id }) => id));
  const { error } = result;
  const inputSchema = tools.find(({ id }) => id === toolId)?.inputSchema;
  // The handler's text names the property it refused; guidance for any other absent property would answer a different failure.
  const sentences = missingArgumentGuidance({ inputSchema, input }, { isKnownTool: (id) => known.has(id) })
    .filter(({ property }) => error.includes(property)).map(({ sentence }) => sentence);
  return sentences.length === 0 ? result : { ...result, error: `${error} ${sentences.join(' ')}` };
}
