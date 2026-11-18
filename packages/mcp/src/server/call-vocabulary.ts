/**
 * @module @jini-ai/mcp/server/call-vocabulary
 * Builds, per tool call, the names an error text may keep (see `@jini-ai/core/text/diagnostic-vocabulary`).
 * Kept apart from `ctx.diagnosticToolIds`, which also decides which tool ids are registered: nothing
 * built here ever registers a tool.
 */
import type { ToolDescriptor } from '@jini-ai/core';
import { buildDiagnosticVocabulary } from '@jini-ai/core/text/diagnostic-vocabulary';

/** The two gateway tools: their schema names `toolId` and a free `input`, so the domain schema comes from the descriptor this run holds. */
export const DELEGATED_GATEWAY_TOOL_NAMES: readonly string[] = ['execute_delegated_tool', 'execute_readonly_delegated_tool'];

/** What a failed daemon call carried in its envelope, as the vocabulary reads it. */
export interface EnvelopeTokens {
  readonly requestId?: string | undefined;
  readonly details?: Record<string, unknown> | undefined;
}

/** Tokens a daemon error envelope names in its fixed fields (`details.toolId`, `executionId`, `inputNames`, `requestId`, ...). */
export function envelopeVocabulary({ requestId, details }: EnvelopeTokens, _optional: Record<string, never> = {}): readonly string[] {
  return buildDiagnosticVocabulary({ toolIds: [] }, { envelopeDetails: { ...details, ...(requestId === undefined ? {} : { requestId }) } });
}

/**
 * The vocabulary of one call, complete before the daemon is asked anything.
 * @param required.tool - The called MCP tool: its own schema is the domain schema, except for a gateway.
 * @param required.args - The validated arguments of the call.
 * @param required.toolIds - Registered and hosted tool ids.
 * @param required.descriptorFor - The publisher's held descriptors, for a gateway call.
 * @returns The names (and, for the caller's own slug arguments, values) an error text may keep.
 */
export function callVocabulary(
  required: { toolName: string; inputSchema: unknown; args: Record<string, unknown>; toolIds: readonly string[]; descriptorFor?: ((required: { toolId: string }) => ToolDescriptor | undefined) | undefined },
  _optional: Record<string, never> = {},
): readonly string[] {
  const { toolName, args, toolIds } = required;
  if (!DELEGATED_GATEWAY_TOOL_NAMES.includes(toolName)) {
    return buildDiagnosticVocabulary({ toolIds }, { inputSchema: required.inputSchema, echoed: { input: args, schema: required.inputSchema } });
  }
  const held = typeof args.toolId === 'string' ? required.descriptorFor?.({ toolId: args.toolId }) : undefined;
  return buildDiagnosticVocabulary({ toolIds }, { ...(held === undefined ? {} : { inputSchema: held.inputSchema }), echoed: { input: args.input, ...(held === undefined ? {} : { schema: held.inputSchema }) } });
}
