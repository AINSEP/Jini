import type { AgentEvent, ToolUseEvent } from './events.js';
import { canonicalJson } from '@jini-ai/core/records';
import { toolPresentation } from './tool-presentation.js';

/**
 * Drop repeated `tool_use` events that share an `id`. A retried/duplicated
 * stream can replay the same tool-call id (e.g. reconnect-and-replay landing
 * an event twice); rendering it twice would show a phantom second call.
 * Non-`tool_use` events (and the first occurrence of each id) pass through
 * unchanged and in original order.
 *
 * @param events - The event list to dedupe, or `undefined` for an empty conversation turn.
 * @returns A new array with later duplicate `tool_use` events removed, or the
 *   original array reference when nothing needed to change (cheap no-op for
 *   the common case).
 * @complexity O(n) time / O(k) extra space, where `n` is `events.length` and
 *   `k` is the number of distinct `tool_use` ids seen — one linear pass with
 *   a `Set` membership check.
 */
export function dedupeToolUsesById({ events }: { events: AgentEvent[] | undefined }): AgentEvent[] {
  if (!events || events.length === 0) return [];

  const seen = new Set<string>();
  let deduped: AgentEvent[] | null = null;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]!;
    if (event.kind !== 'tool_use') {
      deduped?.push(event);
    } else if (seen.has(event.id)) {
      deduped ??= events.slice(0, i);
    } else {
      seen.add(event.id);
      deduped?.push(event);
    }
  }

  return deduped ?? events;
}

/** The two delegated-tool gateways `@jini-ai/mcp` hosts: the write gateway and its read-only companion. */
const DELEGATED_WRAPPER_PATTERN = /^(?:mcp__.+__)?execute_(?:readonly_)?delegated_tool$/;

/**
 * Whether `name` is a delegated-tool transport wrapper — `execute_delegated_tool` or
 * `execute_readonly_delegated_tool`, bare or as an MCP client names it (`mcp__<server>__…`). Its real
 * tool id is in `input.toolId`. The one shared definition, so a renderer and the run-activity line
 * cannot disagree about which names are wrappers (both once missed the read-only gateway).
 *
 * @complexity O(n) in the length of `name`.
 */
export function isDelegatedWrapperToolName({ name }: { name: string }): boolean {
  return DELEGATED_WRAPPER_PATTERN.test(name);
}

/** The tool `mcp__<server>__X` names (`X`), or undefined for any other name. O(n) in the name length. */
function directMcpToolName({ name }: { name: string }): string | undefined {
  if (!name.startsWith('mcp__')) return undefined;
  // The server segment is at least one character, so its closing `__` starts at index 6 or later.
  const separator = name.indexOf('__', 6);
  return separator === -1 ? undefined : name.slice(separator + 2);
}

type WrapperCall = { name: string; input: unknown; matchInput: boolean; buffered: boolean };

/** Resolve the generic wrapper contract or an MCP gateway/direct name. Pure; O(n) in the name.
 * Legacy gateways retain name-only matching for malformed-input bridge errors;
 * Antigravity's adapter-described wrappers require equal inner inputs but may arrive buffered.
 */
function wrapperCall({ event }: { event: ToolUseEvent }, _options: Record<string, never> = {}): WrapperCall | undefined {
  const wrapper = toolPresentation(event).wrapper;
  const call = wrapper ?? event;
  if (!isDelegatedWrapperToolName({ name: call.name })) {
    const name = wrapper ? wrapper.name : directMcpToolName({ name: call.name });
    return name ? { name, input: call.input, matchInput: true, buffered: wrapper !== undefined } : undefined;
  }
  const args = call.input !== null && typeof call.input === 'object' ? call.input as Record<string, unknown> : {};
  const name = args.toolId;
  return typeof name === 'string' && name ? { name, input: args.input, matchInput: wrapper !== undefined, buffered: wrapper !== undefined } : undefined;
}

