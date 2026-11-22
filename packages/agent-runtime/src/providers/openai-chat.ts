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
import { defaultDnsLookup, validateBaseUrlResolved } from './connection-guard.js';
import { buildOpenAIChatTokenParam } from './token-params.js';
import { createTurnEndGuard } from './turn-end-guard.js';
import type { ProviderSchemaFallback, ProviderProtocol } from './provider-tool-policy.js';
import { trimCharsEnd } from '@jini-ai/core/text';
import { toolLoopVerdict } from './tool-loop-verdict.js';
import { omitKeys } from '../core/omit-keys.js';
import { type OpenAiTurnOptions, type OpenAiMessageParam, type StrictToolRetryState, type OpenAiTurnEndReason, type OpenAiCompatibleRequestOutcome, type OpenAiTurnResult, type OpenAiTurnEvent, type OpenAiToolCallParam } from './openai-chat-types.js';
import { runOpenAiCompatibleRequest } from './openai-chat-request.js';
import { executeOpenAiToolCalls, buildOpenAiAssistantToolCallMessage, buildOpenAiToolExchangeMessages } from './openai-chat-tool-results.js';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';
const DEFAULT_MAX_TOOL_TURNS = 8;
/** Matches OD's own default (`apps/daemon/src/routes/chat.ts`'s openai/azure handlers both fall back to this when the caller doesn't supply one) — a real, explicit bound is always sent, never an unbounded request. */
export const DEFAULT_OPENAI_MAX_TOKENS = 8192;

