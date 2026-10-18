import type { RunProtocolEvent } from '@jini-ai/protocol';
import type { ToolAttemptAuditSink, ToolAttemptEvent } from './tool-audit.js';

/** Reserved audit marker; detail is a redacted ToolGapEntry, never tool output or file content. */
export const TOOL_GAP_AUDIT_ID = 'native_tool_gap';
export interface ToolGapEntry {
  type: 'tool_gap' | 'native_tool_used';
  id: string; at: string; site: string; chatId: string; runId: string;
  provider: string; toolUsed: string; summary: string; gapLine: string | null;
}

/** Decode only the public metadata shape; corrupt/older audit rows are skipped. Pure, O(n) JSON. */
export function decodeToolGapEntry(required: { json: string | null }, _optional = {}): ToolGapEntry | null {
  try {
    const entry = JSON.parse(required.json ?? 'null') as Record<string, unknown> | null;
    if (!entry || typeof entry !== 'object') return null;
    for (const key of ['id', 'at', 'site', 'chatId', 'runId', 'provider', 'toolUsed', 'summary']) {
      if (typeof entry[key] !== 'string') return null;
    }
    if (entry.gapLine !== null && typeof entry.gapLine !== 'string') return null;
    if (entry.type !== undefined && entry.type !== 'tool_gap' && entry.type !== 'native_tool_used') return null;
    return { ...entry, type: entry.type ?? 'tool_gap' } as unknown as ToolGapEntry;
  } catch { return null; }
}

/** Project the in-memory audit adapter with the SQL reader's same latest-revision semantics.
 * Pure, O(n) over retained audit events; bounded output, no provider or database coupling. */
export function toolGapsFromAuditEvents(required: {
  events: readonly ToolAttemptEvent[]; workspaceId: string; principalId: string;
}, optional: { limit?: number } = {}): readonly ToolGapEntry[] {
  const limit = Math.max(1, Math.min(200, Math.trunc(optional.limit ?? 100) || 100));
  const entries = new Map<string, ToolGapEntry>();
  for (let index = required.events.length - 1; index >= 0 && entries.size < limit; index--) {
    const row = required.events[index]!;
    if (row.toolId !== TOOL_GAP_AUDIT_ID || row.workspaceId !== required.workspaceId || row.principalId !== required.principalId) continue;
    const entry = decodeToolGapEntry({ json: row.detail ?? null }, {});
    if (entry && !entries.has(entry.id)) entries.set(entry.id, entry);
  }
  return [...entries.values()];
}
const CATALOG_BRIDGE_TOOLS = new Set(['search_tools', 'describe_tool', 'execute_delegated_tool', 'execute_readonly_delegated_tool']);
const FALLBACK_NAMES = new Set([
  'Bash', 'BashOutput', 'KillShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit',
  'shell', 'shell_command', 'exec_command', 'write_stdin', 'run_shell_command',
  'apply_patch', 'write_file', 'replace', 'edit_file', 'file_change',
]);

/** Extract command/path metadata only. File bodies, patches and tool output never enter audit.
 * Pure, O(n) in the tool input size. Redaction must precede truncation at the collector boundary. */
export function nativeFallbackSummary(required: { name: string; input: unknown }, _optional = {}): string | null {
  const name = required.name.replace(/^functions\./, '');
  if (!FALLBACK_NAMES.has(name)) return null;
  if (typeof required.input === 'string') {
    if (name === 'apply_patch') return required.input.split('\n').filter(line => /^\*\*\* (?:Add|Update|Delete) File:/.test(line)).join('; ');
    return '[native tool input omitted]';
  }
  const input = required.input as Record<string, unknown> | null;
  if (!input || typeof input !== 'object') return '[no command/path reported]';
  const command = input.command ?? input.cmd;
  if (typeof command === 'string') return command;
  const paths = input.file_path ?? input.path ?? input.notebook_path ?? input.paths;
  if (typeof paths === 'string') return paths;
  if (Array.isArray(paths)) return paths.filter(path => typeof path === 'string').join('; ');
  return '[no command/path reported]';
}

