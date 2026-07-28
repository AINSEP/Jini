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
  supportsImagePaths?: boolean;
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
 * A typed "what should the UI do to fix this" intent attached to an
 * {@link AgentDiagnostic}. The UI renders a button per intent and owns the
 * concrete handler (open a URL, re-run detection, write an env override,
 * launch an OAuth terminal flow). Keeping the intent typed — rather than a
 * pre-baked button label + URL — lets multiple surfaces (a settings card,
 * an unavailable-agents grid, a CLI healthcheck) render the same fix
 * affordances from one source of truth instead of each re-deriving copy
 * and wiring.
 *
 * Vendored (minimal, unmodified shape) from OD's
 * `packages/contracts/src/api/registry.ts#AgentFixIntent` — see
 * `source-map.md`. `@jini-ai/agent-runtime` does not depend on OD's
 * contracts workspace package.
 */
export type AgentFixIntent =
  /** Open the agent's configuration / auth docs (`AgentInfo.docsUrl`). */
  | { kind: 'openDocs' }
  /** Open the agent's install / download page (`AgentInfo.installUrl`). */
  | { kind: 'openInstall' }
  /** Re-run agent detection (a Settings "Rescan" affordance). */
  | { kind: 'rescan' }
  /**
   * Prompt the user to point the host application at an explicit binary by
   * writing `envKey` (e.g. `CURSOR_AGENT_BIN`) into a configured-env store.
   * Used when the CLI is installed somewhere PATH detection can't reach.
   */
  | { kind: 'setEnv'; envKey: string }
  /** Clear a previously-set binary override so detection falls back to PATH. */
  | { kind: 'clearEnv'; envKey: string }
  /**
   * Launch the agent's interactive sign-in in a system terminal (used by
   * adapters whose OAuth flow cannot complete in a headless/print mode).
   */
  | { kind: 'launchOAuth'; agentId: string };

export type AgentDiagnosticReason =
  /** The binary (and any fallback names) was not found on PATH. */
  | 'not-on-path'
  /** A file matched but is not executable (missing +x / wrong PATHEXT). */
  | 'not-executable'
  /** A wrapper/shim was found but its target is gone (exit 126/127). */
  | 'shim-broken'
  /** A user-set `*_BIN` override points at a missing/invalid file. */
  | 'configured-bin-invalid'
  /** Installed and invocable, but the CLI is not authenticated. */
  | 'auth-missing'
  /** Installed, but auth status could not be verified. */
  | 'auth-unknown';

export type AgentDiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * Why a CLI agent is unavailable or only partially usable, in a shape a UI
 * can render as "one-line reason + fix button(s)" instead of a silent grey
 * card. Vendored from OD's contracts workspace package — see
 * `AgentFixIntent`'s doc comment.
 */
export interface AgentDiagnostic {
  reason: AgentDiagnosticReason;
  severity: AgentDiagnosticSeverity;
  /** Short, human-readable, single-sentence explanation. */
  message: string;
  /** Optional longer context (e.g. the probe's stderr tail). */
  detail?: string;
  /**
   * Directories PATH detection searched, surfaced verbatim for the
   * `not-on-path` case so the user can see where detection looked before
   * being asked to set an explicit binary path.
   */
  searchedDirs?: string[];
  /** Ordered fix affordances the UI should offer for this diagnostic. */
  fixActions?: AgentFixIntent[];
}
