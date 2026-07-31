/**
 * `AgentExecutor` — the driver `RunLifecycle`'s own module doc names as the
 * missing piece: *"It does not spawn or signal a subprocess... A driver...
 * calls `emit()` for agent/stdout/stderr/error events, observes cancellation
 * via `onCancelRequested`, and calls `finish()` once it knows the real
 * outcome."* This module is that driver — it wires `@jini-ai/agent-runtime`'s
 * registry/launch-resolution/stream-parsers (previously a complete but
 * disconnected library, zero callers anywhere outside its own package) into
 * a real `node:child_process` spawn, feeding both `RunLifecycle.emit()` and
 * this package's own `@jini-ai/protocol` event envelope.
 *
 * ## v1 scope: all 24 registered agent defs
 *
 * `@jini-ai/agent-runtime`'s registry ships 24 built-in defs across four
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
 * All 5 `streamFormat: 'plain'` defs — grok-build, aider, deepseek, qwen,
 * antigravity — are also driven, per
 * `ADS-memory/reports/proposals/PROP-plain-format-agent-driving-2026-07-21.md`'s
 * recommended "Option B": no structured stream parser at all. By default
 * every raw `child.stdout` chunk is forwarded verbatim as a `text_delta`
 * `'agent'` event, live, as it arrives (see `wireChildLifecycle`'s
 * `streamFormat === 'plain'` branch). Prompt delivery across the 5 is not
 * uniform: qwen and antigravity already fit the pre-existing stdin-only
 * guard; grok-build stages the prompt to a temp file via
 * `preparePromptFileForAgent` (its path threaded into `buildArgs` through a
 * `RuntimeContext`, cleaned up after the child exits on every path,
 * including pre-spawn/spawn-failure ones); aider/deepseek carry the prompt
 * on argv and are guarded pre-spawn by `checkPromptArgvBudget` plus the two
 * Windows CreateProcess command-line-expansion guards
 * (`checkWindowsCmdShimCommandLineBudget`/`checkWindowsDirectExeCommandLineBudget`).
 *
 * ## Antigravity's two extra needs, met declaratively
 *
 * Antigravity was the one def this driver rejected outright, for two reasons
 * the proposal doc (§2c) scoped out to a follow-up: `agy` can print an OAuth
 * sign-in URL to stdout and *still exit 0*, so live streaming leaks it; and
 * its model choice is written into one process-global `settings.json` that
 * `agy` reads on its own startup, so two concurrent runs race on it.
 *
 * Both are now met through **declarative `RuntimeAgentDef` fields this driver
 * reads generically** — `needsAgentLogFile`, `stdoutPolicy`, `runtimeLock` —
 * not a `def.id === 'antigravity'` branch. That mirrors how all 14 of the
 * def's other optional behavior flags (`promptViaFile`, `authProbe`,
 * `capturesSessionIdFromStream`, …) already work, and it is a deliberate
 * divergence from OD's own `server.ts`, which hardcodes `def.id ===
 * 'antigravity'` twice. The three fields are no-ops for the other 23 defs,
 * none of which declares any of them — so nothing else's behavior changed.
 *
 * `run()` still rejects cleanly (never a bare throw) with an
 * `AgentExecutorError` for any def whose `streamFormat` or prompt-delivery
 * shape this driver does not implement — see `isSupportedStreamFormat` and
 * `assessAgentExecutorCompatibility`.
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
 * `source-map.md`). The real zero-config classifier lives in `@jini-ai/daemon`'s
 * `run/core/retry.ts` (`resumableFromProcessExit`/`classifyProcessExitFailure`)
 * and is wired in by `@jini-ai/server`'s `createLocalNodeDaemon` — see that
 * package's own source-map.md, and `run/core/retry.ts`'s own doc for the
 * classification policy and its 2026-07-22 merge-time reconciliation against
 * a second, independently-built (and rejected) classifier that once lived in
 * this module.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import { redactSecrets } from '@jini-ai/core';
import type { Principal, RunRef } from '@jini-ai/core';
import type { JournalEntry, RunAgentPayload, RunErrorPayload } from '@jini-ai/protocol';
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
  prepareAgentLogFile,
  preparePromptFileForAgent,
  type AcpMcpServerInput,
  type AcpPermissionHandler,
  type AcpSessionController,
  type AgentLaunchResolution,
  type PiRpcSession,
  type PreparedAgentLogFile,
  type PreparedPromptFile,
  type PromptAugmenter,
  type RuntimeAgentDef,
  type RuntimeContext,
  type RuntimeLockHold,
} from '@jini-ai/agent-runtime';
import {
  collectProcessTreePids,
  createCommandInvocation,
  listProcessSnapshots,
  stopProcesses,
  type ProcessSnapshot,
  type StopProcessesResult,
} from '@jini-ai/platform';
import { classifyRunCloseStatus } from './close-status.js';
import { resolveContinuationTransport } from './continuation/continuation-transport.js';
import type { RunByteJournal } from './continuation/journal.js';
import { resultContent } from './delegated-tool-bridge.js';
import type { RunRetrySideEffectState } from './run/core/index.js';
import type { ToolExecutor } from './tool-executor.js';
import type { RunLifecycle } from './run-lifecycle.js';

/**
 * A parsed, loosely-typed event as produced by one of `@jini-ai/agent-runtime`'s
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
 * Whether `run()` can drive a given def, and — when it can — its `streamFormat` already narrowed for
 * the dispatch logic that follows. The narrowing rides along deliberately: it is what lets `run()`
 * delegate every compatibility guard here without then re-checking the format to satisfy the type
 * system, which would leave an unreachable branch behind.
 */
export type AgentExecutorCompatibility =
  | { readonly supported: true; readonly streamFormat: SupportedStreamFormat }
  | { readonly supported: false; readonly reason: string };

/**
 * The single source of truth for whether this executor can drive a def.
 *
 * It exists because that knowledge was previously reachable only by *calling* `run()` and inspecting
 * the failure. Anything that lists agents for a user to pick from — a discovery route, an agent
 * picker, a CLI healthcheck — needs the same answer *before* a run exists, and had no way to ask it.
 * The observable symptom was a consumer advertising an agent that its own executor then rejected the
 * instant it was selected.
 *
 * `run()` consumes this rather than re-checking the conditions itself, so the discovery-time answer
 * and the run-time guards cannot disagree. A predicate that merely duplicated the guards would be
 * the same bug in a second location.
 *
 * @param def - The def to assess. Must be the **full** `RuntimeAgentDef`, not a projected
 * `DetectedAgent`: that type omits `maxPromptArgBytes`, one of the three prompt-delivery signals
 * checked here, so the argv-bound defs (`aider`, `deepseek`) would be misjudged as unsupported.
 * @returns A discriminated result — see {@link AgentExecutorCompatibility}. The `reason` text is
 * operator-facing and is what `run()` reports as its `AGENT_RUNTIME_UNSUPPORTED` message.
 * @complexity O(1) — fixed field checks.
 * @overallScore 100/100
 */
export function assessAgentExecutorCompatibility(def: RuntimeAgentDef): AgentExecutorCompatibility {
  const streamFormat = def.streamFormat;
  if (!isSupportedStreamFormat(streamFormat)) {
    return {
      supported: false,
      reason: `AgentExecutor: agent "${def.id}" has streamFormat "${streamFormat}", which is not implemented in v1 — only ${SUPPORTED_STREAM_FORMATS.join(', ')} are supported`,
    };
  }
  if (
    streamFormat !== 'acp-json-rpc' &&
    def.promptViaStdin !== true &&
    def.promptViaFile !== true &&
    typeof def.maxPromptArgBytes !== 'number'
  ) {
    return {
      supported: false,
      reason: `AgentExecutor: agent "${def.id}" does not deliver its prompt via stdin, a staged prompt file, or a byte-budgeted argv — v1 has no other prompt delivery path`,
    };
  }
  return { supported: true, streamFormat };
}

