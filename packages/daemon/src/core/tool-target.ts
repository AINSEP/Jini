import type { ToolDescriptor, ToolRegistry } from '@jini-ai/core';
import type { ApiError } from '@jini-ai/protocol';
import { toolFamilySentence, unknownToolSentence } from '@jini-ai/core/tool-call-text';
import { toolCandidates } from './tool-candidates.js';
import { visibleToolFamily, type ToolFamily, type ToolFamilyPort } from './tool-family.js';

/**
 * The one answer to "which tool did this request name?", read from descriptors only: a registered
 * tool, or an id the registry does not hold with the closest registered ids. Deciding this reads no
 * handler, resolves no principal and executes nothing, so it can run before every other gate.
 */
export type ToolTarget =
  | { readonly kind: 'tool'; readonly toolId: string; readonly descriptor: ToolDescriptor }
  | { readonly kind: 'unknown'; readonly toolId: string; readonly candidates: readonly string[]; readonly family?: ToolFamily };

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
 * @param optional.families - Host-owned groups; absent means no groups. Asked only about an id the registry does not hold,
 *   and what it names is filtered by this registry before anything is shown.
 * @returns A registered tool, or the unknown id with at most eight candidates and, for a group id, the visible group.
 * @complexity O(n*l*r + n log n) for n registered tools, as `toolCandidates`; known ids cost O(n).
 */
export function resolveToolTarget(
  { toolId, input, registry }: { readonly toolId: string; readonly input?: unknown; readonly registry: Pick<ToolRegistry, 'list'> },
  { families }: { readonly families?: ToolFamilyPort } = {},
): ToolTarget {
  const tools = registry.list({});
  const descriptor = tools.find((candidate) => candidate.id === toolId);
  if (descriptor !== undefined) return { kind: 'tool', toolId, descriptor };
  const description = families?.describeFamily({ familyId: toolId });
  const family = description === undefined ? undefined
    : visibleToolFamily({ familyId: toolId, description, visibleIds: new Set(tools.map(({ id }) => id)) });
  return { kind: 'unknown', toolId, candidates: toolCandidates({ toolId, tools, input }), ...(family === undefined ? {} : { family }) };
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
  if (target.family !== undefined) return toolFamilySentence({ familyId: target.family.id, members: target.family.members });
  return unknownToolSentence({ toolId: target.toolId, candidates: target.candidates });
}

/**
 * The structured part of the answer for a group id: the group's visible members and selector, so a caller
 * can pick one member and call it as an ordinary tool. Nothing else about the group is sent.
 *
 * @returns `{ family: { id, members, selector? } }`, or `undefined` when the id is not a visible group.
 * @complexity O(m + s) for m members and s selector entries (each at most 64).
 */
export function unknownToolDetails(
  { target }: { readonly target: Extract<ToolTarget, { kind: 'unknown' }> },
  _optional: Record<string, never> = {},
): ApiError['details'] {
  const { family } = target;
  if (family === undefined) return undefined;
  const selector = family.selector === undefined ? {}
    : { selector: { keys: [...family.selector.keys], byValue: { ...family.selector.byValue } } };
  return { family: { id: family.id, members: [...family.members], ...selector } };
}