/** Observe normalized CLI events, independent of model cooperation. Writes immediately at tool use;
 * a later explanation appends a revision with the same id. One collector per live run.
 * Sink/redactor are injected; O(n) text work, O(g) identity state for g fallbacks in the run.
 * @example const audit = createToolGapCollector({ ...identity, sink, redact }, {});
 */
export function createToolGapCollector(required: {
  sink: ToolAttemptAuditSink; workspaceId: string; principalId: string;
  site: string; chatId: string; runId: string; provider: string;
  redact: (text: string) => string;
}, optional: { onError?: (error: unknown) => void } = {}) {
  const seen = new Set<string>();
  let tail = '';
  let discardingLine = false;
  let explanation: string | null = null;
  let lastGap: ToolGapEntry | null = null;
  let pending = Promise.resolve();
  const safe = (text: string) => required.redact(text).slice(0, 500);
  const append = (entry: ToolGapEntry) => {
    pending = pending.then(() => required.sink.append({
      attemptId: entry.id, executionId: null, workspaceId: required.workspaceId,
      principalId: required.principalId, runId: required.runId, toolId: TOOL_GAP_AUDIT_ID,
      phase: 'requested', at: entry.at,
    }, { detail: JSON.stringify(entry) })).catch(error => {
      // Observation must not strand later writes if a host's error reporter itself throws.
      try { optional.onError?.(error); } catch { /* host reporter failed */ }
    });
  };
  const readLine = (line: string) => {
    const match = /(?:^|\s)Tool gap:\s*(.+)/.exec(line);
    if (!match) return;
    // Prefer the next fallback: a missing explanation on an earlier tool must not steal the
    // line announcing a later one. A final explanation is attached on the terminal event.
    explanation = safe(`Tool gap: ${match[1]}`);
  };
  return {
    /** Called synchronously from the run's existing subscription; no recursive run events. */
    observe({ event }: { event: RunProtocolEvent }, _options = {}): void {
      if (event.runId !== required.runId) return;
      if (event.kind === 'end') {
        if (!discardingLine) readLine(tail);
        if (lastGap && explanation && lastGap.gapLine === null) {
          lastGap = { ...lastGap, gapLine: explanation };
          append(lastGap);
        }
        tail = ''; explanation = null;
        return;
      }
      if (event.kind !== 'agent') return;
      const payload = event.payload;
      if (payload.type === 'text_delta') {
        const lines = (tail + payload.delta).split('\n');
        tail = lines.pop() ?? '';
        for (const line of lines) {
          if (!discardingLine) readLine(line);
          discardingLine = false;
        }
        // Discard whole oversized lines rather than cutting a secret token before redaction.
        if (tail.length > 2048) discardingLine = true;
        if (discardingLine) tail = '';
        return;
      }
      if (payload.type !== 'tool_use' || seen.has(payload.id)) return;
      const summary = nativeFallbackSummary({ name: payload.name, input: payload.input }, {});
      const catalogName = payload.name.replace(/^(?:mcp__jini__|functions\.)/, '');
      if (CATALOG_BRIDGE_TOOLS.has(catalogName)) return;
      if (summary === null) {
        seen.add(payload.id);
        // Never store native/MCP inputs: they may contain prompts, credentials or document bodies.
        append({ id: `${required.runId}:native:${payload.id}`, type: 'native_tool_used',
          at: new Date(event.ts).toISOString(), site: required.site, chatId: required.chatId,
          runId: required.runId, provider: required.provider, toolUsed: safe(payload.name),
          summary: 'Native tool used', gapLine: null });
        return;
      }
      if (!discardingLine) readLine(tail);
      tail = ''; discardingLine = false;
      seen.add(payload.id);
      lastGap = { id: `${required.runId}:gap:${payload.id}`, type: 'tool_gap', at: new Date(event.ts).toISOString(),
        site: required.site, chatId: required.chatId, runId: required.runId,
        provider: required.provider, toolUsed: safe(payload.name), summary: safe(summary), gapLine: explanation };
      explanation = null;
      append(lastGap);
    },
    /** Await outstanding audit writes during graceful shutdown/tests. */
    flush: () => pending,
  };
}
