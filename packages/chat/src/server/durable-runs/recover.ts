import { recoveredRunEvents, type AgentEvent } from "../../core/index.js";
import { classifyAgentServiceFailure } from "@jini-ai/agent-runtime";
import { continuationRequest } from "../../core/durable-runs/continuation.js";
import { isAwaitingAnswer } from "../../core/run-activity.js";
import type { DurableRecovery, DurableRun, RecoveryPorts, RecoveryResult, RecoveryTrigger, RunProbe } from "../../core/durable-runs/ports.js";

import { RECOVERY_LIMIT, RUN_STALENESS_MS, SAVED_WORK_NOTICE, AWAITING_ANSWER_NOTICE, EXHAUSTED_NOTICE } from "../../core/durable-runs/policies.js";
export { RECOVERY_LIMIT, RECOVERY_WINDOW_MS, RUN_STALENESS_MS, SAVED_WORK_NOTICE, AWAITING_ANSWER_NOTICE, EXHAUSTED_NOTICE } from "../../core/durable-runs/policies.js";
// Older saved run error frames hold only their message: the daemon's MCP_BRIDGE_UNAVAILABLE
// code was dropped, so the bridge failure is still matched by its text.
const MCP_BRIDGE_FAILURE = /The assistant's tools did not load \(MCP bridge "jini" status: [^\r\n]*/;
const STOPPED_NOTICE = "Stopped. Saved work is above.";
type FailureClass = "retryable" | "permanent" | "auth-failure" | "inactivity-watchdog";

/** Index of the last event matching `match`, or -1.
 * @complexity O(e) time, O(1) space, no effects. */
function lastIndexWhere({ events, match }: { events: readonly AgentEvent[]; match: (event: AgentEvent) => boolean }, _optional = {}): number {
  // Reverse scan preserves the last-marker rule on the desktop's ES2022 target.
  for (let index = events.length - 1; index >= 0; index--) if (match(events[index]!)) return index;
  return -1;
}

/** One complete stdout line's contribution to executor diagnostics. */
function diagnosticLine({ line }: { line: string }, _optional = {}): string[] {
  try {
    const result = JSON.parse(line) as { type?: unknown; subtype?: unknown; is_error?: unknown } | null;
    // Successful CLI summaries contain usage metadata and answer prose, not failure evidence.
    if (result?.type === "result" && result.is_error === false) return [];
    // A subagent report can discuss billing/auth in completed work; it is not executor evidence.
    if (result?.type === "system" && result.subtype === "task_notification") return [];
  } catch {
    // Non-JSON stdout can still contain the executor's failure reason.
  }
  return [line];
}

/** A saved raw event may hold several JSONL lines; filter each before failure classification.
 * A status's typed code counts too: a launch `*_UNSUPPORTED` code (any CLI) cannot heal on retry. */
function diagnosticLines({ event }: { event: AgentEvent }, _optional = {}): string[] {
  if (event.kind === "status") return [event.code ?? "", event.label, event.detail ?? ""];
  if (event.kind !== "raw") return [];
  return event.line.split(/\r?\n/).flatMap(line => diagnosticLine({ line }));
}

/** Retryability is independent of session resumability. Inspect executor diagnostics, never
 * answer text or tool results: those can quote unrelated failures from completed work. Old
 * attempt diagnostics remain visible but cannot decide the fate of their continuation. */
function attemptDiagnostics({ run }: { run: DurableRun }, _optional = {}): string {
  const events = run.message.events ?? [];
  // Checkpoints merge adjacent text, so a base's event count is not a durable offset. The
  // coordinator's recovery marker separates attempts and survives that compaction.
  const marker = run.attemptBase.length
    ? lastIndexWhere({ events, match: (event) => event.kind === "status" && event.code === "run_recovering" })
    : -1;
  return events.slice(marker >= 0 ? marker + 1 : run.attemptBase.length).flatMap((event) => diagnosticLines({ event })).join("\n");
}

/** Quota/billing and bad requests need human repair. A 429 for rate throttling and a 5xx
 * overload remain retryable; the provider's coarse RATE_LIMITED class also includes billing. */
function needsHumanRepair({ diagnostics }: { diagnostics: string }, _optional = {}): boolean {
  const hasRejectedStatus = REQUEST_STATUS_PATTERNS.some(pattern =>
    [...diagnostics.matchAll(pattern)].some(match => match[1] !== "408" && match[1] !== "429"));
  return hasRejectedStatus || HUMAN_REPAIR_PATTERNS.some(pattern => pattern.test(diagnostics));
}