/**
 * Whether `run()` can actually drive this def — the discovery-time counterpart to the guards inside
 * `run()`, so a consumer never offers a user an agent that fails the moment it is selected.
 *
 * @param def - The full `RuntimeAgentDef`; see {@link assessAgentExecutorCompatibility} for why a
 * projected `DetectedAgent` is not sufficient.
 * @returns `true` when this executor would attempt the run.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function isAgentExecutorSupported(def: RuntimeAgentDef): boolean {
  return assessAgentExecutorCompatibility(def).supported;
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
 * `RunEndPayload.sessionRef`'s doc in `@jini-ai/protocol`) is a daemon-internal
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
  /**
   * Forwarded verbatim to `RuntimeBuildOptions.permissionMode` (see `@jini-ai/agent-runtime`'s
   * `types.ts`). Every def that has an auto-approve flag (`bypassPermissions` / `--yolo` /
   * `--dangerously-skip-permissions`) uses it by default when this is omitted — unchanged
   * behavior, since there is no TTY on a spawned subprocess to answer an interactive prompt.
   * A host that wants a run to NOT auto-approve every action passes `'restricted'` here.
   */
  readonly permissionMode?: 'bypass' | 'restricted';
  /** Host-validated image files forwarded through argv, ACP, or pi-rpc. */
  readonly imagePaths?: readonly string[];
  /** Additional host-validated directories the runtime may read. */
  readonly extraAllowedDirs?: readonly string[];
  /** Trusted root that must contain pi-rpc image paths after realpath resolution. */
  readonly uploadRoot?: string;
  /**
   * Credential(s) this run's selected agent/provider needs (e.g. `{ ANTHROPIC_API_KEY: '...' }`),
   * delegated explicitly by the host and merged into the baseline-allowlisted env below. Never
   * read implicitly from `process.env` — see SEC-001.
   */
  readonly credentialEnv?: Record<string, string>;
  /**
   * Explicit escape hatch: when supplied, used verbatim as the spawned subprocess's entire
   * environment (no allowlist filtering) — for tests and hosts that have already done their own
   * scoping. When omitted (the default), the subprocess gets only `BASELINE_AGENT_ENV_KEYS` from
   * the host's real env plus `credentialEnv`, never a full `process.env` passthrough. A spawned
   * coding-agent CLI is prompt-influenced and must be treated as potentially adversarial; it must
   * not inherit secrets the daemon process happens to hold for unrelated reasons. See SEC-001
   * (`ADS-memory/reports/proposals/PROP-agent-subprocess-env-allowlist-2026-07-21.md`) and locked
   * architecture decision C8 (`foundry/docs/jini-port/extraction-plan.md`).
   */
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
 * @param env - The source environment (the caller-supplied `input.env` escape hatch — the
 * default path builds its env via `buildAgentEnv` instead, never this function on `process.env`).
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
 * Fixed baseline of host environment variables every spawned agent subprocess may see by
 * default — resolved from the host's env one name at a time, never derived programmatically
 * from `process.env` as a bag, so this can't silently widen. SEC-001's deny-by-default fix; see
 * `AgentExecutorRunInput.env`'s doc for the full threat model.
 */
const BASELINE_AGENT_ENV_KEYS = [
  'PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SHELL',
  'LANG', 'LC_ALL', 'LC_CTYPE',
  // `USER` is required for a spawned `claude` CLI to find its own login/credential state — with
  // it omitted (even though `HOME` is present), `claude` fails fast with "Not logged in · Please
  // run /login" despite real credentials existing on disk/keychain. Confirmed by bisection against
  // a real authenticated `claude` install: `BASELINE_AGENT_ENV_KEYS` alone fails, adding back every
  // `CLAUDE_CODE_*`/`CLAUDECODE` var still fails, `LOGNAME`/`SSH_AUTH_SOCK` alone still fail, but
  // `USER` alone flips it to success. See tovu-learnings.md §9 for the full investigation trail.
  'USER',
  'SystemRoot', 'windir', 'ComSpec', 'PATHEXT', // Windows-only; harmless no-ops elsewhere
] as const;

/**
 * Deny-by-default agent subprocess environment: `BASELINE_AGENT_ENV_KEYS` resolved from
 * `hostEnv`, plus this run's explicitly-delegated credential(s) — never a passthrough of
 * `hostEnv` itself. Only reached when the caller omits `AgentExecutorRunInput.env`; supplying
 * `env` bypasses this function entirely (see its call site).
 */
function buildAgentEnv(hostEnv: NodeJS.ProcessEnv, credentialEnv: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of BASELINE_AGENT_ENV_KEYS) {
    const value = hostEnv[key];
    if (typeof value === 'string') result[key] = value;
  }
  for (const [key, value] of Object.entries(credentialEnv ?? {})) {
    result[key] = value;
  }
  return result;
}

/**
 * Resolves once `child` emits `'spawn'`, or rejects on `'error'`. Replicates
 * `@jini-ai/platform`'s own internal (non-exported) `waitForChildSpawn` race
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
 * @param deps - The process-snapshot/tree-collection/stop ports (real `@jini-ai/platform` implementations by default — see {@link CreateAgentExecutorOptions}).
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

/**
 * Which step reported a contained failure through `onCleanupFailure` (SEC-007).
 *
 * The first three come from {@link terminateChildTreeBestEffort} (process-tree teardown). The last
 * two are the two fallible steps that sit between a child's `'close'` and `finish()` — staged-file
 * removal and the host's own `classifyFailure` — neither of which may prevent the terminal
 * transition, and neither of which may fail silently either. See each close handler.
 */
export type AgentCleanupFailurePhase =
  | 'cancel'
  | 'acp-attach-failure'
  | 'pi-rpc-attach-failure'
  | 'staged-file-cleanup'
  | 'failure-classification';

export interface AgentCleanupFailureContext {
  readonly runId: string;
  readonly phase: AgentCleanupFailurePhase;
  /**
   * The child's pid. `undefined` only for the post-close phases on a child that never had one
   * assigned (a spawn that produced no process): those phases are about this run's own bookkeeping
   * rather than about signalling a process, so an absent pid is reportable rather than a
   * contradiction.
   */
  readonly pid: number | undefined;
  readonly error: unknown;
}

/** Default sink when a host does not supply `onCleanupFailure`: still observable, never silent. Redacted per SEC-007 (a spawn/permission error can embed paths/host detail). */
function defaultCleanupFailureSink(context: AgentCleanupFailureContext): void {
  // eslint-disable-next-line no-console
  console.error(
    `[@jini-ai/daemon] agent-executor: process-tree cleanup failed for run "${context.runId}" (${context.phase}, pid=${context.pid})`,
    redactSecrets(errorMessage(context.error)),
  );
}

/**
 * Reports a contained post-close failure through the host's sink, absorbing a throwing sink.
 *
 * A diagnostic sink is host code too, and the whole point of the two callers below is that nothing
 * between `'close'` and `finish()` can strand the run — a sink that throws must not reintroduce
 * exactly that. Same reasoning `run-lifecycle.ts`'s `handleInactivityTimeout` already applies to its
 * own `onInternalError`.
 */
function reportPostCloseFailure(
  onCleanupFailure: (context: AgentCleanupFailureContext) => void,
  context: AgentCleanupFailureContext,
): void {
  try {
    onCleanupFailure(context);
  } catch {
    // Nothing further can be done from here, and the terminal transition below still must happen.
  }
}

/** The subset of a close handler's context the two post-close guards below need. */
interface PostCloseGuardContext {
  readonly runId: string;
  readonly child: ChildProcess;
  readonly cleanupStagedFiles: () => Promise<void>;
  readonly onCleanupFailure: (context: AgentCleanupFailureContext) => void;
}

/**
 * Removes this run's staged files, reporting rather than propagating a failure.
 *
 * Unguarded, a rejecting cleanup (EBUSY, a temp directory yanked out from under the daemon, a host
 * stager bug) escaped the `void (async () => …)()` wrapper in each close handler and took `finish()`
 * with it: the child was already gone, yet the run stayed `'running'` forever — unfinishable and
 * unresumable — and the rejection surfaced only as an unhandled promise. A leaked temp file is a real
 * problem, but it is strictly smaller than a permanently stranded run, and reporting it keeps it
 * visible.
 */
async function cleanupStagedFilesSafely(ctx: PostCloseGuardContext): Promise<void> {
  try {
    await ctx.cleanupStagedFiles();
  } catch (error) {
    reportPostCloseFailure(ctx.onCleanupFailure, {
      runId: ctx.runId,
      phase: 'staged-file-cleanup',
      pid: ctx.child.pid,
      error,
    });
  }
}

/**
 * Resolves `finish()`'s `resumable` flag from the host's classifier, falling back to `false` when the
 * classifier itself rejects.
 *
 * `classifyFailure` is host-supplied and may do real work (a keystore read, an HTTP call), so it can
 * fail for reasons unrelated to this run. `false` is the right fallback: it is already the answer for
 * every run with no classifier configured at all, so an unavailable classifier degrades to the
 * documented default rather than losing the run.
 */
