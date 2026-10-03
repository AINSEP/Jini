/**
 * `AgentExecutor` — the driver `RunLifecycle`'s own module doc names as the
 * missing piece: *"It does not spawn or signal a subprocess... A driver...
 * calls `emit()` for agent/stdout/stderr/error events, observes cancellation
 * via `onCancelRequested`, and calls `finish()` once it knows the real
 * outcome."* This folder is that driver — it wires `@jini-ai/agent-runtime`'s
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
 * `archived provenance ledger`). The real zero-config classifier lives in `@jini-ai/daemon`'s
 * `run/core/retry.ts` (`resumableFromProcessExit`/`classifyProcessExitFailure`)
 * and is wired in by `@jini-ai/server`'s `createLocalNodeDaemon` — see that
 * package's own archived provenance ledger, and `run/core/retry.ts`'s own doc for the
 * classification policy and its 2026-07-22 merge-time reconciliation against
 * a second, independently-built (and rejected) classifier that once lived in
 * this module.
 */

export {
  type SupportedStreamFormat,
  type AgentExecutorCompatibility,
  type AgentRuntimeEventTranslation,
  type AgentExecutorErrorCode,
  AgentExecutorError,
  type AgentExecutorRunInput,
  type AgentExecutor,
  type CollectProcessTreePidsPort,
  type StopProcessesPort,
  type AgentCleanupFailurePhase,
  type AgentCleanupFailureContext,
  type ContinuationOptions,
  type McpJsonInjectionOptions,
  type McpBridgeDelivery,
  type PreparedCodexHome,
  type PreparedClaudeConfigDir,
  type ClaudeConfigDirSeams,
  type ClaudeConfigDirIsolationOptions,
  type FailureClassificationContext,
  type ClassifyFailure,
  type CreateAgentExecutorOptions,
  type SystemPromptOverlayDelivery,
  type PreparedSystemPromptOverlayFile,
  type SpawnAgentChildProcessResult,
} from './contracts.js';
export {
  isSupportedStreamFormat,
  assessAgentExecutorCompatibility,
  isAgentExecutorSupported,
  resolveDefAndStreamFormat,
  resolveImageDeliveryAndArgvBudget,
  resolveRunEnv,
  resolveLaunch,
  stagePromptFile,
  stageLogFile,
  computeChildEnv,
  computeRuntimeContext,
  buildAgentBuildArgsOptions,
  resolveSystemPromptOverlayDelivery,
  buildRunArgs,
  prepareSystemPromptOverlayFileIfNeeded,
  guardWindowsCommandLineBudget,
  spawnAgentChildProcess,
  isStdinDrivenFormat,
  confirmChildSpawned,
  createAgentExecutor,
} from './launch.js';
export {
  extractUsageTokens,
  translateStatusEvent,
  translateToolResultEvent,
  translateErrorEvent,
  translateTurnEndEvent,
  translateAgentRuntimeEvent,
  applyAgentTranslationSideEffects,
} from './event-translation.js';
export {
  MCP_BRIDGE_UNAVAILABLE,
  unavailableJiniBridgeStatus,
  buildMcpJsonServerEntry,
  mergeMcpJsonContent,
  buildAcpMcpBridgeServers,
  mergeEnvContentMcpConfig,
  mergeEnvContentInstructions,
  buildCodexMcpServerToml,
  buildCodexHomeConfigToml,
  resolveSourceCodexHomeDir,
  buildMcpBridgeDelivery,
  resolveSourceClaudeConfigDir,
  resolveMcpBridgeForRun,
  writeMcpJsonIfNeeded,
  prepareCodexHomeIfNeeded,
  prepareClaudeConfigDirIfNeeded,
} from './mcp-bridge.js';
export {
  DEFAULT_BUFFERED_STDOUT_MAX_BYTES,
  runAcpDispatch,
  runPiRpcDispatch,
} from './events.js';
export {
  armHandoffWatcher,
} from './handoff.js';