function attemptFailure({ diagnostics }: { diagnostics: string }, _optional = {}): FailureClass {
  // MCP_BRIDGE_UNAVAILABLE needs bridge repair; another attempt repeats the same failure.
  // Classify it before interpreting the bridge's stderr as an agent auth/watchdog failure.
  if (MCP_BRIDGE_FAILURE.test(diagnostics)) return "permanent";
  if (/inactivity[_ -]?(timeout|watchdog)|watchdog.*(kill|stop)/i.test(diagnostics)) return "inactivity-watchdog";
  if (classifyAgentServiceFailure({ text: diagnostics }) === "AGENT_AUTH_REQUIRED") return "auth-failure";
  return needsHumanRepair({ diagnostics }) ? "permanent" : "retryable";
}

/** Keep the notice bounded and scoped to the same executor diagnostics as failure classification. */
function lastDiagnosticLine({ diagnostics }: { diagnostics: string }, _optional = {}): string | undefined {
  return diagnostics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1)?.slice(0, 300);
}

function attemptFailureDetail({ run }: { run: DurableRun }, _optional = {}): string | undefined {
  return lastDiagnosticLine({ diagnostics: attemptDiagnostics({ run }) });
}

function exclusion(run: DurableRun): string | null {
  if (run.cancelReason) return run.cancelReason;
  if (!run.principalId || run.engine !== "daemon") return "excluded";
  return null;
}

/** Preflight cards precede model tools, so the normal open-tool activity scan cannot see them.
 * Chat saves the bare resource without its wire toolUseId. Saved consent or subsequent model
 * execution closes this preflight wait, including cards saved before this fix.
 * A model tool closes the wait and no later card can reopen it, so the wait is pending exactly
 * when no tool ran and the last card follows the last consent for this conversation.
 * @complexity O(e) time, O(1) space, no effects.
 */
function awaitingAnswer({ run }: { run: DurableRun }, _options = {}): boolean {
  if (isAwaitingAnswer({ events: run.message.events })) return true;
  const events = run.message.events ?? [];
  if (events.some((event) => event.kind === "tool_use")) return false;
  const card = lastIndexWhere({ events, match: (event) => event.kind === "ext" && event.name === "mcp-ui" });
  const consent = lastIndexWhere({ events, match: (event) => event.kind === "ext" && event.name === "agent_plugins"
    && (event.data as { conversationId?: unknown } | null)?.conversationId === run.conversationId });
  return card > consent;
}

function budgetNotice(run: DurableRun, now: number): string | null {
  if (now - run.lastProgressAt >= RUN_STALENESS_MS) return awaitingAnswer({ run }) ? AWAITING_ANSWER_NOTICE : SAVED_WORK_NOTICE;
  if (run.recoveryCount >= RECOVERY_LIMIT) return EXHAUSTED_NOTICE;
  if (run.recoveryDeadline !== null && now >= run.recoveryDeadline) return EXHAUSTED_NOTICE;
  return null;
}

/** The exhausted notice's detail: the attempt's last diagnostic, else which budget ended. */
function exhaustedDetail({ run }: { run: DurableRun }, _optional = {}): string {
  return attemptFailureDetail({ run }) ?? (run.recoveryCount >= RECOVERY_LIMIT ? `Tried ${RECOVERY_LIMIT} times` : "Recovery window ended");
}

/** Saved work to carry into the next attempt, seeding the saved content when no text event holds it. */
function savedWork({ run }: { run: DurableRun }, _optional = {}): AgentEvent[] {
  const saved = [...(run.message.events ?? [])];
  if (!saved.some((event) => event.kind === "text") && run.message.content) saved.unshift({ kind: "text", text: run.message.content });
  return saved;
}

/** A dead attempt continues now; a fresh queued one waits (see the caller's comment). */
function continuesNow({ run, trigger, now }: { run: DurableRun; trigger: RecoveryTrigger; now: number }, _optional = {}): boolean {
  return trigger === "attempt-failed" || now - run.attemptStartedAt >= 10_000;
}

/** One recovery decision plus the evidence it was based on, for the metadata log line. */
interface Decision { readonly decision: RecoveryResult; readonly probe?: RunProbe; readonly failure?: FailureClass }

/** Recovery coordinator behind explicit host ports. One CAS owns both the attempt and its conversation slot.
 * Each recovery decision logs one `logger.info` line (default console) of run metadata. */