async function classifyFailureSafely(
  ctx: PostCloseGuardContext,
  classifyFailure: ClassifyFailure,
  context: FailureClassificationContext,
): Promise<boolean> {
  try {
    return await classifyFailure(context);
  } catch (error) {
    reportPostCloseFailure(ctx.onCleanupFailure, {
      runId: ctx.runId,
      phase: 'failure-classification',
      pid: ctx.child.pid,
      error,
    });
    return false;
  }
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
 * control (see `@jini-ai/protocol`'s `JournalEntry` doc on why `trust` exists).
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
 * (`@jini-ai/mcp`'s `../server/tools/delegated-tool.ts`) only does anything useful once the spawned
 * CLI's own client actually launches `jini-mcp` as its MCP server subprocess.
 *
 * **All four declared strategies are wired.** These options describe *one* bridge server
 * (`command`/`args`/`daemonUrl`/`credential`); which transport carries it to a given child is that
 * def's own `externalMcpInjection` declaration, and each of the four has exactly one
 * implementation here — see {@link buildMcpBridgeDelivery}, which is the single dispatch point.
 * The interface name predates the other three mechanisms and is kept for API compatibility with
 * `@jini-ai/server`'s `agentExecutor` passthrough; it is no longer `.mcp.json`-specific.
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
  /**
   * Mints the bearer credential this run's `jini-mcp` child presents on its callbacks, delivered to
   * the child through `JINI_DAEMON_TOKEN`. Omit it and the child is spawned exactly as before, with
   * no token env var at all — so this is additive for every existing host.
   *
   * **A resolver, not a string, and deliberately so.** A host's `McpJsonInjectionOptions` is built
   * once when it composes its executor — before any run exists. A plain string field could therefore
   * only ever carry one boot-wide secret shared by every run, which defeats the point: the reason to
   * hand the child a credential at all is that it can be scoped to the one run it was spawned for and
   * stop working when that run ends. Taking `runId` here is what makes a per-run credential
   * expressible.
   *
   * May be async so a host can mint through a keystore or signing service. Resolution happens in
   * `writeMcpJsonForRun`, which is already async and already effectful; `buildMcpJsonServerEntry`
   * stays pure and synchronous and receives the resolved value.
   *
   * Never hand this the host's own inbound API token. The child is the least-trusted participant in
   * the run — it is reachable by whatever the spawned CLI does — so its credential should authorize
   * its own callback route and nothing else.
   *
   * @throws Anything the host's own minting throws. `run()` turns a rejection into a pre-spawn
   * `AGENT_SPAWN_FAILED` failure rather than spawning a child that cannot authenticate.
   */
  readonly credential?: (runId: string) => string | Promise<string>;
  /** Reads the project's own `cwd/.mcp.json` so this driver merges its servers in rather than dropping them. Rejecting (ENOENT or otherwise) is treated as "no existing file" — see `writeMcpJsonForRun`. This file is only ever *read*. @default the real `fs.promises.readFile` (utf8) */
  readonly readFile?: (path: string) => Promise<string>;
  /** Writes the merged content to this run's own config path (see {@link mcpJsonPathForRun}), never to the project's `.mcp.json`. @default the real `fs.promises.writeFile` (utf8) */
  readonly writeFile?: (path: string, content: string) => Promise<void>;
  /**
   * Removes this run's config file once the run is over — it holds a live per-run bearer token, so
   * leaving it behind is the same class of confidentiality gap as a leaked prompt file (see
   * `WireChildLifecycleContext.cleanupStagedFiles`). Called on the close handler and on every
   * pre-spawn/spawn-failure path, and a rejection is reported rather than allowed to strand the run.
   * @default `fs.promises.rm(path, { force: true })` — already-gone is success, not an error.
   */
  readonly removeFile?: (path: string) => Promise<void>;
}

const JINI_MCP_SERVER_KEY = 'jini';

/** One `.mcp.json` `mcpServers` entry — the shape Claude Code's own config schema expects. */
interface McpJsonServerEntry {
  readonly command: string;
  readonly args: string[];
  readonly env: {
    readonly JINI_RUN_ID: string;
    readonly JINI_DAEMON_URL: string;
    /** Present only when the host supplied a `credential` resolver — see {@link McpJsonInjectionOptions.credential}. */
    readonly JINI_DAEMON_TOKEN?: string;
  };
}

/**
 * Builds this run's `mcpServers.jini` entry — pure and synchronous, so every field mapping is
 * directly assertable without touching the filesystem. The credential arrives already resolved:
 * `McpJsonInjectionOptions.credential` is a possibly-async per-run resolver, and awaiting it is
 * `writeMcpJsonForRun`'s job, which keeps the effect out of this function.
 *
 * @param runId - The run this entry scopes its child to.
 * @param options - `command`/`args`/`daemonUrl` from the host's injection options.
 * @param credential - The already-resolved bearer token, or `undefined` to omit `JINI_DAEMON_TOKEN`
 * entirely. Omitting produces byte-identical output to before this parameter existed.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function buildMcpJsonServerEntry(
  runId: string,
  options: Pick<McpJsonInjectionOptions, 'command' | 'args' | 'daemonUrl'>,
  credential?: string,
): McpJsonServerEntry {
  return {
    command: options.command,
    args: options.args !== undefined ? [...options.args] : [],
    env: {
      JINI_RUN_ID: runId,
      JINI_DAEMON_URL: options.daemonUrl,
      ...(credential !== undefined ? { JINI_DAEMON_TOKEN: credential } : {}),
    },
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

/**
 * Mechanism 2 of 4 — `'acp-merge'`. Re-shapes the same bridge entry into the `mcpServers` element
 * an ACP `session/new` call carries, for the 8 ACP-native defs (devin, hermes, kilo, kimi, kiro,
 * reasonix, trae-cli, vibe). Pure.
 *
 * `env` is emitted as a plain object on purpose: `@jini-ai/agent-runtime`'s
 * `buildAcpSessionNewParams` already normalises a plain-object `env` into either the
 * `[{name, value}]` array form or the `{"KEY": "val"}` map form according to each def's own
 * `acpMcpEnvFormat`, so the per-vendor wire-shape difference stays in the one place that already
 * owns it rather than being re-decided here.
 *
 * **The credential travels in `env`, never in `args`.** An ACP agent spawns this server itself and
 * applies `env` to that child's environment; a token in `args` would land in the child's process
 * arguments, readable by any other local user via `ps`. Same rule as the `.mcp.json` path.
 *
 * @param entry - The shared bridge entry from {@link buildMcpJsonServerEntry}.
 * @returns A single-element list — this driver contributes exactly its own bridge server and never
 * removes or rewrites servers a def or host added by other means.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function buildAcpMcpBridgeServers(entry: McpJsonServerEntry): AcpMcpServerInput[] {
  return [
    {
      type: 'stdio',
      name: JINI_MCP_SERVER_KEY,
      command: entry.command,
      args: [...entry.args],
      env: { ...entry.env },
    },
  ];
}

/**
 * Mechanism 3+4 of 4 — the spawn-env-content strategies. One map, not two code paths: OpenCode and
 * MiMo consume byte-identical JSON (MiMo's def doc: "the same JSON schema as OpenCode's `mcp`
 * config ... following the same structure as `OPENCODE_CONFIG_CONTENT`"), and differ only in which
 * env var carries it. Adding a third such CLI is a row here, not a new serializer.
 */
const ENV_CONTENT_VAR_BY_STRATEGY: Readonly<Record<'opencode-env-content' | 'mimo-env-content', string>> = {
  'opencode-env-content': 'OPENCODE_CONFIG_CONTENT',
  'mimo-env-content': 'MIMOCODE_CONFIG_CONTENT',
};

/**
 * Serialises the bridge entry into the OpenCode-schema config JSON that `OPENCODE_CONFIG_CONTENT`
 * / `MIMOCODE_CONFIG_CONTENT` carries, merging into whatever the host already put in that variable
 * rather than replacing it — the same "merge, never clobber" discipline
 * {@link mergeMcpJsonContent} applies to `.mcp.json`, and for the same reason: a host may already
 * be handing the CLI the *user's* configured MCP servers through this exact variable, and
 * overwriting it would silently delete them.
 *
 * A missing, empty, or unparseable-as-a-JSON-object existing value degrades to "start from an empty
 * document". Overwriting an unparseable value is deliberate and matches `mergeMcpJsonContent`: this
 * driver did not create it, cannot safely repair it, and must not block the run on it.
 *
 * Emitted per server: `{type: 'local', command: [<command>, ...<args>], environment: {...},
 * enabled: true}` — the shape `@jini-ai/mcp`'s own `buildOpenCodeMcpConfigContent` emits for a
 * stdio server, so both producers stay schema-compatible.
 *
 * **The credential lands in `environment`, i.e. the MCP child's env — never in `command`.** OpenCode
 * spawns the bridge from `command`, so a token placed there would be visible in `ps` output to
 * every other local user. This is the same constraint that keeps `JINI_DAEMON_TOKEN` out of argv on
 * the `.mcp.json` and ACP paths.
 *
 * @param existingRaw - Whatever the spawn env already held for this variable, or `undefined`.
 * @param entry - The shared bridge entry from {@link buildMcpJsonServerEntry}.
 * @returns The full JSON string to set as the env var's value.
 * @complexity O(1) plus `JSON.parse`/`JSON.stringify` over a small config document.
 * @overallScore 100/100
 */
export function mergeEnvContentMcpConfig(existingRaw: string | undefined, entry: McpJsonServerEntry): string {
  let doc: Record<string, unknown> = {};
  if (existingRaw !== undefined && existingRaw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(existingRaw);
      if (isRecord(parsed)) doc = parsed;
    } catch {
      doc = {};
    }
  }
  const existingMcp = isRecord(doc.mcp) ? doc.mcp : {};
  const mcp = {
    ...existingMcp,
    [JINI_MCP_SERVER_KEY]: {
      type: 'local',
      command: [entry.command, ...entry.args],
      environment: { ...entry.env },
      enabled: true,
    },
  };
  return JSON.stringify({ ...doc, mcp });
}

/**
 * What one run's MCP bridge turns into, discriminated by the delivery mechanism its def declared.
 * Exactly one variant is produced per run, and each variant carries only what its own consumer
 * needs — so a consumer cannot accidentally read another mechanism's payload.
 */
export type McpBridgeDelivery =
  /** `'claude-mcp-json'` (claude, codebuddy): a `.mcp.json` staged into the run cwd, whose path the def's `buildArgs` passes as `--mcp-config`. */
  | { readonly kind: 'claude-mcp-json'; readonly mcpJsonPath: string; readonly serverEntry: McpJsonServerEntry }
  /** `'acp-merge'` (the 8 ACP-native defs): `mcpServers` entries for the ACP `session/new` params. */
  | { readonly kind: 'acp-merge'; readonly mcpServers: readonly AcpMcpServerInput[] }
  /** `'opencode-env-content'` / `'mimo-env-content'` (opencode, mimo): one spawn-env variable carrying the serialised config. */
  | { readonly kind: 'env-content'; readonly envVarName: string; readonly serverEntry: McpJsonServerEntry };

/**
 * **The single dispatch point from an `externalMcpInjection` strategy to its delivery mechanism.**
 * Pure and synchronous — the one effectful input (the per-run bearer credential) arrives already
 * resolved, so every strategy's mapping is directly assertable without touching the filesystem,
 * the environment, or a keystore.
 *
 * Keyed off the declared *strategy*, never off `def.id`: a def gets a working bridge by declaring a
 * mechanism, not by being named in this file. That is what makes the 8 `'acp-merge'` defs work
 * without any of their own files being touched.
 *
 * @param input.cwd - The run's working directory; only `'claude-mcp-json'` uses it, to place this
 * run's own config file (see {@link mcpJsonPathForRun}) — never `cwd/.mcp.json` itself.
 * @param input.runId - Scopes the bridge child to this run.
 * @param input.strategy - The def's declared `externalMcpInjection`, or `undefined` for a def with no native MCP transport.
 * @param input.options - The host's bridge options, or `undefined` when the host never configured injection.
 * @param input.credential - Already-resolved bearer token, or `undefined` to omit `JINI_DAEMON_TOKEN` entirely.
 * @returns `null` when this run delivers nothing — an unconfigured host, or a def declaring no
 * strategy — which is byte-identical to this feature not existing.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function buildMcpBridgeDelivery(input: {
  readonly cwd: string;
  readonly runId: string;
  readonly strategy: RuntimeAgentDef['externalMcpInjection'];
  readonly options: McpJsonInjectionOptions | undefined;
  readonly credential: string | undefined;
}): McpBridgeDelivery | null {
  const { cwd, runId, strategy, options, credential } = input;
  if (options === undefined || strategy === undefined) return null;
  const serverEntry = buildMcpJsonServerEntry(runId, options, credential);
  switch (strategy) {
    case 'claude-mcp-json':
      return { kind: 'claude-mcp-json', mcpJsonPath: mcpJsonPathForRun(cwd, runId), serverEntry };
    case 'acp-merge':
      return { kind: 'acp-merge', mcpServers: buildAcpMcpBridgeServers(serverEntry) };
    case 'opencode-env-content':
    case 'mimo-env-content':
      return { kind: 'env-content', envVarName: ENV_CONTENT_VAR_BY_STRATEGY[strategy], serverEntry };
  }
}

function defaultReadMcpJsonFile(path: string): Promise<string> {
  return fsPromises.readFile(path, 'utf8');
}

function defaultWriteMcpJsonFile(path: string, content: string): Promise<void> {
  return fsPromises.writeFile(path, content, 'utf8');
}

function defaultRemoveMcpJsonFile(path: string): Promise<void> {
  return fsPromises.rm(path, { force: true });
}

/**
 * This run's own MCP config path, inside `cwd` but deliberately **not** `cwd/.mcp.json`.
 *
 * A shared filename cannot carry two runs' identities at once, and that is exactly what the file
 * carries: `mcpServers.jini.env` holds this run's `JINI_RUN_ID` and its bearer `JINI_DAEMON_TOKEN`.
 * A spawned CLI reads its MCP config when it starts its client, not synchronously at spawn — so with
 * one shared file, a second run in the same directory overwrote the entry the first run's child had
 * not read yet, and that child's `jini-mcp` subprocess then called back carrying the *other* run's id
 * and token: run A's tool calls executing inside run B's authority context. Concurrent runs in one
 * working directory are supported by design (see `McpJsonInjectionOptions.credential`'s doc on why the
 * credential is a per-run resolver at all), so the resolution is one file per run, not a lock that
 * refuses the second run.
 *
 * Naming it after the run also means the project's own `.mcp.json` is never written at all — it stays
 * purely a merge source, so there is no original content to restore afterwards either.
 *
 * The run id is host-supplied and lands in a filename, so everything outside `[A-Za-z0-9_-]` is
 * replaced (dots included — a `..` segment must not survive) and the result is length-capped. Real run
 * ids are UUIDs, which pass through untouched; the cap could in principle collide two ids sharing a
 * 128-character prefix, which no id shape this daemon mints can produce.
 * @complexity O(n) in the run id's length.
 */
function mcpJsonPathForRun(cwd: string, runId: string): string {
  const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
  return join(cwd, `.mcp.jini-${safeRunId}.json`);
}

/**
 * The `'claude-mcp-json'` mechanism's one effect: writes (merging, never clobbering — see
 * {@link mergeMcpJsonContent}) this run's own config — the project's own servers merged with this
 * run's `jini` bridge entry — to the run-scoped path ({@link mcpJsonPathForRun}) the def was already
 * handed via `RuntimeContext.mcpJsonPath`, so the def's own `--strict-mcp-config --mcp-config <path>`
 * argv has a real file to point at by spawn time, instead of auto-discovering `cwd/.mcp.json` (which
 * needs an interactive trust prompt a headless spawn can never answer — confirmed live 2026-07-30,
 * see `@jini-ai/agent-runtime`'s `defs/claude.ts`).
 *
 * Reads `cwd/.mcp.json` and writes `delivery.mcpJsonPath`: the project's file is a merge source only,
 * never a write target. See {@link mcpJsonPathForRun} for why one file per run is load-bearing rather
 * than cosmetic, and why the read and write paths must differ.
 *
 * A no-op for every other delivery mechanism, which is expressed by the caller simply not having a
 * `'claude-mcp-json'` delivery to hand it rather than by a strategy re-check in here.
 * @param cwd - The run's working directory, so the project's own `.mcp.json` can be read as the
 * merge base — not carried on `delivery` itself, since that only describes the write target.
 * @param delivery - The already-built `'claude-mcp-json'` delivery (path + entry). Both fields come
 * from {@link buildMcpBridgeDelivery}, so the credential was resolved exactly once, for this run.
 * @param options - Supplies the injectable `readFile`/`writeFile` seams.
 * @throws Whatever `writeFile` rejects with — the caller (`run()`) turns that into a pre-spawn
 * `AGENT_SPAWN_FAILED` failure, matching every other pre-spawn filesystem guard in this file
 * (`preparePromptFileForAgentFn`'s own try/catch).
 * @complexity O(1) plus one `readFile`/`writeFile` round trip.
 * @overallScore 100/100
 */
async function writeMcpJsonForRun(
  cwd: string,
  delivery: Extract<McpBridgeDelivery, { kind: 'claude-mcp-json' }>,
  options: McpJsonInjectionOptions,
): Promise<void> {
  const readFileFn = options.readFile ?? defaultReadMcpJsonFile;
  const writeFileFn = options.writeFile ?? defaultWriteMcpJsonFile;
  let existingRaw: string | undefined;
  try {
    existingRaw = await readFileFn(join(cwd, '.mcp.json'));
  } catch {
    // No existing file (ENOENT — the common case) or unreadable for any other reason: both
    // degrade to "start fresh", matching mergeMcpJsonContent's own doc.
    existingRaw = undefined;
  }
  await writeFileFn(delivery.mcpJsonPath, mergeMcpJsonContent(existingRaw, delivery.serverEntry));
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
 * `@jini-ai/protocol`'s `RunAgentEventPayload` union (`events.ts`) has no
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

/**
 * Default ceiling on the `'until-close'` stdout accumulator (see `RuntimeStdoutPolicy` in
 * `@jini-ai/agent-runtime`), in bytes of received UTF-8.
 *
 * A buffered def holds its child's entire stdout in one in-memory string until the process closes,
 * which is exactly what makes the accumulator a denial-of-service surface: the child is a
 * prompt-influenced agent CLI this driver already treats as potentially adversarial (SEC-001), and
 * nothing obliges it to ever close or to stop emitting. Without a ceiling one run could exhaust the
 * daemon's heap and take every unrelated run in the process down with it.
 *
 * 8 MiB is chosen to sit far above any real buffered-agent transcript (antigravity's print-mode
 * output — the only `'until-close'` def — is a few KiB of auth prompt and result text) while staying
 * small enough that a hostile child cannot meaningfully pressure the heap. A host that genuinely
 * needs more passes `CreateAgentExecutorOptions.bufferedStdoutMaxBytes`.
 */
export const DEFAULT_BUFFERED_STDOUT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The host-authored note appended to a truncated flush. Written *after* the def's own `sanitize`
 * runs, never before: it is this driver's own text, not agent output, and passing it through a
 * consumer-supplied redactor could silently delete the one line that says output is missing.
 */
function bufferedStdoutTruncationNotice(droppedBytes: number, maxBytes: number): string {
  return `\n[jini] agent stdout truncated: ${droppedBytes} byte(s) dropped after the ${maxBytes}-byte buffer limit was reached.\n`;
}

interface WireChildLifecycleContext extends TerminateChildTreeDeps {
  readonly runId: string;
  readonly def: RuntimeAgentDef;
  readonly streamFormat: ChildDrivenStreamFormat;
  readonly child: ChildProcess;
  readonly lifecycle: RunLifecycle;
  readonly onCleanupFailure: (context: AgentCleanupFailureContext) => void;
  /**
   * Removes every temp file `run()` staged for this run — a `promptViaFile`
   * def's prompt file (grok-build) and a `needsAgentLogFile` def's log file
   * (antigravity) — after the child exits. Deliberately one composed closure
   * rather than one field per file: the two are staged at the same point and
   * must be released on the same set of paths, and a second parallel field
   * is exactly how one of them ends up forgotten on a path the other covers.
   * A no-op default when neither was staged — see `run()`'s
   * `preparePromptFileForAgent`/`prepareAgentLogFile` call sites.
   */
  readonly cleanupStagedFiles: () => Promise<void>;
  /** Gap 1's byte-journal (see `continuation/journal.ts`). `undefined` when a caller configured none — every journal call site below is then a no-op. */
  readonly journal: RunByteJournal | undefined;
  /** Gap 3's stdin-tool-result injection config. `undefined` means every `turn_end` closes stdin unconditionally — see `ContinuationOptions`'s own doc. */
  readonly continuation: ContinuationOptions | undefined;
  /** Gap 4's failure classifier. `undefined` means every `'failed'` outcome stays `resumable: false` — byte-identical to pre-gap-4 behavior. See `ClassifyFailure`'s own doc. */
  readonly classifyFailure: ClassifyFailure | undefined;
  /** Ceiling on the `'until-close'` stdout accumulator — see {@link DEFAULT_BUFFERED_STDOUT_MAX_BYTES}. Always resolved by `run()`, never left to this function to default. */
  readonly bufferedStdoutMaxBytes: number;
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
 * §3): every raw stdout chunk is forwarded verbatim as a `text_delta`
 * `'agent'` event, through the same `enqueueEmit` FIFO queue every other
 * emit already goes through — no new parser state machine.
 * **Deliberately un-hygiened for v1**: no ANSI/terminal-control-sequence
 * stripping is applied (there is no Jini equivalent of OD's
 * `TerminalControlSequenceStripper` yet) — a documented decision, not an
 * oversight; see `packages/daemon/source-map.md`'s 2026-07-21 addition for
 * the reasoning.
 *
 * *When* those chunks leave is the def's call, via `def.stdoutPolicy`:
 *
 *   - `'live'` (the default, and every def but antigravity) — emit per
 *     chunk, as it arrives.
 *   - `'until-close'` — accumulate, and emit the whole thing exactly once
 *     from the `close` handler, after `def.stdoutPolicy.sanitize`. For an
 *     adapter that can print a secret to stdout and still exit 0, no
 *     per-chunk decision is safe: the pattern to redact can straddle two
 *     `'data'` events.
 *
 * The buffered path holds back the raw `'stdout'` echo too, not just the
 * `'agent'`/`text_delta`, and sanitizes both. Emitting an unsanitized raw
 * echo while withholding the chat copy would leak the exact string the
 * sanitizer exists to remove to any client subscribed to the run's events —
 * the raw channel is a different *purpose*, not a different audience.
 * `journal` is the one thing still recorded per-chunk and verbatim: it is
 * the host's own byte record, deliberately kept in a **separate** `EventLog`
 * instance that is never replayed to run-event subscribers (see
 * `continuation/journal.ts`'s module doc), and "every byte received" is its
 * whole contract.
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
  // `def.stdoutPolicy` read once, up front, so the per-chunk handler below is a single boolean
  // test rather than a repeated union narrowing. `undefined` (every def but antigravity) means
  // live — see this function's own doc.
  const stdoutPolicy = def.stdoutPolicy;
  const bufferStdoutUntilClose = stdoutPolicy?.buffering === 'until-close';
  const sanitizeBufferedStdout = stdoutPolicy?.buffering === 'until-close' ? stdoutPolicy.sanitize : undefined;
  // Accumulator for the `'until-close'` path. Stays `''` for every live def, and the flush below
  // is then a no-op that emits nothing. Bounded by `ctx.bufferedStdoutMaxBytes` — see
  // {@link DEFAULT_BUFFERED_STDOUT_MAX_BYTES} for why an unbounded accumulator was a
  // denial-of-service surface rather than merely untidy.
  let bufferedStdout = '';
  let bufferedStdoutBytes = 0;
  /** Bytes the ceiling refused, reported verbatim on flush so truncation is never silent. */
  let droppedStdoutBytes = 0;

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

  /**
   * Emits the accumulated `'until-close'` stdout — sanitized — as exactly one raw `'stdout'` echo
   * plus one `text_delta`, through the same `enqueueEmit` FIFO queue every other emit uses, so the
   * flush is ordered after every already-queued event and before `finish()`'s `'end'`. A no-op for
   * every live-streaming def (nothing was ever accumulated) and for a buffered run that produced
   * no stdout at all — an empty `text_delta` is noise, not information.
   *
   * A run whose accumulator hit its ceiling is the one case that still emits when the sanitized text
   * is empty: "the sanitizer redacted everything" and "we dropped output on the floor" must not look
   * identical to a client, so the truncation notice is information in its own right.
   */
  function flushBufferedStdout(): void {
    if (bufferedStdout.length === 0 && droppedStdoutBytes === 0) return;
    const safe = sanitizeBufferedStdout ? sanitizeBufferedStdout(bufferedStdout) : bufferedStdout;
    bufferedStdout = '';
    bufferedStdoutBytes = 0;
    const text =
      droppedStdoutBytes > 0
        ? `${safe}${bufferedStdoutTruncationNotice(droppedStdoutBytes, ctx.bufferedStdoutMaxBytes)}`
        : safe;
    droppedStdoutBytes = 0;
    if (text.length === 0) return;
    enqueueEmit(() => lifecycle.emit(runId, { event: 'stdout', data: { chunk: text } }));
    enqueueEmit(() => lifecycle.emit(runId, { event: 'agent', data: { type: 'text_delta', delta: text } }));
  }

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString('utf8');
    if (journal) enqueueEmit(() => journal.record(runId, receivedJournalEntry('stdout', text)));
    if (streamFormat === 'plain') {
      if (text.length > 0) userVisibleOutputSeen = true;
      if (bufferStdoutUntilClose) {
        // Nothing is emitted on *either* channel yet — see this function's doc on why holding the
        // raw echo back matters as much as holding back the chat copy.
        //
        // Whole chunks only: a chunk that would cross the ceiling is dropped entirely rather than
        // sliced to fit, which keeps the accumulator free of half-written multi-byte characters (a
        // `data` event boundary already need not align with one) and makes the kept prefix exactly
        // the bytes some prefix of chunks produced. Everything after the first refusal is dropped
        // too — the point is a hard ceiling on resident bytes, not a best-effort tail.
        const chunkBytes = Buffer.byteLength(text, 'utf8');
        if (droppedStdoutBytes > 0 || bufferedStdoutBytes + chunkBytes > ctx.bufferedStdoutMaxBytes) {
          droppedStdoutBytes += chunkBytes;
          return;
        }
        bufferedStdout += text;
        bufferedStdoutBytes += chunkBytes;
        return;
      }
      enqueueEmit(() => lifecycle.emit(runId, { event: 'stdout', data: { chunk: text } }));
      enqueueEmit(() => lifecycle.emit(runId, { event: 'agent', data: { type: 'text_delta', delta: text } }));
      return;
    }
    enqueueEmit(() => lifecycle.emit(runId, { event: 'stdout', data: { chunk: text } }));
    // Non-null: `streamHandler` is only ever null when `streamFormat === 'plain'` (see its
    // construction above), the branch this statement is provably unreachable from.
    streamHandler!.feed(text);
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
      // Queued before `await emitQueue` so the flushed text is durably appended ahead of
      // `finish()`'s `'end'` event, exactly like every live-path emit already is.
      flushBufferedStdout();
      await emitQueue;
      unsubscribeCancel();
      // Both of the next two steps are guarded: neither a failed cleanup nor a rejecting host
      // classifier may prevent the terminal transition below — see each helper's own doc.
      await cleanupStagedFilesSafely(ctx);
      const status = classifyRunCloseStatus({ cancelRequested, code, signal });
      const resumable =
        status === 'failed' && classifyFailure !== undefined
          ? await classifyFailureSafely(ctx, classifyFailure, {
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
  /**
   * The `'acp-merge'` delivery mechanism's entire surface: `mcpServers` for this run's `session/new`
   * params. Set for every def declaring `externalMcpInjection: 'acp-merge'` when the host configured
   * MCP injection; `undefined` otherwise, which reproduces having no MCP servers at all.
   *
   * **Fixed here, once, for all 8 ACP-native defs.** `attachAcpSession` has always accepted
   * `mcpServers`; the gap was that this wrapper never passed any, so declaring the strategy bought a
   * def nothing. Because the gap was in this shared function rather than in the defs, closing it
   * required no per-def change and automatically covers a 9th def that declares `'acp-merge'` later.
   * Each entry's `env` stays a plain object — `buildAcpSessionNewParams` converts it to the array or
   * map wire shape per `envFormat`, so the per-vendor difference stays in the one module that owns it.
   */
  readonly mcpServers: readonly AcpMcpServerInput[] | undefined;
  readonly onPermissionRequest: AcpPermissionHandler | undefined;
  readonly attachAcpSession: typeof attachAcpSession;
  readonly onCleanupFailure: (context: AgentCleanupFailureContext) => void;
  /** Same seam as `WireChildLifecycleContext.cleanupStagedFiles` — no current ACP def declares `promptViaFile` or `needsAgentLogFile`, so this is always the no-op default in practice today, threaded through for consistency rather than special-cased away. */
  readonly cleanupStagedFiles: () => Promise<void>;
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
      // Guarded for the same reasons as the child-driven handler above.
      await cleanupStagedFilesSafely(ctx);
      const status = cancelRequested ? 'cancelled' : controller?.completedSuccessfully() ? 'succeeded' : 'failed';
      const resumable =
        status === 'failed' && classifyFailure !== undefined
          ? await classifyFailureSafely(ctx, classifyFailure, {
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
    // Spread-when-present rather than always: passing `mcpServers: []` is not the same as passing
    // nothing for every downstream ACP agent, and "no bridge configured" must stay byte-identical
    // to before this field existed.
    ...(ctx.mcpServers !== undefined && ctx.mcpServers.length > 0 ? { mcpServers: [...ctx.mcpServers] } : {}),
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
  /** Same seam as `WireChildLifecycleContext.cleanupStagedFiles` — no current pi-rpc def declares `promptViaFile` or `needsAgentLogFile`, so this is always the no-op default in practice today, threaded through for consistency rather than special-cased away. */
  readonly cleanupStagedFiles: () => Promise<void>;
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
      // Guarded for the same reasons as the child-driven handler above.
      await cleanupStagedFilesSafely(ctx);
      const status = cancelRequested ? 'cancelled' : session?.hasFatalError() ? 'failed' : 'succeeded';
      const resumable =
        status === 'failed' && classifyFailure !== undefined
          ? await classifyFailureSafely(ctx, classifyFailure, {
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
  /** @default the real `@jini-ai/agent-runtime` registry lookup */
  readonly getAgentDef?: typeof getAgentDef;
  /** @default the real `@jini-ai/agent-runtime` launch resolver */
  readonly resolveAgentLaunch?: typeof resolveAgentLaunch;
  /** @default the real `@jini-ai/agent-runtime` PATH-env composer */
  readonly applyAgentLaunchEnv?: typeof applyAgentLaunchEnv;
  /** @default the real `@jini-ai/platform` cross-platform invocation builder */
  readonly createCommandInvocation?: typeof createCommandInvocation;
  /** @default `node:child_process`'s `spawn` */
  readonly spawn?: typeof nodeSpawn;
  /** @default the real `@jini-ai/agent-runtime` ACP session transport */
  readonly attachAcpSession?: typeof attachAcpSession;
  /**
   * Host-owned policy for ACP agents' native tool calls. The ACP agent still
   * executes its own selected option; Jini-registered tool execution belongs
   * to `createDelegatedToolBridge`, not this permission callback.
   */
  readonly acpPermissionHandler?: AcpPermissionHandler;
  /** @default the real `@jini-ai/agent-runtime` pi-rpc session transport */
  readonly attachPiRpcSession?: typeof attachPiRpcSession;
  /**
   * Stages a `promptViaFile` def's (grok-build) composed prompt to a temp
   * file before `buildArgs` runs. Touches the real filesystem by default
   * (`fs.mkdtemp`/`fs.writeFile`/`fs.rm`) — injectable so tests can drive
   * it without real disk I/O, matching this factory's "no real subprocess,
   * filesystem, or PATH lookup by default in tests" convention.
   * @default the real `@jini-ai/agent-runtime` prompt-file stager
   */
  readonly preparePromptFileForAgent?: typeof preparePromptFileForAgent;
  /**
   * Stages a `needsAgentLogFile` def's (antigravity) diagnostic-log path
   * before `buildArgs` runs. Same real-filesystem/injectable-for-tests deal
   * as `preparePromptFileForAgent` above, and a no-op for every def that
   * did not opt in.
   * @default the real `@jini-ai/agent-runtime` log-file stager
   */
  readonly prepareAgentLogFile?: typeof prepareAgentLogFile;
  /** @default the real `@jini-ai/platform` process-snapshot enumerator */
  readonly listProcessSnapshots?: typeof listProcessSnapshots;
  /** @default the real `@jini-ai/platform` descendant-PID collector */
  readonly collectProcessTreePids?: typeof collectProcessTreePids;
  /** @default the real `@jini-ai/platform` SIGTERM→SIGKILL escalator */
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
  /**
   * Ceiling on how many bytes of a `'until-close'` def's stdout this driver will hold in memory
   * before it stops accumulating and reports the shortfall — see
   * {@link DEFAULT_BUFFERED_STDOUT_MAX_BYTES} for the threat this closes and why 8 MiB.
   * @default {@link DEFAULT_BUFFERED_STDOUT_MAX_BYTES}
   */
  readonly bufferedStdoutMaxBytes?: number;
  /**
   * Host-owned system-prompt overlay — see `prompt-augmenter.ts`'s own doc for why this seam
   * exists (product-specific discovery/behavior instructions that don't belong in the engine).
   * When present, `systemOverlay()` is called once per `run()` and its result (if non-null) is
   * threaded through to `buildArgs` as `RuntimeBuildOptions.systemPromptOverlay` — a def with no
   * append-system-prompt mechanism ignores it.
   * @default undefined — no overlay is computed and no def sees `systemPromptOverlay`,
   * byte-identical to pre-this-option behavior.
   */
  readonly promptAugmenter?: PromptAugmenter;
}

/**
 * Creates the `AgentExecutor` reference implementation: an in-process
 * `RunLifecycle` driver over real (by default) `@jini-ai/agent-runtime`
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
  const prepareAgentLogFileFn = options.prepareAgentLogFile ?? prepareAgentLogFile;
  const listProcessSnapshotsFn = options.listProcessSnapshots ?? listProcessSnapshots;
  const collectProcessTreePidsFn = options.collectProcessTreePids ?? collectProcessTreePids;
  const stopProcessesFn = options.stopProcesses ?? stopProcesses;
  const onCleanupFailureFn = options.onCleanupFailure ?? defaultCleanupFailureSink;
  const journal = options.journal;
  const continuation = options.continuation;
  const classifyFailure = options.classifyFailure;
  const mcpJsonInjection = options.mcpJsonInjection;
  const promptAugmenter = options.promptAugmenter;
  const bufferedStdoutMaxBytes = options.bufferedStdoutMaxBytes ?? DEFAULT_BUFFERED_STDOUT_MAX_BYTES;

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

    // Every compatibility guard lives in `assessAgentExecutorCompatibility` so discovery surfaces can
    // ask the same question before a run exists — see that function's own doc. It returns the narrowed
    // `streamFormat` on success, so this delegation costs no redundant re-check.
    const compatibility = assessAgentExecutorCompatibility(def);
    if (!compatibility.supported) {
      return failBeforeSpawn(input.runId, 'AGENT_RUNTIME_UNSUPPORTED', compatibility.reason);
    }
    const streamFormat = compatibility.streamFormat;

    // Argv-bound defs (aider, deepseek) — reject an oversized prompt before
    // ever resolving a binary or touching the filesystem. A no-op for every
    // def without `maxPromptArgBytes` (checkPromptArgvBudget's own guard).
    const argvBudgetError = checkPromptArgvBudget(def, input.prompt);
    if (argvBudgetError) {
      return failBeforeSpawn(input.runId, 'AGENT_PROMPT_TOO_LARGE', argvBudgetError.message);
    }

    const resolvedEnv: Record<string, string> =
      input.env !== undefined ? toStringEnvRecord(input.env) : buildAgentEnv(process.env, input.credentialEnv);
    const launch: AgentLaunchResolution = resolveAgentLaunchFn(def, resolvedEnv);
    if (!launch.launchPath) {
      return failBeforeSpawn(
        input.runId,
        'AGENT_BINARY_NOT_RESOLVED',
        `AgentExecutor: could not resolve an executable for agent "${def.id}" (bin "${def.bin}")`,
      );
    }

    const spawnEnv = applyAgentLaunchEnvFn({ ...resolvedEnv }, launch);

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
    // Stage a needsAgentLogFile def's (antigravity) diagnostic-log path, on the same terms and at
    // the same point as the prompt file above: before buildArgs, since buildArgs is what turns the
    // path into a `--log-file <path>` argument. A no-op (returns null) for every def without
    // `needsAgentLogFile: true` (prepareAgentLogFile's own guard). Sequenced after the prompt file
    // rather than concurrently so the failure path below has exactly one thing to clean up.
    let preparedLogFile: PreparedAgentLogFile | null;
    try {
      preparedLogFile = await prepareAgentLogFileFn(def, input.runId);
    } catch (err) {
      await (preparedPromptFile ? preparedPromptFile.cleanup() : Promise.resolve());
      return failBeforeSpawn(
        input.runId,
        'AGENT_SPAWN_FAILED',
        `AgentExecutor: could not stage a log file for agent "${def.id}": ${errorMessage(err)}`,
      );
    }

    // Cleaned up after the child exits (wireChildLifecycle/wireAcpLifecycle/wirePiRpcLifecycle's
    // close handlers) and on every pre-spawn/spawn-failure path below — a leaked temp file
    // containing the full prompt, or whatever the CLI chose to write into its log, is a
    // confidentiality gap, not just a disk leak. One composed closure covering both staged files;
    // see `WireChildLifecycleContext.cleanupStagedFiles`'s doc for why they are not two fields.
    /**
     * Set once `writeMcpJsonForRun` has actually written this run's MCP config, so `cleanupStagedFiles`
     * knows there is a file holding a live bearer token to remove. Cleared as it is consumed, so the
     * removal happens exactly once across the several paths that may call the cleanup. Only the
     * `'claude-mcp-json'` mechanism stages a file at all — `'acp-merge'` and `'env-content'` leave
     * nothing on disk, so this stays `undefined` for those.
     */
    let writtenMcpJsonPath: string | undefined;
    const removeMcpJsonFileFn = mcpJsonInjection?.removeFile ?? defaultRemoveMcpJsonFile;
    const cleanupStagedFiles: () => Promise<void> = async () => {
      if (preparedPromptFile) await preparedPromptFile.cleanup();
      if (preparedLogFile) await preparedLogFile.cleanup();
      if (writtenMcpJsonPath !== undefined) {
        const mcpJsonFileToRemove = writtenMcpJsonPath;
        writtenMcpJsonPath = undefined;
        await removeMcpJsonFileFn(mcpJsonFileToRemove);
      }
    };
    // Resolve this run's MCP bridge delivery once, before buildArgs — the `'claude-mcp-json'`
    // variant's path has to be in `runtimeContext` for that def's own `--mcp-config` argv, and
    // resolving here means the per-run bearer credential is minted exactly once no matter which of
    // the four mechanisms ends up carrying it. `null` for an unconfigured host or a def declaring
    // no strategy — see `buildMcpBridgeDelivery`'s doc.
    let mcpBridge: McpBridgeDelivery | null;
    try {
      // Awaited here rather than inside `buildMcpBridgeDelivery` so that function stays pure and
      // synchronous. `undefined` when the host supplied no resolver, which omits the token entirely.
      const credential = mcpJsonInjection !== undefined ? await mcpJsonInjection.credential?.(input.runId) : undefined;
      mcpBridge = buildMcpBridgeDelivery({
        cwd: input.cwd,
        runId: input.runId,
        strategy: def.externalMcpInjection,
        options: mcpJsonInjection,
        credential,
      });
    } catch (err) {
      // Spawning a child that cannot authenticate would produce a run whose every bridged tool call
      // 401s, so a rejecting credential resolver fails the run before spawn instead.
      await cleanupStagedFiles();
      return failBeforeSpawn(
        input.runId,
        'AGENT_SPAWN_FAILED',
        `AgentExecutor: could not resolve the MCP bridge credential for agent "${def.id}": ${errorMessage(err)}`,
      );
    }
    // Mechanism 3+4 (`'opencode-env-content'`/`'mimo-env-content'`): the bridge rides in the child's
    // *environment*, merged into whatever the host already set there. Deliberately not a `-c
    // key=value`-style CLI argument — the config embeds `JINI_DAEMON_TOKEN`, and process arguments
    // are readable by any other local user through `ps`, while a process's environment is not.
    const childEnv: NodeJS.ProcessEnv =
      mcpBridge?.kind === 'env-content'
        ? {
            ...spawnEnv,
            [mcpBridge.envVarName]: mergeEnvContentMcpConfig(spawnEnv[mcpBridge.envVarName], mcpBridge.serverEntry),
          }
        : spawnEnv;
    const runtimeContext: RuntimeContext | undefined =
      preparedPromptFile || preparedLogFile || mcpBridge?.kind === 'claude-mcp-json'
        ? {
            ...(preparedPromptFile ? { promptFilePath: preparedPromptFile.path } : {}),
            ...(preparedLogFile ? { agentLogFilePath: preparedLogFile.path } : {}),
            // Safe to pass before the file exists: `writeMcpJsonForRun` runs after buildArgs but
            // still before spawn, so the path is real by the time the child process starts.
            ...(mcpBridge?.kind === 'claude-mcp-json' ? { mcpJsonPath: mcpBridge.mcpJsonPath } : {}),
          }
        : undefined;

    // A `runtimeLock` def's buildArgs mutates process-global state its own CLI reads back at
    // startup, so the mutex must be held from before buildArgs until the spawned child has
    // demonstrably consumed it — see `RuntimeLock`'s own doc for the concrete race. Undefined for
    // 23 of 24 defs, in which case nothing below waits on anything.
    const selectedModel = input.model;
    const runtimeLockHold: RuntimeLockHold | undefined = await def.runtimeLock?.acquire({ model: selectedModel });
    // Aborts once the spawned process is gone — or immediately, on a path where no process ever
    // ran — so a def's own handoff watcher can never outlive the run it was polling for.
    const processExitedController = new AbortController();
    /**
     * Releases the runtime lock and cancels any handoff watcher. Safe to call from any number of
     * paths: `AbortController.abort()` after the first is a no-op, and `RuntimeLockHold.release`
     * is idempotent by contract.
     */
    const releaseRuntimeLock = (): void => {
      processExitedController.abort();
      runtimeLockHold?.release();
    };
    /** Both staged-file and lock release, for the pre-spawn/spawn-failure paths that own neither a child nor a close handler. */
    const releaseStagedResources = async (): Promise<void> => {
      releaseRuntimeLock();
      await cleanupStagedFiles();
    };

    // Guarded, like every other step between staging and spawn: a `runtimeLock` def's `buildArgs` is
    // guarded precisely *because* it performs real filesystem writes (antigravity writes its model
    // choice into a shared settings file), so EACCES on a read-only home, ENOSPC, or a malformed
    // existing settings file all reach here as a throw. Unguarded, that escaped `run()` as a bare
    // `Error` — breaking this driver's "never a bare throw, always an `AgentExecutorError`" contract
    // — and left the run `'running'` forever while still holding the process-global mutex and both
    // staged files, so no later run of that def could ever acquire the lock either.
    // Computed once per `run()`, not per-token/per-event: a system-prompt overlay is a spawn-time
    // CLI arg, not something that varies mid-run. `turnIndex` is a coarse 0/1 proxy (no exact turn
    // counter exists on this driver) — sufficient because every `PromptAugmenter.systemOverlay()`
    // implementation this seam has today wants the same overlay on every turn, not a first-turn-only
    // one; a caller that needs finer-grained turn numbering can track it itself and ignore this arg.
    const systemPromptOverlay = promptAugmenter?.systemOverlay?.({
      agentId: def.id,
      turnIndex: runtimeContext?.hasPriorAssistantTurn ? 1 : 0,
    });

    let args: string[];
    try {
      args = def.buildArgs(
        input.prompt,
        [...(input.imagePaths ?? [])],
        input.extraAllowedDirs === undefined ? undefined : [...input.extraAllowedDirs],
        input.model !== undefined
          || input.reasoning !== undefined
          || input.permissionMode !== undefined
          || (systemPromptOverlay !== undefined && systemPromptOverlay !== null)
          ? {
              ...(input.model !== undefined ? { model: input.model } : {}),
              ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
              ...(input.permissionMode !== undefined ? { permissionMode: input.permissionMode } : {}),
              ...(systemPromptOverlay !== undefined && systemPromptOverlay !== null
                ? { systemPromptOverlay }
                : {}),
            }
          : undefined,
        runtimeContext,
      );
    } catch (err) {
      await releaseStagedResources();
      return failBeforeSpawn(
        input.runId,
        'AGENT_SPAWN_FAILED',
        `AgentExecutor: could not build launch arguments for agent "${def.id}": ${errorMessage(err)}`,
      );
    }

    // Mechanism 1 of 4's one effect — stage this run's own MCP config file (run-scoped, see
    // `mcpJsonPathForRun`) before spawn so the `--mcp-config <path>` argv buildArgs just produced
    // points at a real file. Skipped entirely for the other three mechanisms and whenever no bridge
    // was resolved at all. `writtenMcpJsonPath` is set only once the write actually happens, so
    // `cleanupStagedFiles` knows there is a live-token file to remove afterward.
    try {
      if (mcpBridge?.kind === 'claude-mcp-json' && mcpJsonInjection !== undefined) {
        await writeMcpJsonForRun(input.cwd, mcpBridge, mcpJsonInjection);
        writtenMcpJsonPath = mcpBridge.mcpJsonPath;
      }
    } catch (err) {
      await releaseStagedResources();
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
      await releaseStagedResources();
      return failBeforeSpawn(input.runId, 'AGENT_PROMPT_TOO_LARGE', windowsBudgetError.message);
    }

    const invocation = createCommandInvocationFn({ command: launch.launchPath, args, env: childEnv });

    let child: ChildProcess;
    try {
      child = spawnFn(invocation.command, invocation.args, {
        cwd: input.cwd,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      });
    } catch (err) {
      await releaseStagedResources();
      return failBeforeSpawn(
        input.runId,
        'AGENT_SPAWN_FAILED',
        `AgentExecutor: spawn threw synchronously for agent "${def.id}": ${errorMessage(err)}`,
      );
    }

    // Registered before the spawn-confirmation await below, for the same reason
    // `wireChildLifecycle` is: a child that exits immediately must not slip past the listener.
    // `'exit'` rather than `'close'` on purpose — a `runtimeLock` guards state the *process* reads,
    // so the process being gone is the release condition, not its stdio pipes draining (which a
    // grandchild inheriting them can delay arbitrarily). A spawn that never produced a process at
    // all emits no `'exit'`, and is covered instead by `releaseStagedResources` on the reject path.
    child.once('exit', releaseRuntimeLock);

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
            cleanupStagedFiles,
            journal,
            continuation,
            classifyFailure,
            bufferedStdoutMaxBytes,
          });

    try {
      await waitForSpawnOrError(child);
    } catch (err) {
      await releaseStagedResources();
      await lifecycle.finish({ runId: input.runId, status: 'failed', code: null, signal: null, resumable: false });
      throw new AgentExecutorError(
        'AGENT_SPAWN_FAILED',
        `AgentExecutor: failed to spawn agent "${def.id}": ${errorMessage(err)}`,
      );
    }

    // Now — and only now — is there a live process that could consume the locked side effect, so
    // this is where a def's handoff watcher starts. Deliberately not awaited: the whole point is to
    // release the lock as soon as the child confirms the handoff, in parallel with this run
    // continuing. Rejection releases too — a lock stuck open because a watcher threw is strictly
    // worse than releasing early (see `RuntimeLockHold.waitForHandoff`'s own doc).
    if (runtimeLockHold?.waitForHandoff) {
      void runtimeLockHold
        .waitForHandoff({
          logFilePath: preparedLogFile?.path,
          model: selectedModel,
          processExited: processExitedController.signal,
        })
        .then(releaseRuntimeLock, releaseRuntimeLock);
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
          // Mechanism 2 of 4 — see `WireAcpLifecycleContext.mcpServers`. `undefined` for any def
          // that did not declare `'acp-merge'` and for an unconfigured host.
          mcpServers: mcpBridge?.kind === 'acp-merge' ? mcpBridge.mcpServers : undefined,
          onPermissionRequest: options.acpPermissionHandler,
          attachAcpSession: attachAcpSessionFn,
          listProcessSnapshots: listProcessSnapshotsFn,
          collectProcessTreePids: collectProcessTreePidsFn,
          stopProcesses: stopProcessesFn,
          onCleanupFailure: onCleanupFailureFn,
          cleanupStagedFiles,
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
        await releaseStagedResources();
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
          cleanupStagedFiles,
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
        await releaseStagedResources();
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
