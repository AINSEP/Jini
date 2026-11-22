import type { createRoleMarkerGuard } from '../role-marker-guard.js';
import { type PinnedFetch } from './connection-guard.js';
import { type TurnEndReason } from './turn-end-guard.js';
import type { ProviderToolSnapshotOptions, ProviderSchemaFallback } from './provider-tool-policy.js';
export interface OpenAiFunctionToolDef {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters: Record<string, unknown>;
    readonly strict?: boolean;
  };
}

export interface OpenAiToolCallParam {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

export interface OpenAiTextPart {
  readonly type: 'text';
  readonly text: string;
}

/** `detail` defaults to `'auto'` server-side when omitted — never sent unless the caller supplies it. */
export interface OpenAiImageUrlPart {
  readonly type: 'image_url';
  readonly image_url: {
    readonly url: string;
    readonly detail?: 'auto' | 'low' | 'high';
  };
}

/** A user/system/assistant message's `content` array item. Not legal inside a `role: 'tool'` message — see module doc's "Tool messages cannot carry an image" section. */
export type OpenAiContentPart = OpenAiTextPart | OpenAiImageUrlPart;

export interface OpenAiMessageParam {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null | readonly OpenAiContentPart[];
  readonly tool_calls?: readonly OpenAiToolCallParam[];
  readonly tool_call_id?: string;
  readonly name?: string;
}

export interface OpenAiToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/** `content` may include `OpenAiImageUrlPart`s (e.g. a vision self-check's screenshot) even though the wire `tool` message can't carry them directly — `runOpenAiToolTurn` splits them onto a follow-up `user` message; see module doc. */
export interface OpenAiToolResult {
  readonly content: string | readonly OpenAiContentPart[];
}

/** Host-owned tool execution — same "the collaborator is always supplied" convention as `anthropic-messages.ts#AnthropicToolExecutor`. */
export type OpenAiToolExecutor = (call: OpenAiToolCall) => Promise<OpenAiToolResult>;

export type OpenAiTurnEndReason = TurnEndReason;

export type OpenAiTurnEvent =
  | { readonly type: 'status'; readonly label: string }
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: 'tool_result'; readonly toolUseId: string; readonly content: string | readonly OpenAiContentPart[]; readonly isError: boolean }
  | { readonly type: 'usage'; readonly usage: Record<string, unknown> | null }
  | { readonly type: 'fabricated_role_marker'; readonly marker: string; readonly messageId: string }
  | { readonly type: 'error'; readonly message: string; readonly code?: string }
  | { readonly type: 'end'; readonly reason: OpenAiTurnEndReason };

export interface OpenAiTurnOptions {
  readonly apiKey: string;
  /** Defaults to `https://api.openai.com`. Overridable for OpenAI-compatible gateways (matching `providers/model-catalog.ts`'s `openai`-protocol `baseUrl` convention). */
  readonly baseUrl?: string;
  readonly model: string;
  readonly messages: readonly OpenAiMessageParam[];
  readonly tools?: readonly OpenAiFunctionToolDef[];
  /** Refresh the run's projection immediately before each HTTP request. */
  readonly getTools?: (options?: ProviderToolSnapshotOptions) => readonly OpenAiFunctionToolDef[];
  readonly onSchemaFallback?: (event: ProviderSchemaFallback) => void;
  readonly temperature?: number;
  /** Defaults to {@link DEFAULT_OPENAI_MAX_TOKENS} (8192) when omitted or not a positive number — a token limit is always sent, matching OD's real behavior (see module doc). */
  readonly maxTokens?: number;
  /** Same bound and rationale as `AnthropicTurnOptions.maxToolTurns`. Defaults to 8. */
  readonly maxToolTurns?: number;
  readonly executeTool?: OpenAiToolExecutor;
  readonly onEvent: (event: OpenAiTurnEvent) => void;
  readonly signal?: AbortSignal;
  /** Caller-supplied extra headers — see `anthropic-messages.ts#AnthropicTurnOptions.extraHeaders`'s doc for why this exists and what it fixes. */
  readonly extraHeaders?: Record<string, string>;
  /** Injectable HTTP transport, defaulting to {@link pinnedFetch} (SSRF-guarded, DNS-pinned). See `anthropic-messages.ts#AnthropicTurnOptions.fetchImpl`'s doc for the seam this exists for and why production wiring must never override it. Forwarded to {@link runOpenAiCompatibleRequest} via `OpenAiCompatibleRequestInit.fetchImpl` — `azure-chat.ts`/`ollama-chat.ts` accept and forward their own copy of this field the same way. */
  readonly fetchImpl?: PinnedFetch;
  /** Injectable DNS resolver for {@link validateBaseUrlResolved}'s DNS-pinning check, defaulting to {@link defaultDnsLookup}. Same test-only override rationale as `fetchImpl`. */
  readonly dnsLookup?: import('@jini-ai/core/contracts/agents').DnsLookupFn;
}

