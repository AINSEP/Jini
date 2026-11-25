import { createConsoleLogger, type Logger } from '@jini-ai/core/primitives';
import { recoveredRunEvents } from "../../core/index.js";
import { classifyAgentServiceFailure, startupFailureMessage } from "@jini-ai/agent-runtime";
import { continuationRequest } from "../../core/durable-runs/continuation.js";
import { isAwaitingAnswer } from "../../core/run-activity.js";
import type { DurableRecovery, DurableRun, RecoveryPorts, RecoveryResult, RecoveryTrigger, RunProbe } from "../../core/durable-runs/ports.js";

import { RECOVERY_LIMIT, RUN_STALENESS_MS, SAVED_WORK_NOTICE, AWAITING_ANSWER_NOTICE, EXHAUSTED_NOTICE } from "../../core/durable-runs/policies.js";
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";
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
  // Startup evidence is already bounded, but redact again for older saved events. Keep the
  // complete stage/cause block; a last-line/300-character tail erased its useful context.
  const startup = diagnostics.lastIndexOf('Startup stage:');
  if (startup >= 0) return startupFailureMessage({ stage: 'saved startup failure', error: diagnostics.slice(startup) }, {});
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

/** Terminal-failure notice for a dead attempt that must not be retried; pure, no effects. */
interface FailureNotice { readonly notice: string; readonly canceled: boolean; readonly detail?: string | undefined }

function isActive({ run }: { run: DurableRun }, _optional = {}): boolean {
  return run.message.runStatus === "queued" || run.message.runStatus === "running";
}

/** Pure eligibility: the outcome that ends a recovery before any probe, or null while the saved run is recoverable. */
function entryOutcome({ run, expectedRunId }: { run: DurableRun | null; expectedRunId: string | undefined }, _optional = {}): RecoveryResult | null {
  if (!run) return "gone";
  if (!isActive({ run })) return "terminal";
  if (expectedRunId && expectedRunId !== run.runId) return "superseded";
  return null;
}

/** Pure eligibility after an await: the outcome that ends this decision, or null while `current` is still the probed attempt. */
function reloadOutcome({ run, current }: { run: DurableRun; current: DurableRun | null }, _optional = {}): RecoveryResult | null {
  if (!current) return "gone";
  // A probe only speaks about the generation it inspected. Never apply its dead result to
  // a newer attempt committed by another caller while this one was awaiting storage/HTTP.
  if (current.runId !== run.runId) return "superseded";
  return isActive({ run: current }) ? null : "terminal";
}

function failureNotice({ failure, diagnostics }: { failure: "permanent" | "auth-failure" | "inactivity-watchdog"; diagnostics: string }, _optional = {}): FailureNotice {
  if (failure !== "permanent") return { notice: failure === "auth-failure" ? "Not logged in. Saved work is above." : STOPPED_NOTICE, canceled: true };
  // A bridge failure shows its own reason (and stderr): the generic notice hides what needs repair.
  const bridgeNotice = diagnostics.match(MCP_BRIDGE_FAILURE)?.[0];
  return { notice: bridgeNotice ?? EXHAUSTED_NOTICE, canceled: false, detail: bridgeNotice ? undefined : lastDiagnosticLine({ diagnostics }) };
}

/** Replay starts from attemptBase. Carry this attempt's saved launch notice into it too, so
 * reconnect/reload cannot replace that evidence with the daemon's shorter replay prefix.
 * Pure: O(e) in saved events; the run to attach, unchanged when no new notice must be carried. */
function attachTarget({ run }: { run: DurableRun }, _optional = {}): DurableRun {
  const events = run.message.events ?? [];
  const noticeIndex = lastIndexWhere({ events, match: event => event.kind === 'status' && event.code === 'run_launch_unconfirmed' });
  const marker = lastIndexWhere({ events, match: event => event.kind === 'status' && event.code === 'run_recovering' });
  if (noticeIndex <= marker) return run;
  const notice = events[noticeIndex]!;
  const base = [...run.attemptBase];
  if (!base.includes(notice)) base.push(notice);
  return { ...run, attemptBase: base };
}

function launchUnconfirmed({ stage, error }: { stage: string; error: unknown }, _optional = {}): AgentEvent {
  return { kind: 'status', code: 'run_launch_unconfirmed',
    label: 'The assistant start response was not confirmed. Checking whether this attempt is running.',
    detail: startupFailureMessage({ stage, error }, {
      notice: 'The assistant start response was not confirmed. Wait while this attempt is checked.',
    }) };
}

/** Attaches the watcher to `attachTarget`; no additional store read, write, or polling. */
function attach({ ports, run }: { ports: RecoveryPorts; run: DurableRun }, _optional = {}): void {
  ports.attach(attachTarget({ run }), {});
}

