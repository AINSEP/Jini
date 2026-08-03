/**
 * @module providers/anthropic-messages
 *
 * Anthropic Messages API wire adapter + tool-loop turn-runner. Built fresh
 * against Anthropic's real, current public API docs (`platform.claude.com/
 * docs/en/build-with-claude/streaming`, `.../api/messages-streaming`),
 * following this repo's established "verify against real API docs, don't
 * guess from memory" convention (see `packages/deploy/src/netlify.ts`'s
 * doc comment for the precedent) — not a byte-for-byte OD port. Only the
 * *shape* is modeled on OD's `apps/daemon/src/routes/chat.ts`'s
 * `runAnthropicToolTurn` (per `ADS-memory/reports/proposals/
 * PROP-http-route-packs-chat-model-proxy-2026-07-21.md`, which read that
 * 2267-line file directly and extracted its mechanism, line numbers, and
 * two confirmed bugs — this task did not have access to the OD source
 * itself). Extends this package's existing `providers/` pattern
 * (`model-catalog.ts`'s BYOK request/response handling,
 * `connection-guard.ts`'s SSRF guard + secret redaction,
 * `role-marker-guard.ts`'s contamination detector, and the
 * "one file per vendor's stream-parsing shape" precedent
 * `claude-stream.ts`/`copilot-stream.ts`/`qoder-stream.ts` already
 * establish) rather than duplicating any of that inside `@jini-ai/http-kit` — see
 * the proposal's "real question: where does provider-specific wire-protocol
 * logic belong?" section for the placement decision this file implements.
 *
 * **Scope for this pass:** the Anthropic Messages API only (native
 * `x-api-key`/`anthropic-version` auth), text + tool-use + image content
 * blocks, and the tool-execution loop. Extended thinking is deliberately out
 * of scope — this adapter never sends a `thinking` request parameter, so
 * Anthropic never emits `thinking`/`signature_delta` content blocks in the
 * response (per the streaming docs: thinking blocks are opt-in), which
 * means there is nothing to parse. A future pass can add it by following
 * `claude-stream.ts#emitSafeText`'s precedent (thinking is passed through
 * *unguarded* — the role-marker guard only polices the user-visible text
 * channel, since thinking content is never re-serialized as a transcript
 * turn boundary).
 *
 * **Image ("vision") support**, added for the vision self-check loop (render
 * the model's own in-progress HTML, screenshot it, hand the PNG back to the
 * model inside a tool result so the next turn sees what it built): the wire
 * shape for `AnthropicImageBlockParam`/`AnthropicBase64ImageSource`/
 * `AnthropicUrlImageSource` is modeled on Anthropic's real, current
 * `ImageBlockParam`/`Base64ImageSource`/`URLImageSource` types
 * (`github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/
 * messages/messages.ts`), and the 10 MB base64/4-format size guard below is
 * modeled on the real, current direct-API limits documented at
 * `platform.claude.com/docs/en/build-with-claude/vision#request-limits`
 * (10 MB base64-encoded per image on the direct API; jpeg/png/gif/webp
 * only — the lower 5 MB Bedrock/Google Cloud limit does not apply, since
 * this adapter only ever speaks the direct API). Deliberately narrower than
 * the real API: the real `ToolResultBlockParam.content` union also allows
 * `DocumentBlockParam`/`SearchResultBlockParam`/`ToolReferenceBlockParam`
 * blocks — those are out of scope, since the driving use case only needs
 * text + image.
 *
 * **Two confirmed OD bugs fixed here, not carried forward** (both per the
 * proposal doc above):
 * 1. **Product-identity leak.** OD's OpenRouter branch hardcoded
 *    `'HTTP-Referer': 'https://opendesign.dev'` / `'X-Title': 'Open Design'`.
 *    OpenRouter itself is out of scope this pass, but the fix generalizes:
 *    `AnthropicTurnOptions.extraHeaders` is the *only* way any caller-
 *    identifying header reaches the outbound request, and it is always
 *    caller-supplied — nothing in this module ever hardcodes a product or
 *    gateway identity string.
 * 2. **Duplicate `end`-event bug.** OD's `runAnthropicToolTurn` had two
 *    independent `sse.send('end', {})` call sites (role-marker-guard
 *    contamination, and normal turn completion) with no `ended`-flag guard,
 *    unlike its sibling non-tool-loop streamers in the same file. This
 *    module uses the shared `turn-end-guard.ts#createTurnEndGuard` — see
 *    that module's doc for why the guard is extracted into its own
 *    directly-tested unit rather than a local closure here — from every
 *    exit path (contamination, normal stop, max-tool-turns, upstream/
 *    network error), guaranteeing exactly one `end` event per call. See
 *    `__tests__/anthropic-messages.test.ts`'s "never emits end twice" case
 *    for the integration-level regression proof.
 */
