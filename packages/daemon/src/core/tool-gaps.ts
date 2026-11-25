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

/** The run-scoped identity fields every stored entry carries. */
interface GapIdentity { readonly site: string; readonly chatId: string; readonly runId: string; readonly provider: string }

/** Pure: the explanation announced by one complete text line, or null when it announces none. */
function explainLine({ line, safe }: { readonly line: string; readonly safe: (text: string) => string }): string | null {
  const match = /(?:^|\s)Tool gap:\s*(.+)/.exec(line);
  if (!match) return null;
  // Prefer the next fallback: a missing explanation on an earlier tool must not steal the
  // line announcing a later one. A final explanation is attached on the terminal event.
  return safe(`Tool gap: ${match[1]}`);
}

/**
 * Pure line scan of one text delta: returns the last explanation found on a readable complete
 * line (null when none) plus the carried-over partial `tail` and discard flag.
 */
function scanDelta(
  { buffered, delta, discardingLine, safe }: { readonly buffered: string; readonly delta: string; readonly discardingLine: boolean; readonly safe: (text: string) => string },
): { readonly explanation: string | null; readonly tail: string; readonly discardingLine: boolean } {
  const lines = (buffered + delta).split('\n');
  // String.prototype.split always returns at least one element, so the last piece exists.
  let tail = lines.pop()!;
  let discarding = discardingLine;
  let explanation: string | null = null;
  for (const line of lines) {
    if (!discarding) explanation = explainLine({ line, safe }) ?? explanation;
    discarding = false;
  }
  // Discard whole oversized lines rather than cutting a secret token before redaction.
  if (tail.length > 2048) discarding = true;
  if (discarding) tail = '';
  return { explanation, tail, discardingLine: discarding };
}

/** Pure: the audit entry for a native/MCP tool that is not a fallback gap. */
function nativeToolEntry(
  { identity, tool, ts, safe }: { readonly identity: GapIdentity; readonly tool: ToolUse; readonly ts: number; readonly safe: (text: string) => string },
): ToolGapEntry {
  // Never store native/MCP inputs: they may contain prompts, credentials or document bodies.
  return { id: `${identity.runId}:native:${tool.id}`, type: 'native_tool_used',
    at: new Date(ts).toISOString(), site: identity.site, chatId: identity.chatId,
    runId: identity.runId, provider: identity.provider, toolUsed: safe(tool.name),
    summary: 'Native tool used', gapLine: null };
}

/** Pure: the audit entry for a fallback gap, carrying any explanation read so far. */
function gapEntry(
  { identity, tool, summary, ts, safe, gapLine }: { readonly identity: GapIdentity; readonly tool: ToolUse; readonly summary: string; readonly ts: number; readonly safe: (text: string) => string; readonly gapLine: string | null },
): ToolGapEntry {
  return { id: `${identity.runId}:gap:${tool.id}`, type: 'tool_gap', at: new Date(ts).toISOString(),
    site: identity.site, chatId: identity.chatId, runId: identity.runId,
    provider: identity.provider, toolUsed: safe(tool.name), summary: safe(summary), gapLine };
}

/** The collector's line-reading state; every transition below returns the next one. */
interface GapState {
  readonly tail: string;
  readonly discardingLine: boolean;
  readonly explanation: string | null;
  readonly lastGap: ToolGapEntry | null;
}
const INITIAL_GAP_STATE: GapState = { tail: '', discardingLine: false, explanation: null, lastGap: null };

/** Reads the unfinished line into the explanation unless that line is being discarded. */
function settleTail({ state, safe }: { readonly state: GapState; readonly safe: (text: string) => string }): GapState {
  if (state.discardingLine) return state;
  return { ...state, explanation: explainLine({ line: state.tail, safe }) ?? state.explanation };
}

/** State after one text delta. */
function afterDelta({ state, delta, safe }: { readonly state: GapState; readonly delta: string; readonly safe: (text: string) => string }): GapState {
  const scan = scanDelta({ buffered: state.tail, delta, discardingLine: state.discardingLine, safe });
  return { ...state, explanation: scan.explanation ?? state.explanation, tail: scan.tail, discardingLine: scan.discardingLine };
}

/** State after the terminal event, plus the revision to append when a late explanation fills an earlier gap. */
function afterEnd({ state, safe }: { readonly state: GapState; readonly safe: (text: string) => string }): { readonly state: GapState; readonly revision: ToolGapEntry | null } {
  const settled = settleTail({ state, safe });
  const { lastGap, explanation } = settled;
  const revision = lastGap && explanation && lastGap.gapLine === null ? { ...lastGap, gapLine: explanation } : null;
  return { state: { ...settled, tail: '', explanation: null, lastGap: revision ?? lastGap }, revision };
}

/** Queues one entry behind earlier writes; a failed write is reported and never strands later ones. */
function writeGapEntry(
  { pending, identity, entry, onError }: {
    readonly pending: Promise<void>;
    readonly identity: GapIdentity & { readonly sink: ToolAttemptAuditSink; readonly workspaceId: string; readonly principalId: string };
    readonly entry: ToolGapEntry;
    readonly onError: ((error: unknown) => void) | undefined;
  },
): Promise<void> {
  return pending.then(() => identity.sink.append({
    attemptId: entry.id, executionId: null, workspaceId: identity.workspaceId,
    principalId: identity.principalId, runId: identity.runId, toolId: TOOL_GAP_AUDIT_ID,
    phase: 'requested', at: entry.at,
  }, { detail: JSON.stringify(entry) })).catch(error => {
    // Observation must not strand later writes if a host's error reporter itself throws.
    try { onError?.(error); } catch { /* host reporter failed */ }
  });
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
  let state = INITIAL_GAP_STATE;
  let pending = Promise.resolve();
  const safe = (text: string) => required.redact(text).slice(0, 500);
  const append = (entry: ToolGapEntry) => {
    pending = writeGapEntry({ pending, identity: required, entry, onError: optional.onError });
  };
  /** Terminal event: read an unfinished line, then attach a final explanation as a revision. */
  const finishRun = () => {
    const end = afterEnd({ state, safe });
    state = end.state;
    if (end.revision) append(end.revision);
  };
  const recordNativeTool = (tool: ToolUse, ts: number) => {
    append(nativeToolEntry({ identity: required, tool, ts, safe }));
  };
  const recordGap = (tool: ToolUse, summary: string, ts: number) => {
    state = { ...settleTail({ state, safe }), tail: '', discardingLine: false };
    const entry = gapEntry({ identity: required, tool, summary, ts, safe, gapLine: state.explanation });
    state = { ...state, explanation: null, lastGap: entry };
    append(entry);
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
      if (payload.type === 'text_delta') state = afterDelta({ state, delta: payload.delta, safe });
      if (payload.type === 'tool_use') recordToolUse(payload, event.ts);
    },
    /** Await outstanding audit writes during graceful shutdown/tests. */
    flush: () => pending,
  };
}
