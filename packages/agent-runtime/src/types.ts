/**
 * @module types
 *
 * The central, product-neutral contract for this package: `RuntimeAgentDef`
 * declaratively describes how to detect, authenticate, and spawn a single
 * coding-agent CLI (Claude Code, Codex, Cursor, Aider, AMR, …). Everything
 * else in `@jini-ai/agent-runtime` — the registry, detection, launch, and
 * stream-parsing modules — operates on this type or on `DetectedAgent`, its
 * runtime-probed sibling.
 *
 * Ported from OD's `apps/daemon/src/runtimes/core/types.ts`. Product-neutral
 * as found — see `source-map.md` for the full provenance table.
 */
import type { ExecFileOptions } from 'node:child_process';
import type { AgentDiagnostic } from '@jini-ai/protocol';

export type RuntimeEnv = NodeJS.ProcessEnv | Record<string, string>;

export type RuntimeModelOption = {
  id: string;
  label: string;
};

export type RuntimeModelSource = 'live' | 'fallback';

export type RuntimeReasoningOption = RuntimeModelOption;

export type RuntimeBuildOptions = {
  model?: string | null;
  reasoning?: string | null;
  // Every def that has one auto-approves its CLI's own permission prompts by default
  // (`bypassPermissions` / `--yolo` / `--dangerously-skip-permissions`, depending on the CLI) —
  // there is no TTY on a spawned subprocess to answer an interactive prompt, so a caller that
  // never sets this gets exactly today's behavior unchanged. Pass `'restricted'` to opt a run
  // OUT of that auto-approval; the def then omits its bypass flag, which typically means the
  // underlying CLI denies/blocks actions that would otherwise need approval rather than prompting
  // (still non-interactive-safe — just conservative instead of permissive). Not every def reads
  // this: Codex already has its own distinct sandbox model (`workspace-write` by default,
  // escalating to full access only via explicit env/platform conditions) and is unaffected either
  // way; see `defs/codex.ts`'s `codexNeedsDangerFullAccessSandbox`.
  permissionMode?: 'bypass' | 'restricted';
  // Text appended to the spawned CLI's own default system prompt (never replacing it), computed
  // by the caller's `PromptAugmenter.systemOverlay()` (see `prompt-augmenter.ts`) if one is
  // configured. A def with no system-prompt-append mechanism ignores this field; Claude's def
  // reads it via its own `--append-system-prompt` flag. `null`/`undefined`/empty means no overlay
  // for this run — identical to today's behavior.
  systemPromptOverlay?: string | null;
};

