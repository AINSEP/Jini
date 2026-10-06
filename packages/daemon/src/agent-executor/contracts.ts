import type { MessageAttachmentImage } from '../attachment-content.js';
import {
  type spawn as nodeSpawn,
  type ChildProcess,
} from 'node:child_process';
import {
  type Principal,
} from '@jini-ai/core';
import {
  type RunAgentPayload,
  type RunErrorPayload,
} from '@jini-ai/protocol';
import {
  type applyAgentLaunchEnv,
  type ensureAgentCapabilities,
  type getAgentDef,
  type resolveAgentLaunch,
  type attachAcpSession,
  type attachPiRpcSession,
  type prepareAgentLogFile,
  type preparePromptFileForAgent,
  type AcpMcpServerInput,
  type AcpPermissionHandler,
  type PromptAugmenter,
} from '@jini-ai/agent-runtime';
import {
  type collectProcessTreePids,
  type createCommandInvocation,
  type listProcessSnapshots,
  type stopProcesses,
  type ProcessSnapshot,
  type StopProcessesResult,
} from '@jini-ai/platform';
import {
  type RunByteJournal,
} from '../continuation/journal.js';
import {
  type RunRetrySideEffectState,
} from '../run/core/index.js';
import {
  type ToolExecutor,
} from '../tool-executor.js';
import {
  type RunLifecycle,
} from '../run-lifecycle.js';

/**
 * A parsed, loosely-typed event as produced by one of `@jini-ai/agent-runtime`'s
 * four stream-parser factories — each parser's `onEvent` callback receives
 * `Record<string, unknown>` with a `type` discriminant, not a typed union.
 */
export type StreamHandler = { feed(args: { chunk: string }): void; flush(): void };

export const SUPPORTED_STREAM_FORMATS = [
  'claude-stream-json',
  'json-event-stream',
  'copilot-stream-json',
  'qoder-stream-json',
  'acp-json-rpc',
  'pi-rpc',
  'plain',
] as const;

/** The families of the registry's stream-format this driver implements — see index.ts module doc. */
export type SupportedStreamFormat = (typeof SUPPORTED_STREAM_FORMATS)[number];

export type JsonStreamFormat = Exclude<SupportedStreamFormat, 'acp-json-rpc' | 'pi-rpc' | 'plain'>;

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
export type ChildDrivenStreamFormat = JsonStreamFormat | 'plain';

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
 * Result of translating one parsed stream event into this engine's
 * vocabulary. `'agent'` is the common case (forward as a `RunAgentPayload`
 * via the `'agent'` run event); `'error'` and `'turn-end'` are the two
 * type values `run()` handles specially rather than passing through (see
 * index.ts module doc); `'ignored'` covers anything the 4 parsers never actually
 * produce plus defensively malformed/non-record input.
 *
 * `'agent'`'s optional `sessionId` (gap 5, session resume — see
 * `RunEndPayload.sessionRef`'s doc in `@jini-ai/protocol`) remains a daemon-internal
 * side channel for lifecycle wiring to capture the locator and thread it into
 * its terminal `finish()` call. The `'status'` wire payload also carries
 * `sessionId` so durable hosts can persist it immediately, before a process
 * crash can prevent the terminal `end` event from arriving. OpenCode's
 * `sessionID`/Codex's `thread_id`/Qoder's and Claude's `session_id` are normalized
 * by their stream parsers into this shared locator.
 *
 * `'turn-end'`'s optional `stopReason` (gap 3, capability-routed
 * continuation transport) is the same kind of internal side channel: the
 * claude-stream parser deliberately emits `stopReason` *after* every
 * `tool_use` block in the same assistant message has already been
 * translated (so a caller can decide whether to keep stdin open before
 * closing it), but v1 (pre-gap-3) discarded it and closed stdin
 * unconditionally on any `turn-end` — see `packages/daemon/archived provenance ledger`'s
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

