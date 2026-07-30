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

export interface OpenAiMessageParam {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  readonly tool_calls?: readonly OpenAiToolCallParam[];
  readonly tool_call_id?: string;
  readonly name?: string;
}

export interface OpenAiToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface OpenAiToolResult {
  readonly content: string;
}

/** Host-owned tool execution — same "the collaborator is always supplied" convention as `anthropic-messages.ts#AnthropicToolExecutor`. */
export type OpenAiToolExecutor = (call: OpenAiToolCall) => Promise<OpenAiToolResult>;

export type OpenAiTurnEndReason = TurnEndReason;

export type OpenAiTurnEvent =
  | { readonly type: 'status'; readonly label: string }
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: 'tool_result'; readonly toolUseId: string; readonly content: string; readonly isError: boolean }
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
    for (const call of outcome.toolCalls) {
      const result = await options.executeTool(call);
      options.onEvent({ type: 'tool_result', toolUseId: call.id, content: result.content, isError: false });
      toolResultMessages.push({ role: 'tool', content: result.content, tool_call_id: call.id });
    }

    messages = [
      ...messages,
      { role: 'assistant', content: outcome.text || null, tool_calls: assistantToolCalls },
      ...toolResultMessages,
    ];
  }

  return { finishReason: lastFinishReason, toolTurns };
}