export type RuntimeContext = {
  cwd?: string;
  // True when the current chat run has at least one prior persisted
  // assistant message in the same conversation — i.e. this isn't the
  // first user turn. Plain-streaming adapters that support a "continue
  // the most recent conversation" CLI flag read this to decide whether to
  // resume the upstream agent's own session state instead of spawning a
  // fresh, context-free turn. Adapters that either have no resume flag or
  // recompose history into the prompt themselves ignore this field.
  hasPriorAssistantTurn?: boolean;
  // Daemon-owned path to a temp file where the adapter should write its
  // diagnostic log. Some adapters are silent on stdout/stderr for both
  // missing-auth AND quota-exhausted failures, so post-exit log inspection
  // is the only way to tell them apart. Adapters that don't have an
  // equivalent flag ignore this field; the caller cleans the file up after
  // reading.
  agentLogFilePath?: string;
  // Override for an adapter's model-selection settings file path.
  // Production code leaves this undefined (adapters fall back to their own
  // default). Tests pass a temp path so unit assertions against buildArgs
  // do not touch the real home dir.
  antigravitySettingsPath?: string;
  // Daemon-owned path to a temp file containing the composed prompt.
  // Adapters with `promptViaFile: true` read this instead of receiving the
  // prompt via argv or stdin. The caller creates the file before buildArgs
  // and removes it after the child exits.
  promptFilePath?: string;
  // Resume-capable adapters (resumesSessionViaCli) read these to decide
  // whether to continue the CLI's own session. `resumeSessionId` is the
  // stored id for this (conversation, agent) when a prior session exists;
  // the adapter passes it to the CLI's resume flag and the caller sends
  // only the latest user turn. When it is null/absent the adapter starts a
  // new session using `newSessionId` (a freshly minted id the caller also
  // persists) and the caller seeds it with the full transcript.
  resumeSessionId?: string | null;
  newSessionId?: string;
  // Absolute path to the `.mcp.json` `agent-executor.ts` is about to write for this run, set only
  // when `mcpJsonInjection` is configured AND `def.externalMcpInjection === 'claude-mcp-json'` —
  // i.e. only when the file is actually going to exist by spawn time. A `'claude-mcp-json'` def's
  // `buildArgs` reads this to pass `--strict-mcp-config --mcp-config <path>` explicitly instead of
  // relying on Claude Code's auto-discovery of `.mcp.json` from cwd, which requires an interactive
  // trust prompt neither a headless spawn nor this daemon can ever answer — confirmed live
  // (2026-07-30): auto-discovery left the MCP server connection stuck at `"pending"` forever, while
  // the identical config passed explicitly via `--mcp-config` connected immediately. Passing it
  // explicitly also implies `--strict-mcp-config`, which as a side effect closes the previously
  // separate "spawned CLI inherits the interactive user's own unrelated MCP servers" leak, since
  // Claude Code then uses ONLY the passed config. Absent (not just falsy) for every def other than
  // `'claude-mcp-json'` ones and for any run where `mcpJsonInjection` was never configured, so
  // `buildArgs` implementations that ignore unknown `RuntimeContext` fields see no behavior change.
  mcpJsonPath?: string;
};

export type RuntimeCapabilityMap = Record<string, boolean>;

export type RuntimeListModels = {
  args: string[];
  // Required, not optional: every real def that declares `listModels`
  // (codex, cursor-agent, grok-build, opencode) sets this explicitly, so an
  // `?? 5000` fallback in `detection.ts#fetchModels` was dead code for every
  // real caller. Making the field mandatory removes that branch instead of
  // padding a test around data that never occurs (see
  // `detection.ts`'s 2026-07-22 source-map.md entry).
  timeoutMs: number;
  parse: (stdout: string) => RuntimeModelOption[] | null;
};

export type RuntimePromptBudgetError = {
  code: 'AGENT_PROMPT_TOO_LARGE';
  message: string;
  bytes?: number;
  commandLineLength?: number;
  limit: number;
};

/**
 * How the caller should treat a `streamFormat: 'plain'` adapter's raw stdout.
 *
 * Declared as a discriminated union rather than two independent flags
 * (`stdoutBuffering` + `sanitizeStdout`) on purpose: a sanitizer is only
 * *meaningful* on the buffered path, because a pattern to be redacted can
 * straddle two `'data'` chunks — the exact case that motivates buffering at
 * all. Two flat fields would let a def declare `sanitize` alongside live
 * streaming, where the caller could not honor it; the confidentiality gap
 * would then *look* closed in the def while leaking at runtime. The union
 * makes that combination unrepresentable.
 *
 * `undefined` on a def means `{buffering: 'live'}` — today's behavior for
 * every adapter, and the only sane default: a CLI that streams tokens should
 * reach the user as it streams.
 */
export type RuntimeStdoutPolicy =
  /**
   * Forward every stdout chunk to the client as it arrives. The default;
   * what a streaming CLI's own output cadence implies.
   */
  | { readonly buffering: 'live' }
  /**
   * Accumulate every stdout chunk and forward the whole thing exactly once,
   * after the child process closes. For adapters that can print a secret
   * (e.g. an interactive OAuth URL) to stdout and *still exit 0*, where the
   * only safe moment to decide what the user sees is after the output is
   * complete.
   */
  | {
      readonly buffering: 'until-close';
      /**
       * Last transform applied to the fully-accumulated stdout before it is
       * emitted. Receives the concatenation of every chunk; returns what the
       * client may see. Must be pure and must not throw — the caller has
       * nothing better to fall back on than the unsanitized text, so a
       * throwing sanitizer is the leak it was added to prevent.
       */
      readonly sanitize?: (fullText: string) => string;
    };

