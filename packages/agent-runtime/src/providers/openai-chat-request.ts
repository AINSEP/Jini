import { redactSecrets } from '@jini-ai/core';
import { createRoleMarkerGuard } from '../role-marker-guard.js';
import { extractProviderErrorDetail } from './response-text.js';
import { pinnedFetch } from './connection-guard.js';
import { decodeSseStream, type DecodedSseEvent } from './sse-decode.js';
import { omitKeys } from '../core/omit-keys.js';
import { type OpenAiCompatibleRequestInit, type OpenAiStreamState, type OpenAiTurnEvent, type OpenAiCompatibleRequestOutcome } from './openai-chat-types.js';
import { parseOpenAiSseData, applyOpenAiStreamUsage, firstOpenAiChoice, handleOpenAiChoiceDelta, resolveOpenAiToolCalls, emitPendingOpenAiToolUseEvents } from './openai-chat-stream.js';
const DONE_SENTINEL = '[DONE]';

export const extractOpenAiErrorDetail = extractProviderErrorDetail;

type OpenAiFetchOutcome =
  | { readonly type: 'body'; readonly body: AsyncIterable<Uint8Array | string> }
  | { readonly type: 'retry'; readonly retryInit: OpenAiCompatibleRequestInit }
  | { readonly type: 'ended' };

/** Tool-schema retry has precedence; consume only the hook that selected a replacement body. */
function resolveOpenAiRetry(
  { init, status, rawText }: { init: OpenAiCompatibleRequestInit; status: number; rawText: string },
  _options = {},
): OpenAiFetchOutcome | null {
  const toolRetryBody = init.retryToolBody?.({ status, rawErrorText: rawText, body: init.body });
  if (toolRetryBody) {
    const retryInit = omitKeys({ source: init, keys: ['retryToolBody'] });
    return { type: 'retry', retryInit: { ...retryInit, body: toolRetryBody } };
  }
  const retryBody = init.retryableBody?.(status, rawText);
  if (retryBody) {
    const retryInit = omitKeys({ source: init, keys: ['retryableBody'] });
    return { type: 'retry', retryInit: { ...retryInit, body: retryBody } };
  }
  return null;
}

/**
 * Opens the streaming POST and validates the response, returning its readable body once every
 * pre-stream failure mode (network error, non-2xx status with no retry available, missing body)
 * has been ruled out. Calls `emitEnd('error')` and returns `{type: 'ended'}` itself on any of
 * those — the caller only has to branch on the outcome's `type`, keeping `hasEnded()` as the sole
 * gate for every exit path (see `runOpenAiCompatibleRequest`'s doc).
 */
async function requestOpenAiCompatibleStream(
  { init }: { init: OpenAiCompatibleRequestInit },
  _options = {},
): Promise<OpenAiFetchOutcome> {
  const { onEvent, emitEnd } = init;

  let response: { ok: boolean; status: number; body: AsyncIterable<Uint8Array | string> | null; text(): Promise<string> };
  try {
    response = await (init.fetchImpl ?? pinnedFetch)({ url: init.url, init: {
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
      }, pinnedAddress: init.pinnedAddress }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onEvent({ type: 'error', message: redactSecrets({ input: message }, { exactSecrets: init.redactSecretsList }) });
    emitEnd('error');
    return { type: 'ended' };
  }

  if (!response.ok) {
    const rawText = await response.text();
    const retryOutcome = resolveOpenAiRetry({ init, status: response.status, rawText });
    if (retryOutcome) return retryOutcome;
    onEvent({
      type: 'error',
      message: redactSecrets({ input: extractOpenAiErrorDetail({ rawText: rawText }) }, { exactSecrets: init.redactSecretsList }),
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
export function processOpenAiStreamFrame({ state, frame, onEvent }: { state: OpenAiStreamState; frame: DecodedSseEvent; onEvent: (event: OpenAiTurnEvent) => void }, _optional: Record<string, never> = {}): OpenAiFrameResult {
  if (frame.data === DONE_SENTINEL) return 'done';
  const data = parseOpenAiSseData({ raw: frame.data });
  if (!data) return 'continue'; // malformed/empty keep-alive frame, or a non-object payload

  applyOpenAiStreamUsage({ state: state, data: data, onEvent: onEvent });

  const choice = firstOpenAiChoice({ data: data });
  if (!choice) return 'continue';

  return handleOpenAiChoiceDelta({ state: state, choice: choice, onEvent: onEvent }) === 'break' ? 'contaminated' : 'continue';
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
export async function runOpenAiCompatibleRequest(requiredArgs: Pick<OpenAiCompatibleRequestInit, "url" | "headers" | "body" | "redactSecretsList" | "guardMessageId" | "providerLabel" | "onEvent" | "emitEnd" | "hasEnded">, optionalArgs: Omit<OpenAiCompatibleRequestInit, "url" | "headers" | "body" | "redactSecretsList" | "guardMessageId" | "providerLabel" | "onEvent" | "emitEnd" | "hasEnded"> = {}): Promise<OpenAiCompatibleRequestOutcome> {
  const init: OpenAiCompatibleRequestInit = { ...optionalArgs, ...requiredArgs };
  const { onEvent, hasEnded } = init;

  const fetchOutcome = await requestOpenAiCompatibleStream({ init });
  if (fetchOutcome.type === 'ended') {
    return { finishReason: null, toolCalls: [], text: '' };
  }
  if (fetchOutcome.type === 'retry') {
    return (({ url, headers, body, redactSecretsList, guardMessageId, providerLabel, onEvent, emitEnd, hasEnded, ...optionalArgs }: Parameters<typeof runOpenAiCompatibleRequest>[0] & NonNullable<Parameters<typeof runOpenAiCompatibleRequest>[1]>) => runOpenAiCompatibleRequest({ url, headers, body, redactSecretsList, guardMessageId, providerLabel, onEvent, emitEnd, hasEnded }, optionalArgs))(fetchOutcome.retryInit);
  }

  onEvent({ type: 'status', label: 'requesting' });

  const state: OpenAiStreamState = {
    guard: createRoleMarkerGuard({ messageId: init.guardMessageId }),
    toolCalls: new Map(),
    fullText: '',
    finishReason: null,
    usage: null,
  };

  for await (const frame of decodeSseStream({ source: fetchOutcome.body })) {
    // No `hasEnded()` re-check at the top of this loop: the only in-loop call to `emitEnd`
    // (contamination, below) is immediately followed by `break`, and every other call site is a
    // pre-loop early `return` — traced across all five call sites in this function and
    // `requestOpenAiCompatibleStream`, same proof as
    // `anthropic-messages.ts#runSingleAnthropicRequest`. `hasEnded()` is still consulted once,
    // after this loop, to decide whether pending tool_use events should still be emitted (a
    // contaminating delta can arrive on a *later* chunk than the one that set `finish_reason`).
    const result = processOpenAiStreamFrame({ state: state, frame: frame, onEvent: onEvent });
    if (result === 'done' || result === 'contaminated') {
      if (result === 'contaminated') init.emitEnd('contaminated');
      break;
    }
  }

  const resolvedToolCalls = resolveOpenAiToolCalls({ pending: state.toolCalls });

  if (state.finishReason === 'tool_calls' && !hasEnded()) {
    emitPendingOpenAiToolUseEvents({ toolCalls: resolvedToolCalls, onEvent });
  }

  return { finishReason: state.finishReason, toolCalls: resolvedToolCalls, text: state.fullText };
}
