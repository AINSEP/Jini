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
 * Receipt and canonical failure states must match: a success cannot consume a failed row,
 * and an identical successful or pending call cannot account for a refusal before the bridge,
 * regardless of buffered receipt ordering.
 * A legacy gateway folds onto the first LATER canonical `tool_use` whose name equals its `input.toolId`.
 * A direct call folds onto the first LATER `X` row with structurally equal JSON input that arrives
 * before the CLI's own result for it; failing that, once that result has arrived, onto the first
 * unclaimed same-name row between the two, since argument normalization can change the bridge's
 * input (see {@link findCanonicalRow}). No canonical row is claimed twice, and a folded wrapper's
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
  const failedResults = new Set(events.flatMap(event => event.kind === 'tool_result' && event.isError ? [event.toolUseId] : []));
  // Equal inputs pair first across the whole turn, so a by-name pairing never takes the row an
  // exact match needed; only then may a direct call pair by name inside its closed window.
  for (const byName of [false, true]) {
    events.forEach((event, i) => {
      if (event.kind !== 'tool_use') return;
      const call = wrapperCall({ event });
      // A replayed wrapper (same id) must not claim a second canonical row.
      if (call === undefined || folded.has(event.id)) return;
      const match = findCanonicalRow({ events, wrapper: event, wrapperIndex: i, call, claimed, failedResults }, { byName });
      if (match === -1) return;
      claimed.add(match);
      folded.add(event.id);
    });
  }
  if (folded.size === 0) return events;

  return events.filter((event) => !(
    (event.kind === 'tool_use' && folded.has(event.id)) ||
    (event.kind === 'tool_result' && folded.has(event.toolUseId))
  ));
}

/**
 * Index of the first unclaimed canonical row in the wrapper's matching window, or -1. Legacy gateways match
 * on name alone; direct calls and adapter-described wrappers also require equal inner input.
 *
 * `byName` (the second pass) lets a direct `mcp__<server>__X` call pair with a same-name row whose
 * input differs, but only inside a CLOSED window: after the call and before the CLI's own result for
 * it. The MCP server normalizes arguments before the bridge sees them (an integer string read as the
 * integer, an alias renamed, see `@jini-ai/mcp`'s `tool-arguments.ts`), so the bridge row's input is
 * not always the CLI's (demo practice run, 2026-11-02: every such call showed twice). The CLI's result
 * only returns after the bridge row its call caused, so a same-name row in that window is that call.
 * An open window (no CLI result yet) and buffered or legacy wrappers never pair by name.
 * @throws CanonicalJsonError if a direct call's input contains non-JSON values.
 * @complexity O(n·s): n events, s canonical input serialization cost.
 */
function findCanonicalRow({ events, wrapper, wrapperIndex, call, claimed, failedResults }: {
  events: AgentEvent[]; wrapper: ToolUseEvent; wrapperIndex: number; call: WrapperCall; claimed: ReadonlySet<number>;
  failedResults: ReadonlySet<string>;
}, { byName = false }: { byName?: boolean } = {}): number {
  const [start, end, closed] = canonicalSearchWindow({ events, wrapper, wrapperIndex, call });
  const match = matchRule({ call, byName, closed });
  if (match === undefined) return -1;
  const inputKey = match.compareInput ? canonicalJson({ value: { input: call.input } }) : undefined;
  const wrapperFailed = failedResults.has(wrapper.id);
  for (let j = start; j < end; j += 1) {
    const other = events[j]!;
    if (!claimed.has(j) && isCandidateRow({ other, name: call.name, wrapperFailed, failedResults, inputKey })) return j;
  }
  return -1;
}

/** How one pass matches `call`, or undefined when this pass must skip it. Pass two (`byName`) only
 * revisits direct calls whose window is closed; everything else already had its chance. Pure; O(1). */
function matchRule({ call, byName, closed }: { call: WrapperCall; byName: boolean; closed: boolean }, _options: Record<string, never> = {}): { compareInput: boolean } | undefined {
  if (!byName) return { compareInput: call.matchInput };
  return closed && call.matchInput && !call.buffered ? { compareInput: false } : undefined;
}

/** Whether `other` is an unclaimed row's possible canonical twin: a same-name `tool_use` with the same
 * outcome and, when `inputKey` is given, structurally equal input. Pure; O(s) input serialization. */
function isCandidateRow({ other, name, wrapperFailed, failedResults, inputKey }: {
  other: AgentEvent; name: string; wrapperFailed: boolean; failedResults: ReadonlySet<string>; inputKey: string | undefined;
}, _options: Record<string, never> = {}): boolean {
  if (other.kind !== 'tool_use' || other.name !== name) return false;
  // Outcome parity keeps successes from consuming failed rows and duplicating later refusals.
  if (wrapperFailed !== failedResults.has(other.id)) return false;
  return inputKey === undefined || canonicalJson({ value: { input: other.input } }) === inputKey;
}

/** Pure matching bounds within one turn; O(n) time, O(1) space for n events.
 * Antigravity's buffered receipts cannot establish arrival/result boundaries. Direct MCP calls
 * retain their later-only window so a completed/refused call cannot consume a separate retry.
 * `closed` is true only when the CLI's own result ends the window (the by-name pass needs it).
 */
function canonicalSearchWindow({ events, wrapper, wrapperIndex, call }: {
  events: AgentEvent[]; wrapper: ToolUseEvent; wrapperIndex: number; call: WrapperCall;
}, _options: Record<string, never> = {}): [start: number, end: number, closed: boolean] {
  if (call.buffered) return [0, events.length, false];
  const resultIndex = !call.matchInput ? -1 : events.findIndex(other => other.kind === 'tool_result' && other.toolUseId === wrapper.id);
  return resultIndex === -1 ? [wrapperIndex + 1, events.length, false] : [wrapperIndex + 1, resultIndex, true];
}
