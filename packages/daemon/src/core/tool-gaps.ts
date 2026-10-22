import type { RunProtocolEvent } from '@jini-ai/protocol';
import type { ToolAttemptAuditSink, ToolAttemptEvent } from './tool-audit.js';

/** Reserved audit marker; detail is a redacted ToolGapEntry, never tool output or file content. */
export const TOOL_GAP_AUDIT_ID = 'native_tool_gap';
export interface ToolGapEntry {
  type: 'tool_gap' | 'native_tool_used';
  id: string; at: string; site: string; chatId: string; runId: string;
  provider: string; toolUsed: string; summary: string; gapLine: string | null;
}

const GAP_ENTRY_STRING_KEYS = ['id', 'at', 'site', 'chatId', 'runId', 'provider', 'toolUsed', 'summary'] as const;

/** True when a parsed row carries every public metadata field; older rows may omit `type`. */
function hasToolGapShape(entry: Record<string, unknown>): boolean {
  if (!GAP_ENTRY_STRING_KEYS.every(key => typeof entry[key] === 'string')) return false;
  if (entry.gapLine !== null && typeof entry.gapLine !== 'string') return false;
  return entry.type === undefined || entry.type === 'tool_gap' || entry.type === 'native_tool_used';
}

/** Decode only the public metadata shape; corrupt/older audit rows are skipped. Pure, O(n) JSON. */
export function decodeToolGapEntry(required: { json: string | null }, _optional = {}): ToolGapEntry | null {
  try {
    const entry = JSON.parse(required.json ?? 'null') as Record<string, unknown> | null;
    if (!entry || typeof entry !== 'object' || !hasToolGapShape(entry)) return null;
    return { ...entry, type: entry.type ?? 'tool_gap' } as unknown as ToolGapEntry;
  } catch { return null; }
}

/** Default 100, at most 200, at least 1; zero/NaN/fractions below 1 fall back to the default. */
function clampGapLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(200, Math.trunc(limit ?? 100) || 100));
}

/** A reserved gap row owned by the requested workspace and principal. */
function isGapRowFor(row: ToolAttemptEvent, owner: { readonly workspaceId: string; readonly principalId: string }): boolean {
  return row.toolId === TOOL_GAP_AUDIT_ID && row.workspaceId === owner.workspaceId && row.principalId === owner.principalId;
}

/** Project the in-memory audit adapter with the SQL reader's same latest-revision semantics.
 * Pure, O(n) over retained audit events; bounded output, no provider or database coupling. */
export function toolGapsFromAuditEvents(required: {
  events: readonly ToolAttemptEvent[]; workspaceId: string; principalId: string;
}, optional: { limit?: number } = {}): readonly ToolGapEntry[] {
  const limit = clampGapLimit(optional.limit);
  const entries = new Map<string, ToolGapEntry>();
  for (let index = required.events.length - 1; index >= 0 && entries.size < limit; index--) {
    const row = required.events[index]!;
    if (!isGapRowFor(row, required)) continue;
    const entry = decodeToolGapEntry({ json: row.detail ?? null }, {});
    if (entry && !entries.has(entry.id)) entries.set(entry.id, entry);
  }
  return [...entries.values()];
}
const CATALOG_BRIDGE_TOOLS: ReadonlySet<string> = new Set(['search_tools', 'describe_tool', 'execute_delegated_tool', 'execute_readonly_delegated_tool']);
const FALLBACK_NAMES: ReadonlySet<string> = new Set([
  'Bash', 'BashOutput', 'KillShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit',
  'shell', 'shell_command', 'exec_command', 'write_stdin', 'run_shell_command',
  'apply_patch', 'write_file', 'replace', 'edit_file', 'file_change',
]);

/** Extract command/path metadata only. File bodies, patches and tool output never enter audit.
 * Pure, O(n) in the tool input size. Redaction must precede truncation at the collector boundary. */
export function nativeFallbackSummary(required: { name: string; input: unknown }, _optional = {}): string | null {
  const name = required.name.replace(/^functions\./, '');
  if (!FALLBACK_NAMES.has(name)) return null;
  if (typeof required.input === 'string') return summarizeTextInput(name, required.input);
  return summarizeStructuredInput(required.input);
}

