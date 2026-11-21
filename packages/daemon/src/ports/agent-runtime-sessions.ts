/** @file Session types daemon passes to the host-bound ACP/PI attach functions; restated (single consumer, DESIGN B4). Node-typed transport, so not core. */
import type { ChildProcess } from 'node:child_process';
import type { RuntimeBuildOptions } from '@jini-ai/core/contracts/agents';

/** A JSON-RPC 2.0 request or response identifier. May be a numeric integer or a string. */
export type JsonRpcId = string | number;

/** An arbitrary JSON object with string keys and unknown values. Used as a loose type for parsed RPC frames. */
/** ACP records may contain unvalidated provider values; this does not assert JSON safety. */
export type UnknownRecord = Record<string, unknown>;

/** The Node `ChildProcess` handle for a spawned ACP agent subprocess. */
export type AcpChildProcess = ChildProcess;

/**
 * Execution profile of an agent run: whether artifacts are written to the
 * filesystem (`'filesystem'`) or emitted inline as agent text
 * (`'text_artifact'`). Inlined here rather than imported from an external
 * contracts package — the upstream type is a trivial two-value literal union
 * with no product-specific branding, so importing a whole package for it
 * would be the tail wagging the dog. See archived provenance ledger.
 */
export type ExecutionProfile = 'filesystem' | 'text_artifact';

/**
 * A structured, provider-agnostic account failure classification. Shaped
 * generically (not AMR-specific field names) so any provider's classifier can
 * satisfy this contract.
 */
export interface AccountFailure {
  /** A stable machine-readable failure code (e.g. `'AUTH_REQUIRED'`). */
  code: string;
  /** A human-readable message describing the failure and how to recover. */
  message: string;
  /** The recovery action the caller should surface to the end user. */
  action: string;
  /** Optional URL to send the user to for taking `action` (e.g. a billing page). */
  actionUrl?: string;
}

/**
 * Injectable port: classifies free-form diagnostic text (drawn from an ACP
 * session update or a stderr tail) into a structured `AccountFailure`, or
 * `null` when the text does not match a known account-failure pattern.
 */
export interface AccountFailureClassifier {
  classify(requiredArgs: { text: string }): AccountFailure | null;
}

/**
 * Loose descriptor for a single MCP server entry as supplied by a caller.
 * All fields are typed `unknown` so the builder can safely normalise them
 * without trusting the caller's type discipline.
 */
export interface AcpMcpServerInput {
  type?: unknown;
  name?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
}

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

/** A plain JSON object — the base payload type for pi RPC messages. */
export type JsonRecord = Record<string, unknown>;
/** Callback signature for forwarding a typed event to the daemon's SSE layer. */
export type SendAgentEvent = (requiredArgs: { event: string; payload: JsonRecord }) => void;

/** Options for `attachPiRpcSession`. All fields map directly to the pi RPC protocol. */
export type PiRpcSessionOptions = {
  child: ChildProcess;
  prompt: string;
  cwd?: string;
  model?: string | null;
  send: SendAgentEvent;
  imagePaths?: string[];
  uploadRoot?: string;
  parentSession?: string;
  /** Explicit post-completion grace period before SIGTERM. Native hosts resolve env defaults. */
  gracefulShutdownMs?: number;
};
/** Handle returned by `attachPiRpcSession` for querying run state and requesting abort. */
export type PiRpcSession = {
  hasFatalError(): boolean;
  abort(): void;
  getLastSessionPath(): string | null;
};

export type AcpAttachRequired = Pick<AttachAcpSessionOptions, 'child' | 'prompt' | 'send'>;
export type AcpAttachOptional = Omit<AttachAcpSessionOptions, 'child' | 'prompt' | 'send'>;
export type PiRpcAttachRequired = Pick<PiRpcSessionOptions, 'child' | 'prompt' | 'send'>;
export type PiRpcAttachOptional = Omit<PiRpcSessionOptions, 'child' | 'prompt' | 'send'>;