/**
 * Context for {@link RuntimeLock.acquire}, so a def can decide whether the
 * side effect its lock guards will happen for *this* spawn at all — and skip
 * serializing when it will not.
 */
export type RuntimeLockAcquireContext = {
  /**
   * The model id the caller is about to pass to `buildArgs` as
   * `RuntimeBuildOptions.model`; `undefined` when the caller selected none.
   */
  readonly model: string | undefined;
};

/**
 * Context for {@link RuntimeLockHold.waitForHandoff} — everything a def needs
 * to observe the spawned process confirming it consumed the guarded side
 * effect, without the caller handing over a `ChildProcess` (which would couple
 * `RuntimeAgentDef` to `node:child_process`'s process model for a concern that
 * is really just "did the child read the file yet").
 */
export type RuntimeLockHandoffContext = {
  /**
   * The temp path the caller staged into `RuntimeContext.agentLogFilePath`
   * for this spawn — `undefined` when the def did not declare
   * `needsAgentLogFile`, or the caller could not stage one.
   */
  readonly logFilePath: string | undefined;
  /** The same value {@link RuntimeLockAcquireContext.model} carried. */
  readonly model: string | undefined;
  /**
   * Aborts once the spawned process has exited. A def that polls for its
   * handoff signal should pass this straight into its poller so the poll
   * stops promptly instead of running out its own timeout against a log file
   * that will never grow again.
   */
  readonly processExited: AbortSignal;
};

/** A held {@link RuntimeLock}. See that type's doc for the release contract. */
export type RuntimeLockHold = {
  /**
   * Releases the lock. **Must be idempotent** — the caller invokes it on
   * whichever of `waitForHandoff` settling or process exit happens first, and
   * makes no attempt to suppress the second.
   */
  readonly release: () => void;
  /**
   * Resolves once the spawned process has demonstrably consumed the guarded
   * side effect, at which point the caller releases. Rejecting is treated
   * exactly like resolving (the caller releases either way — a lock held
   * forever because a watcher threw is worse than an early release).
   *
   * Omit it to hold the lock for the child's entire lifetime: the caller then
   * releases only on process exit.
   */
  readonly waitForHandoff?: (context: RuntimeLockHandoffContext) => Promise<void>;
};

/**
 * A def-declared mutex around a *process-global* side effect its `buildArgs`
 * performs — the case that exists today being an adapter with no `--model`
 * flag, whose model choice must instead be written into a single shared
 * settings file that the spawned CLI reads on its own startup. Two concurrent
 * runs of such an adapter race: run A writes model A, A spawns, B writes
 * model B, and *then* A's CLI reads the file — so A silently executes on B's
 * model.
 *
 * The caller's contract, in order:
 *   1. `acquire(...)` before `buildArgs` runs (which is what performs the
 *      side effect), awaiting the returned hold.
 *   2. spawn.
 *   3. `hold.waitForHandoff?.(...)` — and `hold.release()` on whichever of
 *      that settling or process exit comes first.
 *
 * Releasing on process exit is not a fallback, it is load-bearing: a
 * `waitForHandoff` that gives up polling means "I stopped watching", never
 * "the child definitely didn't read the file". Only exit proves the child can
 * no longer read it.
 */
export type RuntimeLock = {
  readonly acquire: (context: RuntimeLockAcquireContext) => Promise<RuntimeLockHold>;
};