/**
 * Drop each delegated or direct MCP wrapper call that the daemon also reported as its own canonical row,
 * so one call shows as one row.
 *
 * WHY. A delegated call arrives twice: the vendor CLI's wrapper `tool_use`
 * (`mcp__jini__execute_delegated_tool {toolId, input}`, with the CLI's `toolu_…` id) and the
 * daemon bridge's canonical `tool_use` named after the real tool (`content_stats`, with a fresh
 * UUID from `@jini-ai/mcp`). The ids differ, so {@link dedupeToolUsesById} cannot merge them, and a
 * failed call showed two red rows. The canonical row is the one to keep: it carries the tool's own
 * name, input and result.
 *
 * A direct call (`mcp__jini__theme_read_file`) arrives twice the same way: the CLI's `mcp__<server>__X`
 * row and the bridge's `X` row with the same input, so every direct Jini MCP call drew two rows.
 *
 * Antigravity buffers CLI receipts: its adapter-described wrappers match equal inner inputs
 * anywhere in this assistant turn, in appearance order among equal keys. Pass only one turn's events;
 * no state is retained across calls. Wrapper and bridge rows are each claimed at most once.
 * A legacy gateway folds onto the first LATER canonical `tool_use` whose name equals its `input.toolId`.
 * A direct call folds onto the first LATER `X` row with structurally equal JSON input that arrives
 * before the CLI's own result for it. No canonical row is claimed twice, and a folded wrapper's
 * `tool_result` events go with it. A wrapper with no such canonical row (refused before the
 * bridge, e.g. a read-only 403) stays, so its error is not hidden.
 *
 * @param events - One assistant turn's events, normally already passed through {@link dedupeToolUsesById}.
 * @returns A new array without the folded wrappers, or the original reference when none fold.
 * @throws CanonicalJsonError if a direct call's input contains non-JSON values.
 * @complexity O(n·w·s): n events, w wrappers, s canonical input serialization cost (including key sorting).
 * O(n + s) extra space; inputs and events are not mutated.
 * @example foldDelegatedWrapperCalls({ events }); // canonical rows retain their own results
 */
export function foldDelegatedWrapperCalls({ events }: { events: AgentEvent[] | undefined }, _options: Record<string, never> = {}): AgentEvent[] {
  if (!events || events.length === 0) return [];

  const claimed = new Set<number>();
  const folded = new Set<string>();
  events.forEach((event, i) => {
    if (event.kind !== 'tool_use') return;
    const call = wrapperCall({ event });
    // A replayed wrapper (same id) must not claim a second canonical row.
    if (call === undefined || folded.has(event.id)) return;
    const match = findCanonicalRow({ events, wrapper: event, wrapperIndex: i, call, claimed });
    if (match === -1) return;
    claimed.add(match);
    folded.add(event.id);
  });
  if (folded.size === 0) return events;

  return events.filter((event) => !(
    (event.kind === 'tool_use' && folded.has(event.id)) ||
    (event.kind === 'tool_result' && folded.has(event.toolUseId))
  ));
}

/**
 * Index of the first unclaimed canonical row in the wrapper's matching window, or -1. Legacy gateways match
 * on name alone; direct calls and adapter-described wrappers also require equal inner input.
 * @throws CanonicalJsonError if a direct call's input contains non-JSON values.
 * @complexity O(n·s): n events, s canonical input serialization cost.
 */
function findCanonicalRow({ events, wrapper, wrapperIndex, call, claimed }: {
  events: AgentEvent[]; wrapper: ToolUseEvent; wrapperIndex: number; call: WrapperCall; claimed: ReadonlySet<number>;
}): number {
  const inputKey = call.matchInput ? canonicalJson({ value: { input: call.input } }) : undefined;
  const [start, end] = canonicalSearchWindow({ events, wrapper, wrapperIndex, call });
  for (let j = start; j < end; j += 1) {
    const other = events[j]!;
    if (claimed.has(j) || other.kind !== 'tool_use' || other.name !== call.name) continue;
    if (inputKey === undefined || canonicalJson({ value: { input: other.input } }) === inputKey) return j;
  }
  return -1;
}

/** Pure matching bounds within one turn; O(n) time, O(1) space for n events.
 * Antigravity's buffered receipts cannot establish arrival/result boundaries. Direct MCP calls
 * retain their later-only window so a completed/refused call cannot consume a separate retry.
 */
function canonicalSearchWindow({ events, wrapper, wrapperIndex, call }: {
  events: AgentEvent[]; wrapper: ToolUseEvent; wrapperIndex: number; call: WrapperCall;
}, _options: Record<string, never> = {}): [number, number] {
  if (call.buffered) return [0, events.length];
  const resultIndex = !call.matchInput ? -1 : events.findIndex(other => other.kind === 'tool_result' && other.toolUseId === wrapper.id);
  return [wrapperIndex + 1, resultIndex === -1 ? events.length : resultIndex];
}