export function createDurableRecovery(ports: RecoveryPorts, { logger = console }: { logger?: Pick<Console, "info"> } = {}): DurableRecovery {
  async function finalize(run: DurableRun, notice: string, { canceled = false, detail }: { canceled?: boolean; detail?: string | undefined } = {}): Promise<RecoveryResult> {
    await ports.cancelAttempt(run, {}).catch(() => undefined);
    // Persist the notice as an event: hook errors are live-only and would leave a reloaded
    // terminal message without its explanation. Only this coordinator decides exhaustion.
    const events: AgentEvent[] = [...(run.message.events ?? []), { kind: "status", label: notice, ...(detail ? { detail } : {}) }];
    await ports.settle({ ...run, content: run.message.content, events, status: canceled ? "canceled" : "failed", endedAt: ports.now() }, {});
    return "finalized";
  }

  async function nativeAllowed(run: DurableRun): Promise<boolean> {
    if (!run.sessionConfirmed || !run.sessionId || !run.child) return false;
    if (!ports.supportsNativeResume({ agentId: run.request.agentId ?? "claude" }, {})) return false;
    return ports.verifyChildDead(run.child, {}).catch(() => false);
  }

  async function launchNext({ run, next, native }: { run: DurableRun; next: DurableRun; native: boolean }, _optional = {}): Promise<void> {
    try {
      await ports.launch({ run: next, request: continuationRequest({ run: { ...run, message: next.message, transcript: next.transcript }, native }, {}) }, {});
      await ports.store.recoveryClock({ runId: next.runId, now: ports.now(), active: false }, {});
    } catch {
      // A rejected/lost start response is uncertain: the daemon may already be executing. The
      // same idempotent attempt is probed by the attached watcher before another CAS is possible.
    }
  }

  async function continueDead(run: DurableRun): Promise<RecoveryResult> {
    await ports.cancelAttempt(run, {}).catch(() => undefined);
    // A locator captured before a hard cancel can outlive its rollout. Reuse reconstruction,
    // including prior turns/tool outcomes, instead of retrying a known missing native session.
    const missingResume = run.request.agentId === 'codex' && /no rollout found for thread id/.test(attemptDiagnostics({ run }, {}));
    const native = !missingResume && await nativeAllowed(run);
    const nextRunId = ports.mintRunId();
    const events = recoveredRunEvents({ saved: savedWork({ run }) }, { notice: missingResume ? 'silent' : 'visible' });
    if (!await ports.store.advance({ run, nextRunId, now: ports.now(), events }, {})) return "superseded";
    const next = await ports.store.load({ messageId: run.messageId }, {});
    // Cancel/deletion can win while the old attempt is being fenced. Re-read after CAS and do
    // not launch against a removed binding or a newer generation.
    if (!next || next.runId !== nextRunId) return "superseded";
    if (next.cancelReason) return finalize(next, STOPPED_NOTICE, { canceled: true });
    await launchNext({ run, next, native });
    ports.attach(next, {});
    return "continued";
  }

  async function probeAttempt({ run, trigger, liveRunId }: { run: DurableRun; trigger: RecoveryTrigger; liveRunId: string | undefined }, _optional = {}): Promise<RunProbe> {
    // A terminal executor end confirms this attempt is dead even when the daemon retains its
    // replayable record (HTTP 200). Other triggers must obtain fresh liveness evidence.
    if (trigger === "attempt-failed") return "dead";
    return liveRunId === run.runId ? "live" : ports.probe(run, {});
  }

  async function reattach(run: DurableRun): Promise<RecoveryResult> {
    await ports.store.recoveryClock({ runId: run.runId, now: ports.now(), active: false }, {});
    ports.attach(run, {});
    return "reattached";
  }

  async function finalizeFailure({ run, failure, diagnostics }: { run: DurableRun; failure: "permanent" | "auth-failure" | "inactivity-watchdog"; diagnostics: string }, _optional = {}): Promise<RecoveryResult> {
    if (failure !== "permanent") return finalize(run, failure === "auth-failure" ? "Not logged in. Saved work is above." : STOPPED_NOTICE, { canceled: true });
    // A bridge failure shows its own reason (and stderr): the generic notice hides what needs repair.
    const bridgeNotice = diagnostics.match(MCP_BRIDGE_FAILURE)?.[0];
    return finalize(run, bridgeNotice ?? EXHAUSTED_NOTICE, { detail: bridgeNotice ? undefined : lastDiagnosticLine({ diagnostics }) });
  }

  async function decide(run: DurableRun, trigger: RecoveryTrigger, liveRunId: string | undefined): Promise<Decision> {
    if (exclusion(run)) return { decision: await finalize(run, STOPPED_NOTICE, { canceled: true }) };
    const probe = await probeAttempt({ run, trigger, liveRunId });
    // HTTP/storage awaits can cross cancellation, settlement, or an attempt-generation change.
    // Re-read before attaching or applying diagnostics to the probed attempt.
    const current = await reload(run);
    if (typeof current === "string") return { probe, decision: current };
    if (probe === "live") return { probe, decision: await reattach(current) };
    if (probe === "uncertain") {
      // Transport uncertainty is not proof of death and spends no restart/time budget. The
      // existing watcher waits and probes again; even an expired budget cannot kill a live child.
      await reattach(current);
      return { probe, decision: "waiting" };
    }
    return decideDead(current, trigger);
  }

  async function decideDead(run: DurableRun, trigger: RecoveryTrigger): Promise<Decision> {
    const probe = "dead";
    // A pending human answer takes precedence over executor exit diagnostics.
    if (awaitingAnswer({ run })) return { probe, decision: await resolveMissing(run, trigger) };
    // Diagnostics decide only the fate of an attempt that is no longer running. Read before the
    // probe, raw stdout quoting a tool description ("OAuth-authenticated") canceled a live turn
    // as "Not logged in" (luvira, 2026-10-08).
    const diagnostics = attemptDiagnostics({ run });
    const failure = attemptFailure({ diagnostics });
    const decision = failure === "retryable" ? await resolveMissing(run, trigger) : await finalizeFailure({ run, failure, diagnostics });
    return { probe, failure, decision };
  }

  async function resolveMissing(run: DurableRun, trigger: RecoveryTrigger): Promise<RecoveryResult> {
    await ports.store.recoveryClock({ runId: run.runId, now: ports.now(), active: true }, {});
    const timed = await reload(run);
    return typeof timed === "string" ? timed : resolveDead(timed, trigger);
  }

  /** The saved row after an await, or the outcome that ends this decision. O(1) store reads. */
  async function reload(run: DurableRun): Promise<DurableRun | RecoveryResult> {
    const current = await ports.store.load({ messageId: run.messageId }, {});
    if (!current) return "gone";
    // A probe only speaks about the generation it inspected. Never apply its dead result to
    // a newer attempt committed by another caller while this one was awaiting storage/HTTP.
    if (current.runId !== run.runId) return "superseded";
    if (current.message.runStatus !== "queued" && current.message.runStatus !== "running") return "terminal";
    if (exclusion(current)) return finalize(current, STOPPED_NOTICE, { canceled: true });
    return current;
  }

  async function resolveDead(run: DurableRun, trigger: RecoveryTrigger): Promise<RecoveryResult> {
    // A dead process cannot resume its question. End this turn with the existing card intact,
    // rather than minting an attempt that runs preflight and asks the same question again.
    if (awaitingAnswer({ run })) return finalize(run, AWAITING_ANSWER_NOTICE);
    const notice = budgetNotice(run, ports.now());
    if (notice) return finalize(run, notice, { detail: notice === EXHAUSTED_NOTICE ? exhaustedDetail({ run }) : undefined });
    // A queued attempt may be between durable acceptance and the daemon's start transaction.
    // Give that idempotent launch time to appear before a 404 can advance its generation.
    if (continuesNow({ run, trigger, now: ports.now() })) return continueDead(run);
    ports.attach(run, {});
    return "waiting";
  }

  return {
    async recover({ messageId, trigger, expectedRunId }, options) {
      const run = await ports.store.load({ messageId }, {});
      if (!run) return "gone";
      if (run.message.runStatus !== "queued" && run.message.runStatus !== "running") return "terminal";
      if (expectedRunId && expectedRunId !== run.runId) return "superseded";
      const { decision, probe, failure } = await decide(run, trigger, options.liveRunId);
      // The watcher re-confirms its own live run every resolution window; log only real recovery
      // decisions. Metadata only: diagnostics, answers and cancel reasons can hold secrets.
      if (options.liveRunId !== run.runId) logger.info("[durable-recovery] " + JSON.stringify({ runId: run.runId, trigger, probe, decision, failureClass: failure }));
      return decision;
    },
  };
}

const REQUEST_STATUS_PATTERNS = [
  /\bhttp(?:[ /]?\d(?:\.\d)?)?[\s:=#-]*(4\d\d)\b/gi,
  /\b(?:status|error|response)(?:[ _-]?code)?[\s:=#-]*(4\d\d)\b/gi,
  /\bcode(?=\s*[:=#])[\s:=#-]*(4\d\d)\b/gi,
];
const HUMAN_REPAIR_PATTERNS = [
  /another answer in this chat is still running|invalid[_ -]?request|context[_ -](length|window)|maximum context/i,
  /model.*(?:not[_ -]found|does not exist|not supported)|unsupported|does not support|permission denied|forbidden/i,
  /insufficient[_ -]?(quota|balance|credit|funds)|credit balance is too low|exceeded your current quota|quota[_ -]?exceeded|usage limit|billing|payment required/i,
];
