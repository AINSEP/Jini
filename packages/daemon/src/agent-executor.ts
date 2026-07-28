/**
 * `AgentExecutor` — the driver `RunLifecycle`'s own module doc names as the
 * missing piece: *"It does not spawn or signal a subprocess... A driver...
 * calls `emit()` for agent/stdout/stderr/error events, observes cancellation
 * via `onCancelRequested`, and calls `finish()` once it knows the real
 * outcome."* This module is that driver — it wires `@injini/agent-runtime`'s
 * registry/launch-resolution/stream-parsers (previously a complete but
 * disconnected library, zero callers anywhere outside its own package) into
 * a real `node:child_process` spawn, feeding both `RunLifecycle.emit()` and
 * this package's own `@injini/protocol` event envelope.
 *
 * ## v1 scope: 23 of 24 registered agent defs
 *
 * `@injini/agent-runtime`'s registry ships 24 built-in defs across four
 * `streamFormat` families. The JSON-stream-parser family — the four
 * `createXStreamHandler`-shaped parsers (`claude-stream-json`,
 * `json-event-stream`, `copilot-stream-json`, `qoder-stream-json`), covering
 * 9 defs (amp, codebuddy, claude, codex, cursor-agent, opencode, mimo,
 * copilot, qoder) — plus all 9 `acp-json-rpc` defs, plus the one `pi-rpc`
 * def (`pi`), are wired here. ACP and pi-rpc each own their own JSON-RPC
 * prompt-delivery protocol, so each takes its own lifecycle branch rather
 * than being treated as a stdout-tail parser; pi-rpc's events arrive through
 * the exact same `{type, ...}` vocabulary `translateAgentRuntimeEvent`
 * already handles for ACP/JSON-stream (confirmed by reading every
 * `mapPiRpcEvent` `send()` call site — no new translation code was needed),
 * so only the driver wiring (spawn → attach → cancel → finish) was new for it.
 *
 * 4 of the 5 `streamFormat: 'plain'` defs — grok-build, aider, deepseek,
 * qwen — are also driven, per
 * `ADS-memory/reports/proposals/PROP-plain-format-agent-driving-2026-07-21.md`'s
 * recommended "Option B": no structured stream parser at all. Every raw
 * `child.stdout` chunk is forwarded verbatim as a `text_delta` `'agent'`
 * event, live, as it arrives — never buffered until close (see
 * `wireChildLifecycle`'s `streamFormat === 'plain'` branch). Prompt delivery
 * across the 4 is not uniform: qwen already fit the pre-existing stdin-only
 * guard; grok-build stages the prompt to a temp file via
 * `preparePromptFileForAgent` (its path threaded into `buildArgs` through a
 * `RuntimeContext`, cleaned up after the child exits on every path,
 * including pre-spawn/spawn-failure ones); aider/deepseek carry the prompt
 * on argv and are guarded pre-spawn by `checkPromptArgvBudget` plus the two
 * Windows CreateProcess command-line-expansion guards
 * (`checkWindowsCmdShimCommandLineBudget`/`checkWindowsDirectExeCommandLineBudget`).
 *
 * The 5th plain def, **antigravity, is deliberately still rejected.** It
 * needs two concerns unrelated to `streamFormat: 'plain'` itself — buffering
 * stdout until close so a leaked OAuth URL can be suppressed before it
 * reaches the client, and a cross-run lock serializing writes to its shared
 * `settings.json` model-selection file — that the proposal doc explicitly
 * scoped out to its own follow-up (see that doc's §2c/§3). `run()` guards it
 * with its own `def.id === 'antigravity'` check, ahead of (and independent
 * of) the generic plain-format prompt-delivery/dispatch logic. `run()`
 * rejects cleanly (never a bare throw) with an `AgentExecutorError` for any
 * def outside the supported 23 — see `isSupportedStreamFormat`.
 *
 * ## Invariant
 *
 * `RunLifecycle.start()` already transitions a run to `'running'` before
 * `run()` is ever called. Every *pre-spawn* failure path in `run()` — unknown
 * `agentId`, an unsupported `streamFormat`/prompt-delivery shape, an
 * unresolvable binary, or a spawn error — calls `lifecycle.finish({status:
 * 'failed', resumable: false, code: null, signal: null})` itself before
 * rejecting, so a run can never get stuck `'running'` with no watchdog.
 * `resumable` is unconditionally `false` on these paths — there is no spawned
 * child, hence nothing a classifier could examine (see
 * `FailureClassificationContext`'s own doc).
 *
 * For a run that *did* spawn and then failed, `resumable` is decided by
 * `classifyFailure` (gap 4 — see `ClassifyFailure`'s own doc), an injectable
 * port with no default of its own in this module (`undefined` stays
 * byte-identical to pre-gap-4 behavior — every `'failed'` outcome
 * resumable:false). OD's ~20-vendor-CLI text-matching failure classifier was
 * deliberately never ported (see `run/core/failure-taxonomy.ts`'s own doc and
 * `source-map.md`). The real zero-config classifier lives in `@injini/daemon`'s
 * `run/core/retry.ts` (`resumableFromProcessExit`/`classifyProcessExitFailure`)
 * and is wired in by `@injini/node-host`'s `createLocalNodeDaemon` — see that
 * package's own source-map.md, and `run/core/retry.ts`'s own doc for the
 * classification policy and its 2026-07-22 merge-time reconciliation against
 * a second, independently-built (and rejected) classifier that once lived in
 * this module.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import { redactSecrets } from '@injini/core';
import type { Principal, RunRef } from '@injini/core';
import type { JournalEntry, RunAgentPayload, RunErrorPayload } from '@injini/protocol';
import {
  applyAgentLaunchEnv,
  createClaudeStreamHandler,
  createCopilotStreamHandler,
  createJsonEventStreamHandler,
  createQoderStreamHandler,
  getAgentDef,
  resolveAgentLaunch,
  attachAcpSession,
  attachPiRpcSession,
  checkPromptArgvBudget,
  checkWindowsCmdShimCommandLineBudget,
  checkWindowsDirectExeCommandLineBudget,
  preparePromptFileForAgent,
  type AcpPermissionHandler,
  type AcpSessionController,
  type AgentLaunchResolution,
  type PiRpcSession,
  type PreparedPromptFile,
  type RuntimeAgentDef,
  type RuntimeContext,
} from '@injini/agent-runtime';
import {
  collectProcessTreePids,
  createCommandInvocation,
  listProcessSnapshots,
  stopProcesses,
  type ProcessSnapshot,
  type StopProcessesResult,
} from '@injini/platform';
import { classifyRunCloseStatus } from './close-status.js';
import { resolveContinuationTransport } from './continuation/continuation-transport.js';
import type { RunByteJournal } from './continuation/journal.js';
import { resultContent } from './delegated-tool-bridge.js';
import type { RunRetrySideEffectState } from './run/core/index.js';
import type { ToolExecutor } from './tool-executor.js';
import type { RunLifecycle } from './run-lifecycle.js';

/**
 * A parsed, loosely-typed event as produced by one of `@injini/agent-runtime`'s
 * four stream-parser factories — each parser's `onEvent` callback receives
 * `Record<string, unknown>` with a `type` discriminant, not a typed union.
 */
type StreamHandler = { feed(chunk: string): void; flush(): void };

const SUPPORTED_STREAM_FORMATS = [
  'claude-stream-json',
  'json-event-stream',
  'copilot-stream-json',
  'qoder-stream-json',
  'acp-json-rpc',
  'pi-rpc',
  'plain',
] as const;

/** The families of the registry's stream-format this driver implements — see module doc. */
export type SupportedStreamFormat = (typeof SUPPORTED_STREAM_FORMATS)[number];

type JsonStreamFormat = Exclude<SupportedStreamFormat, 'acp-json-rpc' | 'pi-rpc' | 'plain'>;

/**
 * `streamFormat` values `wireChildLifecycle` drives directly off raw
 * `child.stdout` `'data'` events: the 4 JSON-stream-parser formats (fed
 * through a real `feed()`/`flush()` state machine via
 * {@link createStreamHandlerForDef}) plus `'plain'` (no parser at all —
 * each chunk is forwarded verbatim as a `text_delta`, see that function's
 * doc). Distinct from `'acp-json-rpc'`/`'pi-rpc'`, which own their own
 * JSON-RPC prompt/event protocol and get their own
 * `wireAcpLifecycle`/`wirePiRpcLifecycle` wiring instead.
 */
type ChildDrivenStreamFormat = JsonStreamFormat | 'plain';

/**
 * Narrows a `RuntimeAgentDef.streamFormat` string to the supported
 * families.
 * @param value - The def's raw `streamFormat` string.
 * @returns `true` when `value` is one of the JSON-stream-parser, ACP, pi-rpc, or plain formats this driver wires.
 * @complexity O(1) — fixed membership check.
 * @overallScore 100/100
 */
export function isSupportedStreamFormat(value: string): value is SupportedStreamFormat {
  return (SUPPORTED_STREAM_FORMATS as readonly string[]).includes(value);
}

/**
 * Selects and constructs the real stream-parser handler for a supported
 * `streamFormat`. `json-event-stream` additionally dispatches on
 * `def.eventParser` (the parser's own internal `kind` switch — e.g.
 * `'codex'`, `'cursor-agent'`, `'opencode'`; `mimo` shares `'opencode'`'s
 * `kind`); an unrecognized/absent `eventParser` degrades to that parser's
 * own `{type:'raw', line}` fallback rather than throwing, matching the
 * parser's own documented behavior. Never called for `streamFormat:
 * 'plain'` — `wireChildLifecycle` handles that format inline with no
 * parser at all (see `ChildDrivenStreamFormat`'s doc).
 * @param def - The resolved agent def (only `.eventParser` is read beyond `streamFormat`).
 * @param streamFormat - `def.streamFormat`, already narrowed by {@link isSupportedStreamFormat}.
 * @param onEvent - Sink the parser calls once per parsed (or malformed-raw) event.
 * @returns A `{feed, flush}` handle for the chosen parser.
 * @complexity O(1) dispatch; the returned handler's own per-chunk cost is the parser's.
 * @overallScore 100/100
 */
function createStreamHandlerForDef(
  def: RuntimeAgentDef,
  streamFormat: JsonStreamFormat,
  onEvent: (event: Record<string, unknown>) => void,
): StreamHandler {
  switch (streamFormat) {
    case 'claude-stream-json':
      return createClaudeStreamHandler(onEvent);
    case 'copilot-stream-json':
      return createCopilotStreamHandler(onEvent);
    case 'qoder-stream-json':
      return createQoderStreamHandler(onEvent);
    case 'json-event-stream':
      return createJsonEventStreamHandler(def.eventParser ?? '', onEvent);
  }
}