export function openAiRequestUrl({ baseUrl }: { baseUrl: string | undefined }, _optional: Record<string, never> = {}): string {
  const base = trimCharsEnd({ text: baseUrl ?? DEFAULT_OPENAI_BASE_URL, chars: '/' });
  return /\/v\d+(\/|$)/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/** The `OpenAiTurnOptions` keys every caller must pass. */
type OpenAiRequiredOption = "apiKey" | "model" | "messages" | "onEvent";

export function openAiHeaders(requiredArgs: Pick<OpenAiTurnOptions, OpenAiRequiredOption>, optionalArgs: Omit<OpenAiTurnOptions, OpenAiRequiredOption> = {}): Record<string, string> {
  const options: OpenAiTurnOptions = { ...optionalArgs, ...requiredArgs };
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${options.apiKey}`,
    ...(options.extraHeaders ?? {}),
  };
}

export function openAiRequestBody({ options, messages }: { options: OpenAiTurnOptions; messages: readonly OpenAiMessageParam[] }, _optional: Record<string, never> = {}): Record<string, unknown> {
  const effectiveMaxTokens = typeof options.maxTokens === 'number' && options.maxTokens > 0 ? options.maxTokens : DEFAULT_OPENAI_MAX_TOKENS;
  return {
    model: options.model,
    stream: true,
    stream_options: { include_usage: true },
    messages,
    ...buildOpenAIChatTokenParam({ model: options.model, maxTokens: effectiveMaxTokens }),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
  };
}

/** Wordings a provider uses to refuse a strict/schema feature; any one matching is enough. */
const STRICT_REJECTION_PATTERNS: readonly RegExp[] = [
  /unsupported|not support|unknown (?:field|parameter|name)|unrecognized|not (?:allowed|permitted)/i,
  /invalid (?:json )?schema|schema[^\n]*invalid|requires?[^\n]*beta/i,
  /invalid (?:enum )?value[^\n]*(?:VALIDATED|function[_ .]?calling[_ .]?config)/i,
];
/** Only explicit HTTP schema/capability rejections qualify, never auth, rate limits or transport failures.
 * @complexity O(e) time and O(e) space for at most 16 KiB of error text; no I/O.
 */
function isStrictToolRejection({ status, rawErrorText }: { status: number; rawErrorText: string }): boolean {
  if (status !== 400 && status !== 422) return false;
  const detail = rawErrorText.slice(0, 16384);
  const namesFeature = /\bstrict\b|\bVALIDATED\b|function[_ .]?calling[_ .]?config|(?:input[_ ]|json[_ ])?schema|structured.outputs/i.test(detail);
  const rejectsFeature = STRICT_REJECTION_PATTERNS.some((pattern) => pattern.test(detail));
  return namesFeature && rejectsFeature;
}

/**
 * Allow one recognized pre-generation downgrade for this turn. Diagnostic callbacks receive
 * names and a closed reason code, never the provider's error text or tool arguments.
 * @param input - Protocol and optional host diagnostic sink.
 * @returns Turn-local strict preference and a rejection decision; callback errors propagate.
 * @example const retry = createStrictToolRetry({ protocol: 'openai' });
 * @complexity O(e + t) per rejection for bounded error text e and t tool names; O(t) diagnostic space.
 */
export function createStrictToolRetry(
  { protocol, onSchemaFallback }: { protocol: ProviderProtocol; onSchemaFallback?: ((event: ProviderSchemaFallback) => void) | undefined },
  _options = {},
): StrictToolRetryState {
  let enabled = true;
  return {
    get enabled() { return enabled; },
    downgrade({ status, rawErrorText, toolNames }) {
      if (!enabled || toolNames.length === 0) return false;
      if (!isStrictToolRejection({ status, rawErrorText })) return false;
      enabled = false;
      for (const toolId of new Set(toolNames)) onSchemaFallback?.({ toolId, protocol, reason: 'endpoint-rejected' });
      return true;
    },
  };
}

/** Refresh OpenAI-compatible tools through the projection owner; legacy callers retain their schemas.
 * @param input - Existing adapter options and the turn's downgrade state.
 * @returns A request-local copy; projection callback failures propagate.
 * @example refreshOpenAiTools({ options, retry });
 * @complexity O(t) local time/space for t tools; projection cost belongs to getTools.
 */
export function refreshOpenAiTools<T extends OpenAiTurnOptions>(
  { options, retry }: { options: T; retry: StrictToolRetryState },
  _optional = {},
): T {
  let tools = options.getTools?.({ strict: retry.enabled }) ?? options.tools;
  if (!retry.enabled) tools = tools?.map(tool => {
    const definition = omitKeys({ source: tool.function, keys: ['strict'] });
    return { ...tool, function: definition };
  });
  return { ...options, ...(tools !== undefined ? { tools } : {}) };
}

/** Validates `options.baseUrl`, then delegates to {@link runOpenAiCompatibleRequest} with OpenAI's own URL/header/body builders. Thin wrapper kept so `runOpenAiToolTurn`'s per-iteration call site stays unchanged by the extraction. */
async function runSingleOpenAiRequest(
  options: OpenAiTurnOptions,
  messages: readonly OpenAiMessageParam[],
  emitEnd: (reason: OpenAiTurnEndReason) => void,
  hasEnded: () => boolean,
  retry: StrictToolRetryState,
): Promise<OpenAiCompatibleRequestOutcome> {
  // DNS-resolving, not merely textual: the synchronous check only inspects the literal hostname,
  // so `https://internal.example.com -> 10.0.0.5` passed it and this runner connected to private
  // infrastructure on behalf of whoever supplied `baseUrl`. Matches what the Azure, Google and
  // Ollama runners in this directory already did.
  const baseUrlCheck = await validateBaseUrlResolved({ baseUrl: options.baseUrl ?? DEFAULT_OPENAI_BASE_URL, lookup: options.dnsLookup ?? defaultDnsLookup });
  if (baseUrlCheck.error) {
    options.onEvent({ type: 'error', message: baseUrlCheck.error });
    emitEnd('error');
    return { finishReason: null, toolCalls: [], text: '' };
  }

  const requestOptions = refreshOpenAiTools({ options, retry });
  return (({ url, headers, body, redactSecretsList, guardMessageId, providerLabel, onEvent, emitEnd, hasEnded, ...optionalArgs }: Parameters<typeof runOpenAiCompatibleRequest>[0] & NonNullable<Parameters<typeof runOpenAiCompatibleRequest>[1]>) => runOpenAiCompatibleRequest({ url, headers, body, redactSecretsList, guardMessageId, providerLabel, onEvent, emitEnd, hasEnded }, optionalArgs))({
    url: openAiRequestUrl({ baseUrl: options.baseUrl }),
    headers: (({ apiKey, model, messages, onEvent, ...optionalArgs }: Parameters<typeof openAiHeaders>[0] & NonNullable<Parameters<typeof openAiHeaders>[1]>) => openAiHeaders({ apiKey, model, messages, onEvent }, optionalArgs))(options),
    body: openAiRequestBody({ options: requestOptions, messages: messages }),
    retryToolBody: ({ status, rawErrorText, body }) => {
      const toolNames = (requestOptions.tools ?? []).filter(tool => tool.function.strict).map(tool => tool.function.name);
      if (!retry.downgrade({ status, rawErrorText, toolNames })) return null;
      return { ...body, tools: refreshOpenAiTools({ options, retry }).tools };
    },
    ...(baseUrlCheck.pinnedAddress ? { pinnedAddress: baseUrlCheck.pinnedAddress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    redactSecretsList: [options.apiKey],
    guardMessageId: 'openai-turn',
    providerLabel: 'OpenAI',
    onEvent: options.onEvent,
    emitEnd,
    hasEnded,
  });
}

/**
 * Decides why the tool loop should stop after one request, or returns `null` when it should
 * instead proceed to execute the pending tool calls — mirrors
 * `anthropic-messages.ts#anthropicLoopExitReason`'s pure decision/effect split.
 */
export function openAiLoopExitReason({ outcome, toolTurns, maxToolTurns }: { outcome: OpenAiCompatibleRequestOutcome; toolTurns: number; maxToolTurns: number }, _optional: Record<string, never> = {}): OpenAiTurnEndReason | null {
  if (outcome.finishReason !== 'tool_calls' || outcome.toolCalls.length === 0) return 'stop';
  if (toolTurns >= maxToolTurns) return 'max_tool_turns';
  return null;
}

/**
 * Runs a full OpenAI Chat Completions turn, including the tool-execution
 * loop when `options.executeTool` is supplied and the model requests a
 * function call. See `anthropic-messages.ts#runAnthropicToolTurn`'s doc for
 * the shared event-stream/`ended`-flag contract this mirrors exactly.
 */
export async function runOpenAiToolTurn(requiredArgs: Pick<OpenAiTurnOptions, OpenAiRequiredOption>, optionalArgs: Omit<OpenAiTurnOptions, OpenAiRequiredOption> = {}): Promise<OpenAiTurnResult> {
  const options: OpenAiTurnOptions = { ...optionalArgs, ...requiredArgs };
  const retry = createStrictToolRetry({ protocol: 'openai', onSchemaFallback: options.onSchemaFallback });
  const maxToolTurns = options.maxToolTurns ?? DEFAULT_MAX_TOOL_TURNS;
  const executeTool = options.executeTool;

  const endGuard = createTurnEndGuard<OpenAiTurnEvent>({ onEvent: options.onEvent, makeEndEvent: (reason) => ({ type: 'end', reason }) });
  const emitEnd = endGuard.emitEnd;

  let messages = options.messages.slice();
  let toolTurns = 0;
  let lastFinishReason: string | null = null;

  while (true) {
    const outcome = await runSingleOpenAiRequest(options, messages, emitEnd, endGuard.hasEnded, retry);
    lastFinishReason = outcome.finishReason;
    const verdict = toolLoopVerdict({ ended: endGuard.hasEnded(), hasExecutor: Boolean(executeTool), exitReason: () => openAiLoopExitReason({ outcome: outcome, toolTurns: toolTurns, maxToolTurns: maxToolTurns }) });
    if (verdict.stop || !executeTool) {
      if (verdict.emit) emitEnd(verdict.emit);
      break;
    }
    toolTurns += 1;

    const assistantToolCalls: OpenAiToolCallParam[] = outcome.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.input) },
    }));
    const { toolResultMessages, followUpParts } = await executeOpenAiToolCalls({ executeTool: executeTool, calls: outcome.toolCalls, onEvent: options.onEvent });

    messages = [
      ...messages,
      buildOpenAiAssistantToolCallMessage({ text: outcome.text, toolCalls: assistantToolCalls }),
      ...buildOpenAiToolExchangeMessages({ toolResultMessages: toolResultMessages, followUpParts: followUpParts }),
    ];
  }

  return { finishReason: lastFinishReason, toolTurns };
}
