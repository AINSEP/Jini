/**
 * @module providers/ollama-chat
 *
 * Ollama native Chat API wire adapter + tool-loop turn-runner. Sibling of
 * `anthropic-messages.ts`/`openai-chat.ts`/`azure-chat.ts` — see those
 * modules' headers for the shared design rationale.
 *
 * **Corrected to match Open Design's real behavior** (an earlier version of
 * this module targeted Ollama's OpenAI-compatible `/v1/chat/completions`
 * surface instead — found wrong by a live side-by-side comparison against a
 * running OD daemon, `apps/daemon/src/routes/chat.ts:1298`'s real
 * `/api/proxy/ollama/stream` handler):
 *
 * - **Endpoint**: `{baseUrl}/api/chat` — Ollama's own native chat API, not
 *   the OpenAI-compatible shim. `baseUrl` has any trailing `/api` stripped
 *   before appending, matching OD's `.replace(/\/api\/?$/, '')`.
 * - **Wire format**: newline-delimited JSON (NDJSON), one JSON object per
 *   line, terminated by a line with `"done": true` — NOT Server-Sent
 *   Events. `text_delta`s come from `message.content`; the terminal line's
 *   `done: true` ends the stream (see `runSingleOllamaRequest` below).
 * - **`apiKey` is required**, like every other provider — OD's real handler
 *   rejects a request with no `apiKey` (`if (!apiKey || !model)`), because
 *   its default target is Ollama Cloud (see next point), not a bare local
 *   install.
 * - **Default `baseUrl` is `https://ollama.com`** (Ollama Cloud), matching
 *   OD's `effectiveBaseUrl = baseUrl || 'https://ollama.com'` — not a local
 *   loopback address. A caller running a real local Ollama install still
 *   just passes `baseUrl: 'http://localhost:11434'` explicitly; the
 *   loopback carve-out in `connection-guard.ts` (documented there as
 *   existing "for local LLM servers like Ollama") still applies when they
 *   do.
 * - **Token limit**: `options.num_predict` (Ollama's native token-limit
 *   field), sent only when `maxTokens` is a positive number — matches OD's
 *   `if (typeof maxTokens === 'number' && maxTokens > 0) payload.options = {
 *   num_predict: maxTokens }`.
 *
 * **Round-4 external audit fix (`AUD-R4-002`)**: the first port of this
 * module's tool-call loop kept the OpenAI-compatible wire shape for both the
 * emitted lifecycle event and the continuation request — `tool_use` was
 * never emitted, and the assistant/tool continuation messages used a
 * stringified `arguments` blob plus a `type` discriminator that does not
 * exist in Ollama's native tool-call schema. (Narrowed 2026-08-03: this note
 * previously also named `id`/`tool_call_id` as nonexistent, which is wrong —
 * see `OllamaMessageParam.tool_name`'s doc for what `api/types.go` actually
 * declares. `type` is the only genuinely absent field.) Fixed: `tool_use` now
 * fires for every resolved call as soon as the stream ends (see
 * `runSingleOllamaRequest`), and `OllamaToolCallParam`/`OllamaMessageParam`
 * now match Ollama's own documented shape (`arguments` as a native object,
 * `tool_name` instead of `tool_call_id` — see those interfaces' docs).
 *
 * **Deliberate extension beyond OD's own scope, not a parity gap**: OD's
 * ollama handler never builds a `tools` field into its request and never
 * reads `message.tool_calls` from the response — its own ollama proxy has
 * no tool-calling support at all. Ollama's real native `/api/chat` API does
 * support tool calling (a `tools` array in the same OpenAI
 * function-declaration shape on the request, `message.tool_calls: [{id?,
 * function: {name, arguments}}]` on a non-streaming-final response chunk —
 * see `github.com/ollama/ollama/blob/main/docs/api.md#chat-request-with-
 * tools`). This module keeps that capability (as the original, pre-parity-
 * fix version of this file already did) rather than removing working
 * functionality just to match a gap in OD's own product scope — matching
 * this repo's established practice elsewhere (e.g. `xai.ts` deliberately
 * generalizing OD's OAuth-connect *shape* while dropping its OD-specific
 * SuperGrok billing gate).
 *
 * **Image ("vision") support**, added for the same vision self-check use
 * case as `anthropic-messages.ts` (see that module's doc). Ollama's real
 * wire shape is genuinely unlike every other provider this repo's adapters
 * touch: `Message.Images` (`github.com/ollama/ollama/blob/main/api/
 * types.go`) is `[]ImageData` where `ImageData` is a raw Go `[]byte` —
 * `encoding/json` marshals a byte slice as a **bare base64 string**, so
 * there is no `data:` URI prefix and no `media_type` field at all (unlike
 * Anthropic/OpenAI's wrapped-source shapes). Confirmed directly against that
 * struct, not assumed from the "list of images" prose in `docs/api.md`.
 *
 * **Design decision: native `tool`-role images, not a synthetic follow-up
 * turn.** A prior pass on this same task (see `ADS-memory/reports/refactors/
 * 2026-08-03-image-send-capability.md`) found OpenAI/Azure/Google's `tool`-
 * role message is documented text-only, so those three need a synthetic
 * `user`-role follow-up turn to carry an image at all. Ollama does not need
 * that workaround — verified, not assumed, against two independent pieces of
 * real server-side evidence: (1) `api/types.go`'s `Message` struct puts
 * `Images` at the same level as `Role`/`Content`/`ToolName`, with no
 * role-conditional field; (2) `server/prompt.go`'s `imageTaggedMessages`
 * function, which actually builds the model prompt, iterates every message
 * regardless of `Role` and reads `msg.Images` unconditionally — there is no
 * `if msg.Role == "user"` gate anywhere near that read. A `tool`-role
 * message's `images` field therefore reaches the model exactly like a
 * `user`-role message's would. This makes Ollama's tool-result channel
 * behave like Anthropic's (native), not like OpenAI/Azure/Google's
 * (workaround required) — a third shape the prior pass's provider table
 * did not anticipate, because Ollama was outside its original four-protocol
 * scope.
 *
 * **`OllamaToolResult.isError` added alongside `images`, not purely a vision
 * change.** Before this pass, every `tool_result` event and continuation
 * message hardcoded `isError: false` regardless of what `executeTool`
 * returned — `OllamaToolResult` had no `isError` field for a host to even
 * set. That is a pre-existing gap independent of images, but this pass's own
 * `guardToolResult` (see below) needs to signal a rejected/malformed image
 * as an error the model can see, which is impossible without it. Wired
 * through as `result.isError ?? false`, so every existing caller that never
 * set `isError` keeps its exact prior behavior.
 */