export type RuntimeAgentDef = {
  id: string;
  name: string;
  bin: string;
  versionArgs: string[];
  fallbackModels: RuntimeModelOption[];
  buildArgs: (
    prompt: string,
    imagePaths: string[],
    extraAllowedDirs?: string[],
    options?: RuntimeBuildOptions,
    runtimeContext?: RuntimeContext,
  ) => string[];
  streamFormat: string;
  fallbackBins?: string[];
  versionProbeTimeoutMs?: number;
  helpArgs?: string[];
  capabilityFlags?: Record<string, string>;
  // Adapter reads the composed prompt from a caller-created temp file. This
  // is intentionally opt-in: stdin-capable adapters keep using
  // `promptViaStdin`, and argv-only adapters keep their argv budget guard
  // unless their CLI exposes an explicit prompt-file flag.
  promptViaFile?: boolean;
  promptViaStdin?: boolean;
  // Format for the user prompt fed via stdin. Default is plain text (the
  // entire prompt buffer goes in raw, then stdin is closed). When set to
  // 'stream-json' the caller writes a single JSONL line wrapping the prompt
  // as an Anthropic user message (so tool_result blocks can later be
  // injected into the same stdin without re-spawning the child). Only
  // honored for adapters that also set `promptViaStdin: true`.
  promptInputFormat?: 'text' | 'stream-json';
  eventParser?: string;
  env?: Record<string, string>;
  listModels?: RuntimeListModels;
  fetchModels?: (
    resolvedBin: string,
    env: RuntimeEnv,
  ) => Promise<RuntimeModelOption[] | null>;
  reasoningOptions?: RuntimeReasoningOption[];
  /**
   * How this def's CLI/protocol receives user-supplied image attachments.
   * Supersedes the old `supportsImagePaths: boolean` field (which was never
   * actually read anywhere outside its own two defs' tests — a pure
   * documentation flag, not a gate on any real behavior): that boolean could
   * not express *how* a def receives an image, so a caller had no way to
   * apply the right mechanism per def, or to avoid applying two at once.
   *
   *   'native'      — the def's own protocol/CLI already carries the image
   *                    reference or bytes directly (an ACP `resource_link`
   *                    prompt block, pi-rpc's base64 `images` field, a
   *                    dedicated CLI flag like qoder's `--attachment`, …).
   *                    The daemon must NOT also augment the prompt text or
   *                    widen `extraAllowedDirs` for these — the def's own
   *                    code path already delivers the image, and doing both
   *                    would deliver the same image twice.
   *   'prompt-path'  — the CLI has no dedicated image mechanism, but CAN
   *                    read a local file once its path is named in the
   *                    prompt text (confirmed for Claude Code by a live
   *                    `claude -p` probe — see `defs/claude.ts`'s module
   *                    doc). The caller (`@jini-ai/daemon`'s
   *                    `image-prompt-delivery.ts`) appends an
   *                    attachment-naming section to the prompt and widens
   *                    `extraAllowedDirs` with each image's containing
   *                    directory before `buildArgs` runs.
   *   'unsupported'  — the CLI has no way to receive an image at all.
   *                    Distinct from `undefined` on purpose: `undefined`
   *                    means "not yet audited for image support", not "this
   *                    CLI genuinely cannot do it" — a caller must not treat
   *                    the two as equivalent.
   *
   * `undefined` (the default for most defs today) is the same as before this
   * field existed: no def-specific image handling is applied, and images are
   * silently dropped exactly as they were previously — unchanged behavior.
   */
  imageDelivery?: 'native' | 'prompt-path' | 'unsupported';
  maxPromptArgBytes?: number;
  mcpDiscovery?: string;
  // How the caller forwards the user's external MCP servers to this
  // runtime at spawn time. The shape of the injection is one of a small
  // set of strategies, each of which the spawn pipeline knows how to apply:
  //
  //   'claude-mcp-json'      — write `.mcp.json` into the managed
  //                            project cwd (Claude Code auto-loads it).
  //   'acp-merge'            — merge stdio entries into the existing
  //                            `mcpServers` array of an ACP launch
  //                            descriptor.
  //   'opencode-env-content' — serialise to OpenCode's `mcp` config
  //                            schema and hand it through
  //                            `OPENCODE_CONFIG_CONTENT` in the spawn env.
  //   'mimo-env-content'     — same schema as opencode-env-content but
  //                            emitted under MiMo's own env namespace.
  //
  // Leave undefined for adapters that have no native MCP transport wired
  // yet.
  externalMcpInjection?:
    | 'claude-mcp-json'
    | 'acp-merge'
    | 'opencode-env-content'
    | 'mimo-env-content';
  installUrl?: string;
  docsUrl?: string;
  // When `false`, a model picker should hide the "Custom (fill below)"
  // option and the associated free-text input. Use this for agents whose
  // CLI does not actually accept a free-form model id (e.g. a CLI whose
  // model is chosen server-side, or one that routes model selection
  // through an ACP `session/set_model` call and rejects free-form ids).
  // Defaults to allowing custom input (undefined === true) so most
  // adapters keep today's UX.
  supportsCustomModel?: boolean;
  // When `true`, the caller trusts this adapter's CLI to carry its own
  // multi-turn conversation memory across spawn invocations. A chat
  // composer built on this package should skip resending the rendered
  // transcript on follow-up turns and send just the latest user message —
  // see the RuntimeContext.hasPriorAssistantTurn comment for why
  // double-context can otherwise loop a discovery-form-shaped protocol.
  resumesSessionViaCli?: boolean;
  // How the resumable session id is obtained, for `resumesSessionViaCli`
  // adapters. The default (undefined/false) is "specify-style": the caller
  // mints `RuntimeContext.newSessionId` and the CLI is told to use it, so
  // the id the caller stores is the id it generated. When `true` the
  // adapter is "capture-style": the CLI generates its OWN session id and
  // reports it on the stream, so the caller must capture that id from the
  // parsed stream (surfaced as a `status` event's `sessionId`) and persist
  // THAT as the resume handle — `newSessionId` is not passed to the CLI.
  capturesSessionIdFromStream?: boolean;
  // ACP-runtime analogue of capture-style resume: the agent talks an
  // ACP-shaped JSON-RPC protocol and supports resuming via `session/load`.
  // The caller captures the durable upstream session handle from the ACP
  // session and persists THAT, drives `session/load` on a resume turn, and
  // maps the agent's structured `resume_failed` error onto the reseed
  // path. Kept distinct from `resumesSessionViaCli` /
  // `capturesSessionIdFromStream` because the capture + resume transport
  // is the ACP result, not a `--session-id` flag or a stream `status`
  // event.
  resumesSessionViaAcpLoad?: boolean;
  // Optional name of a caller-process environment variable that overrides
  // the default model id when the chat run reaches the spawn layer with
  // null or the synthetic 'default'. Used by adapters whose CLI rejects
  // 'default' so an operator can swap the hardcoded fallback without a
  // code change. The value must be present in the caller's `process.env`;
  // per-agent configured env values that only reach the spawned child are
  // NOT consulted here.
  defaultModelEnvVar?: string;
  // Agent-recommended override for a chat-run inactivity watchdog the
  // caller may run. The watchdog observes child stdout/stderr/SSE
  // activity, not real CPU progress, so agents whose CLIs go silent for
  // long stretches during legitimate work need a longer ceiling than
  // whatever global default the caller applies. Callers may still allow an
  // operator override via their own env var — that wins.
  inactivityTimeoutMs?: number;
  // Declarative authentication probe. When set, detection spawns
  // `<bin> <args>` after the version check and classifies the combined
  // stdout/stderr to derive `authStatus`. An adapter opts in by declaring
  // a cheap, side-effect-free status/whoami command. Adapters WITHOUT this
  // field are never actively probed for auth — their auth status is only
  // inferred later from a real chat failure's error text (see
  // `classifyAgentServiceFailure`).
  authProbe?: {
    args: string[];
    timeoutMs?: number;
  };
  // Format for the `env` field in ACP `session/new` → `mcpServers[].env`.
  // `'array'` (default) emits `[{name, value}]`. `'map'` emits
  // `{"KEY": "val"}` — used by ACP implementations that expect the
  // standard MCP `map[string]string` shape. Leave `undefined` (defaults to
  // 'array') for all other agents.
  acpMcpEnvFormat?: 'array' | 'map';
  // Asks the caller to stage a temp file and hand its path over as
  // `RuntimeContext.agentLogFilePath` before `buildArgs` runs — the exact
  // opt-in shape `promptViaFile` already uses for the prompt file, for the
  // same reason: `buildArgs` cannot invent a path the caller must also be
  // able to read and delete. Only useful for adapters whose CLI takes a
  // diagnostic-log flag (`agy --log-file <path>`); every other def leaves
  // this unset and its `runtimeContext.agentLogFilePath` stays `undefined`.
  //
  // The caller owns the file's whole lifetime and removes it after the child
  // exits, on every path — a leaked log can hold whatever the CLI chose to
  // write into it, including auth material.
  needsAgentLogFile?: boolean;
  // How the caller must treat this adapter's raw stdout — see
  // {@link RuntimeStdoutPolicy}. `undefined` means live per-chunk forwarding,
  // which is what every adapter did before this field existed.
  //
  // Only consulted for adapters the caller drives off raw stdout with no
  // structured parser (`streamFormat: 'plain'`): the JSON-stream/ACP/pi-rpc
  // families derive client events from parsed protocol messages, where
  // "buffer the bytes" is not a meaningful knob.
  stdoutPolicy?: RuntimeStdoutPolicy;
  // A mutex the caller must hold across this adapter's `buildArgs` →
  // spawn → CLI-reads-the-side-effect window — see {@link RuntimeLock} for
  // the full contract and the concrete race it exists to close. Left unset
  // by every adapter whose `buildArgs` is pure.
  runtimeLock?: RuntimeLock;
};

