import type { AcceptedRunRequest, DurableRun, DurableRunStore } from "../../core/durable-runs/ports.js";

export interface RunAcceptancePorts {
  readonly store: DurableRunStore;
  /** Sanitize the host envelope before it is durably accepted. */
  readonly sanitizeContextRef: (required: { contextRef: string }, optional: {}) => string;
  readonly now: () => number;
  readonly mintRunId: () => string;
  readonly launch: (required: { run: DurableRun; request: AcceptedRunRequest }, optional: {}) => Promise<void>;
  /** Observes only a newly committed logical run; replays and recovery never invoke it. */
  readonly onAccepted?: (required: { run: DurableRun }, optional: {}) => void;
  readonly attach: (required: DurableRun, optional: {}) => void;
}

export function createRunAcceptance(ports: RunAcceptancePorts, _optional = {}) {
  return {
    async accept(required: { principalId: string; workspaceId: string; conversationId: string; messageId: string; request: AcceptedRunRequest }, _options = {}) {
      const request = { ...required.request, contextRef: ports.sanitizeContextRef({ contextRef: required.request.contextRef }, {}) };
      const runId = ports.mintRunId();
      const run = await ports.store.accept({ ...required, request, runId, now: ports.now() }, {});
      if (!run) return null;
      if (run.runId === runId) {
        try { ports.onAccepted?.({ run }, {}); }
        catch { /* An optional observer cannot prevent dispatch of a committed run. */ }
      }
      // The stub and accepted input are committed BEFORE dispatch. The daemon uses the stored
      // attempt id as its idempotency key, so duplicate POSTs cannot start two executors.
      if (run.message.runStatus === "queued" && run.recoveryCount === 0 && !run.cancelReason) {
        try { await ports.launch({ run, request: run.request }, {}); }
        catch { /* The accepted attempt is recoverable even if its response was lost. */ }
      }
      ports.attach(run, {});
      return run;
    },
  };
}