import { createRoleMarkerGuard } from '../role-marker-guard.js';
import { defaultDnsLookup, pinnedFetch, redactSecrets, validateBaseUrlResolved } from './connection-guard.js';
import { createTurnEndGuard, type TurnEndReason } from './turn-end-guard.js';

export interface OllamaFunctionToolDef {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters: Record<string, unknown>;
  };
}

/**
 * Ollama's native `/api/chat` tool-call shape — genuinely different from the
 * OpenAI-compatible one this file's types were originally copied from:
 * `arguments` is a native JSON object (not a stringified blob), and there is
 * no `id`/`type` field at all (confirmed against Ollama's own documented
 * "Chat request (No streaming, with tools)" example,
 * `github.com/ollama/ollama/blob/main/docs/api.md`). Round-4 external audit
 * (`AUD-R4-002`) found the first port had kept the OpenAI shape here, which
 * a strict Ollama server can reject. Synthetic per-call `id`s are still
 * generated (see `runSingleOllamaRequest`) but stay purely internal to this
 * module's own event stream — they are never put on the wire.
 */
export interface OllamaToolCallParam {
  readonly function: { readonly name: string; readonly arguments: unknown };
}

export interface OllamaMessageParam {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  /** Bare base64-encoded image strings — no `data:` URI prefix, no `media_type` field (see module doc's "Image support" section for the verified real wire shape). Legal on any role, `tool` included — Ollama's server-side prompt builder reads this field with no role restriction. */
  readonly images?: readonly string[];
  readonly tool_calls?: readonly OllamaToolCallParam[];
  /**
   * Ollama's name-based tool-result association field. This adapter associates by name rather than
   * by call id — a deliberate choice, NOT a limitation of the protocol.
   *
   * Corrected 2026-08-03 against Ollama's own `api/types.go`: an earlier version of this comment
   * claimed "Ollama has no call-id concept on the wire", and that is false. `Message` declares BOTH
   * `ToolName string \`json:"tool_name,omitempty"\`` and `ToolCallID string \`json:"tool_call_id,omitempty"\``,
   * and `ToolCall` carries `ID string \`json:"id,omitempty"\``. Only OpenAI's `type` discriminator is
   * genuinely absent from Ollama's `ToolCall`.
   *
   * Name-based association is still correct here, and is what `OllamaToolCall.id` being synthesized
   * locally (see below) is built around — but if parallel calls to the SAME tool in one turn ever
   * need disambiguating, `tool_call_id` is available on the wire and is the right fix. Do not
   * re-derive "the protocol can't do it".
   */
  readonly tool_name?: string;
}

