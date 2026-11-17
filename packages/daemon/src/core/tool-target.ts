import type { ToolDescriptor, ToolRegistry } from '@jini-ai/core';
import { unknownToolSentence } from '@jini-ai/core/tool-call-text';
import { toolCandidates } from './tool-candidates.js';

/**
 * The one answer to "which tool did this request name?", read from descriptors only: a registered
 * tool, or an id the registry does not hold with the closest registered ids. Deciding this reads no
 * handler, resolves no principal and executes nothing, so it can run before every other gate.
 */
export type ToolTarget =
  | { readonly kind: 'tool'; readonly toolId: string; readonly descriptor: ToolDescriptor }
  | { readonly kind: 'unknown'; readonly toolId: string; readonly candidates: readonly string[] };

/** The one id the daemon route is told about that no registry holds: an MCP-local tool, never a registry tool. */
const MCP_LOCAL_CHECK_MESSAGES = 'check_messages';

/**
 * Resolves `toolId` against the registry the route already uses for the run.
 *
 * The same descriptors answer for a tool hidden from the run and for a made-up id, so the answer
 * never tells a caller whether another registry holds the id.
 *
 * @param required.toolId - The id the request named.
 * @param required.input - The request's input; `toolCandidates` reads a selector from it for ranking only.
 * @param required.registry - The run's registry; only `list` is called.
 * @returns A registered tool, or the unknown id with at most eight candidates.
 * @complexity O(n*l*r + n log n) for n registered tools, as `toolCandidates`; known ids cost O(n).
 */
export function resolveToolTarget(
  { toolId, input, registry }: { readonly toolId: string; readonly input?: unknown; readonly registry: Pick<ToolRegistry, 'list'> },
  _optional: Record<string, never> = {},
): ToolTarget {
  const tools = registry.list({});
  const descriptor = tools.find((candidate) => candidate.id === toolId);
  if (descriptor !== undefined) return { kind: 'tool', toolId, descriptor };
  return { kind: 'unknown', toolId, candidates: toolCandidates({ toolId, tools, input }) };
}

/**
 * The model-facing sentence for an unknown target. `check_messages` keeps the sentence that tells
 * the model it is called directly; every other id gets the shared unknown-tool sentence.
 *
 * @returns Plain words, no status or code.
 * @complexity O(c) for c candidates.
 */
export function unknownToolMessage(
  { target }: { readonly target: Extract<ToolTarget, { kind: 'unknown' }> },
  _optional: Record<string, never> = {},
): string {
  if (target.toolId === MCP_LOCAL_CHECK_MESSAGES) {
    return 'check_messages is an MCP-local tool; call check_messages directly, never as toolId in a delegated gateway';
  }
  return unknownToolSentence({ toolId: target.toolId, candidates: target.candidates });
}