/** Machine-readable failure reasons `run()` can reject with — every one is preceded by a `lifecycle.finish({status:'failed'})` call (see index.ts module doc's Invariant section). */
export type AgentExecutorErrorCode =
  | 'AGENT_PERMISSION_MODE_INVALID'
  | 'AGENT_NOT_FOUND'
  | 'AGENT_RUNTIME_UNSUPPORTED'
  | 'AGENT_BINARY_NOT_RESOLVED'
  | 'AGENT_SPAWN_FAILED'
  | 'AGENT_PROMPT_TOO_LARGE';

/** Thrown by `AgentExecutor.run()` on every failure path — never a bare `Error`, so callers can branch on `.code` instead of parsing `.message`. */
export class AgentExecutorError extends Error {
  readonly code: AgentExecutorErrorCode;

  constructor({ code, message }: { readonly code: AgentExecutorErrorCode; readonly message: string }) {
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
   * `--dangerously-skip-permissions`) historically enabled it when omitted because a spawned
   * subprocess has no TTY for interactive approval. That rationale explains the old behavior;
   * the daemon now fails closed with 'restricted'. A host must explicitly select 'bypass' to
   * delegate auto-approval, and any unknown mode is rejected before launching a process.
   */
  readonly permissionMode?: 'bypass' | 'restricted';
  /**
   * Host-validated image files. How each one actually reaches the model
   * depends on `def.imageDelivery` (see `@jini-ai/agent-runtime`'s `types.ts`):
   * a `'native'` def forwards these through its own protocol (argv, ACP
   * `resource_link` blocks, or pi-rpc's base64 `images` field); a
   * `'prompt-path'` def (currently just `claude`) instead gets them named in
   * the prompt text and its allowed directories widened, via
   * `image-prompt-delivery.ts#applyImagePromptDelivery`, called once near
   * the top of `run()` in `launch.ts`.
   */
  readonly imagePaths?: readonly string[];
  /** Host-prepared pixels from the shared attachment reader, for structured message delivery. */
  readonly imageContents?: readonly MessageAttachmentImage[];
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
   * architecture decision C8 (`ADS-memory/reports/jini-port/extraction-plan.md`).
   */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Stored session id for this (conversation, agent) pair from a prior run's
   * `RunEndPayload.sessionRef` (see `@jini-ai/protocol`'s doc on that field) — set when the host
   * wants this run to continue that CLI session instead of starting cold. Forwarded verbatim into
   * `RuntimeContext.resumeSessionId`; a `resumesSessionViaCli` def (see
   * `@jini-ai/agent-runtime`'s `types.ts`) reads it to pass its CLI's own resume flag, in which case
   * the host should send only the latest user turn as `prompt`, not the full transcript. `null` and
   * omitted are equivalent: no resume target for this run.
   */
  readonly resumeSessionId?: string | null;
  /**
   * A fresh id the host mints and persists when starting a session it wants resumable on a later
   * turn (i.e. no `resumeSessionId` is available yet). Forwarded verbatim into
   * `RuntimeContext.newSessionId`; a `resumesSessionViaCli` def passes it to its CLI's own
   * "start with this id" flag so a later turn's `resumeSessionId` can continue the same underlying
   * CLI session. Ignored by defs that don't declare `resumesSessionViaCli`.
   */
  readonly newSessionId?: string;
  /**
   * Forwarded verbatim to `RuntimeBuildOptions.disallowedTools` (see `@jini-ai/agent-runtime`'s
   * `types.ts`) — Finding 2 of SEC-assistant-env-isolation-2026-09-07. A mechanism only: this
   * package bakes in no opinion about which tools to name; the host decides. `undefined`/empty
   * means no restriction, byte-identical to today's behavior.
   */
  readonly disallowedTools?: readonly string[];
  /** Same mechanism as {@link disallowedTools}, forwarded to `RuntimeBuildOptions.allowedTools`. */
  readonly allowedTools?: readonly string[];
  /** Forwarded verbatim to `RuntimeBuildOptions.settingSources` (an empty list = load none of the CLI's settings layers). */
  readonly settingSources?: readonly string[];
  /** Forwarded verbatim to `RuntimeBuildOptions.settings` (extra settings JSON or file path for this run). */
  readonly settings?: string;
}

export interface AgentExecutor {
  /**
   * Spawns `agentId`'s CLI for `runId`, wires its stdout/stderr into
   * `lifecycle.emit()`, and resolves once the child process is confirmed
   * spawned (fire-and-forget from there — see index.ts module doc). Callers await
   * `lifecycle.waitForTerminal(runId)` separately for completion.
   * @throws {@link AgentExecutorError} on every failure path — the
   * underlying run is always already transitioned to `'failed'` via
   * `lifecycle.finish()` before this rejects (see index.ts module doc's Invariant).
   */
  run(requiredArgs: Pick<AgentExecutorRunInput, "runId" | "agentId" | "prompt" | "cwd">, optionalArgs?: Pick<AgentExecutorRunInput, "model" | "reasoning" | "permissionMode" | "imagePaths" | "imageContents" | "extraAllowedDirs" | "uploadRoot" | "credentialEnv" | "env" | "resumeSessionId" | "newSessionId" | "disallowedTools" | "allowedTools" | "settingSources" | "settings">): Promise<void>;
}

/** Process discovery is a getter; process collection and stopping accept explicit host inputs. */
export type CollectProcessTreePidsPort = (args: { readonly processes: ProcessSnapshot[]; readonly rootPids: Array<number | null | undefined> }) => number[];

export type StopProcessesPort = (args: { readonly pids: Array<number | null | undefined> }) => Promise<StopProcessesResult>;

export interface TerminateChildTreeDeps {
  readonly listProcessSnapshots: () => Promise<ProcessSnapshot[]>;
  readonly collectProcessTreePids: CollectProcessTreePidsPort;
  readonly stopProcesses: StopProcessesPort;
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

/** A small handle `writePromptToStdin` uses to close stdin exactly once, shared with the `turn_end`-triggered close inside {@link wireChildLifecycle}. */
export interface StdinCloseHandle {
  /** Prepared pixels ride on the initial stdin message without reopening filesystem tools or
   * serializing base64 into text. Native argv/ACP/pi transports keep their existing image path. */
  imageContents?: readonly MessageAttachmentImage[];
  closeStdinOnce(): void;
  /** Journals a sent-to-stdin byte chunk, queued through the same FIFO {@link wireChildLifecycle} already uses for emitted events. No-op when no journal was configured (see `CreateAgentExecutorOptions.journal`). */
  recordSentBytes(content: string): void;
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
 * the executor did not originally *act* on that resolution — `execute_delegated_tool`
 * (`@jini-ai/mcp`'s `../server/tools/delegated-tool.ts`) only does anything useful once the spawned
 * CLI's own client actually launches `jini-mcp` as its MCP server subprocess.
 *
 * **All six declared strategies are wired.** These options describe *one* bridge server
 * (`command`/`args`/`daemonUrl`/`credential`); which transport carries it to a given child is that
 * def's own `externalMcpInjection` declaration, and each of the six has exactly one
 * implementation in `mcp-bridge.ts` — see {@link buildMcpBridgeDelivery}, which is the single dispatch point.
 * The interface name predates the other five mechanisms and is kept for API compatibility with
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
  /**
   * Extra env for the bridge child, for hosts whose `command` is not a plain Node binary. An Electron
   * host passes `{ ELECTRON_RUN_AS_NODE: '1' }`: its `process.execPath` is the app itself, which boots
   * as a GUI app without that flag and never speaks MCP. `buildAgentEnv`'s allowlist strips the
   * host's own copy from the CLI, so it can only reach the bridge through here. `JINI_*` keys are
   * ignored: the run id, callback URL and token are this driver's to set. @default {}
   */
  readonly env?: Readonly<Record<string, string>>;
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
  readonly credential?: ({ runId }: { readonly runId: string }) => string | Promise<string>;
  /** Reads the project's own `cwd/.mcp.json` so this driver merges its servers in rather than dropping them. Rejecting (ENOENT or otherwise) is treated as "no existing file" — see `writeMcpJsonForRun`. This file is only ever *read*. @default the real `fs.promises.readFile` (utf8) */
  readonly readFile?: ({ path }: { readonly path: string }) => Promise<string>;
  /** Writes the merged content to this run's own config path (see {@link mcpJsonPathForRun}), never to the project's `.mcp.json`. @default the real `fs.promises.writeFile` (utf8) */
  readonly writeFile?: ({ path, content }: { readonly path: string; readonly content: string }) => Promise<void>;
  /**
   * Removes this run's config file once the run is over — it holds a live per-run bearer token, so
   * leaving it behind is the same class of confidentiality gap as a leaked prompt file (see
   * `WireChildLifecycleContext.cleanupStagedFiles`). Called on the close handler and on every
   * pre-spawn/spawn-failure path, and a rejection is reported rather than allowed to strand the run.
   * @default `fs.promises.rm(path, { force: true })` — already-gone is success, not an error.
   */
  readonly removeFile?: ({ path }: { readonly path: string }) => Promise<void>;
  /**
   * `'codex-toml'` only. Creates a fresh, randomly-named directory `prepareCodexHomeForRun` stages
   * as a run's scratch `CODEX_HOME`. **Must be non-deterministic (a real `mkdtemp`, not a
   * caller-computed path)** — unlike `mcpJsonPathForRun`'s deterministic path inside the run's own
   * `cwd`, this directory holds a copy of the operator's real Codex login credential, and
   * `os.tmpdir()` is a shared location on a multi-user host: a guessable name there is a real
   * pre-plant/symlink target for another local user. `fs.mkdtemp`'s random suffix plus its `0700`
   * directory mode is the actual confidentiality control, matching the same reasoning
   * `@jini-ai/agent-runtime`'s `log-file.ts`/`prompt-file.ts` already apply to their own staged temp
   * dirs.
   * @param prefix - A caller-composed, run-id-derived prefix (already sanitized) for the mkdtemp
   * template; the real suffix mkdtemp appends is what makes the path unpredictable.
   * @default `fs.mkdtemp(path.join(os.tmpdir(), prefix))`
   */
  readonly mkdtemp?: ({ prefix }: { readonly prefix: string }) => Promise<string>;
  /**
   * `'codex-toml'` only. Recursively removes the scratch `CODEX_HOME` directory `mkdtemp` above
   * created — the directory-level analogue of `removeFile`, needed because this mechanism stages a
   * whole directory (`config.toml` plus a copied `auth.json`), not one file.
   * @default `fs.rm(path, { recursive: true, force: true })` — already-gone is success, not an error.
   */
  readonly removeDir?: ({ path }: { readonly path: string }) => Promise<void>;
}

/** One `.mcp.json` `mcpServers` entry — the shape Claude Code's own config schema expects. */
export interface McpJsonServerEntry {
  readonly command: string;
  readonly args: string[];
  readonly env: Readonly<Record<string, string>> & {
    readonly JINI_RUN_ID: string;
    readonly JINI_DAEMON_URL: string;
    /** Present only when the host supplied a `credential` resolver — see {@link McpJsonInjectionOptions.credential}. */
    readonly JINI_DAEMON_TOKEN?: string;
  };
}

/**
 * What one run's MCP bridge turns into, discriminated by the delivery mechanism its def declared.
 * Exactly one variant is produced per run, and each variant carries only what its own consumer
 * needs — so a consumer cannot accidentally read another mechanism's payload.
 */
export type McpBridgeDelivery =
  /** `'claude-mcp-json'` (claude, codebuddy): a `.mcp.json` staged into the run cwd, whose path the def's `buildArgs` passes as `--mcp-config`. */
  | { readonly kind: 'claude-mcp-json'; readonly mcpJsonPath: string; readonly serverEntry: McpJsonServerEntry }
  /** `'acp-merge'` (the 9 ACP-native defs): `mcpServers` entries for the ACP `session/new` params. */
  | { readonly kind: 'acp-merge'; readonly mcpServers: readonly AcpMcpServerInput[] }
  /** `'opencode-env-content'` / `'mimo-env-content'` (opencode, mimo): one spawn-env variable carrying the serialised config. */
  | { readonly kind: 'env-content'; readonly envVarName: string; readonly serverEntry: McpJsonServerEntry }
  /**
   * `'codex-toml'` (codex): no path yet — unlike `'claude-mcp-json'`'s `mcpJsonPath`, the scratch
   * `CODEX_HOME` directory is created with `fs.mkdtemp` (a real, non-deterministic filesystem
   * effect — see `McpJsonInjectionOptions.mkdtemp`'s own doc for why), so it cannot be computed by
   * this delivery's pure, synchronous dispatch. `prepareCodexHomeIfNeeded` stages it separately and
   * reports the resulting path back into `childEnv.CODEX_HOME` directly, never through this type.
   */
  | { readonly kind: 'codex-toml'; readonly serverEntry: McpJsonServerEntry }
  /**
   * `'env-passthrough'` (antigravity): the bridge entry's `env` triple (`JINI_RUN_ID`/
   * `JINI_DAEMON_URL`/`JINI_DAEMON_TOKEN`) is set directly on the spawned CLI's own OS
   * environment — no config document, no file, no CLI-specific schema. Correct only because this
   * strategy's CLI already inherits its own env down to the stdio MCP child it launches for a
   * server registered once, globally, out of band (see `types.ts`'s own doc on this strategy).
   */
  | { readonly kind: 'env-passthrough'; readonly serverEntry: McpJsonServerEntry };

/** A staged, run-scoped Codex `CODEX_HOME` — the directory-holding analogue of {@link PreparedPromptFile}/{@link PreparedAgentLogFile} from `@jini-ai/agent-runtime`. */
export type PreparedCodexHome = {
  /** Absolute path to hand to the spawned child as its `CODEX_HOME` env var. */
  readonly path: string;
  /** Recursively removes the staged directory — the live `auth.json` copy it may hold makes this a confidentiality cleanup, not just tidiness. Safe to call more than once. */
  readonly cleanup: () => Promise<void>;
};

/**
 * Finding 1 of SEC-assistant-env-isolation-2026-09-07 — a staged, run-scoped `claude` CLI config
 * directory, the `CLAUDE_CONFIG_DIR`-isolation analogue of {@link PreparedCodexHome} above.
 *
 * **The bug this closes:** `BASELINE_AGENT_ENV_KEYS` forwards `HOME` verbatim and neither this
 * package nor `@jini-ai/agent-runtime` ever set `CLAUDE_CONFIG_DIR`, so a spawned `claude` child
 * resolved its config (skills, plugins, agents, memory-path index, settings) from the OPERATOR's
 * own real `$HOME/.claude` — a personal grant (including `Task`/`Edit`/`Write`/`Cron*`/worktree
 * tools on this host) the host process never intended to hand the model.
 */
export type PreparedClaudeConfigDir = {
  /** Absolute path to hand to the spawned child as its `CLAUDE_CONFIG_DIR` env var. */
  readonly path: string;
  /** Recursively removes the staged directory — it may hold a copied login credential (see {@link prepareClaudeConfigDirForRun}'s doc), the same confidentiality-cleanup duty as {@link PreparedCodexHome.cleanup}. Safe to call more than once. */
  readonly cleanup: () => Promise<void>;
};

/** The Claude-config-dir mechanism's injectable filesystem seams, real by default — the directory-staging analogue of {@link CodexHomeSeams}, kept as its own small options bag (see {@link CreateAgentExecutorOptions.claudeConfigDirIsolation}) rather than folded into {@link McpJsonInjectionOptions}: isolating the operator's personal config is an env-hygiene concern independent of whether this host configured MCP federation at all, and must not be gated on that unrelated flag. */
export interface ClaudeConfigDirSeams {
  readonly mkdtemp: ({ prefix }: { readonly prefix: string }) => Promise<string>;
  readonly readFile: ({ path }: { readonly path: string }) => Promise<string>;
  readonly writeFile: ({ path, content }: { readonly path: string; readonly content: string }) => Promise<void>;
  readonly removeDir: ({ path }: { readonly path: string }) => Promise<void>;
}

/**
 * `CreateAgentExecutorOptions.claudeConfigDirIsolation` — every field optional and real-filesystem
 * by default, matching the executor's standing "no real disk I/O by default in tests" convention (see
 * `preparePromptFileForAgent`/`prepareAgentLogFile`'s identical shape). Unlike
 * {@link McpJsonInjectionOptions}, this bag is never itself a gate: {@link
 * prepareClaudeConfigDirIfNeeded} stages a scratch directory for every `claude`-def run regardless
 * of whether a host supplies overrides here — this options bag only lets a test observe/replace the
 * filesystem calls, the same way `preparePromptFileForAgent`'s own default does.
 */
export interface ClaudeConfigDirIsolationOptions {
  /** @default the real `fs.promises.mkdtemp(path.join(os.tmpdir(), prefix))` */
  readonly mkdtemp?: ({ prefix }: { readonly prefix: string }) => Promise<string>;
  /** Reads the operator's real `.credentials.json`, if any — see {@link prepareClaudeConfigDirForRun}'s own doc. @default the real `fs.promises.readFile` (utf8) */
  readonly readFile?: ({ path }: { readonly path: string }) => Promise<string>;
  /** Writes the copied `.credentials.json` into the scratch directory. @default the real `fs.promises.writeFile` (utf8) */
  readonly writeFile?: ({ path, content }: { readonly path: string; readonly content: string }) => Promise<void>;
  /** @default `fs.promises.rm(path, { recursive: true, force: true })` — already-gone is success, not an error. */
  readonly removeDir?: ({ path }: { readonly path: string }) => Promise<void>;
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

export interface CreateAgentExecutorOptions {
  readonly lifecycle: RunLifecycle;
  /** @default the real `@jini-ai/agent-runtime` registry lookup */
  readonly getAgentDef?: typeof getAgentDef;
  /** @default the real `@jini-ai/agent-runtime` launch resolver */
  readonly resolveAgentLaunch?: typeof resolveAgentLaunch;
  /** @default the real `@jini-ai/agent-runtime` once-per-binary `--help` capability probe */
  readonly ensureAgentCapabilities?: typeof ensureAgentCapabilities;
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
  readonly collectProcessTreePids?: CollectProcessTreePidsPort;
  /** @default the real `@jini-ai/platform` SIGTERM→SIGKILL escalator */
  readonly stopProcesses?: StopProcessesPort;
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
   * failure classifier was deliberately never ported (see index.ts module doc), so there is no
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
   * Finding 1 of SEC-assistant-env-isolation-2026-09-07's injectable filesystem seams — see
   * {@link ClaudeConfigDirIsolationOptions}'s own doc. This bag itself is still NOT a gate (supplying
   * it only lets a test observe/replace the real filesystem calls); whether staging happens AT ALL is
   * now {@link claudeConfigDirIsolationEnabled}'s job — see that field's doc for why the two were
   * split apart instead of overloading this one's presence as the switch.
   * @default the real `fs.promises.mkdtemp`/`readFile`/`rm` — no real disk I/O for every def other
   * than `claude`, matching this factory's "no real filesystem by default in tests" convention.
   */
  readonly claudeConfigDirIsolation?: ClaudeConfigDirIsolationOptions;
  /**
   * The actual on/off switch for Finding 1's `CLAUDE_CONFIG_DIR` isolation (see
   * {@link prepareClaudeConfigDirIfNeeded}'s doc for the staging behavior this gates). Split out as
   * its own boolean rather than reusing {@link claudeConfigDirIsolation}'s presence, because that bag
   * is a test-seam-injection convention shared with every other `*IsolationOptions`/`*Seams` field in
   * this file (see `mcpJsonInjection`'s own "NOT a gate" precedent) — overloading it here would mean a
   * host that only wants to override `mkdtemp` for a test silently also flips production behavior.
   *
   * @default `false`. This DEFAULTS OFF, which reopens the leak Finding 1 closed (the spawned
   * `claude` child again reads the operator's real `~/.claude` — skills, plugins, memory index, and
   * whatever tool grant that directory carries) — **not a regression discovered later, a deliberate
   * rollback landed the same day as the isolation fix itself.** Reason: on macOS the Keychain login
   * `claude auth status` reports is keyed to `CLAUDE_CONFIG_DIR` (see {@link
   * prepareClaudeConfigDirForRun}'s doc), and no caller of this factory was passing a credential of
   * its own (`AgentExecutorRunInput.credentialEnv`) when Finding 1 landed unconditionally — so every
   * isolated child ran unauthenticated and the assistant reported "Not logged in" on its default
   * runtime. A host that provisions a real `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` via
   * `credentialEnv` (both outrank Keychain login in Claude Code's own auth precedence, so an isolated,
   * still-logged-in child needs no access to the operator's personal Keychain entry at all) should
   * flip this back on — the mechanism itself is unchanged and was already proven live
   * (2026-09-07); only the default changed.
   */
  readonly claudeConfigDirIsolationEnabled?: boolean;
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

/** `createAgentExecutor`'s internal `failBeforeSpawn` — a nested closure over `lifecycle`, so every extracted `run()` phase below takes it as an explicit injected collaborator rather than reaching for a module-level one. */
export type FailBeforeSpawn = (args: { readonly runId: string; readonly code: AgentExecutorErrorCode; readonly message: string }) => Promise<never>;

/**
 * {@link resolveSystemPromptOverlayDelivery}'s decision, threaded out of that one resolver to every
 * channel that can actually carry the overlay to the CLI.
 *
 * **Why `promptPrefix` exists alongside `prompt`.** `prompt` is the composed prompt with the
 * fallback prefix already applied, and is what `buildArgs`, the staged prompt file, and a
 * `promptViaStdin` def's stdin all receive. But the two RPC transports (`runAcpDispatch`,
 * `runPiRpcDispatch`) deliberately send `run()`'s *raw* `input.prompt`, not the image-delivery
 * rewrite this resolver was handed — those defs deliver images through their own native protocol
 * and must never also get `'prompt-path'`'s appended paths (see `resolveImageDeliveryAndArgvBudget`'s
 * call site in `run()` for that hazard). Handing them `prompt` would silently couple them to the
 * image rewrite; handing them `promptPrefix + input.prompt` applies exactly this resolver's overlay
 * decision to exactly the prompt text they were already sending.
 *
 * **The no-double-delivery invariant.** `promptPrefix` is a non-empty string on exactly one path —
 * the universal fallback, the only strategy that carries the overlay *in the prompt text*. Every
 * declared strategy (`'append-flag'`, `'env-var'`, `'config-instructions-file'`) and every
 * suppressed case (no overlay, continuing a session) returns `''`, so a def that receives the
 * overlay through argv, an env var, or a staged config file never also receives it inline. A
 * transport therefore does not need to know which strategy applies: applying `promptPrefix`
 * unconditionally is correct precisely because the resolver already zeroed it where it must not
 * apply.
 */
export interface SystemPromptOverlayDelivery {
  /**
   * The text to prepend to whatever prompt a transport is about to send — `''` for every def whose
   * overlay rides another channel, so it is always safe to apply unconditionally. See this
   * interface's own doc for why callers with their own prompt text use this rather than `prompt`.
   */
  readonly promptPrefix: string;
  /** `promptPrefix` already applied to the prompt this resolver was handed. */
  readonly prompt: string;
  /** Extra argv to append to `buildArgs`' own result — non-empty only for `'append-flag'`. */
  readonly extraArgs: readonly string[];
  /** Env vars to merge into the spawn env — non-empty only for `'env-var'`. */
  readonly envOverrides: Readonly<Record<string, string>>;
}

/** {@link prepareSystemPromptOverlayFileIfNeeded}'s result. */
export type PreparedSystemPromptOverlayFile = {
  /** Absolute path to the staged file, ready to merge into a `config-instructions-file` def's `instructions` array. */
  readonly path: string;
  /** Recursively removes the staged directory. Safe to call more than once. */
  readonly cleanup: () => Promise<void>;
};

/** {@link spawnAgentChildProcess}'s result — a discriminated union rather than a thrown/rejected outcome so the call can stay synchronous; see that function's doc for why. */
export type SpawnAgentChildProcessResult =
  | { readonly kind: 'ok'; readonly child: ChildProcess }
  | { readonly kind: 'error'; readonly error: unknown };
