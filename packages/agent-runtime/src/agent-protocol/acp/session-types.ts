import type { ExecutionProfile } from './types.js';
import type { RuntimeBuildOptions } from '@jini-ai/core/contracts/agents';
import { type ArtifactTextSuppressor } from './text-suppression.js';
import type { JsonRpcId, UnknownRecord, AcpChildProcess } from './types.js';
import { type AcpMcpServerInput } from './session-params.js';
import { type AccountFailureClassifier } from './account-failure.js';
/** One option offered by an ACP agent for a pending tool permission request. */
export interface AcpPermissionOption {
  readonly optionId: string;
  readonly kind?: string;
  readonly name?: string;
  readonly [key: string]: unknown;
}


/**
 * The complete, host-auditable context for an ACP agent's request to perform
 * one of *its own* tool calls. Selecting an option authorizes or rejects the
 * agent's native tool execution; it is intentionally distinct from Jini's
 * `ToolExecutor`, which only executes Jini-registered delegated tools.
 */
export interface AcpPermissionRequest {
  readonly requestId: JsonRpcId;
  readonly sessionId: string | null;
  readonly toolCall: UnknownRecord | null;
  readonly options: readonly AcpPermissionOption[];
  /** Original ACP request parameters for forward-compatible audit storage. */
  readonly rawParams: UnknownRecord;
}

/** A host's response to an {@link AcpPermissionRequest}. */
export type AcpPermissionDecision =
  | { readonly outcome: 'selected'; readonly optionId: string }
  | { readonly outcome: 'cancelled' };

/**
 * Injected ACP authorization seam. It may be async so a host can persist an
 * audit record or await an interactive policy decision before replying.
 */
export type AcpPermissionHandler = (
  request: AcpPermissionRequest,
) => AcpPermissionDecision | Promise<AcpPermissionDecision>;

/** Public state/abort handle returned by {@link attachAcpSession}. */
export interface AcpSessionController {
  hasFatalError(): boolean;
  getDurableSessionId(): string | null;
  completedSuccessfully(): boolean;
  abort(): void;
}

/**
 * Options for `attachAcpSession`. All fields except `child`, `prompt`, and
 * `send` are optional and carry sensible defaults.
 */
export interface AttachAcpSessionOptions {
  /** Host-authorized parity: bypass native permission requests; disable silence watchdog. */
  cliParity?: boolean;
  child: AcpChildProcess;
  prompt: string;
  cwd?: string;
  model?: string | null;
  effort?: string;
  imagePaths?: string[];
  mcpServers?: AcpMcpServerInput[];
  // Passed through to buildAcpSessionNewParams — see AcpSessionOptions.
  envFormat?: 'array' | 'map';
  send: (requiredArgs: { event: string; payload: unknown }) => void;
  /**
   * Receives every native ACP tool-permission request before the agent can
   * execute it. Omit it to answer by `permissionMode`; a handler that throws
   * or picks an unoffered option cancels the request instead of failing the run.
   */
  onPermissionRequest?: AcpPermissionHandler;
  /** Default policy when no handler is injected: bypass allows once; otherwise reject. */
  permissionMode?: RuntimeBuildOptions['permissionMode'];
  clientName?: string;
  clientVersion?: string;
  stageTimeoutMs?: number;
  executionProfile?: ExecutionProfile;
  modelUnavailableErrorCode?: 'AMR_MODEL_UNAVAILABLE';
  // Classifies AMR retry-status updates and stderr tails into a structured
  // account-failure error (auth required, insufficient balance, etc.). A host
  // application injects its own provider-specific classifier here; the
  // default `noopAccountFailureClassifier` never matches, which reproduces
  // not having this feature at all. See acp/account-failure.ts.
  accountFailureClassifier?: AccountFailureClassifier;
  // When set, resume an existing upstream session instead of creating a new
  // one: the handshake sends `session/load { sessionId }` (the durable handle
  // captured from a prior run via `getDurableSessionId()`) rather than
  // `session/new`. The agent verifies the session and, if it is gone, returns a
  // structured `resume_failed` error the caller maps to its reseed path.
  // Every failure before session/load acknowledgement has
  // `error.details.kind: 'resume_failed'`, including transport/timeouts.
  // The original error code is retained, with prior details under `cause`.
  // Once load succeeds, later model/prompt failures are ordinary run errors.
  resumeSessionId?: string | null;
  /** Awaited before stdin is closed or the child is signalled, so the caller can record the child's descendants while it is alive. A rejection is ignored. */
  beforeRelease?: () => Promise<void>;
  // Subsegment timing markers for spawn->first-token attribution.
  // `onCliReady` fires once on the first well-formed ACP JSON-RPC message
  // (the CLI is up and speaking the protocol); `onSessionInit` fires once when
  // the `session/new` handshake is acknowledged (a session id is established).
  // Both are best-effort and the caller dedupes, so extra calls are harmless.
  onCliReady?: () => void;
  onSessionInit?: () => void;
}