export interface OllamaToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface OllamaToolResult {
  readonly content: string;
  /** Bare base64-encoded image strings — same wire shape as `OllamaMessageParam.images` (see module doc). Attached to the outbound `tool`-role continuation message's own `images` field. */
  readonly images?: readonly string[];
  /** Added alongside `images` — see module doc's "`OllamaToolResult.isError` added alongside `images`" note for why this was a pre-existing gap, not a vision-only addition. */
  readonly isError?: boolean;
}

/** Host-owned tool execution — same "the collaborator is always supplied" convention as `anthropic-messages.ts#AnthropicToolExecutor`. */
export type OllamaToolExecutor = (call: OllamaToolCall) => Promise<OllamaToolResult>;

export type OllamaTurnEndReason = TurnEndReason;

export type OllamaTurnEvent =
  | { readonly type: 'status'; readonly label: string }
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: 'tool_result'; readonly toolUseId: string; readonly content: string; readonly images?: readonly string[]; readonly isError: boolean }
  | { readonly type: 'usage'; readonly usage: Record<string, unknown> | null }
  | { readonly type: 'fabricated_role_marker'; readonly marker: string; readonly messageId: string }
  | { readonly type: 'error'; readonly message: string; readonly code?: string }
  | { readonly type: 'end'; readonly reason: OllamaTurnEndReason };

export interface OllamaTurnOptions {
  /** Required — see module doc (OD's real handler rejects a request with no apiKey). */
  readonly apiKey: string;
  /** Defaults to `https://ollama.com` (Ollama Cloud) — see module doc. Pass a local address explicitly to target a local install. */
  readonly baseUrl?: string;
  readonly model: string;
  readonly messages: readonly OllamaMessageParam[];
  readonly tools?: readonly OllamaFunctionToolDef[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Same bound and rationale as `AnthropicTurnOptions.maxToolTurns`. Defaults to 8. */
  readonly maxToolTurns?: number;
  readonly executeTool?: OllamaToolExecutor;
  readonly onEvent: (event: OllamaTurnEvent) => void;
  readonly signal?: AbortSignal;
  /** Caller-supplied extra headers — see `anthropic-messages.ts#AnthropicTurnOptions.extraHeaders`'s doc for why this exists and what it fixes. */
  readonly extraHeaders?: Record<string, string>;
}

export interface OllamaTurnResult {
  readonly finishReason: string | null;
  readonly toolTurns: number;
}

const DEFAULT_OLLAMA_BASE_URL = 'https://ollama.com';
const DEFAULT_MAX_TOOL_TURNS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strips a trailing `/api` (with or without a trailing slash) before appending `/api/chat` — matches OD's `.replace(/\/+$/, '').replace(/\/api\/?$/, '')` so a caller-supplied `baseUrl` ending in `/api` doesn't produce `/api/api/chat`. */
function ollamaRequestUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, '').replace(/\/api\/?$/, '');
  return `${trimmed}/api/chat`;
}