/**
 * Result of translating one parsed stream event into this engine's
 * vocabulary. `'agent'` is the common case (forward as a `RunAgentPayload`
 * via the `'agent'` run event); `'error'` and `'turn-end'` are the two
 * type values `run()` handles specially rather than passing through (see
 * module doc); `'ignored'` covers anything the 4 parsers never actually
 * produce plus defensively malformed/non-record input.
 *
 * `'agent'`'s optional `sessionId` (gap 5, session resume — see
 * `RunEndPayload.sessionRef`'s doc in `@injini/protocol`) is a daemon-internal
 * side channel, not part of the `RunAgentPayload` wire payload itself:
 * OpenCode's `sessionID`/Codex's `thread_id`/Qoder's and Claude's
 * `session_id` all arrive on a `'status'` event alongside fields
 * `RunAgentPayload`'s `'status'` variant already models (`label`/`model`/
 * `ttftMs`/`detail`) but has no room for a session id itself — surfacing it
 * here lets a lifecycle-wiring function capture it into a local variable and
 * thread it into its own terminal `finish()` call, without widening the
 * public wire protocol just to carry a value that only this module reads.
 *
 * `'turn-end'`'s optional `stopReason` (gap 3, capability-routed
 * continuation transport) is the same kind of internal side channel: the
 * claude-stream parser deliberately emits `stopReason` *after* every
 * `tool_use` block in the same assistant message has already been
 * translated (so a caller can decide whether to keep stdin open before
 * closing it), but v1 (pre-gap-3) discarded it and closed stdin
 * unconditionally on any `turn-end` — see `packages/daemon/source-map.md`'s
 * "Design decision 2" note. `wireChildLifecycle` now reads it to decide
 * whether `stop_reason: 'tool_use'` means "inject a tool result and keep
 * going" (gap 3, gated — see `ContinuationOptions`) or "close stdin as
 * before" (the unconditional default when no continuation is configured).
 */