const NO_COMMAND_OR_PATH = '[no command/path reported]';

/** Raw text input is omitted, except patch file headers. */
function summarizeTextInput(name: string, text: string): string {
  if (name === 'apply_patch') return text.split('\n').filter(line => /^\*\*\* (?:Add|Update|Delete) File:/.test(line)).join('; ');
  return '[native tool input omitted]';
}

/** Prefer a command, then the first reported path field. */
function summarizeStructuredInput(value: unknown): string {
  const input = value as Record<string, unknown> | null;
  if (!input || typeof input !== 'object') return NO_COMMAND_OR_PATH;
  const command = input.command ?? input.cmd;
  if (typeof command === 'string') return command;
  return summarizePaths(input.file_path ?? input.path ?? input.notebook_path ?? input.paths);
}

function summarizePaths(paths: unknown): string {
  if (typeof paths === 'string') return paths;
  if (Array.isArray(paths)) return paths.filter(path => typeof path === 'string').join('; ');
  return NO_COMMAND_OR_PATH;
}

/** The normalized tool_use payload fields the collector reads. */
interface ToolUse { readonly id: string; readonly name: string; readonly input: unknown }

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
  /** Terminal event: read an unfinished line, then attach a final explanation as a revision. */
  const finishRun = () => {
    if (!discardingLine) readLine(tail);
    if (lastGap && explanation && lastGap.gapLine === null) {
      lastGap = { ...lastGap, gapLine: explanation };
      append(lastGap);
    }
    tail = ''; explanation = null;
  };
  const readDelta = (delta: string) => {
    const lines = (tail + delta).split('\n');
    // String.prototype.split always returns at least one element, so the last piece exists.
    tail = lines.pop()!;
    for (const line of lines) {
      if (!discardingLine) readLine(line);
      discardingLine = false;
    }
    // Discard whole oversized lines rather than cutting a secret token before redaction.
    if (tail.length > 2048) discardingLine = true;
    if (discardingLine) tail = '';
  };
  const recordNativeTool = (tool: ToolUse, ts: number) => {
    // Never store native/MCP inputs: they may contain prompts, credentials or document bodies.
    append({ id: `${required.runId}:native:${tool.id}`, type: 'native_tool_used',
      at: new Date(ts).toISOString(), site: required.site, chatId: required.chatId,
      runId: required.runId, provider: required.provider, toolUsed: safe(tool.name),
      summary: 'Native tool used', gapLine: null });
  };
  const recordGap = (tool: ToolUse, summary: string, ts: number) => {
    if (!discardingLine) readLine(tail);
    tail = ''; discardingLine = false;
    lastGap = { id: `${required.runId}:gap:${tool.id}`, type: 'tool_gap', at: new Date(ts).toISOString(),
      site: required.site, chatId: required.chatId, runId: required.runId,
      provider: required.provider, toolUsed: safe(tool.name), summary: safe(summary), gapLine: explanation };
    explanation = null;
    append(lastGap);
  };
  const recordToolUse = (tool: ToolUse, ts: number) => {
    if (seen.has(tool.id)) return;
    // Catalog bridge calls are already audited by the catalog itself and are never marked seen.
    if (CATALOG_BRIDGE_TOOLS.has(tool.name.replace(/^(?:mcp__jini__|functions\.)/, ''))) return;
    seen.add(tool.id);
    const summary = nativeFallbackSummary({ name: tool.name, input: tool.input }, {});
    if (summary === null) recordNativeTool(tool, ts);
    else recordGap(tool, summary, ts);
  };
  return {
    /** Called synchronously from the run's existing subscription; no recursive run events. */
    observe({ event }: { event: RunProtocolEvent }, _options = {}): void {
      if (event.runId !== required.runId) return;
      if (event.kind === 'end') { finishRun(); return; }
      if (event.kind !== 'agent') return;
      const payload = event.payload;
      if (payload.type === 'text_delta') readDelta(payload.delta);
      else if (payload.type === 'tool_use') recordToolUse(payload, event.ts);
    },
    /** Await outstanding audit writes during graceful shutdown/tests. */
    flush: () => pending,
  };
}
