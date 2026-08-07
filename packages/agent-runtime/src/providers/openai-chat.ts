/**
 * @module providers/openai-chat
 *
 * OpenAI Chat Completions API wire adapter + tool-loop turn-runner. Built
 * fresh against OpenAI's real, current public API docs/reference
 * (`developers.openai.com/api/docs/guides/function-calling` for the
 * `tools`/`tool_calls`/tool-result-message shapes; the streaming delta
 * accumulation shape below matches the long-stable, widely-documented
 * `chat.completion.chunk` SSE format every OpenAI-compatible gateway this
 * package's `providers/model-catalog.ts` already targets — `openai`/
 * `senseaudio`/`aihubmix` protocols — implements identically), per this
 * repo's "verify against real API docs, don't guess from memory"
 * convention. Only the *shape* (a turn-runner with a tool-execution loop)
 * is modeled on OD's `apps/daemon/src/routes/chat.ts`'s `runTurn` per
 * `ADS-memory/reports/proposals/PROP-http-route-packs-chat-model-proxy-
 * 2026-07-21.md` — this task did not have direct access to that file.
 * Sibling of `anthropic-messages.ts`; see that module's header for the
 * shared design rationale (package placement, `extraHeaders` fix for the
 * confirmed OpenRouter product-identity leak, the `turn-end-guard.ts` fix
 * for the confirmed duplicate-`end`-event bug — both apply identically
 * here).
 *
 * **Token-limit fix**: an earlier version of this module sent no
 * `max_tokens`/`max_completion_tokens` field at all — a live comparison
 * against a running Open Design daemon found OD always sends one (defaulting
 * to 8192), model-aware between the legacy and newer field name. This
 * module now wires in `./token-params.js#buildOpenAIChatTokenParam` — that
 * module already existed, itself a verbatim port of OD's real
 * `apps/daemon/src/integrations/openai-chat-token-params.ts`, but was never
 * actually called from here until this fix. `azure-chat.ts` reuses the same
 * module's `buildLegacyMaxTokensParam` (always the legacy `max_tokens`
 * field, not model-aware) — matching OD's own azure handler, which never
 * uses the model-aware picker (Azure deployment names are caller-defined
 * strings, not necessarily matching OpenAI's own model-naming scheme).
 *
 * **Image support**: verified against `developers.openai.com/api/docs/api-reference/chat/create`
 * (the Chat Completions endpoint specifically — a redirect from the older
 * `platform.openai.com/docs/guides/vision` URL now leads to a *different*, newer Responses API
 * guide that uses `input_text`/`input_image` part names; those do not apply here and are not
 * modeled). A user/system/assistant message's `content` may be an array mixing `{type:'text'}` and
 * `{type:'image_url', image_url:{url, detail?}}` parts; `url` is either an `https://` URL (OpenAI's
 * servers fetch it — see `invalidOpenAiContentPartReason`'s doc for why this module does not size-
 * check that case) or a `data:<mime>;base64,<data>` URI. Supported formats per the same reference:
 * PNG/JPEG/WEBP/non-animated GIF; documented limits are a 512 MB total request payload and 1500
 * images per request (this module also applies its own conservative single-image guard — see
 * `MAX_IMAGE_DATA_URI_BASE64_CHARS`'s doc).
 *
 * **Tool messages cannot carry an image** — confirmed against the same API reference: a `role:
 * 'tool'` message's `content` is documented as `string | ChatCompletionContentPartText[]` only
 * ("For tool messages, only type text is supported"). So a vision self-check whose tool result
 * includes a screenshot cannot put that image on the `tool` message itself. `runOpenAiToolTurn`
 * instead keeps the `tool` message text-only (see `splitOpenAiToolResultContent`) and appends one
 * synthetic `role: 'user'` message carrying every image from the batch, built up while iterating
 * every `tool_call` in the batch but appended exactly once, after every one of that batch's `tool`
 * messages — never interleaved between them or emitted per-call, since OpenAI requires every `tool`
 * message answering a batch of parallel `tool_calls` to directly follow the assistant message with
 * nothing else in between. This is a real 400 if violated, not a style concern — see
 * `runOpenAiToolTurn`'s tool-loop body and its test file's multi-tool-call image test.
 *
 * **This synthetic follow-up message is a workaround for the OpenAI wire protocol's own text-only
 * `tool` message, not structure this module invented.** Anthropic's `tool_result` content block can
 * carry an image directly (see `anthropic-messages.ts`) and needs no such split. Each image (or run
 * of images) in the follow-up is preceded by a plain-text label naming the tool call it answers
 * (name + `tool_call_id`) — an unlabeled image sitting alone in a `user` message is indistinguishable
 * from a human having just pasted a screenshot, which in a vision self-check loop risks the model
 * treating its own tool's output as a brand-new user request instead of a continuation of its own
 * reasoning.
 */