export type AgentRuntimeEventTranslation =
  | { readonly kind: 'agent'; readonly payload: RunAgentPayload; readonly sessionId?: string }
  | { readonly kind: 'error'; readonly payload: RunErrorPayload }
  | { readonly kind: 'turn-end'; readonly stopReason?: string }
  | { readonly kind: 'ignored' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * Narrows one parsed `usage` event's loosely-typed fields into
 * `RunAgentPayload`'s `usage` variant. The 4 source parsers attach extra
 * fields this narrow payload has no room for — `thought_tokens`,
 * `cached_read_tokens`/`cached_write_tokens` (opencode/gemini/codex),
 * `modelUsage`/`stopReason`/`isError` (qoder), a top-level `stopReason`
 * (claude/copilot) — all intentionally dropped here, not carried through.
 * @param rawEvent - The raw `{type:'usage', ...}` record from a stream parser.
 * @returns The narrowed `RunAgentPayload` `usage` variant.
 * @complexity O(1).
 * @overallScore 100/100
 */
function translateUsagePayload(rawEvent: Record<string, unknown>): RunAgentPayload {
  const rawUsage = isRecord(rawEvent.usage) ? rawEvent.usage : undefined;
  const inputTokens = rawUsage ? asOptionalNumber(rawUsage.input_tokens) : undefined;
  const outputTokens = rawUsage ? asOptionalNumber(rawUsage.output_tokens) : undefined;
  const usage =
    inputTokens !== undefined || outputTokens !== undefined
      ? {
          ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
          ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
        }
      : undefined;
  const costUsd = asOptionalNumber(rawEvent.costUsd);
  const durationMs = asOptionalNumber(rawEvent.durationMs);
  return {
    type: 'usage',
    ...(usage !== undefined ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

/**
 * Narrows one parser-emitted `{type, ...}` record into this engine's
 * `RunAgentPayload` union (or the `error`/`turn-end`/`ignored` routing
 * `run()` special-cases). Pure — no I/O, no closure state — so every
 * variant each of the 4 supported parsers can produce is directly
 * assertable in isolation.
 *
 * Defensive by construction: several real parser emissions carry fields
 * looser than `RunAgentPayload`'s types promise (e.g. copilot's
 * `tool.execution_start` emits `id: data.toolCallId ?? null` — a literal
 * `null`, not the `string` `RunAgentPayload['tool_use']['id']` demands).
 * Every field read here is defensively coerced (`asString`/
 * `asOptionalString`/`asOptionalNumber`) rather than trusted, so a
 * malformed or null field degrades to a safe default instead of
 * propagating `null`/`undefined` into a field typed as required, or
 * throwing.
 *
 * @param rawEvent - One event as delivered to a stream parser's `onEvent` callback.
 * @returns The routing + payload this event maps to.
 * @complexity O(1) — one discriminant switch, no iteration.
 * @overallScore 100/100
 */
export function translateAgentRuntimeEvent(rawEvent: unknown): AgentRuntimeEventTranslation {
  if (!isRecord(rawEvent) || typeof rawEvent.type !== 'string') {
    return { kind: 'ignored' };
  }

  switch (rawEvent.type) {
    case 'status': {
      const model = asOptionalString(rawEvent.model);
      const ttftMs = asOptionalNumber(rawEvent.ttftMs);
      const detail = asOptionalString(rawEvent.detail);
      const sessionId = asOptionalString(rawEvent.sessionId);
      return {
        kind: 'agent',
        payload: {
          type: 'status',
          label: asString(rawEvent.label, 'unknown'),
          ...(model !== undefined ? { model } : {}),
          ...(ttftMs !== undefined ? { ttftMs } : {}),
          ...(detail !== undefined ? { detail } : {}),
        },
        ...(sessionId !== undefined ? { sessionId } : {}),
      };
    }
    case 'text_delta':
      return { kind: 'agent', payload: { type: 'text_delta', delta: asString(rawEvent.delta) } };
    case 'thinking_start':
      return { kind: 'agent', payload: { type: 'thinking_start' } };
    case 'thinking_delta':
      return { kind: 'agent', payload: { type: 'thinking_delta', delta: asString(rawEvent.delta) } };
    case 'tool_use':
      return {
        kind: 'agent',
        payload: {
          type: 'tool_use',
          id: asString(rawEvent.id),
          name: asString(rawEvent.name),
          input: rawEvent.input ?? null,
        },
      };
    case 'tool_input_delta':
      return {
        kind: 'agent',
        payload: {
          type: 'tool_input_delta',
          id: asString(rawEvent.id),
          name: asString(rawEvent.name),
          delta: asString(rawEvent.delta),
        },
      };
    case 'tool_result': {
      const isError = typeof rawEvent.isError === 'boolean' ? rawEvent.isError : undefined;
      return {
        kind: 'agent',
        payload: {
          type: 'tool_result',
          toolUseId: asString(rawEvent.toolUseId),
          content: asString(rawEvent.content),
          ...(isError !== undefined ? { isError } : {}),
        },
      };
    }
    case 'usage':
      return { kind: 'agent', payload: translateUsagePayload(rawEvent) };
    case 'raw':
      return { kind: 'agent', payload: { type: 'raw', line: asString(rawEvent.line) } };
    case 'error': {
      const code = asOptionalString(rawEvent.code);
      const message = asString(rawEvent.message, 'Unknown agent error');
      return {
        kind: 'error',
        payload: { message, ...(code !== undefined ? { error: { code, message } } : {}) },
      };
    }
    case 'turn_end': {
      // Claude-specific per-turn boundary. Not forwarded as an 'agent'
      // event (no RunAgentPayload variant represents it) — run() reacts to
      // it directly to close stdin (or, for gap 3, decide whether to inject
      // a tool result and keep it open instead). See module doc.
      const stopReason = asOptionalString(rawEvent.stopReason);
      return { kind: 'turn-end', ...(stopReason !== undefined ? { stopReason } : {}) };
    }
    default:
      return { kind: 'ignored' };
  }
}

/** Machine-readable failure reasons `run()` can reject with — every one is preceded by a `lifecycle.finish({status:'failed'})` call (see module doc's Invariant section). */
export type AgentExecutorErrorCode =
  | 'AGENT_NOT_FOUND'
  | 'AGENT_RUNTIME_UNSUPPORTED'
  | 'AGENT_BINARY_NOT_RESOLVED'
  | 'AGENT_SPAWN_FAILED'
  | 'AGENT_PROMPT_TOO_LARGE';

/** Thrown by `AgentExecutor.run()` on every failure path — never a bare `Error`, so callers can branch on `.code` instead of parsing `.message`. */
export class AgentExecutorError extends Error {
  readonly code: AgentExecutorErrorCode;

  constructor(code: AgentExecutorErrorCode, message: string) {
    super(message);
    this.name = 'AgentExecutorError';
    this.code = code;
  }
}

export interface AgentExecutorRunInput {
  readonly runId: string;
  readonly agentId: string;
  readonly prompt: string;
  readonly cwd: string;
  /** Optional host-selected model id, forwarded to every runtime transport. */
  readonly model?: string;
  /** Optional host-selected reasoning effort, forwarded to runtime argv builders. */
  readonly reasoning?: string;
  /** Host-validated image files forwarded through argv, ACP, or pi-rpc. */
  readonly imagePaths?: readonly string[];
  /** Additional host-validated directories the runtime may read. */
  readonly extraAllowedDirs?: readonly string[];
  /** Trusted root that must contain pi-rpc image paths after realpath resolution. */
  readonly uploadRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface AgentExecutor {
  /**
   * Spawns `agentId`'s CLI for `runId`, wires its stdout/stderr into
   * `lifecycle.emit()`, and resolves once the child process is confirmed
   * spawned (fire-and-forget from there — see module doc). Callers await
   * `lifecycle.waitForTerminal(runId)` separately for completion.
   * @throws {@link AgentExecutorError} on every failure path — the
   * underlying run is always already transitioned to `'failed'` via
   * `lifecycle.finish()` before this rejects (see module doc's Invariant).
   */
  run(input: AgentExecutorRunInput): Promise<void>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Drops `undefined` values so `NodeJS.ProcessEnv` (whose values are
 * `string | undefined`) can feed `resolveAgentLaunch`'s
 * `Record<string, string>` parameter.
 * @param env - The source environment (typically `input.env ?? process.env`).
 * @returns A new object containing only the string-valued entries.
 * @complexity O(n) in the number of env entries.
 * @overallScore 100/100
 */
function toStringEnvRecord(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

/**
 * Resolves once `child` emits `'spawn'`, or rejects on `'error'`. Replicates
 * `@injini/platform`'s own internal (non-exported) `waitForChildSpawn` race
 * idiom inline — see that module's `spawnLoggedProcess`/`spawnBackgroundProcess`.
 * @param child - The just-spawned `ChildProcess` to race.
 * @returns A promise settling on the first of `'spawn'`/`'error'` to fire.
 * @complexity O(1) — two one-time listener registrations.
 * @overallScore 100/100
 */
function waitForSpawnOrError(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', resolve);
  });
}

interface TerminateChildTreeDeps {
  readonly listProcessSnapshots: () => Promise<ProcessSnapshot[]>;
  readonly collectProcessTreePids: typeof collectProcessTreePids;
  readonly stopProcesses: (pids: Array<number | null | undefined>) => Promise<StopProcessesResult>;
}

/**
 * Enumerates `child`'s full descendant process tree and stops it (SIGTERM →
 * SIGKILL escalation, via the injected `stopProcesses` port).
 * @param deps - The process-snapshot/tree-collection/stop ports (real `@injini/platform` implementations by default — see {@link CreateAgentExecutorOptions}).
 * @param child - The child whose descendant tree should be terminated.
 * @returns Resolves once escalation completes (or immediately, as a no-op, if `child.pid` was never assigned — spawn never actually started).
 * @complexity O(p) in the number of live OS processes (`listProcessSnapshots`'s own cost) plus O(1) escalation rounds.
 * @overallScore 100/100
 */
async function terminateChildTree(deps: TerminateChildTreeDeps, child: ChildProcess): Promise<void> {
  if (child.pid == null) return;
  const processes = await deps.listProcessSnapshots();
  const pids = deps.collectProcessTreePids(processes, [child.pid]);
  await deps.stopProcesses(pids);
}

/** Which caller invoked {@link terminateChildTreeBestEffort} — carried through to `onCleanupFailure` (SEC-007) for diagnosis. */
export type AgentCleanupFailurePhase = 'cancel' | 'acp-attach-failure' | 'pi-rpc-attach-failure';

export interface AgentCleanupFailureContext {
  readonly runId: string;
  readonly phase: AgentCleanupFailurePhase;
  readonly pid: number;
  readonly error: unknown;
}

/** Default sink when a host does not supply `onCleanupFailure`: still observable, never silent. Redacted per SEC-007 (a spawn/permission error can embed paths/host detail). */
function defaultCleanupFailureSink(context: AgentCleanupFailureContext): void {
  // eslint-disable-next-line no-console
  console.error(
    `[@injini/daemon] agent-executor: process-tree cleanup failed for run "${context.runId}" (${context.phase}, pid=${context.pid})`,
    redactSecrets(errorMessage(context.error)),
  );
}

/**
 * Fire-and-forget-safe wrapper around {@link terminateChildTree} for the cancellation paths
 * (a synchronous `onCancelRequested` listener, an ACP attach-failure catch) that observed this
 * promise with a bare `void` — silently swallowing any `listProcessSnapshots`/`stopProcesses`
 * rejection (e.g. EPERM — see `packages/platform/src/__tests__/process.test.ts`) and letting it
 * become an unhandled rejection, with descendants possibly still running and no diagnostic at
 * all (SEC-007). This never rejects: a tree-stop failure is reported through `onCleanupFailure`
 * (redacted) and followed by a best-effort direct kill of `child` itself, since the immediate
 * child is still worth trying even when tree enumeration/escalation failed.
 */
function terminateChildTreeBestEffort(
  deps: TerminateChildTreeDeps,
  child: ChildProcess,
  runId: string,
  phase: AgentCleanupFailurePhase,
  onCleanupFailure: (context: AgentCleanupFailureContext) => void,
): Promise<void> {
  return terminateChildTree(deps, child).catch((error: unknown) => {
    // `terminateChildTree` only reaches a rejecting call (rather than its own early return) once
    // its own `child.pid == null` guard has already passed, and a real ChildProcess's `pid` is
    // never unset after being assigned — so `child.pid` is provably a number here. The non-null
    // assertion documents that invariant instead of a `?? null` fallback that could never
    // actually be exercised (same pattern as `pi-rpc/session.ts`'s `resolveSessionPathChangedSince`).
    onCleanupFailure({ runId, phase, pid: child.pid!, error });
    try {
      if (child.pid != null && !child.killed) child.kill('SIGKILL');
    } catch {
      // Best-effort only — nothing further can be done from here.
    }
  });
}

/** A small handle `writePromptToStdin` uses to close stdin exactly once, shared with the `turn_end`-triggered close inside {@link wireChildLifecycle}. */
interface StdinCloseHandle {
  closeStdinOnce(): void;
  /** Journals a sent-to-stdin byte chunk, queued through the same FIFO {@link wireChildLifecycle} already uses for emitted events. No-op when no journal was configured (see `CreateAgentExecutorOptions.journal`). */
  recordSentBytes(content: string): void;
}

/**
 * Gap 1's byte-journal record for bytes the host sent to the child's stdin — always `trust:
 * 'trusted'`, since these are bytes this driver itself composed and wrote, not agent output. See
 * `packages/daemon/src/continuation/journal.ts`'s module doc.
 */
function sentJournalEntry(content: string): JournalEntry {
  return { content, provenance: { source: 'host', channel: 'stdin' }, trust: 'trusted' };
}

/**
 * Gap 1's byte-journal record for bytes a child agent process produced on `channel` — always
 * `trust: 'untrusted'`, since this is attacker-influenceable agent output the kernel does not
 * control (see `@injini/protocol`'s `JournalEntry` doc on why `trust` exists).
 */
function receivedJournalEntry(channel: 'stdout' | 'stderr', content: string): JournalEntry {
  return { content, provenance: { source: 'agent', channel }, trust: 'untrusted' };
}

/**
 * Gap 3 (capability-routed continuation transport) — host-owned config for the
 * `'stdin-injection'` transport (claude/codebuddy only; see
 * `resolveContinuationTransport`'s doc). **Absent by default, and absent means
 * zero behavior change**: with no `ContinuationOptions`, every `turn_end`
 * closes stdin exactly as it always has (v1 behavior, unconditionally).
 *
 * `autonomousToolNames` is this task's answer to the debate's Unresolved
 * Delta (how does the loop distinguish "the agent is continuing
 * autonomously" from "the agent is waiting on a human"): rather than
 * inferring intent from the stream, the *host* pre-declares which tool
 * names are safe to auto-resolve and re-inject without a human in the loop.
 * A `tool_use` whose name is not in this set is left exactly as it was
 * before gap 3 — stdin closes, the run proceeds to its normal terminal
 * state — even though a `stopReason: 'tool_use'` was observed. This sidesteps
 * building unproven intent-detection: nothing auto-continues unless a host
 * has explicitly vetted that specific tool as autonomous-safe. A
 * human-facing "ask the user a question" tool is simply never added to this
 * set; `packages/chat-core/src/question-form.ts`'s existing text-tag
 * mechanism (a new `Run` per turn, not mid-turn injection) already covers
 * that case without needing this transport at all.
 */
export interface ContinuationOptions {
  /** Injected tool results are authorized through this — the same deny-by-default gate every other tool execution path in this codebase uses. No parallel authorization path. */
  readonly toolExecutor: ToolExecutor;
  /** The principal an injected tool call is authorized as. */
  readonly principal: Principal;
  /** Tool names this host has pre-classified as safe to auto-resolve without human involvement. See this interface's own doc for why this — not stream-inferred intent — is gap 3's answer to the human-in-the-loop pause question. */
  readonly autonomousToolNames: ReadonlySet<string>;
}

/**
 * Gap 3, part 2 (MCP-callback continuation transport — the spawn-time half the spike's own
 * commit message named as undone: "Item 4 ... NOT done yet"). `resolveContinuationTransport`
 * already resolves `'mcp-callback'` for every def with `externalMcpInjection !== undefined`, but
 * nothing in this file ever *acted* on that resolution — `execute_delegated_tool`
 * (`@injini/mcp`'s `../server/tools/delegated-tool.ts`) only does anything useful once the spawned
 * CLI's own client actually launches `jini-mcp` as its MCP server subprocess, and the only
 * `externalMcpInjection` strategy that mechanism is wired for here is `'claude-mcp-json'`
 * (`claude`/`codebuddy` — see `@injini/agent-runtime`'s `types.ts` doc on the other three
 * strategies: `'acp-merge'` delivers `mcpServers` through the ACP `session/new` params
 * `wireAcpLifecycle`/`attachAcpSession` already carry, and `'opencode-env-content'`/
 * `'mimo-env-content'` deliver through spawn-env content, neither of which needs or wants a
 * written file — a future task wiring those two would extend `wireAcpLifecycle`'s existing
 * `envFormat`/`mcpServers` passthrough or `applyAgentLaunchEnv`'s env composition respectively,
 * not this function).
 *
 * **Host-resolved, not this package's to know.** `command`/`daemonUrl` have no default the way
 * `journal`/`continuation`/`classifyFailure` don't either — there is no "real" install layout or
 * loopback URL this package could assume on a caller's behalf (matching every other seam on this
 * interface that defaults to *nothing* rather than a real implementation).
 */
export interface McpJsonInjectionOptions {
  /** Absolute path (or PATH-resolvable name) to the `jini-mcp` bin entry (`packages/mcp/src/bin/serve.ts`) this driver tells the spawned CLI to launch as its own MCP server subprocess. */
  readonly command: string;
  /** Extra argv for `command`. @default [] */
  readonly args?: readonly string[];
  /** The daemon's own loopback base URL the spawned `jini-mcp` process calls back into via `JINI_DAEMON_URL` (see `packages/mcp/src/bin/serve.ts`'s `DAEMON_URL_ENV_VAR`). */
  readonly daemonUrl: string;
  /** Reads an existing `.mcp.json` at the given absolute path so this driver merges rather than clobbers a project's own file. Rejecting (ENOENT or otherwise) is treated as "no existing file" — see `writeMcpJsonForRun`. @default the real `fs.promises.readFile` (utf8) */
  readonly readFile?: (path: string) => Promise<string>;
  /** Writes the merged `.mcp.json` content back out. @default the real `fs.promises.writeFile` (utf8) */
  readonly writeFile?: (path: string, content: string) => Promise<void>;
}

const JINI_MCP_SERVER_KEY = 'jini';

/** One `.mcp.json` `mcpServers` entry — the shape Claude Code's own config schema expects. */
interface McpJsonServerEntry {
  readonly command: string;
  readonly args: string[];
  readonly env: { readonly JINI_RUN_ID: string; readonly JINI_DAEMON_URL: string };
}

/**
 * Builds this run's `mcpServers.jini` entry — pure, so every field mapping is directly
 * assertable without touching the filesystem.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function buildMcpJsonServerEntry(
  runId: string,
  options: Pick<McpJsonInjectionOptions, 'command' | 'args' | 'daemonUrl'>,
): McpJsonServerEntry {
  return {
    command: options.command,
    args: options.args !== undefined ? [...options.args] : [],
    env: { JINI_RUN_ID: runId, JINI_DAEMON_URL: options.daemonUrl },
  };
}

/**
 * Merges {@link JINI_MCP_SERVER_KEY} into an existing `.mcp.json`'s `mcpServers` map, preserving
 * every other key and every other registered server untouched. A missing (`existingRaw ===
 * undefined`), empty, or unparseable-as-a-JSON-object existing file all degrade to "start from an
 * empty document" rather than throwing — an unparseable project `.mcp.json` is a pre-existing
 * problem this driver did not create and cannot safely repair, so it is deliberately overwritten
 * with a fresh, valid file containing just this run's bridge entry rather than left broken or
 * left blocking the run. Pure — no I/O — so every branch is directly assertable.
 * @complexity O(1) plus `JSON.parse`/`JSON.stringify`'s own cost on a small config file.
 * @overallScore 100/100
 */
export function mergeMcpJsonContent(existingRaw: string | undefined, serverEntry: McpJsonServerEntry): string {
  let doc: Record<string, unknown> = {};
  if (existingRaw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(existingRaw);
      if (isRecord(parsed)) doc = parsed;
    } catch {
      doc = {};
    }
  }
  const existingServers = isRecord(doc.mcpServers) ? doc.mcpServers : {};
  const mcpServers = { ...existingServers, [JINI_MCP_SERVER_KEY]: serverEntry };
  return `${JSON.stringify({ ...doc, mcpServers }, null, 2)}\n`;
}

function defaultReadMcpJsonFile(path: string): Promise<string> {
  return fsPromises.readFile(path, 'utf8');
}

function defaultWriteMcpJsonFile(path: string, content: string): Promise<void> {
  return fsPromises.writeFile(path, content, 'utf8');
}

/**
 * Writes (merging, never clobbering — see {@link mergeMcpJsonContent}) `.mcp.json` into `cwd`
 * before spawn, so Claude Code's own spawn-time config load (confirmed in `@injini/agent-runtime`'s
 * `defs/claude.ts` doc: "Claude Code auto-loads `.mcp.json` from the project cwd at spawn")
 * discovers the `jini-mcp` bridge server without this driver needing to pass any CLI flag at all.
 * A no-op when `mcpJsonInjection` is `undefined` (opt-in, see `CreateAgentExecutorOptions`'s doc)
 * or `def.externalMcpInjection !== 'claude-mcp-json'` (every other injection strategy delivers
 * `mcpServers` a different way — see this module's own doc above).
 * @throws Whatever `writeFile` rejects with — the caller (`run()`) turns that into a pre-spawn
 * `AGENT_SPAWN_FAILED` failure, matching every other pre-spawn filesystem guard in this file
 * (`preparePromptFileForAgentFn`'s own try/catch).
 * @complexity O(1) plus one `readFile`/`writeFile` round trip.
 * @overallScore 100/100
 */
async function writeMcpJsonForRun(
  cwd: string,
  runId: string,
  def: RuntimeAgentDef,
  mcpJsonInjection: McpJsonInjectionOptions | undefined,
): Promise<void> {
  if (mcpJsonInjection === undefined || def.externalMcpInjection !== 'claude-mcp-json') return;
  const readFileFn = mcpJsonInjection.readFile ?? defaultReadMcpJsonFile;
  const writeFileFn = mcpJsonInjection.writeFile ?? defaultWriteMcpJsonFile;
  const filePath = join(cwd, '.mcp.json');
  let existingRaw: string | undefined;
  try {
    existingRaw = await readFileFn(filePath);
  } catch {
    // No existing file (ENOENT — the common case) or unreadable for any other reason: both
    // degrade to "start fresh", matching mergeMcpJsonContent's own doc.
    existingRaw = undefined;
  }
  const serverEntry = buildMcpJsonServerEntry(runId, mcpJsonInjection);
  await writeFileFn(filePath, mergeMcpJsonContent(existingRaw, serverEntry));
}

/**
 * Gap 4 of the run/chat orchestration Final Recommendation: what
 * `classifyFailure` (see `CreateAgentExecutorOptions.classifyFailure`) is
 * given to decide whether a `'failed'` run is `resumable`. `code`/`signal`
 * are the only *content-level* signals cheaply available at every one of the
 * three lifecycle-wiring close handlers without new stderr/stdout buffering
 * machinery (a host wanting output-pattern-based classification, the way
 * OD's own ~20-vendor text-matching classifier worked, would need its own
 * listener for that — an honest scope limit, not an oversight).
 *
 * `sideEffects` (2026-07-22) carries the two `RunRetrySideEffectState` fields
 * every `wire*Lifecycle` driver already tracks live from the translated
 * agent-event stream it's processing anyway — `userVisibleOutputSeen` (a
 * non-empty `text_delta`/`thinking_delta`) and `toolCallSeen` (a `tool_use`)
 * — so `decideSafeRunRetry`'s matching suppression guards are genuinely
 * exercised, not permanently dead code. Two related fields are deliberately
 * absent: `cancelRequested` is never included because it's structurally
 * always `false` by the time a classifier runs at all (a cancelled run's
 * status already routes to `'cancelled'` before `classifyFailure` is ever
 * consulted — see each `wire*Lifecycle` close handler); `artifactWriteSeen`/
 * `liveArtifactSeen` have no real signal to derive them from at all —
 * `@injini/protocol`'s `RunAgentEventPayload` union (`events.ts`) has no
 * `'artifact'`/`'live_artifact'` event kind yet (Jini's own generalized
 * GenUI/artifact surface isn't built — see this repo's "A2UI full protocol
 * deferred" scope note), unlike OD, which `RunRetrySideEffectState`'s shape
 * was carried over from.
 */
export interface FailureClassificationContext {
  readonly runId: string;
  readonly agentId: string;
  readonly code: number | null;
  readonly signal: string | null;
  readonly sideEffects: Pick<RunRetrySideEffectState, 'userVisibleOutputSeen' | 'toolCallSeen'>;
}

/**
 * Host-owned failure classifier — gap 4. Decides, for one specific
 * `'failed'` run, whether `RunLifecycle.finish()`'s `resumable` flag should
 * be `true`. Never consulted for `'succeeded'`/`'cancelled'` outcomes, and
 * never consulted for a pre-spawn failure (`failBeforeSpawn`'s call sites) —
 * those represent failures where no child process ever ran, so there is
 * nothing a classifier could meaningfully examine.
 */
export type ClassifyFailure = (context: FailureClassificationContext) => boolean | Promise<boolean>;

interface WireChildLifecycleContext extends TerminateChildTreeDeps {
  readonly runId: string;
  readonly def: RuntimeAgentDef;
  readonly streamFormat: ChildDrivenStreamFormat;
  readonly child: ChildProcess;
  readonly lifecycle: RunLifecycle;
  readonly onCleanupFailure: (context: AgentCleanupFailureContext) => void;
  /** Removes a `promptViaFile`-staged temp file (grok-build) after the child exits. A no-op default when no prompt file was staged for this run — see `run()`'s `preparePromptFileForAgent` call site. */
  readonly cleanupPromptFile: () => Promise<void>;
  /** Gap 1's byte-journal (see `continuation/journal.ts`). `undefined` when a caller configured none — every journal call site below is then a no-op. */
  readonly journal: RunByteJournal | undefined;
  /** Gap 3's stdin-tool-result injection config. `undefined` means every `turn_end` closes stdin unconditionally — see `ContinuationOptions`'s own doc. */
  readonly continuation: ContinuationOptions | undefined;
  /** Gap 4's failure classifier. `undefined` means every `'failed'` outcome stays `resumable: false` — byte-identical to pre-gap-4 behavior. See `ClassifyFailure`'s own doc. */
  readonly classifyFailure: ClassifyFailure | undefined;
}

/**
 * Wires one spawned child's full observable lifecycle: raw stdout/stderr
 * forwarding, structured stream-parser dispatch (translated via
 * {@link translateAgentRuntimeEvent}), cancellation (subscribes
 * `lifecycle.onCancelRequested` and escalates via `stopProcesses` on the
 * child's full descendant tree), and the terminal `close` → `finish()`
 * transition. Registered *before* the caller awaits spawn confirmation so
 * no early `'error'`/`'close'` event is ever missed.
 *
 * Every `lifecycle.emit()` call is funneled through a per-run FIFO queue
 * (`enqueueEmit`) rather than fired independently: a single stdout `data`
 * chunk can synchronously produce several parsed events (a JSON line's
 * `feed()` call may invoke `onEvent` more than once), and successive
 * `data` events must not have their derived `emit()` calls race each
 * other out of order. The queue also absorbs an individual `emit()`
 * rejection (e.g. a race against an already-terminal run) without losing
 * subsequently queued events, and the `close` handler awaits it fully
 * drained before computing the terminal outcome — so `finish()`'s `'end'`
 * event is always durably last, never interleaved with a still-in-flight
 * `'agent'`/`'stdout'`/`'stderr'` append.
 *
 * `streamFormat: 'plain'` gets no `createStreamHandlerForDef` parser at
 * all (Option B — see module doc and
 * `ADS-memory/reports/proposals/PROP-plain-format-agent-driving-2026-07-21.md`
 * §3): every raw stdout chunk is forwarded live, verbatim, as its own
 * `text_delta` `'agent'` event, through the same `enqueueEmit` FIFO queue
 * every other emit already goes through — no buffering until close, no new
 * parser state machine. **Deliberately un-hygiened for v1**: no ANSI/
 * terminal-control-sequence stripping is applied (there is no Jini
 * equivalent of OD's `TerminalControlSequenceStripper` yet) — a documented
 * decision, not an oversight; see `packages/daemon/source-map.md`'s
 * 2026-07-21 addition for the reasoning.
 *
 * @param ctx - Run/def/child/lifecycle plus the cancellation-escalation ports.
 * @returns A handle exposing `closeStdinOnce` for the initial prompt write to share.
 * @complexity Registration is O(1); steady-state per-chunk cost is the
 * chosen stream parser's own `feed()` cost plus O(1) queue bookkeeping.
 * @overallScore 100/100
 */
function wireChildLifecycle(ctx: WireChildLifecycleContext): StdinCloseHandle {
  const { runId, def, streamFormat, child, lifecycle, journal, continuation, classifyFailure } = ctx;
  let stdinClosed = false;
  let cancelRequested = false;
  let emitQueue: Promise<void> = Promise.resolve();
  // Gap 5 (session resume) — the last session/thread id a 'status' event reported, threaded into
  // finish()'s sessionRef below. `streamFormat === 'plain'` defs have no structured parser and
  // therefore never populate this — an honest scope limit, not an oversight.
  let capturedSessionId: string | undefined;
  // Real `FailureClassificationContext.sideEffects` signals (2026-07-22) — see that interface's
  // own doc for exactly what these two mean and why the other two `RunRetrySideEffectState`
  // fields aren't tracked here at all.
  let userVisibleOutputSeen = false;
  let toolCallSeen = false;
  // Gap 3 (stdin-tool-result injection) — the most recently reported tool_use, cleared once
  // consumed by a turn-end injection decision. See `ContinuationOptions`'s doc for why this is
  // only ever acted on when a host has explicitly allowlisted the tool's name.
  let pendingToolUse: { id: string; name: string; input: unknown } | undefined;

  function enqueueEmit(task: () => Promise<unknown>): void {
    emitQueue = emitQueue.then(async () => {
      try {
        await task();
      } catch {
        // A single emit failing (e.g. a race against an already-terminal
        // run) must not block delivery of subsequently queued events —
        // see this function's own doc.
      }
    });
  }

  function closeStdinOnce(): void {
    if (stdinClosed) return;
    stdinClosed = true;
    child.stdin?.end();
  }

  /**
   * Writes a structured (never string-concatenated — see `ContinuationOptions`'s doc on the
   * prompt-injection stakes here) tool_result JSONL line, mirroring the shape
   * `claude-stream.ts`'s own inbound parser already expects on the opposite direction of this
   * exact wire format. Journals the sent content the same way `writePromptToStdin`'s
   * `recordSentBytes` does.
   */
  function injectToolResultLine(toolUseId: string, content: string, isError: boolean): void {
    const stdin = child.stdin;
    if (!stdin) return;
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, ...(isError ? { is_error: true } : {}) }] },
    });
    stdin.write(`${line}\n`, 'utf8');
    if (journal) enqueueEmit(() => journal.record(runId, sentJournalEntry(content)));
  }

  /**
   * Decides, per `turn_end`, whether to auto-resolve a pending tool_use through the injected
   * `ToolExecutor` and keep stdin open (gap 3), or close stdin exactly as every version of this
   * function has always done (the default, and the only behavior when `continuation` is
   * unconfigured or the pending tool isn't allowlisted).
   */
  function handleTurnEnd(stopReason: string | undefined): void {
    const toolUse = pendingToolUse;
    const shouldInject =
      stopReason === 'tool_use' &&
      toolUse !== undefined &&
      continuation !== undefined &&
      resolveContinuationTransport(def) === 'stdin-injection' &&
      continuation.autonomousToolNames.has(toolUse.name);
    if (!shouldInject) {
      closeStdinOnce();
      return;
    }
    pendingToolUse = undefined;
    enqueueEmit(async () => {
      const run: RunRef = { id: runId };
      let content: string;
      let isError: boolean;
      try {
        const result = await continuation.toolExecutor.execute(continuation.principal, run, toolUse.name, toolUse.input);
        content = resultContent(result);
        isError = result.status !== 'completed';
      } catch (error) {
        content = errorMessage(error);
        isError = true;
      }
      await lifecycle.emit(runId, {
        event: 'agent',
        data: { type: 'tool_result', toolUseId: toolUse.id, content, ...(isError ? { isError: true } : {}) },
      });
      injectToolResultLine(toolUse.id, content, isError);
    });
  }

  const streamHandler: StreamHandler | null =
    streamFormat === 'plain'
      ? null
      : createStreamHandlerForDef(def, streamFormat, (rawEvent) => {
          const translation = translateAgentRuntimeEvent(rawEvent);
          if (translation.kind === 'agent') {
            if (translation.sessionId !== undefined) capturedSessionId = translation.sessionId;
            if (translation.payload.type === 'tool_use') {
              pendingToolUse = { id: translation.payload.id, name: translation.payload.name, input: translation.payload.input };
              toolCallSeen = true;
            } else if (
              (translation.payload.type === 'text_delta' || translation.payload.type === 'thinking_delta') &&
              translation.payload.delta.length > 0
            ) {
              userVisibleOutputSeen = true;
            }
            enqueueEmit(() => lifecycle.emit(runId, { event: 'agent', data: translation.payload }));
          } else if (translation.kind === 'error') {
            enqueueEmit(() => lifecycle.emit(runId, { event: 'error', data: translation.payload }));
          } else if (translation.kind === 'turn-end') {
            handleTurnEnd(translation.stopReason);
          }
        });

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString('utf8');
    if (journal) enqueueEmit(() => journal.record(runId, receivedJournalEntry('stdout', text)));
    enqueueEmit(() => lifecycle.emit(runId, { event: 'stdout', data: { chunk: text } }));
    if (streamFormat === 'plain') {
      if (text.length > 0) userVisibleOutputSeen = true;
      enqueueEmit(() => lifecycle.emit(runId, { event: 'agent', data: { type: 'text_delta', delta: text } }));
    } else {
      // Non-null: `streamHandler` is only ever null when `streamFormat === 'plain'` (see its
      // construction above), the branch this `else` provably excludes.
      streamHandler!.feed(text);
    }
  });

  child.stderr?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString('utf8');
    if (journal) enqueueEmit(() => journal.record(runId, receivedJournalEntry('stderr', text)));
    enqueueEmit(() => lifecycle.emit(runId, { event: 'stderr', data: { chunk: text } }));
  });

  // EPIPE-tolerant: a fast-exiting child that closes its stdin read end
  // before every queued write lands must not crash the host process with
  // an unhandled stream error — the real failure (if any) surfaces through
  // the 'close' handler below regardless.
  child.stdin?.on('error', () => {});
  // Safety net for any child-level 'error' event that fires after the
  // spawn-confirmation race (see waitForSpawnOrError) has already settled —
  // EventEmitter throws on an unheard 'error' otherwise. The real outcome
  // is still decided by 'close' below.
  child.on('error', () => {});

  const unsubscribeCancel = lifecycle.onCancelRequested(runId, () => {
    cancelRequested = true;
    void terminateChildTreeBestEffort(ctx, child, runId, 'cancel', ctx.onCleanupFailure);
  });

  child.on('close', (code, signal) => {
    void (async () => {
      // Not wrapped in try/catch: all 4 supported parser factories'
      // flush() implementations already internally guard their own
      // JSON.parse/dispatch and degrade a malformed trailing buffered
      // line to a `{type:'raw'}` event rather than throwing (confirmed by
      // reading each of the 4 modules in full — see module doc). A guard
      // here would be dead code for the fixed, closed set of parsers this
      // driver dispatches to. `streamHandler` is null for `'plain'` (no
      // parser, hence nothing to flush) — `?.` skips it cleanly.
      streamHandler?.flush();
      await emitQueue;
      unsubscribeCancel();
      await ctx.cleanupPromptFile();
      const status = classifyRunCloseStatus({ cancelRequested, code, signal });
      const resumable =
        status === 'failed' && classifyFailure !== undefined
          ? await classifyFailure({
              runId,
              agentId: def.id,
              code,
              signal: signal ?? null,
              sideEffects: { userVisibleOutputSeen, toolCallSeen },
            })
          : false;
      await lifecycle.finish({
        runId,
        status,
        code,
        signal: signal ?? null,
        resumable,
        ...(capturedSessionId !== undefined ? { sessionRef: capturedSessionId } : {}),
      });
    })();
  });

  return {
    closeStdinOnce,
    recordSentBytes(content: string): void {
      if (journal) enqueueEmit(() => journal.record(runId, sentJournalEntry(content)));
    },
  };
}

