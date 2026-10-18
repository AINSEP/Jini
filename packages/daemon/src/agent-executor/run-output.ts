import { redactSecrets } from '@jini-ai/core';
import type { TerminalRunOutcome } from '../close-status.js';
import type { RunLifecycle } from '../run-lifecycle.js';

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
  let textSeen = false;
  let toolSeen = false;
  let errorSeen = false;
  let diagnostic: string | undefined;
  const tails = { stdout: '', stderr: '' };
  const subscription = lifecycle.stream({ runId, onEvent: event => {
    if (event.kind === 'error') errorSeen = true;
    if (event.kind === 'agent') {
      const payload = event.payload;
      if (payload.type === 'text_delta' && payload.delta.trim()) textSeen = true;
      if (payload.type === 'tool_use' || payload.type === 'tool_result') toolSeen = true;
    }
    if (event.kind !== 'stderr' && !(plainStdout && event.kind === 'stdout')) return;
    const channel = event.kind === 'stderr' ? 'stderr' : 'stdout';
    tails[channel] = (tails[channel] + event.payload.chunk).slice(-8192);
    // Only a terminal-prefixed failure overrides real output; ordinary assistant explanations
    // can mention empty output or headless permissions without being failed runs themselves.
    const line = tails[channel].split(/\r?\n/).find(value => /^(?:jetski|agy|error|fatal):\s*(?:no (?:output|response) produced(?:\s*[—–:-]|[.!]\s*$)|(?:error:\s*)?permission denied\b.*headless|headless\b.*auto-denied)/i.test(value.trim()));
    if (line) diagnostic = line;
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
      if (status === 'cancelled' || (status === 'failed' && !diagnostic)) return status;
      if (!diagnostic && !errorSeen && (textSeen || toolSeen)) return status;
      const reason = diagnostic
        ? `${agentName} failed${/headless|permission|auto-denied/i.test(diagnostic) ? ': permission denied in headless mode' : ': no output produced'}. ${diagnostic}`
        : errorSeen ? `${agentName} ended with an error.` : `${agentName} returned no assistant text or tool activity. Please retry.`;
      const message = redactSecrets({ input: reason.slice(0, 1200) });
      // A watchdog can already have settled the run; its terminal state must still win.
      await lifecycle.emit({ runId, input: { event: 'error', data: { message } } }).catch(() => {});
      return 'failed';
    },
  };
}