function ollamaHeaders(options: OllamaTurnOptions): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${options.apiKey}`,
    ...(options.extraHeaders ?? {}),
  };
}

function ollamaRequestBody(options: OllamaTurnOptions, messages: readonly OllamaMessageParam[]): Record<string, unknown> {
  const modelOptions: Record<string, unknown> = {};
  if (options.temperature !== undefined) modelOptions.temperature = options.temperature;
  if (typeof options.maxTokens === 'number' && options.maxTokens > 0) modelOptions.num_predict = options.maxTokens;

  return {
    model: options.model,
    stream: true,
    messages,
    ...(Object.keys(modelOptions).length > 0 ? { options: modelOptions } : {}),
    ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
  };
}

function extractOllamaErrorDetail(rawText: string): string {
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (isRecord(parsed) && typeof parsed.error === 'string') return parsed.error;
  } catch {
    // fall through to raw text
  }
  return rawText.slice(0, 500);
}

/**
 * Validates one image string from a host-returned `OllamaToolResult.images` array. Returns the
 * violation reason, or `null` when the string is legal to send.
 *
 * Deliberately narrower than `anthropic-messages.ts#invalidToolResultContentBlockReason`: no
 * `media_type` allow-list (Ollama's wire shape has no such field to validate — see module doc), and
 * no byte-size cap. The size guard was considered and rejected, not skipped reflexively: Anthropic's
 * 10 MB figure came from a real, documented direct-API limit; no equivalent published figure exists
 * for Ollama. A local install's real ceiling is whatever the host machine's memory allows (not a
 * fixed vendor number this module could verify), and `OllamaTurnOptions.baseUrl`'s own documented
 * default target — Ollama Cloud — is a remote, metered service too, but its docs likewise publish no
 * per-image size limit as of this pass. Inventing a number in either case would be exactly the kind
 * of memory-guess this repo's "verify against real docs" convention forbids (see module doc).
 *
 * What IS checked: the shape mistake an existing host is actually likely to make. A caller that
 * already built an Anthropic/OpenAI-shaped payload elsewhere in the same codebase has a `data:`
 * URI-prefixed or object-wrapped image sitting right there — pasting that into Ollama's `images`
 * array (a bare base64 string, no wrapper) is a real, easy, silent mistake, not a hypothetical one.
 *
 * @complexity O(1) — a string-prefix check and a length check, no base64 decoding.
 * @overallScore 100
 */
function invalidOllamaImageReason(image: string): string | null {
  if (image.length === 0) return 'image must be a non-empty base64 string';
  if (image.startsWith('data:')) {
    return "image must be a bare base64 string with no `data:` URI prefix (Ollama's wire format has no media_type field — see module doc)";
  }
  return null;
}

/**
 * Runtime guard applied to every `OllamaToolExecutor` result before it is wired onto the outbound
 * continuation message or reported via `onEvent` — same rationale and posture as
 * `anthropic-messages.ts#guardToolResult` (host-owned executor, TS types don't constrain a buggy
 * host at runtime; substitutes a legible `is_error` tool_result rather than forwarding a malformed
 * image the server would reject with a less legible error).
 *
 * @complexity O(n) in the number of images; O(1) per image.
 * @overallScore 100
 */
function guardToolResult(result: OllamaToolResult): OllamaToolResult {
  if (!result.images || result.images.length === 0) return result;
  for (const image of result.images) {
    const reason = invalidOllamaImageReason(image);
    if (reason) {
      return { content: `[rejected tool result] ${reason}`, isError: true };
    }
  }
  return result;
}

interface SingleRequestOutcome {
  readonly finishReason: string | null;
  readonly toolCalls: readonly OllamaToolCall[];
  readonly text: string;
}

/** Mutable reduction state threaded through one streaming request's line handlers (below). Grouped into one object so each handler takes a single parameter instead of several — same convention as `anthropic-messages.ts#AnthropicStreamState`/`openai-chat.ts#OpenAiStreamState`. Exported so a unit test can construct one directly without going through a full `runOllamaToolTurn` call. */
export interface OllamaStreamState {
  readonly guard: ReturnType<typeof createRoleMarkerGuard>;
  readonly toolCalls: OllamaToolCall[];
  fullText: string;
  finishReason: string | null;
}

/** Parses one `function.arguments` value: Ollama's native tool-call payload documents it as a native JSON object, but a strict/older server can still send a stringified blob — this tolerates either, falling back to the raw string on malformed JSON. */
export function parseOllamaToolCallArguments(args: unknown): unknown {
  if (typeof args !== 'string') return args;
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

/** Resolves one raw `message.tool_calls[]` entry into an `OllamaToolCall`, or `null` when the entry is missing its `function`/`name` (malformed, so skipped rather than surfaced). `index` seeds the synthetic id fallback — see `OllamaToolCallParam`'s doc for why a call id is generated locally rather than trusted off the wire. */
export function resolveOllamaToolCall(rawCall: unknown, index: number): OllamaToolCall | null {
  if (!isRecord(rawCall) || !isRecord(rawCall.function)) return null;
  const name = typeof rawCall.function.name === 'string' ? rawCall.function.name : '';
  if (!name) return null;
  const input = parseOllamaToolCallArguments(rawCall.function.arguments);
  const id = typeof rawCall.id === 'string' && rawCall.id ? rawCall.id : `ollama-tool-${index}`;
  return { id, name, input };
}

/** Resolves every entry in `message.tool_calls` into `state.toolCalls`, then marks `finishReason: 'tool_calls'` once at least one resolved — mirrors the original inline loop's behavior of setting `finishReason` after the whole batch rather than per-call. */
export function handleOllamaToolCallsField(state: OllamaStreamState, message: Record<string, unknown>): void {
  if (!Array.isArray(message.tool_calls)) return;
  for (const rawCall of message.tool_calls) {
    const call = resolveOllamaToolCall(rawCall, state.toolCalls.length);
    if (call) state.toolCalls.push(call);
  }
  if (state.toolCalls.length > 0) state.finishReason = 'tool_calls';
}

/**
 * Feeds one `message.content` delta through the role-marker guard and emits the safe portion.
 * Returns `'break'` once the guard flags contamination, otherwise `'continue'` — same contract as
 * `anthropic-messages.ts#handleAnthropicTextDelta`/`openai-chat.ts#handleOpenAiTextContentDelta`.
 */
export function handleOllamaTextContent(state: OllamaStreamState, content: string, onEvent: (event: OllamaTurnEvent) => void): 'continue' | 'break' {
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

/**
 * Reduces one already-parsed NDJSON line into `state`, reporting whether the caller's line loop
 * should stop and, if so, why. `'break'` calls `emitEnd('contaminated')` itself (mirroring the
 * `content`-delta contamination path being the only in-loop `emitEnd` call site in every sibling
 * provider); `'done'` reports the terminal `done: true` line with no `emitEnd` call of its own —
 * the caller (`runSingleOllamaRequest`) still owns the normal-completion `emitEnd`, exactly like
 * every sibling turn-runner's `emitEnd` contract.
 */
export function processOllamaLine(
  state: OllamaStreamState,
  line: Record<string, unknown>,
  onEvent: (event: OllamaTurnEvent) => void,
  emitEnd: (reason: OllamaTurnEndReason) => void,
): 'continue' | 'break' | 'done' {
  const message = isRecord(line.message) ? line.message : null;
  if (message && typeof message.content === 'string' && message.content.length > 0) {
    if (handleOllamaTextContent(state, message.content, onEvent) === 'break') {
      state.finishReason = 'contaminated';
      emitEnd('contaminated');
      return 'break';
    }
  }
  if (message) handleOllamaToolCallsField(state, message);

  if (line.done === true) {
    if (state.finishReason !== 'contaminated' && state.finishReason !== 'tool_calls') state.finishReason = 'stop';
    return 'done';
  }
  return 'continue';
}

/** Emitted for every resolved call as soon as the stream ends, independent of whether the caller actually supplied an `executeTool` — see AUD-R4-002 fix note in the module doc. */
function emitPendingOllamaToolUseEvents(toolCalls: readonly OllamaToolCall[], onEvent: (event: OllamaTurnEvent) => void): void {
  for (const call of toolCalls) {
    onEvent({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
  }
}

/**
 * Validates `options.baseUrl` and opens the streaming POST, returning the response's readable body
 * once every pre-stream failure mode (SSRF-guard rejection, network error, non-2xx status, missing
 * body) has been ruled out. Calls `emitEnd('error')` and returns `null` itself on any of those —
 * the caller only has to check for `null` — same split as
 * `anthropic-messages.ts#openAnthropicResponseStream`.
 */
async function openOllamaResponseStream(
  options: OllamaTurnOptions,
  messages: readonly OllamaMessageParam[],
  emitEnd: (reason: OllamaTurnEndReason) => void,
): Promise<AsyncIterable<Uint8Array | string> | null> {
  const { onEvent } = options;

  const baseUrlCheck = await validateBaseUrlResolved(options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL, defaultDnsLookup);
  if (baseUrlCheck.error) {
    onEvent({ type: 'error', message: baseUrlCheck.error });
    emitEnd('error');
    return null;
  }

  let response: { ok: boolean; status: number; body: AsyncIterable<Uint8Array | string> | null; text(): Promise<string> };
  try {
    response = await pinnedFetch(
      ollamaRequestUrl(options.baseUrl),
      {
        method: 'POST',
        headers: ollamaHeaders(options),
        body: JSON.stringify(ollamaRequestBody(options, messages)),
        // Unlike the other three providers, this call never set `redirect: 'error'` even before
        // this pinning change — the reviewer's redirect-rebinding finding was only reported (and
        // fixed) for `openai-chat.ts`. `pinnedFetch` closes it here regardless, the same way it
        // does everywhere else (`node:http`'s `request` never auto-follows); the flag is added for
        // self-documentation, matching the other three call sites.
        redirect: 'error',
        ...(options.signal ? { signal: options.signal } : {}),
      },
      baseUrlCheck.pinnedAddress,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onEvent({ type: 'error', message: redactSecrets(message, [options.apiKey]) });
    emitEnd('error');
    return null;
  }

  if (!response.ok) {
    const rawText = await response.text();
    onEvent({
      type: 'error',
      message: redactSecrets(extractOllamaErrorDetail(rawText), [options.apiKey]),
      code: String(response.status),
    });
    emitEnd('error');
    return null;
  }
  if (!response.body) {
    onEvent({ type: 'error', message: 'Ollama response had no body' });
    emitEnd('error');
    return null;
  }

  return response.body;
}

/** Parses one NDJSON line, returning `undefined` for a malformed/empty line — JSON has no `undefined` literal, so a successful parse is never confused with a failed one. Extracted so the generator below never nests a `try`/`catch` inside its loops (see that function's doc). */
export function parseNdjsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** Splits already-accumulated buffer content into complete newline-terminated lines (newline stripped) plus the remaining partial-line `remainder`. Pure — no I/O — so this buffering/splitting logic is exercised as plain value-in/value-out assertions instead of through the full streaming generator. */
export function splitNdjsonLines(buffer: string): { readonly lines: readonly string[]; readonly remainder: string } {
  const lines: string[] = [];
  let rest = buffer;
  let newlineIndex: number;
  while ((newlineIndex = rest.indexOf('\n')) >= 0) {
    lines.push(rest.slice(0, newlineIndex));
    rest = rest.slice(newlineIndex + 1);
  }
  return { lines, remainder: rest };
}

/** Trims and parses each complete line in `rawLines`, yielding only the ones that parsed to something other than `undefined` — a plain (non-async) generator so `decodeNdjsonStream` below can delegate to it with `yield*` instead of nesting a `for`/`if`/`if` inside its own `for await` loop. */
export function* parseNdjsonLines(rawLines: readonly string[]): Generator<unknown> {
  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) continue; // tolerate a malformed/empty keep-alive line
    const parsed = parseNdjsonLine(line);
    if (parsed !== undefined) yield parsed;
  }
}

/**
 * Reads a `fetch` response body as newline-delimited JSON, yielding one
 * parsed line at a time. Buffers partial lines across chunk boundaries — an
 * NDJSON line is not guaranteed to arrive in a single chunk. A trailing,
 * unterminated final line (no closing newline) is still yielded once the
 * stream ends, matching `sse-decode.ts#decodeSseStream`'s equivalent
 * tolerance for the SSE case.
 */
async function* decodeNdjsonStream(body: AsyncIterable<Uint8Array | string>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    const { lines, remainder } = splitNdjsonLines(buffer);
    buffer = remainder;
    yield* parseNdjsonLines(lines);
  }
  const trailing = buffer.trim();
  if (!trailing) return;
  const parsed = parseNdjsonLine(trailing);
  if (parsed !== undefined) yield parsed; // else: final partial line was never completed — nothing usable to yield
}

/** Runs exactly one Ollama `/api/chat` NDJSON streaming request and reduces it into a single outcome. Mirrors `anthropic-messages.ts#runSingleAnthropicRequest`'s `emitEnd` contract — see that function's doc. */
async function runSingleOllamaRequest(
  options: OllamaTurnOptions,
  messages: readonly OllamaMessageParam[],
  emitEnd: (reason: OllamaTurnEndReason) => void,
): Promise<SingleRequestOutcome> {
  const { onEvent } = options;

  const body = await openOllamaResponseStream(options, messages, emitEnd);
  if (!body) {
    return { finishReason: null, toolCalls: [], text: '' };
  }

  onEvent({ type: 'status', label: 'requesting' });

  const state: OllamaStreamState = {
    guard: createRoleMarkerGuard('ollama-turn'),
    toolCalls: [],
    fullText: '',
    finishReason: null,
  };

  for await (const line of decodeNdjsonStream(body)) {
    if (!isRecord(line)) continue;
    const result = processOllamaLine(state, line, onEvent, emitEnd);
    if (result === 'break' || result === 'done') break;
  }

  if (state.finishReason === 'tool_calls') {
    emitPendingOllamaToolUseEvents(state.toolCalls, onEvent);
  }

  return { finishReason: state.finishReason, toolCalls: state.toolCalls, text: state.fullText };
}

/**
 * Decides why the tool loop should stop after one request, or returns `null` when it should
 * instead proceed to execute the pending tool calls — mirrors
 * `anthropic-messages.ts#anthropicLoopExitReason`'s pure decision/effect split.
 */
export function ollamaLoopExitReason(outcome: SingleRequestOutcome, toolTurns: number, maxToolTurns: number): OllamaTurnEndReason | null {
  if (outcome.finishReason !== 'tool_calls' || outcome.toolCalls.length === 0) return 'stop';
  if (toolTurns >= maxToolTurns) return 'max_tool_turns';
  return null;
}

/** Builds the assistant continuation's `tool_calls` field — Ollama's native shape has no `id`/`type` on the wire (see `OllamaToolCallParam`'s doc). */
export function buildOllamaAssistantToolCalls(toolCalls: readonly OllamaToolCall[]): OllamaToolCallParam[] {
  return toolCalls.map((call) => ({ function: { name: call.name, arguments: call.input } }));
}

/**
 * Runs every pending tool call in order, applying `guardToolResult` and reducing the results into
 * the `tool`-role continuation messages Ollama's native `tool_name`-association scheme expects —
 * see module doc's "Design decision: native `tool`-role images" section for why no separate
 * follow-up message is needed here, unlike `openai-chat.ts`/`azure-chat.ts`.
 */
export async function executeOllamaToolCalls(
  executeTool: OllamaToolExecutor,
  calls: readonly OllamaToolCall[],
  onEvent: (event: OllamaTurnEvent) => void,
): Promise<OllamaMessageParam[]> {
  const toolResultMessages: OllamaMessageParam[] = [];
  for (const call of calls) {
    const rawResult = await executeTool(call);
    const result = guardToolResult(rawResult);
    onEvent({
      type: 'tool_result',
      toolUseId: call.id,
      content: result.content,
      ...(result.images ? { images: result.images } : {}),
      isError: result.isError ?? false,
    });
    toolResultMessages.push({
      role: 'tool',
      content: result.content,
      tool_name: call.name,
      ...(result.images ? { images: result.images } : {}),
    });
  }
  return toolResultMessages;
}

/**
 * Runs a full Ollama native `/api/chat` turn, including the tool-execution
 * loop when `options.executeTool` is supplied and the model requests a
 * function call. See `anthropic-messages.ts#runAnthropicToolTurn`'s doc for
 * the shared event-stream/`ended`-flag contract this mirrors exactly.
 */
export async function runOllamaToolTurn(options: OllamaTurnOptions): Promise<OllamaTurnResult> {
  const maxToolTurns = options.maxToolTurns ?? DEFAULT_MAX_TOOL_TURNS;
  const executeTool = options.executeTool;

  const endGuard = createTurnEndGuard<OllamaTurnEvent>(options.onEvent, (reason) => ({ type: 'end', reason }));
  const emitEnd = endGuard.emitEnd;

  let messages = options.messages.slice();
  let toolTurns = 0;
  let lastFinishReason: string | null = null;

  while (true) {
    const outcome = await runSingleOllamaRequest(options, messages, emitEnd);
    lastFinishReason = outcome.finishReason;

    if (endGuard.hasEnded()) break;

    const exitReason = ollamaLoopExitReason(outcome, toolTurns, maxToolTurns);
    if (exitReason) {
      emitEnd(exitReason);
      break;
    }
    if (!executeTool) {
      emitEnd('stop');
      break;
    }
    toolTurns += 1;

    const assistantToolCalls = buildOllamaAssistantToolCalls(outcome.toolCalls);
    const toolResultMessages = await executeOllamaToolCalls(executeTool, outcome.toolCalls, options.onEvent);

    messages = [
      ...messages,
      { role: 'assistant', content: outcome.text || null, tool_calls: assistantToolCalls },
      ...toolResultMessages,
    ];
  }

  return { finishReason: lastFinishReason, toolTurns };
}