interface WireAcpLifecycleContext extends TerminateChildTreeDeps {
  readonly runId: string;
  readonly agentId: string;
  readonly child: ChildProcess;
  readonly lifecycle: RunLifecycle;
  readonly prompt: string;
  readonly cwd: string;
  readonly model: string | undefined;
  readonly imagePaths: readonly string[];
  readonly envFormat: 'array' | 'map' | undefined;
  readonly onPermissionRequest: AcpPermissionHandler | undefined;
  readonly attachAcpSession: typeof attachAcpSession;
  readonly onCleanupFailure: (context: AgentCleanupFailureContext) => void;
  /** Same seam as `WireChildLifecycleContext.cleanupPromptFile` — no current ACP def declares `promptViaFile`, so this is always the no-op default in practice today, threaded through for consistency rather than special-cased away. */
  readonly cleanupPromptFile: () => Promise<void>;
  /** Gap 1's byte-journal (see `continuation/journal.ts`). Covers this wrapper's own raw stdout/stderr forwarding only — the actual ACP prompt delivery happens inside `attachAcpSession`'s own transport, out of this module's direct view, so sent bytes are not journaled on this path (an honestly-scoped v1 gap, not an oversight). */
  readonly journal: RunByteJournal | undefined;
  /** Gap 4's failure classifier — see `ClassifyFailure`'s own doc. `undefined` means every `'failed'` outcome stays `resumable: false`. */
  readonly classifyFailure: ClassifyFailure | undefined;
}

