import type { AgentEvent } from './events.js';

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
    if (event.kind === 'tool_use') {
      if (seen.has(event.id)) {
        if (!deduped) deduped = events.slice(0, i);
        continue;
      }
      seen.add(event.id);
    }
    if (deduped) deduped.push(event);
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

function wrapperToolId(event: AgentEvent): string | undefined {
  if (event.kind !== 'tool_use' || !isDelegatedWrapperToolName({ name: event.name })) return undefined;
  const input = event.input;
  const toolId = typeof input === 'object' && input !== null ? (input as Record<string, unknown>).toolId : undefined;
  return typeof toolId === 'string' && toolId ? toolId : undefined;
}

/**
 * Drop each delegated-tool wrapper call that the daemon also reported as its own canonical row,
 * so one call shows as one row.
 *
 * WHY. A delegated call arrives twice: the vendor CLI's wrapper `tool_use`
 * (`mcp__jini__execute_delegated_tool {toolId, input}`, with the CLI's `toolu_…` id) and the
 * daemon bridge's canonical `tool_use` named after the real tool (`content_stats`, with a fresh
 * UUID from `@jini-ai/mcp`). The ids differ, so {@link dedupeToolUsesById} cannot merge them, and a
 * failed call showed two red rows. The canonical row is the one to keep: it carries the tool's own
 * name, input and result.
 *
 * A wrapper folds onto the first LATER canonical `tool_use` whose name equals its `input.toolId`
 * and that no earlier wrapper has claimed; its `tool_result` events go with it. A wrapper with no
 * such canonical row (refused before the bridge, e.g. a read-only 403) stays, so its error is not
 * hidden.
 *
 * @param events - The event list, normally already passed through {@link dedupeToolUsesById}.
 * @returns A new array without the folded wrappers, or the original reference when none fold.
 * @complexity O(n·w): n events, w wrapper calls (a handful per message).
 */
export function foldDelegatedWrapperCalls({ events }: { events: AgentEvent[] | undefined }): AgentEvent[] {
  if (!events || events.length === 0) return [];

  const claimed = new Set<number>();
  const folded = new Set<string>();
  events.forEach((event, i) => {
    const toolId = wrapperToolId(event);
    // A replayed wrapper (same id) must not claim a second canonical row.
    if (toolId === undefined || event.kind !== 'tool_use' || folded.has(event.id)) return;
    const match = events.findIndex((other, j) => j > i && !claimed.has(j) && other.kind === 'tool_use' && other.name === toolId);
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
