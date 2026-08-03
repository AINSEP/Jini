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
import { defaultDnsLookup, redactSecrets, validateBaseUrlResolved } from './connection-guard.js';
import { decodeSseStream } from './sse-decode.js';
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

function openAiRequestUrl(baseUrl: string | undefined): string {
  const base = (baseUrl ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
  return /\/v\d+(\/|$)/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

function openAiHeaders(options: OpenAiTurnOptions): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${options.apiKey}`,
    ...(options.extraHeaders ?? {}),
  };
}

function openAiRequestBody(options: OpenAiTurnOptions, messages: readonly OpenAiMessageParam[]): Record<string, unknown> {
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

function extractOpenAiErrorDetail(rawText: string): string {
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

interface PendingToolCall {
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

/**
 * Runs exactly one OpenAI-compatible (Chat Completions JSON wire format)
 * streaming HTTP request and reduces its SSE events into a single outcome.
 * Extracted so this ~150-line SSE-reduction loop has exactly one
 * implementation shared by every OpenAI-compatible provider turn-runner in
 * this package: `runOpenAiToolTurn` itself (below), plus
 * `azure-chat.ts#runAzureToolTurn` and `ollama-chat.ts#runOllamaToolTurn` —
 * both target byte-identical chat-completions JSON, differing only in URL
 * and auth. Callers own their own base-URL SSRF validation
 * (`validateBaseUrl`) and URL/header/body construction *before* calling
 * this function — it only knows how to run *a* request against whatever
 * URL/headers/body it is handed, and has no opinion on any provider's
 * defaults. Mirrors `anthropic-messages.ts#runSingleAnthropicRequest`'s
 * `emitEnd` contract — see that function's doc.
 */
export async function runOpenAiCompatibleRequest(init: OpenAiCompatibleRequestInit): Promise<OpenAiCompatibleRequestOutcome> {
  const { onEvent, emitEnd, hasEnded } = init;

  let response: { ok: boolean; status: number; body: AsyncIterable<Uint8Array | string> | null; text(): Promise<string> };
  try {
    response = (await fetch(init.url, {
      method: 'POST',
      headers: init.headers,
      body: JSON.stringify(init.body),
      ...(init.signal ? { signal: init.signal } : {}),
    })) as unknown as typeof response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onEvent({ type: 'error', message: redactSecrets(message, init.redactSecretsList) });
    emitEnd('error');
    return { finishReason: null, toolCalls: [], text: '' };
  }

  if (!response.ok) {
    const rawText = await response.text();
    if (init.retryableBody) {
      const retryBody = init.retryableBody(response.status, rawText);
      if (retryBody) {
        const { retryableBody: _retryableBody, ...retryInit } = init;
        return runOpenAiCompatibleRequest({ ...retryInit, body: retryBody });
      }
    }
    onEvent({
      type: 'error',
      message: redactSecrets(extractOpenAiErrorDetail(rawText), init.redactSecretsList),
      code: String(response.status),
    });
    emitEnd('error');
    return { finishReason: null, toolCalls: [], text: '' };
  }
  if (!response.body) {
    onEvent({ type: 'error', message: `${init.providerLabel} response had no body` });
    emitEnd('error');
    return { finishReason: null, toolCalls: [], text: '' };
  }

  onEvent({ type: 'status', label: 'requesting' });

  const guard = createRoleMarkerGuard(init.guardMessageId);
  const toolCalls = new Map<number, PendingToolCall>();
  let fullText = '';
  let finishReason: string | null = null;
  let usage: Record<string, unknown> | null = null;

  for await (const frame of decodeSseStream(response.body)) {
    // No `hasEnded()` re-check at the top of this loop: the only in-loop call to `emitEnd`
    // (contamination, below) is immediately followed by `break`, and every other call site is a
    // pre-loop early `return` — traced across all five call sites in this function, same proof as
    // `anthropic-messages.ts#runSingleAnthropicRequest`. `hasEnded()` is still consulted once,
    // after this loop, to decide whether pending tool_use events should still be emitted (a
    // contaminating delta can arrive on a *later* chunk than the one that set `finish_reason`).
    if (frame.data === DONE_SENTINEL) break;

    let data: unknown;
    try {
      data = JSON.parse(frame.data);
    } catch {
      continue; // tolerate a malformed/empty keep-alive frame
    }
    if (!isRecord(data)) continue;

    if (isRecord(data.usage)) {
      usage = data.usage;
      onEvent({ type: 'usage', usage });
    }

    const choices = Array.isArray(data.choices) ? data.choices : [];
    const choice = choices[0];
    if (!isRecord(choice)) continue;

    if (typeof choice.finish_reason === 'string') {
      finishReason = choice.finish_reason;
    }

    const delta = isRecord(choice.delta) ? choice.delta : null;
    if (!delta) continue;

    if (typeof delta.content === 'string' && delta.content.length > 0) {
      // No `guard.contaminated` pre-check here: the only way it becomes true is the
      // `emitEnd('contaminated'); break;` a few lines below, which exits this loop immediately —
      // see `anthropic-messages.ts#runSingleAnthropicRequest`'s identical reachability proof.
      const safe = guard.feedText(delta.content);
      if (safe.length > 0) {
        fullText += safe;
        onEvent({ type: 'text_delta', delta: safe });
      }
      if (guard.contaminated) {
        const warn = guard.warningEvent();
        if (warn) onEvent(warn);
        emitEnd('contaminated');
        break;
      }
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const rawCall of delta.tool_calls) {
        if (!isRecord(rawCall) || typeof rawCall.index !== 'number') continue;
        let pending = toolCalls.get(rawCall.index);
        if (!pending) {
          const id = typeof rawCall.id === 'string' ? rawCall.id : `call_${rawCall.index}`;
          const fn = isRecord(rawCall.function) ? rawCall.function : {};
          const name = typeof fn.name === 'string' ? fn.name : '';
          pending = { id, name, argsJson: '' };
          toolCalls.set(rawCall.index, pending);
        }
        const fn = isRecord(rawCall.function) ? rawCall.function : null;
        if (fn && typeof fn.arguments === 'string') {
          pending.argsJson += fn.arguments;
        }
      }
    }
  }

  const resolvedToolCalls: OpenAiToolCall[] = Array.from(toolCalls.values()).map((call) => {
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

  if (finishReason === 'tool_calls' && !hasEnded()) {
    for (const call of resolvedToolCalls) {
      onEvent({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
    }
  }

  return { finishReason, toolCalls: resolvedToolCalls, text: fullText };
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
function invalidOpenAiContentPartReason(part: OpenAiContentPart): string | null {
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

interface SanitizedOpenAiToolResult {
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
function sanitizeOpenAiToolResult(result: OpenAiToolResult): SanitizedOpenAiToolResult {
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

interface SplitOpenAiToolResultContent {
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
function splitOpenAiToolResultContent(content: string | readonly OpenAiContentPart[]): SplitOpenAiToolResultContent {
  if (typeof content === 'string') return { toolMessageContent: content, imageParts: [] };
  const textParts = content.filter((part): part is OpenAiTextPart => part.type === 'text');
  const imageParts = content.filter((part): part is OpenAiImageUrlPart => part.type === 'image_url');
  const toolMessageContent: readonly OpenAiTextPart[] =
    textParts.length > 0 ? textParts : [{ type: 'text', text: '(tool result included only non-text content; see the following message)' }];
  return { toolMessageContent, imageParts };
}

/**
 * Runs a full OpenAI Chat Completions turn, including the tool-execution
 * loop when `options.executeTool` is supplied and the model requests a
 * function call. See `anthropic-messages.ts#runAnthropicToolTurn`'s doc for
 * the shared event-stream/`ended`-flag contract this mirrors exactly.
 */
export async function runOpenAiToolTurn(options: OpenAiTurnOptions): Promise<OpenAiTurnResult> {
  const maxToolTurns = options.maxToolTurns ?? DEFAULT_MAX_TOOL_TURNS;

  const endGuard = createTurnEndGuard<OpenAiTurnEvent>(options.onEvent, (reason) => ({ type: 'end', reason }));
  const emitEnd = endGuard.emitEnd;

  let messages = options.messages.slice();
  let toolTurns = 0;
  let lastFinishReason: string | null = null;

  while (true) {
    const outcome = await runSingleOpenAiRequest(options, messages, emitEnd, endGuard.hasEnded);
    lastFinishReason = outcome.finishReason;

    if (endGuard.hasEnded()) break;

    if (outcome.finishReason !== 'tool_calls' || outcome.toolCalls.length === 0) {
      emitEnd('stop');
      break;
    }
    if (!options.executeTool) {
      emitEnd('stop');
      break;
    }
    if (toolTurns >= maxToolTurns) {
      emitEnd('max_tool_turns');
      break;
    }
    toolTurns += 1;

    const assistantToolCalls: OpenAiToolCallParam[] = outcome.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.input) },
    }));
    const toolResultMessages: OpenAiMessageParam[] = [];
    // Every `tool` message for this batch is pushed here first; the labeled image parts below are
    // only ever assembled into a SINGLE follow-up message appended after the loop — never per-call
    // — because OpenAI rejects a request where a non-tool message sits between two `tool` messages
    // answering the same assistant turn. See module doc's "Tool messages cannot carry an image"
    // section, and this file's `__tests__` for the multi-tool-call proof.
    const followUpParts: OpenAiContentPart[] = [];
    for (const call of outcome.toolCalls) {
      const result = await options.executeTool(call);
      const sanitized = sanitizeOpenAiToolResult(result);
      options.onEvent({ type: 'tool_result', toolUseId: call.id, content: sanitized.content, isError: sanitized.isError });
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

    messages = [
      ...messages,
      { role: 'assistant', content: outcome.text || null, tool_calls: assistantToolCalls },
      ...toolResultMessages,
      ...(followUpParts.length > 0 ? [{ role: 'user' as const, content: followUpParts }] : []),
    ];
  }

  return { finishReason: lastFinishReason, toolTurns };
}