/**
 * Maps an ACP session's transport error into the canonical run-error shape.
 * ACP adapters may add a structured `error` member, but a daemon driver must
 * never make one vendor's error shape part of the run protocol.
 */
function translateAcpError(payload: unknown): RunErrorPayload {
  if (!isRecord(payload)) return { message: asString(payload, 'ACP agent failed') };
  const message = asString(payload.message, 'ACP agent failed');
  const error = isRecord(payload.error) ? payload.error : null;
  const code = error ? asOptionalString(error.code) : undefined;
  const retryable = error && typeof error.retryable === 'boolean' ? error.retryable : undefined;
  return {
    message,
    ...(code !== undefined
      ? {
          error: {
            code,
            message: asString(error?.message, message),
            ...(retryable !== undefined ? { retryable } : {}),
          },
        }
      : {}),
  };
}

/**
 * Wires an ACP child to a run. Unlike the JSON-stream path, ACP owns the
 * prompt protocol and reports its parsed events through `attachAcpSession`'s
 * callback. This wrapper retains raw stdout/stderr for diagnostics, preserves
 * event order through the same FIFO discipline, forwards cancellation both as
 * ACP `session/cancel` and an OS process-tree stop, and uses the controller's
 * clean-prompt signal rather than SIGTERM (expected ACP cleanup) to determine
 * success.
 */