import { createRoleMarkerGuard } from '../role-marker-guard.js';
import { defaultDnsLookup, pinnedFetch, redactSecrets, validateBaseUrlResolved, type DnsLookupAddress } from './connection-guard.js';
import { decodeSseStream, type DecodedSseEvent } from './sse-decode.js';
import { buildOpenAIChatTokenParam } from './token-params.js';
import { createTurnEndGuard, type TurnEndReason } from './turn-end-guard.js';

export interface OpenAiFunctionToolDef {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters: Record<string, unknown>;
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
}

export interface OpenAiTurnResult {
  readonly finishReason: string | null;
  readonly toolTurns: number;
}

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';
const DEFAULT_MAX_TOOL_TURNS = 8;
const DONE_SENTINEL = '[DONE]';
/** Matches OD's own default (`apps/daemon/src/routes/chat.ts`'s openai/azure handlers both fall back to this when the caller doesn't supply one) — a real, explicit bound is always sent, never an unbounded request. */
export const DEFAULT_OPENAI_MAX_TOKENS = 8192;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function openAiRequestUrl(baseUrl: string | undefined): string {
  const base = (baseUrl ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
  return /\/v\d+(\/|$)/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

export function openAiHeaders(options: OpenAiTurnOptions): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${options.apiKey}`,
    ...(options.extraHeaders ?? {}),
  };
}

export function openAiRequestBody(options: OpenAiTurnOptions, messages: readonly OpenAiMessageParam[]): Record<string, unknown> {
  const effectiveMaxTokens = typeof options.maxTokens === 'number' && options.maxTokens > 0 ? options.maxTokens : DEFAULT_OPENAI_MAX_TOKENS;
  return {
    model: options.model,
    stream: true,
    stream_options: { include_usage: true },
    messages,
    ...buildOpenAIChatTokenParam(options.model, effectiveMaxTokens),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
  };
}

export function extractOpenAiErrorDetail(rawText: string): string {
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
      return parsed.error.message;
    }
  } catch {
    // Non-JSON error body — fall through to the raw text below.
  }
  return rawText.trim().slice(0, 500);
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
  readonly pinnedAddress?: DnsLookupAddress;
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
}

/** Mutable reduction state threaded through one streaming request's SSE frame handlers (below). Grouped into one object so each handler takes a single parameter instead of several. Exported so a unit test can construct one directly (e.g. `{ guard: createRoleMarkerGuard('t'), toolCalls: new Map(), fullText: '', finishReason: null, usage: null }`) without going through a full `runOpenAiToolTurn` call. */
export interface OpenAiStreamState {
  readonly guard: ReturnType<typeof createRoleMarkerGuard>;
  readonly toolCalls: Map<number, PendingToolCall>;
  fullText: string;
  finishReason: string | null;
  usage: Record<string, unknown> | null;
}

/** Parses one SSE frame's data as a JSON object, or `null` for a malformed/empty keep-alive frame or a non-object payload — both are tolerated by the caller as "nothing to do this frame". */
export function parseOpenAiSseData(raw: string): Record<string, unknown> | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return isRecord(data) ? data : null;
}

export function applyOpenAiStreamUsage(state: OpenAiStreamState, data: Record<string, unknown>, onEvent: (event: OpenAiTurnEvent) => void): void {
  if (!isRecord(data.usage)) return;
  state.usage = data.usage;
  onEvent({ type: 'usage', usage: data.usage });
}

/** The chunk's first (and, for Chat Completions, only) choice — `null` when the chunk carries no choice at all (e.g. a usage-only trailer chunk). */
export function firstOpenAiChoice(data: Record<string, unknown>): Record<string, unknown> | null {
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const choice = choices[0];
  return isRecord(choice) ? choice : null;
}

/**
 * Feeds one text delta through the role-marker guard and emits the safe portion. Returns
 * `'break'` once the guard flags contamination (the caller ends the turn immediately), otherwise
 * `'continue'` — same contract as `anthropic-messages.ts#handleAnthropicTextDelta`.
 */
export function handleOpenAiTextContentDelta(state: OpenAiStreamState, content: string, onEvent: (event: OpenAiTurnEvent) => void): 'continue' | 'break' {
  const safe = state.guard.feedText(content);
  if (safe.length > 0) {
    state.fullText += safe;
    onEvent({ type: 'text_delta', delta: safe });
  }
  if (!state.guard.contaminated) return 'continue';
  const warn = state.guard.warningEvent();
  if (warn) onEvent(warn);
  return 'break';
}

/** Builds a fresh `PendingToolCall` from the streaming chunk that first mentions a given tool-call index — OpenAI sends `id`/`function.name` once, on that first chunk, then dribbles `function.arguments` in across subsequent chunks (accumulated separately by the caller). */
export function newPendingOpenAiToolCall(rawCall: Record<string, unknown>, index: number): PendingToolCall {
  const id = typeof rawCall.id === 'string' ? rawCall.id : `call_${index}`;
  const fn = isRecord(rawCall.function) ? rawCall.function : {};
  const name = typeof fn.name === 'string' ? fn.name : '';
  return { id, name, argsJson: '' };
}

/** Accumulates one `delta.tool_calls[]` entry from a streaming chunk into its running `PendingToolCall`. */
export function accumulateOpenAiToolCallDelta(state: OpenAiStreamState, rawCall: unknown): void {
  if (!isRecord(rawCall) || typeof rawCall.index !== 'number') return;
  let pending = state.toolCalls.get(rawCall.index);
  if (!pending) {
    pending = newPendingOpenAiToolCall(rawCall, rawCall.index);
    state.toolCalls.set(rawCall.index, pending);
  }
  const fn = isRecord(rawCall.function) ? rawCall.function : null;
  if (fn && typeof fn.arguments === 'string') {
    pending.argsJson += fn.arguments;
  }
}

/** Reduces one chunk's `choices[0]` — `finish_reason`, text content, and tool-call deltas — into `state`. Returns `'break'` when the text-delta guard detects contamination. */
export function handleOpenAiChoiceDelta(state: OpenAiStreamState, choice: Record<string, unknown>, onEvent: (event: OpenAiTurnEvent) => void): 'continue' | 'break' {
  if (typeof choice.finish_reason === 'string') {
    state.finishReason = choice.finish_reason;
  }
  const delta = isRecord(choice.delta) ? choice.delta : null;
  if (!delta) return 'continue';

  if (typeof delta.content === 'string' && delta.content.length > 0) {
    if (handleOpenAiTextContentDelta(state, delta.content, onEvent) === 'break') return 'break';
  }
  if (Array.isArray(delta.tool_calls)) {
    for (const rawCall of delta.tool_calls) {
      accumulateOpenAiToolCallDelta(state, rawCall);
    }
  }
  return 'continue';
}

/** Parses one accumulated tool call's `argsJson`, falling back to `{}` for empty or malformed JSON — mirrors Anthropic's identical fallback for `input_json_delta` accumulation in `anthropic-messages.ts`. */
export function resolveOpenAiToolCalls(pending: ReadonlyMap<number, PendingToolCall>): OpenAiToolCall[] {
  return Array.from(pending.values()).map((call) => {
    let input: unknown = {};
    if (call.argsJson.trim()) {
      try {
        input = JSON.parse(call.argsJson);
      } catch {
        input = {};
      }
    }
    return { id: call.id, name: call.name, input };
  });
}

function emitPendingOpenAiToolUseEvents(toolCalls: readonly OpenAiToolCall[], onEvent: (event: OpenAiTurnEvent) => void): void {
  for (const call of toolCalls) {
    onEvent({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
  }
}

type OpenAiFetchOutcome =
  | { readonly type: 'body'; readonly body: AsyncIterable<Uint8Array | string> }
  | { readonly type: 'retry'; readonly retryInit: OpenAiCompatibleRequestInit }
  | { readonly type: 'ended' };

/**
 * Opens the streaming POST and validates the response, returning its readable body once every
 * pre-stream failure mode (network error, non-2xx status with no retry available, missing body)
 * has been ruled out. Calls `emitEnd('error')` and returns `{type: 'ended'}` itself on any of
 * those — the caller only has to branch on the outcome's `type`, keeping `hasEnded()` as the sole
 * gate for every exit path (see `runOpenAiCompatibleRequest`'s doc).
 */
async function requestOpenAiCompatibleStream(init: OpenAiCompatibleRequestInit): Promise<OpenAiFetchOutcome> {
  const { onEvent, emitEnd } = init;

  let response: { ok: boolean; status: number; body: AsyncIterable<Uint8Array | string> | null; text(): Promise<string> };
  try {
    response = await pinnedFetch(
      init.url,
      {
        method: 'POST',
        headers: init.headers,
        body: JSON.stringify(init.body),
        // The caller's SSRF check (`validateBaseUrlResolved`) only ever sees the
        // ORIGINAL url. Following a redirect would let a public, guard-passing
        // endpoint hand back a `302 -> http://169.254.169.254/...` and reach the
        // address the guard exists to refuse — with the provider auth headers
        // still attached. `model-catalog.ts`'s own fetch already refuses
        // redirects for the same reason; a redirecting chat-completions endpoint
        // is not a thing any supported provider does. `pinnedFetch` never
        // follows one regardless (see its doc); `redirect: 'error'` here is
        // self-documentation, not the mechanism.
        redirect: 'error',
        ...(init.signal ? { signal: init.signal } : {}),
      },
      init.pinnedAddress,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onEvent({ type: 'error', message: redactSecrets(message, init.redactSecretsList) });
    emitEnd('error');
    return { type: 'ended' };
  }

  if (!response.ok) {
    const rawText = await response.text();
    const retryBody = init.retryableBody?.(response.status, rawText);
    if (retryBody) {
      const { retryableBody: _retryableBody, ...retryInit } = init;
      return { type: 'retry', retryInit: { ...retryInit, body: retryBody } };
    }
    onEvent({
      type: 'error',
      message: redactSecrets(extractOpenAiErrorDetail(rawText), init.redactSecretsList),
      code: String(response.status),
    });
    emitEnd('error');
    return { type: 'ended' };
  }
  if (!response.body) {
    onEvent({ type: 'error', message: `${init.providerLabel} response had no body` });
    emitEnd('error');
    return { type: 'ended' };
  }

  return { type: 'body', body: response.body };
}

export type OpenAiFrameResult = 'continue' | 'done' | 'contaminated';

/**
 * Reduces one decoded SSE frame into `state`, reporting what the caller's loop should do next:
 * `'done'` on the `[DONE]` sentinel, `'contaminated'` once the role-marker guard trips on this
 * frame's text delta, otherwise `'continue'`. Pulling per-frame dispatch out of the loop body
 * turns what would be four sequential, nesting-penalized `if`s into a single function call plus
 * one outcome check — see `runOpenAiCompatibleRequest`'s loop below.
 */
export function processOpenAiStreamFrame(state: OpenAiStreamState, frame: DecodedSseEvent, onEvent: (event: OpenAiTurnEvent) => void): OpenAiFrameResult {
  if (frame.data === DONE_SENTINEL) return 'done';
  const data = parseOpenAiSseData(frame.data);
  if (!data) return 'continue'; // malformed/empty keep-alive frame, or a non-object payload

  applyOpenAiStreamUsage(state, data, onEvent);

  const choice = firstOpenAiChoice(data);
  if (!choice) return 'continue';

  return handleOpenAiChoiceDelta(state, choice, onEvent) === 'break' ? 'contaminated' : 'continue';
}

/**
 * Runs exactly one OpenAI-compatible (Chat Completions JSON wire format)
 * streaming HTTP request and reduces its SSE events into a single outcome.
 * Extracted so this SSE-reduction loop has exactly one implementation
 * shared by every OpenAI-compatible provider turn-runner in this package:
 * `runOpenAiToolTurn` itself (below), plus `azure-chat.ts#runAzureToolTurn`
 * and `ollama-chat.ts#runOllamaToolTurn` — both target byte-identical
 * chat-completions JSON, differing only in URL and auth. Callers own their
 * own base-URL SSRF validation (`validateBaseUrl`) and URL/header/body
 * construction *before* calling this function — it only knows how to run
 * *a* request against whatever URL/headers/body it is handed, and has no
 * opinion on any provider's defaults. Mirrors
 * `anthropic-messages.ts#runSingleAnthropicRequest`'s `emitEnd` contract —
 * see that function's doc.
 */
export async function runOpenAiCompatibleRequest(init: OpenAiCompatibleRequestInit): Promise<OpenAiCompatibleRequestOutcome> {
  const { onEvent, hasEnded } = init;

  const fetchOutcome = await requestOpenAiCompatibleStream(init);
  if (fetchOutcome.type === 'ended') {
    return { finishReason: null, toolCalls: [], text: '' };
  }
  if (fetchOutcome.type === 'retry') {
    return runOpenAiCompatibleRequest(fetchOutcome.retryInit);
  }

  onEvent({ type: 'status', label: 'requesting' });

  const state: OpenAiStreamState = {
    guard: createRoleMarkerGuard(init.guardMessageId),
    toolCalls: new Map(),
    fullText: '',
    finishReason: null,
    usage: null,
  };

  for await (const frame of decodeSseStream(fetchOutcome.body)) {
    // No `hasEnded()` re-check at the top of this loop: the only in-loop call to `emitEnd`
    // (contamination, below) is immediately followed by `break`, and every other call site is a
    // pre-loop early `return` — traced across all five call sites in this function and
    // `requestOpenAiCompatibleStream`, same proof as
    // `anthropic-messages.ts#runSingleAnthropicRequest`. `hasEnded()` is still consulted once,
    // after this loop, to decide whether pending tool_use events should still be emitted (a
    // contaminating delta can arrive on a *later* chunk than the one that set `finish_reason`).
    const result = processOpenAiStreamFrame(state, frame, onEvent);
    if (result === 'done') break;
    if (result === 'contaminated') {
      init.emitEnd('contaminated');
      break;
    }
  }

  const resolvedToolCalls = resolveOpenAiToolCalls(state.toolCalls);

  if (state.finishReason === 'tool_calls' && !hasEnded()) {
    emitPendingOpenAiToolUseEvents(resolvedToolCalls, onEvent);
  }

  return { finishReason: state.finishReason, toolCalls: resolvedToolCalls, text: state.fullText };
}

/** Validates `options.baseUrl`, then delegates to {@link runOpenAiCompatibleRequest} with OpenAI's own URL/header/body builders. Thin wrapper kept so `runOpenAiToolTurn`'s per-iteration call site stays unchanged by the extraction. */
async function runSingleOpenAiRequest(
  options: OpenAiTurnOptions,
  messages: readonly OpenAiMessageParam[],
  emitEnd: (reason: OpenAiTurnEndReason) => void,
  hasEnded: () => boolean,
): Promise<OpenAiCompatibleRequestOutcome> {
  // DNS-resolving, not merely textual: the synchronous check only inspects the literal hostname,
  // so `https://internal.example.com -> 10.0.0.5` passed it and this runner connected to private
  // infrastructure on behalf of whoever supplied `baseUrl`. Matches what the Azure, Google and
  // Ollama runners in this directory already did.
  const baseUrlCheck = await validateBaseUrlResolved(options.baseUrl ?? DEFAULT_OPENAI_BASE_URL, defaultDnsLookup);
  if (baseUrlCheck.error) {
    options.onEvent({ type: 'error', message: baseUrlCheck.error });
    emitEnd('error');
    return { finishReason: null, toolCalls: [], text: '' };
  }

  return runOpenAiCompatibleRequest({
    url: openAiRequestUrl(options.baseUrl),
    headers: openAiHeaders(options),
    body: openAiRequestBody(options, messages),
    ...(baseUrlCheck.pinnedAddress ? { pinnedAddress: baseUrlCheck.pinnedAddress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    redactSecretsList: [options.apiKey],
    guardMessageId: 'openai-turn',
    providerLabel: 'OpenAI',
    onEvent: options.onEvent,
    emitEnd,
    hasEnded,
  });
}

const OPENAI_ALLOWED_IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * OpenAI documents a 512 MB total-payload cap and a 1500-image-per-request cap for the Chat
 * Completions API (see module doc's "Image support" section) but no single-image byte limit. This
 * module still bounds one image's base64 length defensively, matching
 * `anthropic-messages.ts`'s posture — 20 MB is this module's own conservative choice (not an
 * OpenAI-documented per-image number), anchored to Gemini's documented 20 MB total-inline-request
 * budget (`google-messages.ts`) as the closest real, vendor-documented single-request inline-image
 * bound available across this package's providers. Approximated from the base64 *string* length,
 * not decoded byte count — see `anthropic-messages.ts#MAX_IMAGE_BASE64_CHARS`'s doc for why that's
 * the right thing to measure (O(1), no decode step, negligible rounding slack at this size).
 */
const MAX_IMAGE_DATA_URI_BASE64_CHARS = Math.ceil((20 * 1024 * 1024 * 4) / 3);

/** OpenAI's documented per-request image count cap (see module doc). Applied per tool-result content array as a conservative simplification — a real request can also carry images from earlier turns this module doesn't track. */
const MAX_IMAGES_PER_OPENAI_TOOL_RESULT = 1500;

const OPENAI_DATA_URI_PATTERN = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/su;

/**
 * Validates one content part against OpenAI's real format/size constraints. Returns the violation
 * reason, or `null` when the part is legal to send.
 *
 * A plain `https://` `image_url` (not a `data:` URI) is intentionally not size-checked: OpenAI's
 * servers fetch that URL, not this adapter, so there is no local payload to bound — same threat-
 * model split as `anthropic-messages.ts`'s URL-sourced skip (`connection-guard.ts`'s SSRF guard
 * protects this adapter's own outbound `baseUrl` request, a different thing; an `image_url` that
 * points at attacker-chosen infrastructure is a request OpenAI's own servers make, not this one).
 *
 * @complexity O(1) — reads `data.length`, never decodes or parses the base64 payload.
 */
export function invalidOpenAiContentPartReason(part: OpenAiContentPart): string | null {
  if (part.type === 'text') return null;
  const dataUriMatch = OPENAI_DATA_URI_PATTERN.exec(part.image_url.url);
  if (!dataUriMatch) return null;
  const [, mediaType, base64Data] = dataUriMatch;
  if (!mediaType || !OPENAI_ALLOWED_IMAGE_MEDIA_TYPES.has(mediaType.toLowerCase())) {
    return `unsupported image media type ${JSON.stringify(mediaType)} (OpenAI's Chat Completions API supports image/jpeg, image/png, image/webp, and non-animated image/gif)`;
  }
  if (base64Data && base64Data.length > MAX_IMAGE_DATA_URI_BASE64_CHARS) {
    return `image exceeds this adapter's 20 MB base64 size guard (${base64Data.length} base64 chars)`;
  }
  return null;
}

export interface SanitizedOpenAiToolResult {
  readonly content: string | readonly OpenAiContentPart[];
  readonly isError: boolean;
}

/**
 * Runtime guard applied to every `OpenAiToolExecutor` result before it is wired onto the outbound
 * request or reported via `onEvent`. `OpenAiToolResult` is host-owned (see `OpenAiToolExecutor`'s
 * "Host-owned tool execution" doc comment) — the TS content-part union only constrains a
 * well-behaved host at compile time, not a buggy one at runtime, e.g. a screenshot helper that
 * hands back an oversized PNG or a HEIC file mislabeled as `image/jpeg`. Rather than forwarding an
 * invalid part and letting OpenAI reject the *entire* turn with an opaque upstream 400, this
 * substitutes a plain-text `isError: true` result the model can see and react to — matching this
 * package's existing security-conscious posture (`connection-guard.ts`'s SSRF guard,
 * `role-marker-guard.ts`'s contamination guard, and `anthropic-messages.ts`'s identical guard).
 *
 * @complexity O(n) in the number of content parts; O(1) per part (see `invalidOpenAiContentPartReason`).
 */
export function sanitizeOpenAiToolResult(result: OpenAiToolResult): SanitizedOpenAiToolResult {
  if (typeof result.content === 'string') return { content: result.content, isError: false };
  if (result.content.length > MAX_IMAGES_PER_OPENAI_TOOL_RESULT) {
    return { content: `tool result rejected: exceeds the ${MAX_IMAGES_PER_OPENAI_TOOL_RESULT}-image-per-request guard (${result.content.length} parts)`, isError: true };
  }
  for (const part of result.content) {
    const reason = invalidOpenAiContentPartReason(part);
    if (reason) return { content: `tool result rejected: ${reason}`, isError: true };
  }
  return { content: result.content, isError: false };
}

export interface SplitOpenAiToolResultContent {
  readonly toolMessageContent: string | readonly OpenAiTextPart[];
  readonly imageParts: readonly OpenAiImageUrlPart[];
}

/**
 * Splits one (already-sanitized) tool result's content into what can legally sit on the wire
 * `role: 'tool'` message (text only — see module doc's "Tool messages cannot carry an image"
 * section) and the `image_url` parts that must instead travel on a follow-up `user` message.
 *
 * A string `content` is left untouched (`imageParts: []`) — this is the pre-existing, unchanged
 * path every current caller already exercises. For an array, text parts are kept in order for the
 * `tool` message; if there is no text at all (an image-only result), a single placeholder text part
 * is substituted so the `tool` message's content is never empty (OpenAI rejects empty content).
 *
 * @complexity O(n) in the number of content parts.
 */
export function splitOpenAiToolResultContent(content: string | readonly OpenAiContentPart[]): SplitOpenAiToolResultContent {
  if (typeof content === 'string') return { toolMessageContent: content, imageParts: [] };
  const textParts = content.filter((part): part is OpenAiTextPart => part.type === 'text');
  const imageParts = content.filter((part): part is OpenAiImageUrlPart => part.type === 'image_url');
  const toolMessageContent: readonly OpenAiTextPart[] =
    textParts.length > 0 ? textParts : [{ type: 'text', text: '(tool result included only non-text content; see the following message)' }];
  return { toolMessageContent, imageParts };
}

/**
 * Decides why the tool loop should stop after one request, or returns `null` when it should
 * instead proceed to execute the pending tool calls — mirrors
 * `anthropic-messages.ts#anthropicLoopExitReason`'s pure decision/effect split.
 */
export function openAiLoopExitReason(outcome: OpenAiCompatibleRequestOutcome, toolTurns: number, maxToolTurns: number): OpenAiTurnEndReason | null {
  if (outcome.finishReason !== 'tool_calls' || outcome.toolCalls.length === 0) return 'stop';
  if (toolTurns >= maxToolTurns) return 'max_tool_turns';
  return null;
}

export interface OpenAiToolExecutionOutcome {
  readonly toolResultMessages: OpenAiMessageParam[];
  readonly followUpParts: OpenAiContentPart[];
}

/**
 * Runs every pending tool call in order, sanitizing and splitting each result into its `tool`
 * message plus any labeled image parts for the batch's single follow-up `user` message — see
 * module doc's "Tool messages cannot carry an image" section for why the split exists and why the
 * follow-up is assembled once per batch rather than per call.
 */
export async function executeOpenAiToolCalls(
  executeTool: OpenAiToolExecutor,
  calls: readonly OpenAiToolCall[],
  onEvent: (event: OpenAiTurnEvent) => void,
): Promise<OpenAiToolExecutionOutcome> {
  const toolResultMessages: OpenAiMessageParam[] = [];
  const followUpParts: OpenAiContentPart[] = [];
  for (const call of calls) {
    const result = await executeTool(call);
    const sanitized = sanitizeOpenAiToolResult(result);
    onEvent({ type: 'tool_result', toolUseId: call.id, content: sanitized.content, isError: sanitized.isError });
    const split = splitOpenAiToolResultContent(sanitized.content);
    toolResultMessages.push({ role: 'tool', content: split.toolMessageContent, tool_call_id: call.id });
    if (split.imageParts.length > 0) {
      // Attribution label — without it, the model cannot tell this image apart from a human
      // having just pasted one into the conversation (see module doc). Named per-call so a batch
      // with multiple image-bearing tool calls stays disambiguated in one follow-up message.
      followUpParts.push({ type: 'text', text: `Image output from tool \`${call.name}\` (tool_call_id: ${call.id}):` });
      followUpParts.push(...split.imageParts);
    }
  }
  return { toolResultMessages, followUpParts };
}

/** Builds the assistant turn that records the model's pending tool calls in `messages` history — `content` falls back to `null` (never `''`) per the wire schema. */
export function buildOpenAiAssistantToolCallMessage(text: string, toolCalls: readonly OpenAiToolCallParam[]): OpenAiMessageParam {
  return { role: 'assistant', content: text || null, tool_calls: toolCalls };
}

/** Appends the batch's `tool` messages plus, when present, the single labeled-image follow-up message — see module doc's "Tool messages cannot carry an image" section for why the follow-up is at most one message per batch. */
export function buildOpenAiToolExchangeMessages(
  toolResultMessages: readonly OpenAiMessageParam[],
  followUpParts: readonly OpenAiContentPart[],
): OpenAiMessageParam[] {
  return [...toolResultMessages, ...(followUpParts.length > 0 ? [{ role: 'user' as const, content: followUpParts }] : [])];
}

/**
 * Runs a full OpenAI Chat Completions turn, including the tool-execution
 * loop when `options.executeTool` is supplied and the model requests a
 * function call. See `anthropic-messages.ts#runAnthropicToolTurn`'s doc for
 * the shared event-stream/`ended`-flag contract this mirrors exactly.
 */
export async function runOpenAiToolTurn(options: OpenAiTurnOptions): Promise<OpenAiTurnResult> {
  const maxToolTurns = options.maxToolTurns ?? DEFAULT_MAX_TOOL_TURNS;
  const executeTool = options.executeTool;

  const endGuard = createTurnEndGuard<OpenAiTurnEvent>(options.onEvent, (reason) => ({ type: 'end', reason }));
  const emitEnd = endGuard.emitEnd;

  let messages = options.messages.slice();
  let toolTurns = 0;
  let lastFinishReason: string | null = null;

  while (true) {
    const outcome = await runSingleOpenAiRequest(options, messages, emitEnd, endGuard.hasEnded);
    lastFinishReason = outcome.finishReason;
    if (endGuard.hasEnded()) break;

    const exitReason = openAiLoopExitReason(outcome, toolTurns, maxToolTurns);
    if (exitReason) {
      emitEnd(exitReason);
      break;
    }
    if (!executeTool) {
      emitEnd('stop');
      break;
    }
    toolTurns += 1;

    const assistantToolCalls: OpenAiToolCallParam[] = outcome.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.input) },
    }));
    const { toolResultMessages, followUpParts } = await executeOpenAiToolCalls(executeTool, outcome.toolCalls, options.onEvent);

    messages = [
      ...messages,
      buildOpenAiAssistantToolCallMessage(outcome.text, assistantToolCalls),
      ...buildOpenAiToolExchangeMessages(toolResultMessages, followUpParts),
    ];
  }

  return { finishReason: lastFinishReason, toolTurns };
}