export interface OpenAiTurnResult {
  readonly finishReason: string | null;
  readonly toolTurns: number;
}

export interface PendingToolCall {
  id: string;
  name: string;
  argsJson: string;
}

/** Shared return shape for one reduced OpenAI-compatible streaming request — exported so every OpenAI-compatible provider turn-runner (`azure-chat.ts`, `ollama-chat.ts`) can type its own internal single-request helper against it without re-declaring an identical interface. */
export interface OpenAiCompatibleRequestOutcome {
  readonly finishReason: string | null;
  readonly toolCalls: readonly OpenAiToolCall[];
  readonly text: string;
}

/** Injected parameters for {@link runOpenAiCompatibleRequest}. Every OpenAI-compatible provider builds its own URL/headers/body (its own auth scheme, its own base-URL default and SSRF validation) and hands the finished request to this shared reducer — see that function's doc for why. */
export interface OpenAiCompatibleRequestInit {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
  /** The address `validateBaseUrlResolved` validated for `url`'s hostname, forwarded verbatim to `pinnedFetch` so the connection dials it directly instead of re-resolving DNS. `undefined` for the loopback-literal / IP-literal hosts that skip resolution — see `pinnedFetch`'s doc. */
  readonly pinnedAddress?: import('@jini-ai/core/contracts/agents').DnsLookupAddress;
  readonly signal?: AbortSignal;
  /** Secrets to strip out of any error message surfaced to the caller (e.g. the request's API key) — forwarded verbatim to `redactSecrets`'s `exactSecrets` parameter. */
  readonly redactSecretsList: ReadonlyArray<string | undefined | null>;
  /** Role-marker guard message id — distinguishes each provider's stream in guard telemetry (`'openai-turn'`, `'azure-turn'`, `'ollama-turn'`). */
  readonly guardMessageId: string;
  /** Human-readable provider name used in the "response had no body" fallback error message (e.g. `'OpenAI'`, `'Azure OpenAI'`, `'Ollama'`). */
  readonly providerLabel: string;
  readonly onEvent: (event: OpenAiTurnEvent) => void;
  readonly emitEnd: (reason: OpenAiTurnEndReason) => void;
  readonly hasEnded: () => boolean;
  /**
   * Optional single-retry hook: called with the HTTP status and raw error
   * body text on a non-ok response, before the error is treated as
   * terminal. Return a replacement request body to retry once with, or
   * `null`/`undefined` to fall through to the normal error path. Matches
   * OD's real `[proxy:azure]` handler, which retries a 400
   * `isUnsupportedMaxTokensError` response with `max_completion_tokens`
   * (see `azure-chat.ts`). Cleared on the retried call so a second failure
   * cannot retry again.
   */
  readonly retryableBody?: (status: number, rawErrorText: string) => Record<string, unknown> | null | undefined;
  /** Independent of the legacy token-parameter retry; consumed only on a recognized tool rejection. */
  readonly retryToolBody?: (input: { status: number; rawErrorText: string; body: Record<string, unknown> }) => Record<string, unknown> | null;
  /** Injectable HTTP transport, defaulting to {@link pinnedFetch} (SSRF-guarded, DNS-pinned) — forwarded verbatim from the calling provider's own `OpenAiTurnOptions.fetchImpl`/`AzureTurnOptions.fetchImpl`/`OllamaTurnOptions.fetchImpl`. See `anthropic-messages.ts#AnthropicTurnOptions.fetchImpl`'s doc for the seam this exists for. */
  readonly fetchImpl?: PinnedFetch;
}

/** Mutable reduction state threaded through one streaming request's SSE frame handlers (below). Grouped into one object so each handler takes a single parameter instead of several. Exported so a unit test can construct one directly (e.g. `{ guard: createRoleMarkerGuard('t'), toolCalls: new Map(), fullText: '', finishReason: null, usage: null }`) without going through a full `runOpenAiToolTurn` call. */
export interface OpenAiStreamState {
  readonly guard: ReturnType<typeof createRoleMarkerGuard>;
  readonly toolCalls: Map<number, PendingToolCall>;
  fullText: string;
  finishReason: string | null;
  usage: Record<string, unknown> | null;
}

/** Per-turn state shared by the wire adapters; never retries streams or executes tools. */
export interface StrictToolRetryState {
  readonly enabled: boolean;
  readonly downgrade: (input: { status: number; rawErrorText: string; toolNames: readonly string[] }) => boolean;
}