function wireAcpLifecycle(ctx: WireAcpLifecycleContext): AcpSessionController {
  const { runId, agentId, child, lifecycle, journal, classifyFailure } = ctx;
  let cancelRequested = false;
  let emitQueue: Promise<void> = Promise.resolve();
  // Gap 5 (session resume) — see wireChildLifecycle's identical local for the full rationale.
  let capturedSessionId: string | undefined;
  // Real `FailureClassificationContext.sideEffects` signals — see that interface's own doc.
  let userVisibleOutputSeen = false;
  let toolCallSeen = false;

  function enqueueEmit(task: () => Promise<unknown>): void {
    emitQueue = emitQueue.then(async () => {
      try {
        await task();
      } catch {
        // A late event racing a terminal lifecycle is intentionally dropped;
        // it must not prevent subsequent queued cleanup from running.
      }
    });
  }

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString('utf8');
    if (journal) enqueueEmit(() => journal.record(runId, receivedJournalEntry('stdout', text)));
    enqueueEmit(() => lifecycle.emit(runId, { event: 'stdout', data: { chunk: text } }));
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString('utf8');
    if (journal) enqueueEmit(() => journal.record(runId, receivedJournalEntry('stderr', text)));
    enqueueEmit(() => lifecycle.emit(runId, { event: 'stderr', data: { chunk: text } }));
  });
  child.stdin?.on('error', () => {});
  child.on('error', () => {});

  let controller: AcpSessionController | null = null;
  const unsubscribeCancel = lifecycle.onCancelRequested(runId, () => {
    cancelRequested = true;
    controller?.abort();
    void terminateChildTreeBestEffort(ctx, child, runId, 'cancel', ctx.onCleanupFailure);
  });

  child.on('close', (code, signal) => {
    void (async () => {
      await emitQueue;
      unsubscribeCancel();
      await ctx.cleanupPromptFile();
      const status = cancelRequested ? 'cancelled' : controller?.completedSuccessfully() ? 'succeeded' : 'failed';
      const resumable =
        status === 'failed' && classifyFailure !== undefined
          ? await classifyFailure({
              runId,
              agentId,
              code,
              signal: signal ?? null,
              sideEffects: { userVisibleOutputSeen, toolCallSeen },
            })
          : false;
      await lifecycle.finish({
        runId,
        status,
        code,
        signal: signal ?? null,
        resumable,
        ...(capturedSessionId !== undefined ? { sessionRef: capturedSessionId } : {}),
      });
    })();
  });

  controller = ctx.attachAcpSession({
    child,
    prompt: ctx.prompt,
    cwd: ctx.cwd,
    ...(ctx.model !== undefined ? { model: ctx.model } : {}),
    ...(ctx.imagePaths.length > 0 ? { imagePaths: [...ctx.imagePaths] } : {}),
    ...(ctx.envFormat !== undefined ? { envFormat: ctx.envFormat } : {}),
    ...(ctx.onPermissionRequest !== undefined ? { onPermissionRequest: ctx.onPermissionRequest } : {}),
    send(event, payload) {
      if (event === 'agent') {
        const translation = translateAgentRuntimeEvent(payload);
        if (translation.kind === 'agent') {
          if (translation.sessionId !== undefined) capturedSessionId = translation.sessionId;
          if (translation.payload.type === 'tool_use') {
            toolCallSeen = true;
          } else if (
            (translation.payload.type === 'text_delta' || translation.payload.type === 'thinking_delta') &&
            translation.payload.delta.length > 0
          ) {
            userVisibleOutputSeen = true;
          }
          enqueueEmit(() => lifecycle.emit(runId, { event: 'agent', data: translation.payload }));
        } else if (translation.kind === 'error') {
          enqueueEmit(() => lifecycle.emit(runId, { event: 'error', data: translation.payload }));
        }
        return;
      }
      if (event === 'error') {
        enqueueEmit(() => lifecycle.emit(runId, { event: 'error', data: translateAcpError(payload) }));
      }
    },
  });
  return controller;
}

interface WirePiRpcLifecycleContext extends TerminateChildTreeDeps {
  readonly runId: string;
  readonly agentId: string;
  readonly child: ChildProcess;
  readonly lifecycle: RunLifecycle;
  readonly prompt: string;
  readonly cwd: string;
  readonly model: string | undefined;
  readonly imagePaths: readonly string[];
  readonly uploadRoot: string | undefined;
  readonly attachPiRpcSession: typeof attachPiRpcSession;
  readonly onCleanupFailure: (context: AgentCleanupFailureContext) => void;
  /** Same seam as `WireChildLifecycleContext.cleanupPromptFile` — no current pi-rpc def declares `promptViaFile`, so this is always the no-op default in practice today, threaded through for consistency rather than special-cased away. */
  readonly cleanupPromptFile: () => Promise<void>;
  /** Gap 1's byte-journal (see `continuation/journal.ts`). Same scope boundary as `WireAcpLifecycleContext.journal`: covers this wrapper's own raw stdout/stderr forwarding only, not the prompt bytes `attachPiRpcSession` sends through its own transport. */
  readonly journal: RunByteJournal | undefined;
  /** Gap 4's failure classifier — see `ClassifyFailure`'s own doc. `undefined` means every `'failed'` outcome stays `resumable: false`. */
  readonly classifyFailure: ClassifyFailure | undefined;
}

/**
 * Wires a pi-rpc child to a run. Like ACP, pi owns its own prompt-delivery
 * protocol (`prompt`/`new_session`/`abort` RPC commands over stdin) and
 * reports parsed events through `attachPiRpcSession`'s `send` callback —
 * unlike ACP's callback, pi-rpc's `send` always uses the `'agent'` channel
 * (confirmed by reading every `mapPiRpcEvent` call site: error-ness is
 * signaled via the payload's own `type: 'error'` field, never a separate
 * channel), so this wrapper runs every payload through the same
 * `translateAgentRuntimeEvent` pipeline ACP/JSON-stream already use, with no
 * channel branch needed. Raw stdout/stderr are still forwarded for
 * diagnostics (same as ACP) even though `attachPiRpcSession` also consumes
 * `child.stdout` itself for its own JSON-RPC parsing — Node multicasts
 * `'data'` events to every listener, so both coexist safely.
 *
 * v1 omits `parentSession` — none of
 * `AgentExecutorRunInput`'s fields carry them yet (matching this module's
 * established "explicitly out of scope" discipline for other follow-ups:
 * multi-turn tool continuation, resumable session ids, etc.).
 */
function wirePiRpcLifecycle(ctx: WirePiRpcLifecycleContext): PiRpcSession {
  const { runId, agentId, child, lifecycle, journal, classifyFailure } = ctx;
  let cancelRequested = false;
  let emitQueue: Promise<void> = Promise.resolve();
  // Gap 5 (session resume) — see wireChildLifecycle's identical local for the full rationale.
  let capturedSessionId: string | undefined;
  // Real `FailureClassificationContext.sideEffects` signals — see that interface's own doc.
  let userVisibleOutputSeen = false;
  let toolCallSeen = false;

  function enqueueEmit(task: () => Promise<unknown>): void {
    emitQueue = emitQueue.then(async () => {
      try {
        await task();
      } catch {
        // A late event racing a terminal lifecycle is intentionally dropped;
        // it must not prevent subsequent queued cleanup from running.
      }
    });
  }

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString('utf8');
    if (journal) enqueueEmit(() => journal.record(runId, receivedJournalEntry('stdout', text)));
    enqueueEmit(() => lifecycle.emit(runId, { event: 'stdout', data: { chunk: text } }));
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString('utf8');
    if (journal) enqueueEmit(() => journal.record(runId, receivedJournalEntry('stderr', text)));
    enqueueEmit(() => lifecycle.emit(runId, { event: 'stderr', data: { chunk: text } }));
  });
  child.stdin?.on('error', () => {});
  child.on('error', () => {});

  let session: PiRpcSession | null = null;
  const unsubscribeCancel = lifecycle.onCancelRequested(runId, () => {
    cancelRequested = true;
    session?.abort();
    void terminateChildTreeBestEffort(ctx, child, runId, 'cancel', ctx.onCleanupFailure);
  });

  child.on('close', (code, signal) => {
    void (async () => {
      await emitQueue;
      unsubscribeCancel();
      await ctx.cleanupPromptFile();
      const status = cancelRequested ? 'cancelled' : session?.hasFatalError() ? 'failed' : 'succeeded';
      const resumable =
        status === 'failed' && classifyFailure !== undefined
          ? await classifyFailure({
              runId,
              agentId,
              code,
              signal: signal ?? null,
              sideEffects: { userVisibleOutputSeen, toolCallSeen },
            })
          : false;
      await lifecycle.finish({
        runId,
        status,
        code,
        signal: signal ?? null,
        resumable,
        ...(capturedSessionId !== undefined ? { sessionRef: capturedSessionId } : {}),
      });
    })();
  });

  session = ctx.attachPiRpcSession({
    child: ctx.child,
    prompt: ctx.prompt,
    cwd: ctx.cwd,
    ...(ctx.model !== undefined ? { model: ctx.model } : {}),
    ...(ctx.imagePaths.length > 0 ? { imagePaths: [...ctx.imagePaths] } : {}),
    ...(ctx.uploadRoot !== undefined ? { uploadRoot: ctx.uploadRoot } : {}),
    send(_channel, payload) {
      const translation = translateAgentRuntimeEvent(payload);
      if (translation.kind === 'agent') {
        if (translation.sessionId !== undefined) capturedSessionId = translation.sessionId;
        if (translation.payload.type === 'tool_use') {
          toolCallSeen = true;
        } else if (
          (translation.payload.type === 'text_delta' || translation.payload.type === 'thinking_delta') &&
          translation.payload.delta.length > 0
        ) {
          userVisibleOutputSeen = true;
        }
        enqueueEmit(() => lifecycle.emit(runId, { event: 'agent', data: translation.payload }));
      } else if (translation.kind === 'error') {
        enqueueEmit(() => lifecycle.emit(runId, { event: 'error', data: translation.payload }));
      }
    },
  });
  return session;
}

