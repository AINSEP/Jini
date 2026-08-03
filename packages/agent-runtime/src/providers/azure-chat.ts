/**
 * @module providers/azure-chat
 *
 * Azure OpenAI Chat Completions wire adapter + tool-loop turn-runner.
 * Sibling of `anthropic-messages.ts`/`openai-chat.ts` — see those modules'
 * headers for the shared design rationale. Azure OpenAI's chat-completions
 * JSON request/response body is byte-identical to plain OpenAI's (same
 * `messages`/`tools`/streaming-delta shape) — only the URL and the auth
 * header differ — so this module reuses `openai-chat.ts`'s extracted
 * `runOpenAiCompatibleRequest` SSE-reduction loop rather than duplicating
 * it; see that function's doc for why it was pulled out.
 *
 * **URL**: `{baseUrl}/openai/deployments/{model}/chat/completions
 * ?api-version={apiVersion}` — `model` here is the Azure *deployment name*,
 * not a model id (Azure OpenAI resources map a deployment name to a
 * specific model version at resource-creation time). `apiVersion` defaults
 * to `'2024-10-21'`, the default this repo's real OD predecessor used for
 * its own azure chat-completions proxy route (`apps/daemon/src/routes/
 * chat.ts`'s `[proxy:azure]` handler, confirmed by reading that file
 * directly in a sibling checkout — see `source-map.md`'s dated entry).
 * That source additionally branches on whether `baseUrl` already contains
 * a versioned `/openai/v1` path (a newer Azure OpenAI API preview); that
 * branch is deliberately not carried forward here — this adapter targets
 * the one documented, stable URL/body shape per this task's approved scope
 * ("byte-identical to OpenAI, only URL/auth differ"). Its 400-retry
 * behavior IS carried forward (see "Token-limit fix" below) — round-4
 * external audit (`AUD-R4-001`) found the first port had dropped it,
 * which fails every request against a GPT-5/o-series Azure deployment.
 *
 * **Auth**: `api-key: {apiKey}` header — NOT `Authorization: Bearer`,
 * Azure OpenAI's own convention (also confirmed against the same OD
 * source above).
 *
 * **No default `baseUrl`**: every Azure OpenAI resource has its own
 * endpoint (`https://{resource}.openai.azure.com`), so unlike Anthropic/
 * OpenAI/Google/Ollama, `baseUrl` is a required field on
 * {@link AzureTurnOptions}, and `apiVersion` is validated as
 * non-empty-if-supplied by the caller (`@jini-ai/http-kit`'s
 * `parseAzureProxyRequest` — see that module).
 *
 * **Token-limit fix**: an earlier version of this module sent no token-limit
 * field at all — a live comparison against a running Open Design daemon
 * found OD's real `azure` proxy handler always sends `max_tokens` (defaulting
 * to 8192), unconditionally the legacy field name — never the newer
 * `max_completion_tokens` `openai-chat.ts` picks for GPT-5/o-series models,
 * since Azure deployment names are caller-defined strings, not necessarily
 * matching OpenAI's own model-naming scheme. Wired via
 * `./token-params.js#buildLegacyMaxTokensParam`. Because deployment names
 * are opaque, a legacy-field request can still be rejected by a
 * GPT-5/o-series deployment with a 400 — OD's real handler retries exactly
 * once with `max_completion_tokens` on that specific error
 * (`isUnsupportedMaxTokensError`); this module does the same via
 * `runOpenAiCompatibleRequest`'s `retryableBody` hook.
 *
 * **Image support inherits from plain OpenAI, confirmed by doc AND by code.** Microsoft's own
 * vision how-to (`learn.microsoft.com/azure/ai-foundry/openai/how-to/gpt-with-vision`) states
 * verbatim: "The format is the same as the chat completions API for GPT-4o, except that the
 * message content can be an array containing text and images" — identical `type:'text'`/
 * `type:'image_url'` shape and `detail` values as `openai-chat.ts`. That inheritance is genuine at
 * the code level too, not just assumed from the docs matching: `azureRequestBody` below spreads
 * `messages` straight into the JSON body with no per-field transform, so once `AzureMessageParam`
 * (this module's own copy of `OpenAiMessageParam`, per this file's existing full-duplication
 * convention — see every other type in this file) is widened the same way as OpenAI's, an image
 * survives untouched all the way to the wire. `azure-chat.test.ts`'s new image tests assert the
 * request body directly to prove this, rather than trusting the doc claim alone.
 *
 * **The synthetic follow-up message and its ordering/attribution rules are also inherited
 * unchanged from `openai-chat.ts`** — same workaround for the same text-only `tool` message
 * constraint, same requirement that every `tool` message in a batch be emitted before the single
 * follow-up (never interleaved — a real 400 otherwise), same per-image attribution label naming
 * the tool call it answers. See that module's doc for the full rationale; it is not repeated here
 * beyond this pointer to avoid the two copies drifting.
 */