async function finalize({ ports, run, notice, canceled = false, detail }: { ports: RecoveryPorts; run: DurableRun; notice: string; canceled?: boolean; detail?: string | undefined }, _optional = {}): Promise<RecoveryResult> {
  await ports.cancelAttempt(run, {}).catch(() => undefined);
  // Persist the notice as an event: hook errors are live-only and would leave a reloaded
  // terminal message without its explanation. Only this coordinator decides exhaustion.
  const events: AgentEvent[] = [...(run.message.events ?? []), { kind: "status", label: notice, ...(detail ? { detail } : {}) }];
  await ports.settle({ ...run, content: run.message.content, events, status: canceled ? "canceled" : "failed", endedAt: ports.now() }, {});
  return "finalized";
}

async function nativeAllowed({ ports, run }: { ports: RecoveryPorts; run: DurableRun }, _optional = {}): Promise<boolean> {
  if (!run.sessionConfirmed || !run.sessionId || !run.child) return false;
  if (!ports.supportsNativeResume({ agentId: run.request.agentId ?? "claude" }, {})) return false;
  return ports.verifyChildDead(run.child, {}).catch(() => false);
}

/** Persist rejection evidence but leave liveness and retry decisions to the existing probe. */
async function launchNext({ ports, run, next, native }: { ports: RecoveryPorts; run: DurableRun; next: DurableRun; native: boolean }, _optional = {}): Promise<DurableRun> {
  let stage = 'recovery launch';
  try {
    await ports.launch({ run: next, request: continuationRequest({ run: { ...run, message: next.message, transcript: next.transcript }, native }, {}) }, {});
    stage = 'recovery clock';
    await ports.store.recoveryClock({ runId: next.runId, now: ports.now(), active: false }, {});
  } catch (error) {
    // A rejected/lost start response is uncertain: the daemon may already be executing. The
    // same idempotent attempt is probed by the attached watcher before another CAS is possible.
    const events = [...(next.message.events ?? []), launchUnconfirmed({ stage, error })];
    // Preserve the saved answer and all prior events in the existing projection write. The
    // checkpoint's generation fence rejects a concurrent stop or successor attempt.
    await ports.checkpoint?.({ conversationId: next.conversationId, messageId: next.messageId,
      runId: next.runId, content: next.message.content, events }, {}).catch(() => false);
    return { ...next, message: { ...next.message, events } };
  }
  return next;
}

async function continueDead({ ports, run }: { ports: RecoveryPorts; run: DurableRun }, _optional = {}): Promise<RecoveryResult> {
  await ports.cancelAttempt(run, {}).catch(() => undefined);
  // A locator captured before a hard cancel can outlive its rollout. Reuse reconstruction,
  // including prior turns/tool outcomes, instead of retrying a known missing native session.
  const missingResume = run.request.agentId === 'codex' && /no rollout found for thread id/.test(attemptDiagnostics({ run }, {}));
  const native = !missingResume && await nativeAllowed({ ports, run });
  const nextRunId = ports.mintRunId();
  const events = recoveredRunEvents({ saved: savedWork({ run }) }, { notice: missingResume ? 'silent' : 'visible' });
  if (!await ports.store.advance({ run, nextRunId, now: ports.now(), events }, {})) return "superseded";
  const next = await ports.store.load({ messageId: run.messageId }, { includeTranscriptEvents: false });
  // Cancel/deletion can win while the old attempt is being fenced. Re-read after CAS and do
  // not launch against a removed binding or a newer generation.
  if (!next || next.runId !== nextRunId) return "superseded";
  if (next.cancelReason) return finalize({ ports, run: next, notice: STOPPED_NOTICE, canceled: true });
  const launched = await launchNext({ ports, run, next, native });
  attach({ ports, run: launched });
  return "continued";
}

async function probeAttempt({ ports, run, trigger, liveRunId }: { ports: RecoveryPorts; run: DurableRun; trigger: RecoveryTrigger; liveRunId: string | undefined }, _optional = {}): Promise<RunProbe> {
  // A terminal executor end confirms this attempt is dead even when the daemon retains its
  // replayable record (HTTP 200). Other triggers must obtain fresh liveness evidence.
  if (trigger === "attempt-failed") return "dead";
  return liveRunId === run.runId ? "live" : ports.probe(run, {});
}

async function reattach({ ports, run }: { ports: RecoveryPorts; run: DurableRun }, _optional = {}): Promise<RecoveryResult> {
  await ports.store.recoveryClock({ runId: run.runId, now: ports.now(), active: false }, {});
  attach({ ports, run });
  return "reattached";
}

async function finalizeFailure({ ports, run, failure, diagnostics }: { ports: RecoveryPorts; run: DurableRun; failure: "permanent" | "auth-failure" | "inactivity-watchdog"; diagnostics: string }, _optional = {}): Promise<RecoveryResult> {
  return finalize({ ports, run, ...failureNotice({ failure, diagnostics }) });
}