/**
 * Writes the initial user turn to the child's stdin per `def.promptInputFormat`
 * (both branches only run for `promptViaStdin: true` defs — the only shape
 * `run()` supports in v1, see module doc):
 * - `'text'` (default): the raw prompt buffer, then stdin is closed —
 *   matches `RuntimeAgentDef.promptInputFormat`'s own doc.
 * - `'stream-json'`: one JSONL line wrapping the prompt as an Anthropic
 *   user message; stdin is deliberately left open (a real multi-turn
 *   caller would inject further messages) — v1 has no such caller, so
 *   {@link wireChildLifecycle}'s `turn_end` handling closes it once the
 *   agent's own stream reports the turn ended.
 * @param def - The resolved agent def (only `.promptInputFormat` is read).
 * @param child - The spawned child (no-ops if `.stdin` is unexpectedly absent).
 * @param prompt - The composed user turn.
 * @param handle - Shared stdin-close guard so a `'text'` write's immediate close and a later `turn_end` close never race into a double-`end()`; also carries gap 1's byte-journal recorder (see `StdinCloseHandle.recordSentBytes`).
 * @complexity O(1) plus the underlying stream write's own cost.
 * @overallScore 100/100
 */
function writePromptToStdin(def: RuntimeAgentDef, child: ChildProcess, prompt: string, handle: StdinCloseHandle): void {
  const stdin = child.stdin;
  if (!stdin) return;
  if (def.promptInputFormat === 'stream-json') {
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } });
    stdin.write(`${line}\n`, 'utf8');
    handle.recordSentBytes(prompt);
    return;
  }
  stdin.write(prompt, 'utf8');
  handle.recordSentBytes(prompt);
  handle.closeStdinOnce();
}

export interface CreateAgentExecutorOptions {
  readonly lifecycle: RunLifecycle;
  /** @default the real `@injini/agent-runtime` registry lookup */
  readonly getAgentDef?: typeof getAgentDef;
  /** @default the real `@injini/agent-runtime` launch resolver */
  readonly resolveAgentLaunch?: typeof resolveAgentLaunch;
  /** @default the real `@injini/agent-runtime` PATH-env composer */
  readonly applyAgentLaunchEnv?: typeof applyAgentLaunchEnv;
  /** @default the real `@injini/platform` cross-platform invocation builder */
  readonly createCommandInvocation?: typeof createCommandInvocation;
  /** @default `node:child_process`'s `spawn` */
  readonly spawn?: typeof nodeSpawn;
  /** @default the real `@injini/agent-runtime` ACP session transport */
  readonly attachAcpSession?: typeof attachAcpSession;
  /**
   * Host-owned policy for ACP agents' native tool calls. The ACP agent still
   * executes its own selected option; Jini-registered tool execution belongs
   * to `createDelegatedToolBridge`, not this permission callback.
   */
  readonly acpPermissionHandler?: AcpPermissionHandler;
  /** @default the real `@injini/agent-runtime` pi-rpc session transport */
  readonly attachPiRpcSession?: typeof attachPiRpcSession;
  /**
   * Stages a `promptViaFile` def's (grok-build) composed prompt to a temp
   * file before `buildArgs` runs. Touches the real filesystem by default
   * (`fs.mkdtemp`/`fs.writeFile`/`fs.rm`) — injectable so tests can drive
   * it without real disk I/O, matching this factory's "no real subprocess,
   * filesystem, or PATH lookup by default in tests" convention.
   * @default the real `@injini/agent-runtime` prompt-file stager
   */
  readonly preparePromptFileForAgent?: typeof preparePromptFileForAgent;
  /** @default the real `@injini/platform` process-snapshot enumerator */
  readonly listProcessSnapshots?: typeof listProcessSnapshots;
  /** @default the real `@injini/platform` descendant-PID collector */
  readonly collectProcessTreePids?: typeof collectProcessTreePids;
  /** @default the real `@injini/platform` SIGTERM→SIGKILL escalator */
  readonly stopProcesses?: typeof stopProcesses;
  /** Host-owned sink for a process-tree cleanup failure (SEC-007) — e.g. EPERM stopping descendants. @default logs a redacted diagnostic via `console.error` */
  readonly onCleanupFailure?: (context: AgentCleanupFailureContext) => void;
  /**
   * Gap 1's byte-journal (`packages/daemon/src/continuation/journal.ts`) — records every byte
   * this driver sends to or receives from a child agent process, independent of and prior to any
   * parsed/translated event. Covers `writePromptToStdin` (sent) and every `child.stdout`/
   * `child.stderr` `'data'` handler this driver owns (received); does not cover ACP/pi-rpc's own
   * prompt delivery, which happens inside their respective attach functions' own transport, out
   * of this driver's direct view — see `WireAcpLifecycleContext.journal`'s doc.
   * @default no journal — recording is entirely opt-in, unlike every other seam on this
   * interface (which default to a real implementation): there is no generic "real" journal
   * storage this package can default to without a caller-supplied `EventLog` instance.
   */
  readonly journal?: RunByteJournal;
  /**
   * Gap 3's stdin-tool-result injection config — see `ContinuationOptions`'s own doc, especially
   * on why `autonomousToolNames` (not stream-inferred intent) is this task's answer to the
   * human-in-the-loop pause question.
   * @default undefined — every `turn_end` closes stdin unconditionally, byte-identical to
   * pre-gap-3 behavior. Opt-in only, like `journal`: there is no safe default allowlist of
   * "tools okay to auto-continue without a human" this package can supply on a caller's behalf.
   */
  readonly continuation?: ContinuationOptions;
  /**
   * Gap 4's failure classifier — see `ClassifyFailure`'s own doc.
   * @default undefined — every `'failed'` run stays `resumable: false`, byte-identical to
   * pre-gap-4 behavior. No default classifier exists: OD's own ~20-vendor-CLI text-matching
   * failure classifier was deliberately never ported (see this module's own doc), so there is no
   * generic "real" classification logic this package could supply on a caller's behalf.
   */
  readonly classifyFailure?: ClassifyFailure;
  /**
   * Gap 3, part 2's spawn-time `.mcp.json` injection — see {@link McpJsonInjectionOptions}'s own
   * doc for the full design (why only `'claude-mcp-json'`-injection defs, why host-resolved).
   * @default undefined — no `.mcp.json` is written and no filesystem access beyond what already
   * happened (prompt-file staging) occurs on this path, byte-identical to pre-this-task behavior.
   * Opt-in only, like `journal`/`continuation`/`classifyFailure`: there is no safe default
   * `command`/`daemonUrl` this package could assume on a caller's behalf.
   */
  readonly mcpJsonInjection?: McpJsonInjectionOptions;
}

/**
 * Creates the `AgentExecutor` reference implementation: an in-process
 * `RunLifecycle` driver over real (by default) `@injini/agent-runtime`
 * registry lookup, launch resolution, and stream parsing, plus a real
 * `node:child_process.spawn`. Every collaborator is an injectable seam
 * (matching this package's established convention — see
 * `tool-executor.ts`/`run-lifecycle.ts`) so tests can drive a fake child
 * process and a fake registry without touching the filesystem or spawning
 * a real subprocess.
 *
 * @param options.lifecycle - The `RunLifecycle` this executor drives — its `start()` must already have been called for any `runId` passed to `run()`.
 * @returns An `AgentExecutor` whose `run()` never bare-throws (see module doc's Invariant).
 * @complexity `run()`'s own setup is O(1); steady-state cost is the chosen stream parser's.
 * @overallScore 100/100
 */