import { defaultDnsLookup, validateBaseUrlResolved } from './connection-guard.js';
import { runOpenAiCompatibleRequest, type OpenAiCompatibleRequestOutcome } from './openai-chat.js';
import { buildLegacyMaxTokensParam, buildMaxCompletionTokensParam, isUnsupportedMaxTokensError } from './token-params.js';
import { createTurnEndGuard, type TurnEndReason } from './turn-end-guard.js';

export interface AzureFunctionToolDef {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface AzureToolCallParam {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

export interface AzureTextPart {
  readonly type: 'text';
  readonly text: string;
}

/** `detail` defaults to `'auto'` server-side when omitted — never sent unless the caller supplies it. Same shape as `openai-chat.ts#OpenAiImageUrlPart`; see module doc's "Image support inherits from plain OpenAI" note. */
export interface AzureImageUrlPart {
  readonly type: 'image_url';
  readonly image_url: {
    readonly url: string;
    readonly detail?: 'auto' | 'low' | 'high';
  };
}

/** A user/system/assistant message's `content` array item. Not legal inside a `role: 'tool'` message — same constraint as OpenAI's (see `openai-chat.ts` module doc's "Tool messages cannot carry an image" section, which applies here identically). */
export type AzureContentPart = AzureTextPart | AzureImageUrlPart;

export interface AzureMessageParam {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null | readonly AzureContentPart[];
  readonly tool_calls?: readonly AzureToolCallParam[];
  readonly tool_call_id?: string;
  readonly name?: string;
}

export interface AzureToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/** `content` may include `AzureImageUrlPart`s (e.g. a vision self-check's screenshot) even though the wire `tool` message can't carry them directly — `runAzureToolTurn` splits them onto a follow-up `user` message; see `openai-chat.ts`'s identical design. */
export interface AzureToolResult {
  readonly content: string | readonly AzureContentPart[];
}

/** Host-owned tool execution — same "the collaborator is always supplied" convention as `anthropic-messages.ts#AnthropicToolExecutor`. */
export type AzureToolExecutor = (call: AzureToolCall) => Promise<AzureToolResult>;

export type AzureTurnEndReason = TurnEndReason;

export type AzureTurnEvent =
  | { readonly type: 'status'; readonly label: string }
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: 'tool_result'; readonly toolUseId: string; readonly content: string | readonly AzureContentPart[]; readonly isError: boolean }
  | { readonly type: 'usage'; readonly usage: Record<string, unknown> | null }
  | { readonly type: 'fabricated_role_marker'; readonly marker: string; readonly messageId: string }
  | { readonly type: 'error'; readonly message: string; readonly code?: string }
  | { readonly type: 'end'; readonly reason: AzureTurnEndReason };

export interface AzureTurnOptions {
  readonly apiKey: string;
  /** Required — every Azure OpenAI resource has its own endpoint, so there is no sane global default (see module doc). */
  readonly baseUrl: string;
  /** The Azure OpenAI *deployment name* (not a raw model id). */
  readonly model: string;
  /** Defaults to `'2024-10-21'` — see module doc for provenance. */
  readonly apiVersion?: string;
  readonly messages: readonly AzureMessageParam[];
  readonly tools?: readonly AzureFunctionToolDef[];
  readonly temperature?: number;
  /** Defaults to 8192 when omitted or not a positive number — a token limit is always sent, matching OD's real `azure` proxy handler (see module doc). */
  readonly maxTokens?: number;
  /** Same bound and rationale as `AnthropicTurnOptions.maxToolTurns`. Defaults to 8. */
  readonly maxToolTurns?: number;
  readonly executeTool?: AzureToolExecutor;
  readonly onEvent: (event: AzureTurnEvent) => void;
  readonly signal?: AbortSignal;
  /** Caller-supplied extra headers — see `anthropic-messages.ts#AnthropicTurnOptions.extraHeaders`'s doc for why this exists and what it fixes. */
  readonly extraHeaders?: Record<string, string>;
}

export interface AzureTurnResult {
  readonly finishReason: string | null;
  readonly toolTurns: number;
}

const DEFAULT_AZURE_API_VERSION = '2024-10-21';
const DEFAULT_MAX_TOOL_TURNS = 8;
/** Matches OD's real azure handler's default when `maxTokens` isn't supplied — see module doc. */
const DEFAULT_AZURE_MAX_TOKENS = 8192;

function azureRequestUrl(baseUrl: string, model: string, apiVersion: string | undefined): string {
  const base = baseUrl.replace(/\/+$/, '');
  const version = apiVersion && apiVersion.trim() ? apiVersion.trim() : DEFAULT_AZURE_API_VERSION;
  return `${base}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${encodeURIComponent(version)}`;
}

function azureHeaders(options: AzureTurnOptions): Record<string, string> {
  return {
    'content-type': 'application/json',
    'api-key': options.apiKey,
    ...(options.extraHeaders ?? {}),
  };
}

function effectiveAzureMaxTokens(options: AzureTurnOptions): number {
  return typeof options.maxTokens === 'number' && options.maxTokens > 0 ? options.maxTokens : DEFAULT_AZURE_MAX_TOKENS;
}

/** `tokenParam` is injected so the 400-retry path (see module doc) can rebuild an otherwise-identical body with `max_completion_tokens` instead of `max_tokens`. */
function azureRequestBody(
  options: AzureTurnOptions,
  messages: readonly AzureMessageParam[],
  tokenParam: Record<string, unknown>,
): Record<string, unknown> {
  return {
    stream: true,
    stream_options: { include_usage: true },
    messages,
    ...tokenParam,
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
  };
}

/** Validates `options.baseUrl`, then delegates to `openai-chat.ts#runOpenAiCompatibleRequest` with Azure's own URL/header/body builders. */
async function runSingleAzureRequest(
  options: AzureTurnOptions,
  messages: readonly AzureMessageParam[],
  emitEnd: (reason: AzureTurnEndReason) => void,
  hasEnded: () => boolean,
): Promise<OpenAiCompatibleRequestOutcome> {
  const baseUrlCheck = await validateBaseUrlResolved(options.baseUrl, defaultDnsLookup);
  if (baseUrlCheck.error) {
    options.onEvent({ type: 'error', message: baseUrlCheck.error });
    emitEnd('error');
    return { finishReason: null, toolCalls: [], text: '' };
  }

  const maxTokens = effectiveAzureMaxTokens(options);

  return runOpenAiCompatibleRequest({
    url: azureRequestUrl(options.baseUrl, options.model, options.apiVersion),
    headers: azureHeaders(options),
    body: azureRequestBody(options, messages, buildLegacyMaxTokensParam(maxTokens)),
    retryableBody: (status, rawErrorText) =>
      status === 400 && isUnsupportedMaxTokensError(rawErrorText)
        ? azureRequestBody(options, messages, buildMaxCompletionTokensParam(maxTokens))
        : null,
    ...(options.signal ? { signal: options.signal } : {}),
    redactSecretsList: [options.apiKey],
    guardMessageId: 'azure-turn',
    providerLabel: 'Azure OpenAI',
    onEvent: options.onEvent,
    emitEnd,
    hasEnded,
  });
}

const AZURE_ALLOWED_IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Same 20 MB conservative single-image guard as `openai-chat.ts#MAX_IMAGE_DATA_URI_BASE64_CHARS` — see that constant's doc for the full rationale (Azure inherits OpenAI's image support, so it inherits this module's own defensive posture around it too). */
const MAX_IMAGE_DATA_URI_BASE64_CHARS = Math.ceil((20 * 1024 * 1024 * 4) / 3);

/** Same conservative per-tool-result image-count guard as `openai-chat.ts#MAX_IMAGES_PER_OPENAI_TOOL_RESULT`. */
const MAX_IMAGES_PER_AZURE_TOOL_RESULT = 1500;

const AZURE_DATA_URI_PATTERN = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/su;

/** Azure counterpart of `openai-chat.ts#invalidOpenAiContentPartReason` — same validation, same URL-sourced-image skip rationale (Azure's own servers fetch a plain `https://` `image_url`, not this adapter). @complexity O(1). */
function invalidAzureContentPartReason(part: AzureContentPart): string | null {
  if (part.type === 'text') return null;
  const dataUriMatch = AZURE_DATA_URI_PATTERN.exec(part.image_url.url);
  if (!dataUriMatch) return null;
  const [, mediaType, base64Data] = dataUriMatch;
  if (!mediaType || !AZURE_ALLOWED_IMAGE_MEDIA_TYPES.has(mediaType.toLowerCase())) {
    return `unsupported image media type ${JSON.stringify(mediaType)} (Azure OpenAI's chat completions API supports image/jpeg, image/png, image/webp, and non-animated image/gif — same as plain OpenAI)`;
  }
  if (base64Data && base64Data.length > MAX_IMAGE_DATA_URI_BASE64_CHARS) {
    return `image exceeds this adapter's 20 MB base64 size guard (${base64Data.length} base64 chars)`;
  }
  return null;
}

interface SanitizedAzureToolResult {
  readonly content: string | readonly AzureContentPart[];
  readonly isError: boolean;
}

/** Azure counterpart of `openai-chat.ts#sanitizeOpenAiToolResult` — same runtime guard, same rationale (an `AzureToolResult` is host-owned; the TS union only constrains a well-behaved host at compile time). @complexity O(n) in content parts. */
function sanitizeAzureToolResult(result: AzureToolResult): SanitizedAzureToolResult {
  if (typeof result.content === 'string') return { content: result.content, isError: false };
  if (result.content.length > MAX_IMAGES_PER_AZURE_TOOL_RESULT) {
    return { content: `tool result rejected: exceeds the ${MAX_IMAGES_PER_AZURE_TOOL_RESULT}-image-per-request guard (${result.content.length} parts)`, isError: true };
  }
  for (const part of result.content) {
    const reason = invalidAzureContentPartReason(part);
    if (reason) return { content: `tool result rejected: ${reason}`, isError: true };
  }
  return { content: result.content, isError: false };
}

interface SplitAzureToolResultContent {
  readonly toolMessageContent: string | readonly AzureTextPart[];
  readonly imageParts: readonly AzureImageUrlPart[];
}

/** Azure counterpart of `openai-chat.ts#splitOpenAiToolResultContent` — same text/image split, same placeholder-when-image-only rule, same reason (a `role: 'tool'` message on Azure is the identical wire shape as plain OpenAI's, so it has the identical text-only constraint). @complexity O(n) in content parts. */
function splitAzureToolResultContent(content: string | readonly AzureContentPart[]): SplitAzureToolResultContent {
  if (typeof content === 'string') return { toolMessageContent: content, imageParts: [] };
  const textParts = content.filter((part): part is AzureTextPart => part.type === 'text');
  const imageParts = content.filter((part): part is AzureImageUrlPart => part.type === 'image_url');
  const toolMessageContent: readonly AzureTextPart[] =
    textParts.length > 0 ? textParts : [{ type: 'text', text: '(tool result included only non-text content; see the following message)' }];
  return { toolMessageContent, imageParts };
}

/**
 * Runs a full Azure OpenAI Chat Completions turn, including the
 * tool-execution loop when `options.executeTool` is supplied and the model
 * requests a function call. See `anthropic-messages.ts#runAnthropicToolTurn`'s
 * doc for the shared event-stream/`ended`-flag contract this mirrors exactly.
 */
export async function runAzureToolTurn(options: AzureTurnOptions): Promise<AzureTurnResult> {
  const maxToolTurns = options.maxToolTurns ?? DEFAULT_MAX_TOOL_TURNS;

  const endGuard = createTurnEndGuard<AzureTurnEvent>(options.onEvent, (reason) => ({ type: 'end', reason }));
  const emitEnd = endGuard.emitEnd;

  let messages = options.messages.slice();
  let toolTurns = 0;
  let lastFinishReason: string | null = null;

  while (true) {
    const outcome = await runSingleAzureRequest(options, messages, emitEnd, endGuard.hasEnded);
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

    const assistantToolCalls: AzureToolCallParam[] = outcome.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.input) },
    }));
    const toolResultMessages: AzureMessageParam[] = [];
    // Same batching discipline as `openai-chat.ts`: every `tool` message for this batch goes here
    // first; the follow-up is assembled but only ever appended once, after the loop.
    const followUpParts: AzureContentPart[] = [];
    for (const call of outcome.toolCalls) {
      const result = await options.executeTool(call);
      const sanitized = sanitizeAzureToolResult(result);
      options.onEvent({ type: 'tool_result', toolUseId: call.id, content: sanitized.content, isError: sanitized.isError });
      const split = splitAzureToolResultContent(sanitized.content);
      toolResultMessages.push({ role: 'tool', content: split.toolMessageContent, tool_call_id: call.id });
      if (split.imageParts.length > 0) {
        // Attribution label — see `openai-chat.ts`'s identical note for why this matters.
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