// ---------------------------------------------------------------------------
// Exported session-update / result-routing state machine.
//
// `attachAcpSession` owns exactly one `AcpSessionState` + `AcpSessionEffects`
// pair per session and threads them through every handler call below. This
// is what lets the per-message-kind handlers be free, exported, and
// independently unit-testable (construct a state, a fake effects bundle with
// `vi.fn()` stubs, and call the handler directly) instead of closures baked
// into one giant function.
// ---------------------------------------------------------------------------

/**
 * Mutable per-session state shared by the exported ACP handlers below.
 * `attachAcpSession` creates one instance per session via
 * `createAcpSessionState` (`./session-state.js`) and mutates it in place as messages arrive.
 */
export interface AcpSessionState {
  // Handshake / JSON-RPC id routing.
  expectedId: JsonRpcId;
  nextId: number;
  promptRequestId: JsonRpcId | null;
  setModelRequestId: JsonRpcId | null;
  effortRequestId: JsonRpcId | null;
  configOptions: unknown;
  sessionId: string | null;
  // The durable upstream session handle reported by the agent on session/new
  // or session/load (e.g. a vendor bridge's own session id). Distinct from
  // `sessionId`, which is the ACP wrapper id.
  durableSessionId: string | null;
  activeModel: string | null;
  modelConfigId: string | null;
  // session/update: agent_thought_chunk / agent_message_chunk streaming.
  emittedThinkingStart: boolean;
  emittedTextChunk: boolean;
  emittedVisibleTextChunk: boolean;
  emittedTextBuffer: string;
  // session/update: tool_call / tool_call_update.
  emittedToolCall: boolean;
  emittedConcreteToolEvent: boolean;
  dsmlArtifactSuppressor: ArtifactTextSuppressor | null;
  dsmlArtifactSuppressorLastSuppressedChars: number;
  dsmlArtifactSuppressorToolCallId: string | null;
  dsmlArtifactSuppressorArmedAfterText: boolean;
  dsmlArtifactSuppressorSawIncrementalProse: boolean;
  acpArtifactWriteToolCallIds: Set<string>;
  // Per artifact-write tool call, accumulate the best concrete file path seen
  // across its frames and whether we have already mirrored it into canonical
  // tool_use/tool_result events. See `mirrorArtifactWriteToolEvent`.
  acpArtifactRunEventState: Map<string, { path: string | null; emitted: boolean }>;
}

/**
 * The narrow slice of `attachAcpSession`'s side-effect closures and
 * read-only session config that the exported handlers below need.
 * `attachAcpSession` builds exactly one of these per session; tests
 * construct a fake one with `vi.fn()` stubs for the callbacks.
 */
export interface AcpSessionEffects {
  send: (requiredArgs: { event: string; payload: unknown }) => void;
  fail: (
    message: string,
    options?: { forceModelUnavailable?: boolean; details?: unknown; retryable?: boolean },
  ) => void;
  failWithPayload: (payload: UnknownRecord) => void;
  writeRpc: (id: JsonRpcId, method: string, params: unknown, timeoutLabel: string) => void;
  sendPrompt: () => void;
  recoverFromModelSelectionError: () => void;
  finishCleanPrompt: (usageSource?: unknown) => void;
  emitVisibleTextDelta: (delta: string) => void;
  noteArtifactTextSuppression: (reason: string) => void;
  noteToolCallTextSuppression: (reason: string) => void;
  emitAcpRawShapeDiagnostic: (update: UnknownRecord) => void;
  toolCallTextSuppressor: ArtifactTextSuppressor;
  runStartedAt: number;
  modelUnavailableErrorCode?: 'AMR_MODEL_UNAVAILABLE' | undefined;
  accountFailureClassifier: AccountFailureClassifier;
  model?: string | null | undefined;
  effort?: string | undefined;
  onSessionInit?: (() => void) | undefined;
  resumeSessionId?: string | null | undefined;
  effectiveCwd: string;
  mcpServers?: AcpMcpServerInput[] | undefined;
  envFormat: 'array' | 'map';
}

/** `AttachAcpSessionOptions` fields resolved to their defaults. Extracted so `attachAcpSession`'s own signature carries no default-value branches. */
export interface ResolvedAcpSessionOptions {
  imagePaths: string[];
  envFormat: 'array' | 'map';
  clientName: string;
  clientVersion: string;
  stageTimeoutMs: number;
  executionProfile: ExecutionProfile;
  accountFailureClassifier: AccountFailureClassifier;
}