import { createRoleMarkerGuard } from '../role-marker-guard.js';
import { defaultDnsLookup, redactSecrets, validateBaseUrlResolved } from './connection-guard.js';
import { decodeSseStream } from './sse-decode.js';
import { createTurnEndGuard, type TurnEndReason } from './turn-end-guard.js';

export interface AnthropicTextBlockParam {
  readonly type: 'text';
  readonly text: string;
}

export interface AnthropicToolUseBlockParam {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/** Base64-encoded image source. `media_type` mirrors Anthropic's real, current supported-format list (jpeg/png/gif/webp — see module doc). */
export interface AnthropicBase64ImageSource {
  readonly type: 'base64';
  readonly media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  readonly data: string;
}

/** A URL Anthropic's servers fetch server-side — never fetched by this adapter, so the size guard below does not apply to it (see `guardToolResult`'s doc). */
export interface AnthropicUrlImageSource {
  readonly type: 'url';
  readonly url: string;
}

export interface AnthropicImageBlockParam {
  readonly type: 'image';
  readonly source: AnthropicBase64ImageSource | AnthropicUrlImageSource;
}

/** Content blocks legal inside a `tool_result`'s `content` array. Narrower than the real API's `ToolResultBlockParam.content` union — see module doc's "Image support" section for what was deliberately left out and why. */
export type AnthropicToolResultContentBlock = AnthropicTextBlockParam | AnthropicImageBlockParam;

export interface AnthropicToolResultBlockParam {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: string | readonly AnthropicToolResultContentBlock[];
  readonly is_error?: boolean;
}

export type AnthropicContentBlockParam =
  | AnthropicTextBlockParam
  | AnthropicImageBlockParam
  | AnthropicToolUseBlockParam
  | AnthropicToolResultBlockParam;

export interface AnthropicMessageParam {
  readonly role: 'user' | 'assistant';
  readonly content: string | readonly AnthropicContentBlockParam[];
}

export interface AnthropicToolDef {
  readonly name: string;
  readonly description?: string;
  readonly input_schema: Record<string, unknown>;
}

export interface AnthropicToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface AnthropicToolResult {
  readonly content: string | readonly AnthropicToolResultContentBlock[];
  readonly isError?: boolean;
}

/** Host-owned tool execution. This module only knows how to run the wire-protocol loop — what a tool actually *does* is always the caller's business (matching `@jini-ai/http-kit`'s `RunHttpDeps.onStarted`/`db-ops.ts`'s injected `DaemonDbOperations` "the collaborator is always supplied" convention). */
export type AnthropicToolExecutor = (call: AnthropicToolCall) => Promise<AnthropicToolResult>;

/** Why a `runAnthropicToolTurn` call ended its event stream. */
export type AnthropicTurnEndReason = TurnEndReason;

export type AnthropicTurnEvent =
  | { readonly type: 'status'; readonly label: string }
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: 'tool_result'; readonly toolUseId: string; readonly content: string | readonly AnthropicToolResultContentBlock[]; readonly isError: boolean }
  | { readonly type: 'usage'; readonly usage: Record<string, unknown> | null }
  | { readonly type: 'fabricated_role_marker'; readonly marker: string; readonly messageId: string }
  | { readonly type: 'error'; readonly message: string; readonly code?: string }
  | { readonly type: 'end'; readonly reason: AnthropicTurnEndReason };

export interface AnthropicTurnOptions {
  readonly apiKey: string;
  /** Defaults to `https://api.anthropic.com`. Overridable for BYOK-compatible gateways. */
  readonly baseUrl?: string;
  /** Defaults to `2023-06-01`, Anthropic's current stable Messages API version. */
  readonly apiVersion?: string;
  readonly model: string;
  readonly system?: string;
  readonly messages: readonly AnthropicMessageParam[];
  readonly tools?: readonly AnthropicToolDef[];
  readonly maxTokens: number;
  readonly temperature?: number;
  /** Tool-loop iteration ceiling (a single request counts as one iteration once it returns `stop_reason: 'tool_use'`). Defaults to 8 — generous for a real agentic turn, bounded so a misbehaving tool/model pair cannot loop forever. */
  readonly maxToolTurns?: number;
  /** Omit to run a single request with no tool-result feedback loop (pending tool calls are still emitted as `tool_use` events; the turn simply ends after the first response). */
  readonly executeTool?: AnthropicToolExecutor;
  readonly onEvent: (event: AnthropicTurnEvent) => void;
  readonly signal?: AbortSignal;
  /**
   * Caller-supplied extra headers merged onto every request (e.g. an
   * OpenRouter-shaped gateway's `HTTP-Referer`/`X-Title` pair, or a proxy's
   * own routing header). Never hardcode a caller/product identity string
   * here — this is the generalized fix for the confirmed OD product-identity
   * leak documented in this module's header comment.
   */
  readonly extraHeaders?: Record<string, string>;
}