/** The saved row after an await, or the outcome that ends this decision. O(1) store reads. */
async function reload({ ports, run }: { ports: RecoveryPorts; run: DurableRun }, _optional = {}): Promise<DurableRun | RecoveryResult> {
  const current = await ports.store.load({ messageId: run.messageId }, { includeTranscriptEvents: false });
  const ended = reloadOutcome({ run, current });
  if (ended) return ended;
  if (exclusion(current!)) return finalize({ ports, run: current!, notice: STOPPED_NOTICE, canceled: true });
  return current!;
}

async function resolveDead({ ports, run, trigger }: { ports: RecoveryPorts; run: DurableRun; trigger: RecoveryTrigger }, _optional = {}): Promise<RecoveryResult> {
  // A dead process cannot resume its question. End this turn with the existing card intact,
  // rather than minting an attempt that runs preflight and asks the same question again.
  if (awaitingAnswer({ run })) return finalize({ ports, run, notice: AWAITING_ANSWER_NOTICE });
  const notice = budgetNotice(run, ports.now());
  if (notice) return finalize({ ports, run, notice, detail: notice === EXHAUSTED_NOTICE ? exhaustedDetail({ run }) : undefined });
  // A queued attempt may be between durable acceptance and the daemon's start transaction.
  // Give that idempotent launch time to appear before a 404 can advance its generation.
  if (continuesNow({ run, trigger, now: ports.now() })) return continueDead({ ports, run });
  attach({ ports, run });
  return "waiting";
}

async function resolveMissing({ ports, run, trigger }: { ports: RecoveryPorts; run: DurableRun; trigger: RecoveryTrigger }, _optional = {}): Promise<RecoveryResult> {
  await ports.store.recoveryClock({ runId: run.runId, now: ports.now(), active: true }, {});
  const timed = await reload({ ports, run });
  return typeof timed === "string" ? timed : resolveDead({ ports, run: timed, trigger });
}

async function decideDead({ ports, run, trigger }: { ports: RecoveryPorts; run: DurableRun; trigger: RecoveryTrigger }, _optional = {}): Promise<Decision> {
  const probe = "dead";
  // A pending human answer takes precedence over executor exit diagnostics.
  if (awaitingAnswer({ run })) return { probe, decision: await resolveMissing({ ports, run, trigger }) };
  // Diagnostics decide only the fate of an attempt that is no longer running. Read before the
  // probe, raw stdout quoting a tool description ("OAuth-authenticated") canceled a live turn
  // as "Not logged in" (luvira, 2026-10-08).
  const diagnostics = attemptDiagnostics({ run });
  const failure = attemptFailure({ diagnostics });
  const decision = failure === "retryable" ? await resolveMissing({ ports, run, trigger }) : await finalizeFailure({ ports, run, failure, diagnostics });
  return { probe, failure, decision };
}

async function decide({ ports, run, trigger, liveRunId }: { ports: RecoveryPorts; run: DurableRun; trigger: RecoveryTrigger; liveRunId: string | undefined }, _optional = {}): Promise<Decision> {
  if (exclusion(run)) return { decision: await finalize({ ports, run, notice: STOPPED_NOTICE, canceled: true }) };
  const probe = await probeAttempt({ ports, run, trigger, liveRunId });
  // HTTP/storage awaits can cross cancellation, settlement, or an attempt-generation change.
  // Re-read before attaching or applying diagnostics to the probed attempt.
  const current = await reload({ ports, run });
  if (typeof current === "string") return { probe, decision: current };
  if (probe === "live") return { probe, decision: await reattach({ ports, run: current }) };
  if (probe === "uncertain") {
    // Transport uncertainty is not proof of death and spends no restart/time budget. The
    // existing watcher waits and probes again; even an expired budget cannot kill a live child.
    await reattach({ ports, run: current });
    return { probe, decision: "waiting" };
  }
  return decideDead({ ports, run: current, trigger });
}

/** Recovery coordinator behind explicit host ports. One CAS owns both the attempt and its conversation slot.
 * Each recovery decision reports run metadata through the host port or the safe default logger. */
export function createDurableRecovery(ports: RecoveryPorts, { report = createConsoleLogger({ prefix: '' }) }: { report?: Pick<Logger, "info"> } = {}): DurableRecovery {
  return {
    async recover({ messageId, trigger, expectedRunId }, options) {
      const run = await ports.store.load({ messageId }, { includeTranscriptEvents: false });
      const ended = entryOutcome({ run, expectedRunId });
      if (ended) return ended;
      const { decision, probe, failure } = await decide({ ports, run: run!, trigger, liveRunId: options.liveRunId });
      // The watcher re-confirms its own live run every resolution window; log only real recovery
      // decisions. Metadata only: diagnostics, answers and cancel reasons can hold secrets.
      if (options.liveRunId !== run!.runId) report.info({ message: "[durable-recovery] Recovery decision." }, { meta: { runId: run!.runId, trigger, probe, decision, failureClass: failure } });
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
