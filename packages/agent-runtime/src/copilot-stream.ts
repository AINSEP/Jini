/**
 * @module copilot-stream
 *
 * Ported verbatim from OD's top-level `apps/daemon/src/copilot-stream.ts`
 * (relocated under `runtimes/` in Jini's daemon per r1's recon; grouped
 * with the other stream parsers here). Self-contained — no imports, no
 * product coupling. See `source-map.md`.
 *
 * Parses GitHub Copilot CLI's `--output-format json` JSONL stream into the
 * same UI-friendly events that claude-stream.js emits, so the chat panel
 * can render Copilot's thinking / tool calls / text the same way it does
 * Claude Code's.
 *
 * Copilot's schema uses dotted top-level types (`assistant.*`, `tool.*`,
 * `session.*`, `user.*`, `result`) with the payload under `data`. The
 * `ephemeral: true` events (session.mcp_*, reasoning_delta, etc.) are still
 * useful — they carry the streaming deltas — but events we don't have a UI
 * lane for (mcp_server_status, skills_loaded, full reasoning recap, turn
 * boundaries) are dropped on the floor.
 *
 * Mapping:
 *   session.tools_updated         -> status (initializing, with model name)
 *   assistant.turn_start          -> status (streaming)
 *   assistant.reasoning_delta     -> thinking_delta
 *   assistant.message_delta       -> text_delta
 *   tool.execution_start          -> tool_use
 *   tool.execution_complete       -> tool_result
 *   result                        -> usage
 */

/** Every event `createCopilotStreamHandler` can emit, discriminated on `type` — see `claude-stream.ts`'s `ClaudeStreamEvent` doc for why this is exported rather than left as `Record<string, unknown>`. */
export type CopilotStreamEvent =
  | { type: 'raw'; line: string }
  | { type: 'status'; label: 'initializing'; model: unknown }
  | { type: 'status'; label: 'streaming' }
  | { type: 'thinking_delta' | 'text_delta'; delta: string }
  | { type: 'tool_use'; id: unknown; name: unknown; input: unknown }
  | { type: 'tool_result'; toolUseId: unknown; content: string; isError: boolean }
  | { type: 'usage'; usage: unknown; stopReason: 'completed' | 'error'; durationMs: unknown };

type EventSink = (event: CopilotStreamEvent) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function createCopilotStreamHandler(onEvent: EventSink) {
  let buffer = '';

  function feed(chunk: string) {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        onEvent({ type: 'raw', line });
        continue;
      }
      handleObject(obj);
    }
  }

  function flush() {
    const rem = buffer.trim();
    buffer = '';
    if (!rem) return;
    try {
      handleObject(JSON.parse(rem));
    } catch {
      onEvent({ type: 'raw', line: rem });
    }
  }

  function handleObject(obj: unknown) {
    if (!isRecord(obj) || typeof obj.type !== 'string') return;
    const data = isRecord(obj.data) ? obj.data : {};

    switch (obj.type) {
      case 'session.tools_updated':
        if (data.model) {
          onEvent({ type: 'status', label: 'initializing', model: data.model });
        }
        return;

      case 'assistant.turn_start':
        onEvent({ type: 'status', label: 'streaming' });
        return;

      case 'assistant.reasoning_delta':
        if (typeof data.deltaContent === 'string') {
          onEvent({ type: 'thinking_delta', delta: data.deltaContent });
        }
        return;

      case 'assistant.message_delta':
        if (typeof data.deltaContent === 'string') {
          onEvent({ type: 'text_delta', delta: data.deltaContent });
        }
        return;

      case 'tool.execution_start':
        onEvent({
          type: 'tool_use',
          id: data.toolCallId ?? null,
          name: data.toolName ?? null,
          input: data.arguments ?? null,
        });
        return;

      case 'tool.execution_complete':
        onEvent({
          type: 'tool_result',
          toolUseId: data.toolCallId ?? null,
          content: stringifyResult(data.result),
          isError: data.success === false,
        });
        return;

      case 'result':
        // `result` puts usage / exitCode at the top level, not under `data`.
        // Treat a missing exitCode as success when `success: true` is set —
        // strict `=== 0` would otherwise mis-flag turns where Copilot emits
        // usage without a numeric exit code as `error`.
        onEvent({
          type: 'usage',
          usage: obj.usage ?? null,
          stopReason:
            obj.success === true || obj.exitCode === 0 ? 'completed' : 'error',
          durationMs: isRecord(obj.usage) ? obj.usage.sessionDurationMs ?? null : null,
        });
        return;

      default:
        return;
    }
  }

  return { feed, flush };
}

function stringifyResult(r: unknown): string {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (!isRecord(r)) return JSON.stringify(r);
  if (typeof r.content === 'string') return r.content;
  if (typeof r.detailedContent === 'string') return r.detailedContent;
  return JSON.stringify(r);
}