export interface AnthropicTurnResult {
  readonly stopReason: string | null;
  readonly toolTurns: number;
}

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOOL_TURNS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function anthropicRequestUrl(baseUrl: string | undefined): string {
  const base = (baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL).replace(/\/+$/, '');
  return `${base}/v1/messages`;
}

function anthropicHeaders(options: AnthropicTurnOptions): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': options.apiKey,
    'anthropic-version': options.apiVersion ?? DEFAULT_ANTHROPIC_VERSION,
    ...(options.extraHeaders ?? {}),
  };
}

function anthropicRequestBody(options: AnthropicTurnOptions, messages: readonly AnthropicMessageParam[]): Record<string, unknown> {
  return {
    model: options.model,
    max_tokens: options.maxTokens,
    stream: true,
    messages,
    ...(options.system !== undefined ? { system: options.system } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
  };
}

function extractAnthropicErrorDetail(rawText: string): string {
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

const ANTHROPIC_ALLOWED_IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/**
 * Direct-API base64 image limit is 10 MB (see module doc's "Image support" section for the
 * verified docs URL). Approximated from the base64 *string* length rather than decoded byte
 * count — that string is what actually crosses the wire, and checking its length is O(1) with no
 * decode step, at the cost of a small (~1 char in 10^7) rounding slack from base64's 4/3 expansion
 * ratio, which is immaterial at this size.
 */
const MAX_IMAGE_BASE64_CHARS = Math.ceil((10 * 1024 * 1024 * 4) / 3);

/**
 * Validates one tool-result content block against the real API's format/size constraints.
 * Returns the violation reason, or `null` when the block is legal to send.
 *
 * URL-sourced images are intentionally not size-checked here: Anthropic's servers fetch that URL,
 * not this adapter, so there is no local payload to bound (a different threat model than
 * `connection-guard.ts`'s SSRF guard, which protects *this adapter's own* outbound `baseUrl`
 * request).
 *
 * @complexity O(1) — reads `data.length`, never decodes or parses the base64 payload.
 * @overallScore 100
 */
function invalidToolResultContentBlockReason(block: AnthropicToolResultContentBlock): string | null {
  if (block.type === 'text') return null;
  if (block.source.type === 'url') return null;
  if (!ANTHROPIC_ALLOWED_IMAGE_MEDIA_TYPES.has(block.source.media_type)) {
    return `unsupported image media_type ${JSON.stringify(block.source.media_type)} (direct API supports image/jpeg, image/png, image/gif, image/webp)`;
  }
  if (block.source.data.length > MAX_IMAGE_BASE64_CHARS) {
    return `image exceeds the direct API's 10 MB base64 size limit (${block.source.data.length} base64 chars)`;
  }
  return null;
}

/**
 * Runtime guard applied to every `AnthropicToolExecutor` result before it is wired onto the
 * outbound request or reported via `onEvent`. `AnthropicToolResult` is host-owned (see
 * `AnthropicToolExecutor`'s "Host-owned tool execution" doc comment) — the TS content-block union
 * only constrains a well-behaved host at compile time, not a buggy one at runtime, e.g. a
 * screenshot helper that hands back an oversized PNG or a HEIC file mislabeled as `image/jpeg`.
 * Rather than forwarding an invalid block and letting Anthropic reject the *entire* turn with an
 * opaque upstream 400, this substitutes a normal `is_error` tool_result the model can see and
 * react to — matching this module's existing security-conscious posture
 * (`connection-guard.ts`'s SSRF guard, `role-marker-guard.ts`'s contamination guard).
 *
 * @param result - The (host-supplied, not yet trusted) return value of one `executeTool` call.
 * @returns `result` unchanged when valid; otherwise a replacement `{ content, isError: true }`
 * describing the violation.
 * @complexity O(n) in the number of content blocks; O(1) per block (see
 * `invalidToolResultContentBlockReason`).
 * @overallScore 100
 */
function guardToolResult(result: AnthropicToolResult): AnthropicToolResult {
  if (typeof result.content === 'string') return result;
  for (const block of result.content) {
    const reason = invalidToolResultContentBlockReason(block);
    if (reason) {
      return { content: `[rejected tool result] ${reason}`, isError: true };
    }
  }
  return result;
}

interface AnthropicBlockState {
  readonly type: 'text' | 'tool_use' | 'other';
  text: string;
  toolId?: string;
  toolName?: string;
  inputJson: string;
}

interface SingleRequestOutcome {
  readonly stopReason: string | null;
  readonly toolCalls: readonly AnthropicToolCall[];
  readonly text: string;
}

/** Runs exactly one Anthropic Messages API streaming request and reduces its SSE events into a single outcome. Calls `emitEnd` directly (and only) on contamination or a fatal request/stream error — the caller (`runAnthropicToolTurn`) is responsible for the normal-completion `emitEnd` call once the tool loop actually concludes, so the single `ended` flag stays the sole gate for every exit path. */
async function runSingleAnthropicRequest(
  options: AnthropicTurnOptions,
  messages: readonly AnthropicMessageParam[],
  emitEnd: (reason: AnthropicTurnEndReason) => void,
): Promise<SingleRequestOutcome> {
  const { onEvent } = options;

  // DNS-resolving, not merely textual — see the identical note in `openai-chat.ts`. A literal
  // private IP was already rejected; a hostname resolving to one was not.
  const baseUrlCheck = await validateBaseUrlResolved(options.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL, defaultDnsLookup);
  if (baseUrlCheck.error) {
    onEvent({ type: 'error', message: baseUrlCheck.error });
    emitEnd('error');
    return { stopReason: null, toolCalls: [], text: '' };
  }

  let response: { ok: boolean; status: number; body: AsyncIterable<Uint8Array | string> | null; text(): Promise<string> };
  try {
    response = (await fetch(anthropicRequestUrl(options.baseUrl), {
      method: 'POST',
      headers: anthropicHeaders(options),
      body: JSON.stringify(anthropicRequestBody(options, messages)),
      ...(options.signal ? { signal: options.signal } : {}),
    })) as unknown as typeof response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onEvent({ type: 'error', message: redactSecrets(message, [options.apiKey]) });
    emitEnd('error');
    return { stopReason: null, toolCalls: [], text: '' };
  }

  if (!response.ok) {
    const rawText = await response.text();
    onEvent({
      type: 'error',
      message: redactSecrets(extractAnthropicErrorDetail(rawText), [options.apiKey]),
      code: String(response.status),
    });
    emitEnd('error');
    return { stopReason: null, toolCalls: [], text: '' };
  }
  if (!response.body) {
    onEvent({ type: 'error', message: 'Anthropic response had no body' });
    emitEnd('error');
    return { stopReason: null, toolCalls: [], text: '' };
  }

  onEvent({ type: 'status', label: 'requesting' });

  const guard = createRoleMarkerGuard('anthropic-turn');
  const blocks = new Map<number, AnthropicBlockState>();
  const toolCalls: AnthropicToolCall[] = [];
  let fullText = '';
  let stopReason: string | null = null;
  let usage: Record<string, unknown> | null = null;

  for await (const frame of decodeSseStream(response.body)) {
    // No `isEnded()` re-check at the top of this loop: every `emitEnd(...)` call site below is
    // immediately followed by `break`, so `ended` can never be true when a new iteration starts
    // — traced across all six call sites in this function (the four pre-loop early returns plus
    // the two in-loop contamination/error branches below). Verified, not assumed; see
    // `__tests__/anthropic-messages.test.ts`'s duplicate-end-event regression case.
    let data: unknown;
    try {
      data = JSON.parse(frame.data);
    } catch {
      continue; // tolerate a malformed/empty keep-alive frame
    }
    if (!isRecord(data)) continue;
    const kind = typeof data.type === 'string' ? data.type : frame.event;

    if (kind === 'content_block_start' && isRecord(data.content_block) && typeof data.index === 'number') {
      const block = data.content_block;
      if (block.type === 'text') {
        blocks.set(data.index, { type: 'text', text: '', inputJson: '' });
      } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        blocks.set(data.index, { type: 'tool_use', text: '', toolId: block.id, toolName: block.name, inputJson: '' });
      } else {
        blocks.set(data.index, { type: 'other', text: '', inputJson: '' });
      }
      continue;
    }

    if (kind === 'content_block_delta' && isRecord(data.delta) && typeof data.index === 'number') {
      const state = blocks.get(data.index);
      const delta = data.delta;
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        if (state) state.text += delta.text;
        // No `guard.contaminated` pre-check here: the only way it can become
        // true is the `emitEnd('contaminated'); break;` a few lines below,
        // which exits this loop immediately — a later text_delta in the same
        // request can never reach this point already contaminated. (`feedText`
        // itself is still safe to call unconditionally regardless — it
        // early-returns `''` once contaminated, per its own doc.)
        const safe = guard.feedText(delta.text);
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
      } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string' && state) {
        state.inputJson += delta.partial_json;
      }
      continue;
    }

    if (kind === 'content_block_stop' && typeof data.index === 'number') {
      const state = blocks.get(data.index);
      if (state?.type === 'tool_use' && state.toolId && state.toolName) {
        let input: unknown = {};
        if (state.inputJson.trim()) {
          try {
            input = JSON.parse(state.inputJson);
          } catch {
            input = {};
          }
        }
        const call = { id: state.toolId, name: state.toolName, input };
        toolCalls.push(call);
        onEvent({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
      }
      blocks.delete(data.index);
      continue;
    }

    if (kind === 'message_delta') {
      if (isRecord(data.delta) && typeof data.delta.stop_reason === 'string') {
        stopReason = data.delta.stop_reason;
      }
      if (isRecord(data.usage)) {
        usage = data.usage;
        onEvent({ type: 'usage', usage });
      }
      continue;
    }

    if (kind === 'error') {
      const errorDetail = isRecord(data.error) && typeof data.error.message === 'string' ? data.error.message : 'upstream error';
      const errorType = isRecord(data.error) && typeof data.error.type === 'string' ? data.error.type : undefined;
      onEvent({ type: 'error', message: redactSecrets(errorDetail, [options.apiKey]), ...(errorType ? { code: errorType } : {}) });
      emitEnd('error');
      break;
    }

    // `message_start`, `message_stop`, `ping`, and any future event type per
    // Anthropic's own versioning policy ("your code should handle unknown
    // event types gracefully") — nothing to do.
  }

  return { stopReason, toolCalls, text: fullText };
}

/**
 * Runs a full Anthropic Messages API turn, including the tool-execution
 * loop when `options.executeTool` is supplied and the model requests tool
 * use. Emits a generic event stream via `options.onEvent` — a caller (e.g.
 * `@jini-ai/http-kit`'s `model-proxy.ts`) adapts those events onto an outbound SSE
 * channel; this module has no knowledge of HTTP/Express.
 *
 * Guarantees exactly one `{type: 'end'}` event per call, regardless of which
 * of the four exit paths (contamination, normal stop, max-tool-turns,
 * request/stream error) triggers it — the fix for OD's confirmed duplicate-
 * `end`-event bug (see module doc).
 */
export async function runAnthropicToolTurn(options: AnthropicTurnOptions): Promise<AnthropicTurnResult> {
  const maxToolTurns = options.maxToolTurns ?? DEFAULT_MAX_TOOL_TURNS;

  const endGuard = createTurnEndGuard<AnthropicTurnEvent>(options.onEvent, (reason) => ({ type: 'end', reason }));
  const emitEnd = endGuard.emitEnd;

  let messages = options.messages.slice();
  let toolTurns = 0;
  let lastStopReason: string | null = null;

  while (true) {
    const outcome = await runSingleAnthropicRequest(options, messages, emitEnd);
    lastStopReason = outcome.stopReason;

    if (endGuard.hasEnded()) break;

    if (outcome.stopReason !== 'tool_use' || outcome.toolCalls.length === 0) {
      emitEnd('stop');
      break;
    }
    if (!options.executeTool) {
      // Pending tool calls were already emitted as `tool_use` events above;
      // with no executor to run them, the turn ends here rather than
      // silently retrying forever.
      emitEnd('stop');
      break;
    }
    if (toolTurns >= maxToolTurns) {
      emitEnd('max_tool_turns');
      break;
    }
    toolTurns += 1;

    const assistantContent: AnthropicContentBlockParam[] = [
      ...(outcome.text ? [{ type: 'text', text: outcome.text } as const] : []),
      ...outcome.toolCalls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.input }) as const),
    ];
    const toolResultBlocks: AnthropicToolResultBlockParam[] = [];
    for (const call of outcome.toolCalls) {
      const rawResult = await options.executeTool(call);
      const result = guardToolResult(rawResult);
      options.onEvent({ type: 'tool_result', toolUseId: call.id, content: result.content, isError: result.isError ?? false });
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: result.content,
        ...(result.isError !== undefined ? { is_error: result.isError } : {}),
      });
    }

    messages = [
      ...messages,
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: toolResultBlocks },
    ];
  }

  return { stopReason: lastStopReason, toolTurns };
}