export type DetectedAgent = Omit<
  RuntimeAgentDef,
  | 'buildArgs'
  | 'listModels'
  | 'fetchModels'
  | 'fallbackModels'
  | 'helpArgs'
  | 'capabilityFlags'
  | 'fallbackBins'
  | 'versionProbeTimeoutMs'
  | 'maxPromptArgBytes'
  | 'env'
  // `inactivityTimeoutMs` is a spawn-time-only hint consumed by a chat-run
  // watchdog. It is not part of a public agent-registry API contract, so
  // omitting it here keeps that response aligned with such a shared
  // web/CLI shape — agents pick it up by reading the runtime def directly,
  // the registry payload stays unchanged.
  | 'inactivityTimeoutMs'
  | 'authProbe'
  // All three of the spawn-orchestration fields are stripped for the same
  // reason `inactivityTimeoutMs` is: they instruct whoever *spawns* the CLI
  // and mean nothing to a registry consumer picking an agent from a list.
  // `stdoutPolicy` and `runtimeLock` additionally carry closures, which a
  // JSON response would silently flatten into a misleading half-object
  // (`{"buffering":"until-close"}` with the sanitizer gone, `{}` for the
  // lock) rather than omit — see `detection.ts#stripFns`.
  | 'needsAgentLogFile'
  | 'stdoutPolicy'
  | 'runtimeLock'
> & {
  models: RuntimeModelOption[];
  modelsSource: RuntimeModelSource;
  available: boolean;
  authStatus?: 'ok' | 'missing' | 'unknown';
  authMessage?: string;
  path?: string;
  version?: string | null;
  diagnostics?: AgentDiagnostic[];
};

export type RuntimeExecOptions = ExecFileOptions & {
  env?: NodeJS.ProcessEnv;
};

/**
 * Agent unavailability/fix-affordance vocabulary. Moved to `@jini-ai/protocol` on 2026-07-29 (see
 * that package's `agent-catalog.ts`) so a browser package can consume it without depending on this
 * Node-only runtime. Re-exported here so every existing import keeps working unchanged.
 */
export type {
  AgentDiagnostic,
  AgentDiagnosticReason,
  AgentDiagnosticSeverity,
  AgentFixIntent,
} from '@jini-ai/protocol';