export function createAgentExecutor(options: CreateAgentExecutorOptions): AgentExecutor {
  const lifecycle = options.lifecycle;
  const getAgentDefFn = options.getAgentDef ?? getAgentDef;
  const resolveAgentLaunchFn = options.resolveAgentLaunch ?? resolveAgentLaunch;
  const applyAgentLaunchEnvFn = options.applyAgentLaunchEnv ?? applyAgentLaunchEnv;
  const createCommandInvocationFn = options.createCommandInvocation ?? createCommandInvocation;
  const spawnFn = options.spawn ?? nodeSpawn;
  const attachAcpSessionFn = options.attachAcpSession ?? attachAcpSession;
  const attachPiRpcSessionFn = options.attachPiRpcSession ?? attachPiRpcSession;
  const preparePromptFileForAgentFn = options.preparePromptFileForAgent ?? preparePromptFileForAgent;
  const listProcessSnapshotsFn = options.listProcessSnapshots ?? listProcessSnapshots;
  const collectProcessTreePidsFn = options.collectProcessTreePids ?? collectProcessTreePids;
  const stopProcessesFn = options.stopProcesses ?? stopProcesses;
  const onCleanupFailureFn = options.onCleanupFailure ?? defaultCleanupFailureSink;
  const journal = options.journal;
  const continuation = options.continuation;
  const classifyFailure = options.classifyFailure;
  const mcpJsonInjection = options.mcpJsonInjection;

  /**
   * Transitions `runId` to `'failed'` (idempotent, never resumable — no
   * classifier exists, see module doc) then rejects with a typed
   * {@link AgentExecutorError}. Every pre-spawn guard in `run()` returns
   * this call directly.
   * @param runId - The run to transition.
   * @param code - The machine-readable failure reason.
   * @param message - The human-readable rejection message.
   * @throws Always — this function never returns normally.
   * @complexity O(1) plus `lifecycle.finish()`'s own cost.
   * @overallScore 100/100
   */
  async function failBeforeSpawn(runId: string, code: AgentExecutorErrorCode, message: string): Promise<never> {
    await lifecycle.finish({ runId, status: 'failed', code: null, signal: null, resumable: false });
    throw new AgentExecutorError(code, message);
  }

  /**
   * `AgentExecutor.run()` — see that interface method's own doc for the
   * public contract. Implementation note on shape: every guard below
   * returns `failBeforeSpawn(...)` directly (a `Promise<never>`, valid
   * wherever `Promise<void>` is expected) rather than `await`-then-`return`,
   * so each failure path reads as a single, obviously-terminal statement.
   * @param input - `{runId, agentId, prompt, cwd, model?, reasoning?, imagePaths?, extraAllowedDirs?, uploadRoot?, env?}` — `runId` must already be `lifecycle.start()`-ed.
   * @throws {@link AgentExecutorError} — see module doc's Invariant; never a bare `Error`.
   * @complexity O(1) setup (registry lookup, launch resolution, one spawn call); steady-state cost thereafter belongs to {@link wireChildLifecycle}.
   * @overallScore 100/100
   */
  async function run(input: AgentExecutorRunInput): Promise<void> {
    const def = getAgentDefFn(input.agentId);
    if (!def) {
      return failBeforeSpawn(input.runId, 'AGENT_NOT_FOUND', `AgentExecutor: unknown agentId "${input.agentId}"`);
    }

    const streamFormat = def.streamFormat;
    if (!isSupportedStreamFormat(streamFormat)) {
      return failBeforeSpawn(
        input.runId,
        'AGENT_RUNTIME_UNSUPPORTED',
        `AgentExecutor: agent "${def.id}" has streamFormat "${streamFormat}", which is not implemented in v1 — only ${SUPPORTED_STREAM_FORMATS.join(', ')} are supported (see packages/daemon/source-map.md for the deferred antigravity guard)`,
      );
    }
    // Antigravity is the one plain def NOT driven — see module doc. This
    // guard is deliberately independent of (and ahead of) the generic
    // prompt-delivery/dispatch logic below: even though antigravity's def
    // declares promptViaStdin: true and would otherwise clear every guard
    // that follows, it needs auth-URL-leak buffering and a cross-run
    // model-selection lock this driver has no seam for yet.
    if (streamFormat === 'plain' && def.id === 'antigravity') {
      return failBeforeSpawn(
        input.runId,
        'AGENT_RUNTIME_UNSUPPORTED',
        `AgentExecutor: agent "${def.id}" needs auth-URL-leak buffering and a cross-run model-selection lock that generic streamFormat 'plain' driving does not provide — deliberately deferred, see ADS-memory/reports/proposals/PROP-plain-format-agent-driving-2026-07-21.md`,
      );
    }
    if (
      streamFormat !== 'acp-json-rpc' &&
      def.promptViaStdin !== true &&
      def.promptViaFile !== true &&
      typeof def.maxPromptArgBytes !== 'number'
    ) {
      return failBeforeSpawn(
        input.runId,
        'AGENT_RUNTIME_UNSUPPORTED',
        `AgentExecutor: agent "${def.id}" does not deliver its prompt via stdin, a staged prompt file, or a byte-budgeted argv — v1 has no other prompt delivery path`,
      );
    }

    // Argv-bound defs (aider, deepseek) — reject an oversized prompt before
    // ever resolving a binary or touching the filesystem. A no-op for every
    // def without `maxPromptArgBytes` (checkPromptArgvBudget's own guard).
    const argvBudgetError = checkPromptArgvBudget(def, input.prompt);
    if (argvBudgetError) {
      return failBeforeSpawn(input.runId, 'AGENT_PROMPT_TOO_LARGE', argvBudgetError.message);
    }

    const configuredEnv = toStringEnvRecord(input.env ?? process.env);
    const launch: AgentLaunchResolution = resolveAgentLaunchFn(def, configuredEnv);
    if (!launch.launchPath) {
      return failBeforeSpawn(
        input.runId,
        'AGENT_BINARY_NOT_RESOLVED',
        `AgentExecutor: could not resolve an executable for agent "${def.id}" (bin "${def.bin}")`,
      );
    }

    const spawnEnv = applyAgentLaunchEnvFn({ ...(input.env ?? process.env) }, launch);

    // Stage a promptViaFile def's (grok-build) prompt to a temp file before
    // buildArgs runs — its buildArgs throws without
    // runtimeContext.promptFilePath. A no-op (returns null) for every def
    // without promptViaFile: true (preparePromptFileForAgent's own guard).
    let preparedPromptFile: PreparedPromptFile | null;
    try {
      preparedPromptFile = await preparePromptFileForAgentFn(def, input.prompt, input.runId);
    } catch (err) {
      return failBeforeSpawn(
        input.runId,
        'AGENT_SPAWN_FAILED',
        `AgentExecutor: could not stage a prompt file for agent "${def.id}": ${errorMessage(err)}`,
      );
    }
    // Cleaned up after the child exits (wireChildLifecycle/wireAcpLifecycle/wirePiRpcLifecycle's
    // close handlers) and on every pre-spawn/spawn-failure path below — a leaked temp file
    // containing the full prompt is a confidentiality gap, not just a disk leak.
    const cleanupPromptFile: () => Promise<void> = preparedPromptFile
      ? preparedPromptFile.cleanup
      : async () => {};
    const runtimeContext: RuntimeContext | undefined = preparedPromptFile
      ? { promptFilePath: preparedPromptFile.path }
      : undefined;

    const args = def.buildArgs(
      input.prompt,
      [...(input.imagePaths ?? [])],
      input.extraAllowedDirs === undefined ? undefined : [...input.extraAllowedDirs],
      input.model !== undefined || input.reasoning !== undefined
        ? {
            ...(input.model !== undefined ? { model: input.model } : {}),
            ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
          }
        : undefined,
      runtimeContext,
    );

    // Gap 3, part 2 — write .mcp.json into the managed cwd before spawn, so a 'claude-mcp-json'
    // def's own spawn-time config load discovers the jini-mcp bridge server. A no-op for every
    // other def and whenever mcpJsonInjection is unconfigured — see writeMcpJsonForRun's doc.
    try {
      await writeMcpJsonForRun(input.cwd, input.runId, def, mcpJsonInjection);
    } catch (err) {
      await cleanupPromptFile();
      return failBeforeSpawn(
        input.runId,
        'AGENT_SPAWN_FAILED',
        `AgentExecutor: could not write .mcp.json for agent "${def.id}": ${errorMessage(err)}`,
      );
    }

    // Post-buildArgs guard for argv-bound defs whose resolved binary is a
    // Windows .cmd/.bat shim or a direct .exe: a prompt under the raw byte
    // budget can still expand past CreateProcess's command-line cap once
    // quote-escaped. Both are no-ops off-Windows / for non-argv-bound defs.
    const windowsBudgetError =
      checkWindowsCmdShimCommandLineBudget(def, launch.launchPath, args) ??
      checkWindowsDirectExeCommandLineBudget(def, launch.launchPath, args);
    if (windowsBudgetError) {
      await cleanupPromptFile();
      return failBeforeSpawn(input.runId, 'AGENT_PROMPT_TOO_LARGE', windowsBudgetError.message);
    }

    const invocation = createCommandInvocationFn({ command: launch.launchPath, args, env: spawnEnv });

    let child: ChildProcess;
    try {
      child = spawnFn(invocation.command, invocation.args, {
        cwd: input.cwd,
        env: spawnEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      });
    } catch (err) {
      await cleanupPromptFile();
      return failBeforeSpawn(
        input.runId,
        'AGENT_SPAWN_FAILED',
        `AgentExecutor: spawn threw synchronously for agent "${def.id}": ${errorMessage(err)}`,
      );
    }

    const stdinHandle =
      streamFormat === 'acp-json-rpc' || streamFormat === 'pi-rpc'
        ? null
        : wireChildLifecycle({
            runId: input.runId,
            def,
            streamFormat,
            child,
            lifecycle,
            listProcessSnapshots: listProcessSnapshotsFn,
            collectProcessTreePids: collectProcessTreePidsFn,
            stopProcesses: stopProcessesFn,
            onCleanupFailure: onCleanupFailureFn,
            cleanupPromptFile,
            journal,
            continuation,
            classifyFailure,
          });

    try {
      await waitForSpawnOrError(child);
    } catch (err) {
      await cleanupPromptFile();
      await lifecycle.finish({ runId: input.runId, status: 'failed', code: null, signal: null, resumable: false });
      throw new AgentExecutorError(
        'AGENT_SPAWN_FAILED',
        `AgentExecutor: failed to spawn agent "${def.id}": ${errorMessage(err)}`,
      );
    }

    if (streamFormat === 'acp-json-rpc') {
      try {
        wireAcpLifecycle({
          runId: input.runId,
          agentId: def.id,
          child,
          lifecycle,
          prompt: input.prompt,
          cwd: input.cwd,
          model: input.model,
          imagePaths: input.imagePaths ?? [],
          envFormat: def.acpMcpEnvFormat,
          onPermissionRequest: options.acpPermissionHandler,
          attachAcpSession: attachAcpSessionFn,
          listProcessSnapshots: listProcessSnapshotsFn,
          collectProcessTreePids: collectProcessTreePidsFn,
          stopProcesses: stopProcessesFn,
          onCleanupFailure: onCleanupFailureFn,
          cleanupPromptFile,
          journal,
          classifyFailure,
        });
      } catch (err) {
        // Unlike the cancellation-listener call sites, we are already in an async function
        // about to call finish() and throw — nothing else races this, so cleanup is awaited
        // here rather than fired-and-forgotten (SEC-007: "await where lifecycle ordering allows it").
        await terminateChildTreeBestEffort(
          {
            listProcessSnapshots: listProcessSnapshotsFn,
            collectProcessTreePids: collectProcessTreePidsFn,
            stopProcesses: stopProcessesFn,
          },
          child,
          input.runId,
          'acp-attach-failure',
          onCleanupFailureFn,
        );
        await cleanupPromptFile();
        await lifecycle.finish({ runId: input.runId, status: 'failed', code: null, signal: null, resumable: false });
        throw new AgentExecutorError(
          'AGENT_SPAWN_FAILED',
          `AgentExecutor: could not attach ACP session for agent \"${def.id}\": ${errorMessage(err)}`,
        );
      }
      return;
    }

    if (streamFormat === 'pi-rpc') {
      try {
        wirePiRpcLifecycle({
          runId: input.runId,
          agentId: def.id,
          child,
          lifecycle,
          prompt: input.prompt,
          cwd: input.cwd,
          model: input.model,
          imagePaths: input.imagePaths ?? [],
          uploadRoot: input.uploadRoot,
          attachPiRpcSession: attachPiRpcSessionFn,
          listProcessSnapshots: listProcessSnapshotsFn,
          collectProcessTreePids: collectProcessTreePidsFn,
          stopProcesses: stopProcessesFn,
          onCleanupFailure: onCleanupFailureFn,
          cleanupPromptFile,
          journal,
          classifyFailure,
        });
      } catch (err) {
        // Same discipline as the ACP attach-failure path directly above: await cleanup here
        // rather than fire-and-forget (SEC-007).
        await terminateChildTreeBestEffort(
          {
            listProcessSnapshots: listProcessSnapshotsFn,
            collectProcessTreePids: collectProcessTreePidsFn,
            stopProcesses: stopProcessesFn,
          },
          child,
          input.runId,
          'pi-rpc-attach-failure',
          onCleanupFailureFn,
        );
        await cleanupPromptFile();
        await lifecycle.finish({ runId: input.runId, status: 'failed', code: null, signal: null, resumable: false });
        throw new AgentExecutorError(
          'AGENT_SPAWN_FAILED',
          `AgentExecutor: could not attach pi-rpc session for agent \"${def.id}\": ${errorMessage(err)}`,
        );
      }
      return;
    }

    writePromptToStdin(def, child, input.prompt, stdinHandle!);
  }

  return { run };
}
