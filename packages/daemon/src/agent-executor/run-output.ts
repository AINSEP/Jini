import { redactSecrets } from '@jini-ai/core';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import type { TerminalRunOutcome } from '../close-status.js';
import type { RunLifecycle } from '../run-lifecycle.js';

/** What the observer has seen of a run so far; `diagnostic` is the last terminal-prefixed failure line. */
interface OutputSeen { text: boolean; tool: boolean; error: boolean; diagnostic: string | undefined }

// Only a terminal-prefixed failure overrides real output; ordinary assistant explanations
// can mention empty output or headless permissions without being failed runs themselves.
// One pattern per diagnostic; a line is a diagnostic when any of them matches.
const DIAGNOSTIC_LINES: readonly RegExp[] = [
  /^(?:jetski|agy|error|fatal):\s*no (?:output|response) produced(?:\s*[—–:-]|[.!]\s*$)/i,
  /^(?:jetski|agy|error|fatal):\s*(?:error:\s*)?permission denied\b.*headless/i,
  /^(?:jetski|agy|error|fatal):\s*headless\b.*auto-denied/i,
];

/** Records whether the event is assistant text, tool activity or a run error. */
function noteActivity(seen: OutputSeen, event: RunProtocolEvent): void {
  if (event.kind === 'error') seen.error = true;
  if (event.kind !== 'agent') return;
  const payload = event.payload;
  if (payload.type === 'text_delta' && payload.delta.trim()) seen.text = true;
  if (payload.type === 'tool_use' || payload.type === 'tool_result') seen.tool = true;
}

/**
 * Appends a watched output chunk to its 8 KiB tail and keeps the latest failure line found there.
 * stderr is always watched; stdout only for plain-stdout agents, whose stdout is the CLI's own text.
 */
function noteDiagnostic(
  { seen, tails, event, plainStdout }: { seen: OutputSeen; tails: { stdout: string; stderr: string }; event: RunProtocolEvent; plainStdout: boolean },
): void {
  if (event.kind !== 'stderr' && !(plainStdout && event.kind === 'stdout')) return;
  const channel = event.kind === 'stderr' ? 'stderr' : 'stdout';
  tails[channel] = (tails[channel] + event.payload.chunk).slice(-8192);
  const line = tails[channel].split(/\r?\n/).find(value => DIAGNOSTIC_LINES.some(pattern => pattern.test(value.trim())));
  if (line) seen.diagnostic = line;
}

/** True when the run's own outcome stands; false when the observed output turns it into a failure. */
function keepsOutcome(status: TerminalRunOutcome, seen: OutputSeen): boolean {
  if (status === 'cancelled') return true;
  if (seen.diagnostic) return false;
  return status === 'failed' || (!seen.error && (seen.text || seen.tool));
}

/** The readable reason recorded when an apparently finished run is turned into a failure. */
function failureReason(agentName: string, seen: OutputSeen): string {
  if (seen.diagnostic) {
    const cause = /headless|permission|auto-denied/i.test(seen.diagnostic) ? 'permission denied in headless mode' : 'no output produced';
    return `${agentName} failed: ${cause}. ${seen.diagnostic}`;
  }
  return seen.error ? `${agentName} ended with an error.` : `${agentName} returned no assistant text or tool activity. Please retry.`;
}

/**
 * Observe canonical run events, including delegated MCP tools, and reject empty successes.
 * Diagnostics are bounded to 8 KiB; raw progress and private thinking are not assistant output.
 * Returns a close-time guard that unsubscribes and emits a readable error before terminal failure.
 * @complexity O(received bytes), with bounded diagnostic storage.
 */
export function observeRunOutput(
  { lifecycle, runId, agentName }: { lifecycle: RunLifecycle; runId: string; agentName: string },
  { plainStdout = false }: { plainStdout?: boolean } = {},
): { settle(input: { status: TerminalRunOutcome }, options?: Record<string, never>): Promise<TerminalRunOutcome> } {
  const seen: OutputSeen = { text: false, tool: false, error: false, diagnostic: undefined };
  const tails = { stdout: '', stderr: '' };
  const subscription = lifecycle.stream({ runId, onEvent: event => {
    noteActivity(seen, event);
    noteDiagnostic({ seen, tails, event, plainStdout });
  } }).catch(error => {
    // An observer failure is a daemon diagnostic, not evidence that the agent failed.
    // eslint-disable-next-line no-console
    console.warn(`[@jini-ai/daemon] agent-executor: output observer unavailable for run "${runId}"`,
      redactSecrets({ input: error instanceof Error ? error.message : String(error) }));
    return null;
  });

  return {
    async settle({ status }, _options = {}) {
      const observer = await subscription;
      // Without observation, missing events cannot prove an empty run; keep its real outcome.
      if (observer?.kind !== 'ok') return status;
      observer.unsubscribe();
      if (keepsOutcome(status, seen)) return status;
      const message = redactSecrets({ input: failureReason(agentName, seen).slice(0, 1200) });
      // A watchdog can already have settled the run; its terminal state must still win.
      await lifecycle.emit({ runId, input: { event: 'error', data: { message } } }).catch(() => {});
      return 'failed';
    },
  };
}
