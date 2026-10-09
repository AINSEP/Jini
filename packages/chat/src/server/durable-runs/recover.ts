import { recoveredRunEvents, type AgentEvent } from "../../core/index.js";
import { classifyAgentServiceFailure } from "@jini-ai/agent-runtime";
import { continuationRequest } from "../../core/durable-runs/continuation.js";
import type { DurableRecovery, DurableRun, RecoveryPorts, RecoveryResult, RecoveryTrigger } from "../../core/durable-runs/ports.js";

import { RECOVERY_LIMIT, RECOVERY_WINDOW_MS, RUN_STALENESS_MS, SAVED_WORK_NOTICE, EXHAUSTED_NOTICE } from "../../core/durable-runs/policies.js";
export { RECOVERY_LIMIT, RECOVERY_WINDOW_MS, RUN_STALENESS_MS, SAVED_WORK_NOTICE, EXHAUSTED_NOTICE } from "../../core/durable-runs/policies.js";
/** Retryability is independent of session resumability. Inspect executor diagnostics, never
 * answer text or tool results: those can quote unrelated failures from completed work. Old
 * attempt diagnostics remain visible but cannot decide the fate of their continuation. */
function attemptFailure(run: DurableRun): "retryable" | "permanent" | "auth-failure" | "inactivity-watchdog" {
  const events = run.message.events ?? [];
  // Checkpoints merge adjacent text, so a base's event count is not a durable offset. The
  // coordinator's recovery marker separates attempts and survives that compaction.
  let marker = -1;
  // Reverse scan preserves the last-marker rule on the desktop's ES2022 target.
  for (let index = run.attemptBase.length ? events.length - 1 : -1; index >= 0; index--) {
    const event = events[index]!;
    if (event.kind === "status" && event.code === "run_recovering") { marker = index; break; }
  }
  const diagnostics = events.slice(marker >= 0 ? marker + 1 : run.attemptBase.length).flatMap((event) =>
    event.kind === "status" ? [event.label, event.detail ?? ""] : event.kind === "raw" ? [event.line] : []).join("\n");
  if (/inactivity[_ -]?(timeout|watchdog)|watchdog.*(kill|stop)/i.test(diagnostics)) return "inactivity-watchdog";
  const service = classifyAgentServiceFailure({ text: diagnostics });
  if (service === "AGENT_AUTH_REQUIRED") return "auth-failure";
  // Quota/billing and bad requests need human repair. A 429 for rate throttling and a 5xx
  // overload remain retryable; the provider's coarse RATE_LIMITED class also includes billing.
  const requestStatuses = diagnostics.matchAll(/\b(?:http(?:[ /]?\d(?:\.\d)?)?|(?:status|error|response)(?:[ _-]?code)?|code(?=\s*[:=#]))[\s:=#-]*(4\d\d)\b/gi);
  if ([...requestStatuses].some((match) => match[1] !== "408" && match[1] !== "429")) return "permanent";
  if (/another answer in this chat is still running|invalid[_ -]?request|context[_ -]?(length|window)|maximum context|model.*(?:not[_ -]found|does not exist|not supported)|unsupported|does not support|permission denied|forbidden|insufficient[_ -]?(quota|balance|credit|funds)|credit balance is too low|exceeded your current quota|quota[_ -]?exceeded|usage limit|billing|payment required/i.test(diagnostics)) return "permanent";
  return "retryable";
}

function exclusion(run: DurableRun): string | null {
  if (run.cancelReason) return run.cancelReason;
  if (!run.principalId || run.engine !== "daemon") return "excluded";
  return null;
}

function budgetNotice(run: DurableRun, now: number): string | null {
  if (now - run.lastProgressAt >= RUN_STALENESS_MS) return SAVED_WORK_NOTICE;
  if (run.recoveryCount >= RECOVERY_LIMIT) return EXHAUSTED_NOTICE;
  if (run.recoveryDeadline !== null && now >= run.recoveryDeadline) return EXHAUSTED_NOTICE;
  return null;
}

/** Recovery coordinator behind explicit host ports. One CAS owns both the attempt and its conversation slot. */
export function createDurableRecovery(ports: RecoveryPorts, _optional = {}): DurableRecovery {
  async function finalize(run: DurableRun, notice: string, canceled = false): Promise<RecoveryResult> {
    await ports.cancelAttempt(run, {}).catch(() => undefined);
    // Persist the notice as an event: hook errors are live-only and would leave a reloaded
    // terminal message without its explanation. Only this coordinator decides exhaustion.
    const events: AgentEvent[] = [...(run.message.events ?? []), { kind: "status", label: notice }];
    await ports.settle({ ...run, content: run.message.content, events, status: canceled ? "canceled" : "failed", endedAt: ports.now() }, {});
    return "finalized";
  }

  async function nativeAllowed(run: DurableRun): Promise<boolean> {
    if (!run.sessionConfirmed || !run.sessionId || !run.child) return false;
    if (!ports.supportsNativeResume({ agentId: run.request.agentId ?? "claude" }, {})) return false;
    return ports.verifyChildDead(run.child, {}).catch(() => false);
  }

  async function continueDead(run: DurableRun): Promise<RecoveryResult> {
    await ports.cancelAttempt(run, {}).catch(() => undefined);
    const native = await nativeAllowed(run);
    const nextRunId = ports.mintRunId();
    const saved = [...(run.message.events ?? [])];
    if (!saved.some((event) => event.kind === "text") && run.message.content) saved.unshift({ kind: "text", text: run.message.content });
    const events = recoveredRunEvents({ saved }, {});
    if (!await ports.store.advance({ run, nextRunId, now: ports.now(), events }, {})) return "superseded";
    const next = await ports.store.load({ messageId: run.messageId }, {});
    // Cancel/deletion can win while the old attempt is being fenced. Re-read after CAS and do
    // not launch against a removed binding or a newer generation.
    if (!next || next.runId !== nextRunId) return "superseded";
    if (next.cancelReason) return finalize(next, "Stopped. Saved work is above.", true);
    try {
      await ports.launch({ run: next, request: continuationRequest({ run: { ...run, message: next.message, transcript: next.transcript }, native }, {}) }, {});
      await ports.store.recoveryClock({ runId: next.runId, now: ports.now(), active: false }, {});
    } catch {
      // A rejected/lost start response is uncertain: the daemon may already be executing. The
      // same idempotent attempt is probed by the attached watcher before another CAS is possible.
    }
    ports.attach(next, {});
    return "continued";
  }

  async function decide(run: DurableRun, trigger: RecoveryTrigger, liveRunId?: string): Promise<RecoveryResult> {
    if (exclusion(run)) return finalize(run, "Stopped. Saved work is above.", true);
    // A terminal executor end confirms this attempt is dead even when the daemon retains its
    // replayable record (HTTP 200). Other triggers must obtain fresh liveness evidence.
    const probe = trigger === "attempt-failed" ? "dead" : liveRunId === run.runId ? "live" : await ports.probe(run, {});
    if (probe === "live") {
      await ports.store.recoveryClock({ runId: run.runId, now: ports.now(), active: false }, {});
      ports.attach(run, {}); return "reattached";
    }
    // Diagnostics decide only the fate of an attempt that is no longer running. Read before the
    // probe, raw stdout quoting a tool description ("OAuth-authenticated") canceled a live turn
    // as "Not logged in" (luvira, 2026-10-08).
    const failure = attemptFailure(run);
    if (failure === "auth-failure" || failure === "inactivity-watchdog") return finalize(run, failure === "auth-failure" ? "Not logged in. Saved work is above." : "Stopped. Saved work is above.", true);
    if (failure === "permanent") return finalize(run, EXHAUSTED_NOTICE);
    return resolveMissing(run, probe, trigger);
  }

  async function resolveMissing(run: DurableRun, probe: "dead" | "uncertain", trigger: RecoveryTrigger): Promise<RecoveryResult> {
    await ports.store.recoveryClock({ runId: run.runId, now: ports.now(), active: true }, {});
    const timed = await ports.store.load({ messageId: run.messageId }, {}) ?? run;
    // A probe only speaks about the generation it inspected. Never apply its dead result to
    // a newer attempt committed by another caller while this one was awaiting storage/HTTP.
    if (timed.runId !== run.runId) return "superseded";
    const notice = budgetNotice(timed, ports.now());
    if (notice) return finalize(run, notice);
    // A queued attempt may be between durable acceptance and the daemon's start transaction.
    // Give that idempotent launch time to appear before a 404 can advance its generation.
    if (probe === "dead" && (trigger === "attempt-failed" || ports.now() - run.attemptStartedAt >= 10_000)) return continueDead(timed);
    ports.attach(run, {});
    return "waiting";
  }

  return {
    async recover({ messageId, trigger, expectedRunId }, options) {
      const run = await ports.store.load({ messageId }, {});
      if (!run) return "gone";
      if (run.message.runStatus !== "queued" && run.message.runStatus !== "running") return "terminal";
      if (expectedRunId && expectedRunId !== run.runId) return "superseded";
      return decide(run, trigger, options.liveRunId);
    },
  };
}
