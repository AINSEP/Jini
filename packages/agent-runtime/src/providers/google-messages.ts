/**
 * @module providers/google-messages
 *
 * Google Generative Language (Gemini) `streamGenerateContent` wire adapter +
 * tool-loop turn-runner. Sibling of `anthropic-messages.ts`/`openai-chat.ts`
 * — see those modules' headers for the shared design rationale (package
 * placement, `extraHeaders` never carrying a hardcoded product-identity
 * string, the `turn-end-guard.ts` fix for a duplicate-`end`-event class of
 * bug). Reuses this package's existing `providers/google.ts` URL helpers
 * (`googleStreamGenerateContentUrl`) rather than rebuilding URL-building
 * logic — see that module's own doc.
 *
 * **Verified against Google's real, current public API docs** (per this
 * repo's "verify against real API docs, don't guess from memory"
 * convention — see `anthropic-messages.ts`'s header for the precedent).
 * Two things worth flagging for a future maintainer:
 *
 * 1. **Two REST APIs coexist as of this writing.** Google's docs now lead
 *    with a newer `interactions` API (`POST /v1beta/interactions`,
 *    `input`/`previous_interaction_id`/`function_result` shaped) alongside
 *    the classic `generateContent`/`streamGenerateContent` API
 *    (`contents: [{role, parts}]`, `functionCall`/`functionResponse`
 *    parts). This adapter deliberately targets the **classic** API — it is
 *    what `providers/google.ts#googleStreamGenerateContentUrl` already
 *    builds a URL for, and what this task's spec calls for. Confirmed via
 *    `ai.google.dev/api/generate-content` (Content/Part/GenerateContent
 *    Request/Response field names) and a live web search returning a
 *    real-world function-calling exchange showing the exact
 *    `{ functionResponse: { name, response, id } }` shape sent back with
 *    `role: 'user'` (not `role: 'function'` — there is no `function` role
 *    in the classic Content schema; `role` is `'user' | 'model' | 'system'`
 *    only).
 * 2. **No `finishReason` value means "the model wants a tool call."**
 *    Unlike Anthropic (`stop_reason: 'tool_use'`) and OpenAI
 *    (`finish_reason: 'tool_calls'`), Gemini's documented `finishReason`
 *    enum (`STOP`, `MAX_TOKENS`, `SAFETY`, `RECITATION`, `LANGUAGE`,
 *    `OTHER`) has no tool-call-specific member — a function call is simply
 *    a `functionCall` part inside an otherwise normal (often
 *    `finishReason: 'STOP'`) candidate. `runGoogleToolTurn`'s tool-loop
 *    continuation predicate is therefore `toolCalls.length > 0`, not a
 *    `finishReason` comparison — the one structural place this adapter
 *    cannot mirror `anthropic-messages.ts`/`openai-chat.ts` byte-for-byte.
 *
 * **Scope for this pass:** text + function-call parts, `inlineData` image
 * parts, and the tool-execution loop. `fileData` parts (the Files-API
 * reference form, for content too large to inline) and `promptFeedback`'s
 * per-category safety ratings are still out of scope — a blocked prompt
 * (`promptFeedback.blockReason` present, no candidates) is still surfaced as
 * an `error` event rather than silently hanging, but the detailed
 * safety-rating breakdown is not modeled.
 *
 * **Image support**: `inlineData: {mimeType, data}` (base64) — canonical
 * proto3 JSON field names confirmed via `ai.google.dev/api/rest/v1beta/
 * Content` (`inline_data`/`mime_type` also parse, per proto3's JSON mapping,
 * but this module sends the camelCase canonical form to match every other
 * field it already sends: `functionCall`, `functionResponse`,
 * `usageMetadata`, etc.). Supported formats and the 20 MB total-inline-
 * request budget (text + system instructions + inline bytes combined) per
 * `ai.google.dev/gemini-api/docs/image-understanding` — see
 * `MAX_INLINE_IMAGE_BASE64_CHARS`'s doc for how this module applies that
 * budget per-image.
 *
 * **No documented way to attach an image to a `functionResponse` in this
 * (classic) API.** Checked `ai.google.dev/api/rest/v1beta/Content` and
 * `ai.google.dev/gemini-api/docs/image-understanding` directly for a
 * `FunctionResponse.parts` field or similar — neither documents one; images
 * are only documented as ordinary `Content` input. (A "multimodal function
 * response" feature does exist under `ai.google.dev/gemini-api/docs/
 * function-calling`, but confirmed to belong exclusively to the newer
 * `interactions` API this module already deliberately excludes — see the
 * "Two REST APIs coexist" note above; its `result`/`function_result` shape
 * does not apply here.) So a tool result carrying an image keeps
 * `functionResponse.response` as a plain string (same shape as before), and
 * `runGoogleToolTurn` appends the image as ordinary `inlineData` parts in
 * the *same* `role: 'user'` `Content` alongside the `functionResponse` parts
 * — unlike `openai-chat.ts`, which is forced onto a separate follow-up
 * message because OpenAI's wire `tool` role is hard-restricted to text.
 * Gemini's `Content.parts` has no such restriction: it is just an ordered
 * list of `Part` union members, so mixing `functionResponse` and
 * `inlineData` parts in one `Content` is exactly the same pattern this
 * module already uses for `modelParts` (text + `functionCall` together).
 *
 * **This is still a workaround for a real protocol limitation, not this module inventing
 * structure** — Anthropic's `tool_result` content block can carry an image natively and needs no
 * such fold (see `anthropic-messages.ts`). Both `openai-chat.ts`'s separate-message form and this
 * module's same-`Content` form exist for the identical underlying reason: `FunctionResponse`/`tool`
 * has no documented image slot, so the image has to travel some other way. Each `inlineData` part
 * appended this way is preceded by a plain-text label naming the tool call it answers (name + id)
 * — an unlabeled image is otherwise indistinguishable from a human-supplied one, which in a vision
 * self-check loop risks the model treating its own tool's output as a new user turn. When a batch
 * has parallel tool calls, ALL `functionResponse` parts for the batch are assembled first and every
 * labeled image is appended after them, in one `Content` — never one `Content` per tool result —
 * matching this module's existing single-continuation-turn shape (see `runGoogleToolTurn`'s
 * tool-loop body and its test file's multi-tool-call image test).
 */
import { createRoleMarkerGuard } from '../role-marker-guard.js';
import { defaultDnsLookup, pinnedFetch, redactSecrets, validateBaseUrlResolved } from './connection-guard.js';
import { googleStreamGenerateContentUrl } from './google.js';
import { decodeSseStream } from './sse-decode.js';
import { createTurnEndGuard, type TurnEndReason } from './turn-end-guard.js';

export interface GoogleTextPart {
  readonly text: string;
}

/** Base64 inline image (or other binary) data. Canonical camelCase field names — see module doc's "Image support" section for the verified proto3 JSON mapping. */
export interface GoogleInlineDataPart {
  readonly inlineData: {
    readonly mimeType: string;
    readonly data: string;
  };
}

export interface GoogleFunctionCallPart {
  readonly functionCall: {
    readonly name: string;
    readonly args: unknown;
    readonly id?: string;
  };
  /**
   * An opaque, encrypted handle on the model's reasoning for this call. A SIBLING of `functionCall`
   * on the same `Part`, not a field inside it — verified against a live response, not inferred:
   *
   * ```json
   * { "functionCall": { "name": "render_preview", "args": {}, "id": "UgFzM3QW" },
   *   "thoughtSignature": "EukCCuYCARFNMg+HEX+iufpVJfgG..." }
   * ```
   *
   * **Required on the continuation request.** Omitting it makes every currently-served Gemini model
   * reject the follow-up with HTTP 400:
   *
   * > Function call is missing a thought_signature in functionCall parts. This is required for
   * > tools to work correctly … Additional data, function call `default_api:<name>`, position 2.
   *
   * so the whole tool loop fails before the model evaluates anything. Note the wire key is
   * camelCase `thoughtSignature` even though the error message spells it `thought_signature`.
   *
   * Treated as **opaque and echoed back verbatim** — never parsed, normalized, or synthesized. It
   * is encrypted model state; a value we invent is not a weaker signature, it is an invalid one.
   * Optional because a model may return a `functionCall` without one (older models, and non-thinking
   * paths), and in that case the correct continuation omits the field rather than sending an empty
   * string.
   */
  readonly thoughtSignature?: string;
}

export interface GoogleFunctionResponsePart {
  readonly functionResponse: {
    readonly name: string;
    readonly response: unknown;
    readonly id?: string;
  };
}

export type GooglePart = GoogleTextPart | GoogleInlineDataPart | GoogleFunctionCallPart | GoogleFunctionResponsePart;

/** The subset of `GooglePart` a tool result may legally carry — no `functionCall`/`functionResponse` part makes sense as a tool's own output. */
export type GoogleToolResultPart = GoogleTextPart | GoogleInlineDataPart;

export interface GoogleContent {
  readonly role: 'user' | 'model';
  readonly parts: readonly GooglePart[];
}

export interface GoogleFunctionDeclaration {
  readonly name: string;
  readonly description?: string;
  readonly parameters: Record<string, unknown>;
}

export interface GoogleToolDef {
  readonly functionDeclarations: readonly GoogleFunctionDeclaration[];
}

export interface GoogleToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  /** Carried from the response `Part` to the continuation `Part` untouched — see
   *  `GoogleFunctionCallPart.thoughtSignature` for why omitting it breaks the whole tool loop. */
  readonly thoughtSignature?: string;
}

/** `content` may include `GoogleInlineDataPart`s (e.g. a vision self-check's screenshot) — `runGoogleToolTurn` folds them into the continuation `Content`'s `parts` alongside the `functionResponse`; see module doc's "No documented way to attach an image to a functionResponse" section. */
export interface GoogleToolResult {
  readonly content: string | readonly GoogleToolResultPart[];
  readonly isError?: boolean;
}

/** Host-owned tool execution — same "the collaborator is always supplied" convention as `anthropic-messages.ts#AnthropicToolExecutor`. */
export type GoogleToolExecutor = (call: GoogleToolCall) => Promise<GoogleToolResult>;

/** Why a `runGoogleToolTurn` call ended its event stream. */
export type GoogleTurnEndReason = TurnEndReason;

export type GoogleTurnEvent =
  | { readonly type: 'status'; readonly label: string }
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: 'tool_result'; readonly toolUseId: string; readonly content: string | readonly GoogleToolResultPart[]; readonly isError: boolean }
  | { readonly type: 'usage'; readonly usage: Record<string, unknown> | null }
  | { readonly type: 'fabricated_role_marker'; readonly marker: string; readonly messageId: string }
  | { readonly type: 'error'; readonly message: string; readonly code?: string }
  | { readonly type: 'end'; readonly reason: GoogleTurnEndReason };

export interface GoogleTurnOptions {
  readonly apiKey: string;
  /** Defaults to `https://generativelanguage.googleapis.com`. Overridable for BYOK-compatible gateways. */
  readonly baseUrl?: string;
  readonly model: string;
  readonly system?: string;
  readonly contents: readonly GoogleContent[];
  readonly tools?: readonly GoogleToolDef[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  /** Same bound and rationale as `AnthropicTurnOptions.maxToolTurns`. Defaults to 8. */
  readonly maxToolTurns?: number;
  readonly executeTool?: GoogleToolExecutor;
  readonly onEvent: (event: GoogleTurnEvent) => void;
  readonly signal?: AbortSignal;
  /** Caller-supplied extra headers — see `anthropic-messages.ts#AnthropicTurnOptions.extraHeaders`'s doc for why this exists and what it fixes. */
  readonly extraHeaders?: Record<string, string>;
}

export interface GoogleTurnResult {
  readonly finishReason: string | null;
  readonly toolTurns: number;
}

const DEFAULT_GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_MAX_TOOL_TURNS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds the streaming request URL with no credential attached — auth travels via the
 * `x-goog-api-key` header (see `googleHeaders`), not a `?key=` query param.
 *
 * **Corrected to match Open Design's real behavior**: an earlier version of this function
 * attached `apiKey` as a `?key=` query-string parameter, modeled on `google.ts#googleProviderModelsUrl`'s
 * model-*listing* endpoint (a different, read-only surface). A live side-by-side comparison
 * against a running OD daemon found its actual `/api/proxy/google/stream` chat handler
 * (`apps/daemon/src/routes/chat.ts:1251`) uses `headers: { 'x-goog-api-key': apiKey }` instead —
 * query-string credentials are also worse practice generically (they land in server access logs,
 * proxy logs, and browser history far more readily than headers do), so this fix is both a real
 * parity correction and a real hardening.
 */
function googleRequestUrl(baseUrl: string | undefined, model: string): string {
  return googleStreamGenerateContentUrl(baseUrl ?? DEFAULT_GOOGLE_BASE_URL, model);
}

function googleHeaders(options: GoogleTurnOptions): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-goog-api-key': options.apiKey,
    ...(options.extraHeaders ?? {}),
  };
}

function googleRequestBody(options: GoogleTurnOptions, contents: readonly GoogleContent[]): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
  };
  return {
    contents,
    ...(options.system !== undefined ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
    ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  };
}

function extractGoogleErrorDetail(rawText: string): string {
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

interface SingleRequestOutcome {
  readonly finishReason: string | null;
  readonly toolCalls: readonly GoogleToolCall[];
  readonly text: string;
}

/** Runs exactly one Gemini `streamGenerateContent` request and reduces its SSE events into a single outcome. Mirrors `anthropic-messages.ts#runSingleAnthropicRequest`'s `emitEnd` contract — see that function's doc. */
async function runSingleGoogleRequest(
  options: GoogleTurnOptions,
  contents: readonly GoogleContent[],
  emitEnd: (reason: GoogleTurnEndReason) => void,
): Promise<SingleRequestOutcome> {
  const { onEvent } = options;

  const baseUrlCheck = await validateBaseUrlResolved(options.baseUrl ?? DEFAULT_GOOGLE_BASE_URL, defaultDnsLookup);
  if (baseUrlCheck.error) {
    onEvent({ type: 'error', message: baseUrlCheck.error });
    emitEnd('error');
    return { finishReason: null, toolCalls: [], text: '' };
  }

  let response: { ok: boolean; status: number; body: AsyncIterable<Uint8Array | string> | null; text(): Promise<string> };
  try {
    response = await pinnedFetch(
      googleRequestUrl(options.baseUrl, options.model),
      {
        method: 'POST',
        headers: googleHeaders(options),
        body: JSON.stringify(googleRequestBody(options, contents)),
        redirect: 'error',
        ...(options.signal ? { signal: options.signal } : {}),
      },
      baseUrlCheck.pinnedAddress,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onEvent({ type: 'error', message: redactSecrets(message, [options.apiKey]) });
    emitEnd('error');
    return { finishReason: null, toolCalls: [], text: '' };
  }

  if (!response.ok) {
    const rawText = await response.text();
    onEvent({
      type: 'error',
      message: redactSecrets(extractGoogleErrorDetail(rawText), [options.apiKey]),
      code: String(response.status),
    });
    emitEnd('error');
    return { finishReason: null, toolCalls: [], text: '' };
  }
  if (!response.body) {
    onEvent({ type: 'error', message: 'Google response had no body' });
    emitEnd('error');
    return { finishReason: null, toolCalls: [], text: '' };
  }

  onEvent({ type: 'status', label: 'requesting' });

  const guard = createRoleMarkerGuard('google-turn');
  const toolCalls: GoogleToolCall[] = [];
  let fullText = '';
  let finishReason: string | null = null;
  let usage: Record<string, unknown> | null = null;

  frameLoop: for await (const frame of decodeSseStream(response.body)) {
    // No re-check of an "ended" flag at the top of this loop: every `emitEnd(...)` call site below
    // (the promptFeedback block-reason branch and the contamination branch) is immediately followed
    // by `break frameLoop` — same reachability proof as `anthropic-messages.ts#runSingleAnthropicRequest`.
    let data: unknown;
    try {
      data = JSON.parse(frame.data);
    } catch {
      continue; // tolerate a malformed/empty keep-alive frame
    }
    if (!isRecord(data)) continue;

    if (isRecord(data.usageMetadata)) {
      usage = data.usageMetadata;
      onEvent({ type: 'usage', usage });
    }

    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const candidate = candidates[0];

    if (!candidate) {
      if (isRecord(data.promptFeedback) && typeof data.promptFeedback.blockReason === 'string') {
        onEvent({ type: 'error', message: `prompt blocked: ${data.promptFeedback.blockReason}`, code: data.promptFeedback.blockReason });
        emitEnd('error');
        break frameLoop;
      }
      continue;
    }
    if (!isRecord(candidate)) continue;

    if (typeof candidate.finishReason === 'string') {
      finishReason = candidate.finishReason;
    }

    const content = isRecord(candidate.content) ? candidate.content : null;
    const parts = content && Array.isArray(content.parts) ? content.parts : [];

    for (const rawPart of parts) {
      if (!isRecord(rawPart)) continue;

      if (typeof rawPart.text === 'string' && rawPart.text.length > 0) {
        // No `guard.contaminated` pre-check here: the only way it becomes true is the
        // `emitEnd('contaminated'); break frameLoop;` a few lines below, which exits the outer
        // frame loop immediately — see `anthropic-messages.ts#runSingleAnthropicRequest`'s
        // identical reachability proof.
        const safe = guard.feedText(rawPart.text);
        if (safe.length > 0) {
          fullText += safe;
          onEvent({ type: 'text_delta', delta: safe });
        }
        if (guard.contaminated) {
          const warn = guard.warningEvent();
          if (warn) onEvent(warn);
          emitEnd('contaminated');
          break frameLoop;
        }
        continue;
      }

      if (isRecord(rawPart.functionCall)) {
        const fc = rawPart.functionCall;
        const name = typeof fc.name === 'string' ? fc.name : null;
        if (name) {
          const id = typeof fc.id === 'string' && fc.id.length > 0 ? fc.id : `call_${toolCalls.length}`;
          // Read off the PART, not off `fc` — `thoughtSignature` is a sibling of `functionCall`,
          // not a member of it. Only a non-empty string is carried: a missing signature and an
          // empty one are different states, and the continuation must omit the field entirely
          // rather than send `""`, which the API treats as a malformed signature rather than as
          // "absent". See `GoogleFunctionCallPart.thoughtSignature`.
          const signature = typeof rawPart.thoughtSignature === 'string' && rawPart.thoughtSignature.length > 0
            ? rawPart.thoughtSignature
            : undefined;
          const call: GoogleToolCall = { id, name, input: fc.args ?? {}, ...(signature ? { thoughtSignature: signature } : {}) };
          toolCalls.push(call);
          onEvent({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
        }
      }
    }
  }

  return { finishReason, toolCalls, text: fullText };
}

const GOOGLE_ALLOWED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
]);

/**
 * Gemini documents a 20 MB total-inline-request budget — text prompts, system instructions, and
 * inline bytes combined (see module doc's "Image support" section) — not a per-image number. This
 * module applies that 20 MB figure per image as a conservative simplification: a real request
 * always also carries text, so a single inline image already at 20 MB leaves no room for anything
 * else, making per-image enforcement at this bound strictly more permissive than the documented
 * total ever allows in practice. No per-image count cap is enforced here (unlike
 * `openai-chat.ts#MAX_IMAGES_PER_OPENAI_TOOL_RESULT`) because Google does not document one for this
 * API. Approximated from the base64 *string* length, not decoded byte count — see
 * `anthropic-messages.ts#MAX_IMAGE_BASE64_CHARS`'s doc for why that's the right thing to measure.
 */
const MAX_INLINE_IMAGE_BASE64_CHARS = Math.ceil((20 * 1024 * 1024 * 4) / 3);

/**
 * Validates one tool-result part against Gemini's real format/size constraints. Returns the
 * violation reason, or `null` when the part is legal to send. Text parts are always legal — only
 * `inlineData` is format/size-checked.
 *
 * @complexity O(1) — reads `data.length`, never decodes or parses the base64 payload.
 */
function invalidGoogleToolResultPartReason(part: GoogleToolResultPart): string | null {
  if ('text' in part) return null;
  const { mimeType, data } = part.inlineData;
  if (!GOOGLE_ALLOWED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase())) {
    return `unsupported image mimeType ${JSON.stringify(mimeType)} (Gemini supports image/png, image/jpeg, image/webp, image/heic, image/heif)`;
  }
  if (data.length > MAX_INLINE_IMAGE_BASE64_CHARS) {
    return `image exceeds this adapter's 20 MB inline-data base64 size guard (${data.length} base64 chars)`;
  }
  return null;
}

interface SanitizedGoogleToolResult {
  readonly content: string | readonly GoogleToolResultPart[];
  readonly isError: boolean;
}

/**
 * Runtime guard applied to every `GoogleToolExecutor` result before it is wired onto the outbound
 * request or reported via `onEvent` — same rationale and posture as
 * `anthropic-messages.ts`'s/`openai-chat.ts`'s identical guards (`GoogleToolResult` is host-owned;
 * the TS content-part union only constrains a well-behaved host at compile time, not a buggy one at
 * runtime).
 *
 * @complexity O(n) in the number of content parts; O(1) per part (see `invalidGoogleToolResultPartReason`).
 */
function sanitizeGoogleToolResult(result: GoogleToolResult): SanitizedGoogleToolResult {
  const originalIsError = result.isError ?? false;
  if (typeof result.content === 'string') return { content: result.content, isError: originalIsError };
  for (const part of result.content) {
    const reason = invalidGoogleToolResultPartReason(part);
    if (reason) return { content: `tool result rejected: ${reason}`, isError: true };
  }
  return { content: result.content, isError: originalIsError };
}

interface SplitGoogleToolResultContent {
  /** Always a plain string — `functionResponse.response` is a generic JSON object with no documented way to carry a `Part`; see module doc's "No documented way to attach an image to a functionResponse" section. */
  readonly responseContent: string;
  readonly imageParts: readonly GoogleInlineDataPart[];
}

/**
 * Splits one (already-sanitized) tool result's content into the plain-string form
 * `functionResponse.response.content` requires, plus any `inlineData` parts that travel alongside
 * it in the same continuation `Content` — see `runGoogleToolTurn`'s call site.
 *
 * A string `content` is left untouched (`imageParts: []`) — this is the pre-existing, unchanged
 * path every current caller already exercises. For an array, text parts are joined in order; if
 * there is no text at all (an image-only result), a placeholder string is substituted so
 * `functionResponse.response.content` is never empty.
 *
 * @complexity O(n) in the number of content parts.
 */
function splitGoogleToolResultContent(content: string | readonly GoogleToolResultPart[]): SplitGoogleToolResultContent {
  if (typeof content === 'string') return { responseContent: content, imageParts: [] };
  const textParts = content.filter((part): part is GoogleTextPart => 'text' in part);
  const imageParts = content.filter((part): part is GoogleInlineDataPart => 'inlineData' in part);
  const responseContent =
    textParts.length > 0 ? textParts.map((part) => part.text).join('\n') : '(tool result included only non-text content; see the accompanying image parts)';
  return { responseContent, imageParts };
}

/**
 * Runs a full Gemini `streamGenerateContent` turn, including the
 * tool-execution loop when `options.executeTool` is supplied and the model
 * requests a function call. See `anthropic-messages.ts#runAnthropicToolTurn`'s
 * doc for the shared event-stream/`ended`-flag contract this mirrors — with
 * one deliberate structural difference: the loop-continuation predicate is
 * `toolCalls.length > 0`, not a `finishReason` comparison (see module doc,
 * point 2, for why Gemini's `finishReason` enum cannot be used here).
 */
export async function runGoogleToolTurn(options: GoogleTurnOptions): Promise<GoogleTurnResult> {
  const maxToolTurns = options.maxToolTurns ?? DEFAULT_MAX_TOOL_TURNS;

  const endGuard = createTurnEndGuard<GoogleTurnEvent>(options.onEvent, (reason) => ({ type: 'end', reason }));
  const emitEnd = endGuard.emitEnd;

  let contents = options.contents.slice();
  let toolTurns = 0;
  let lastFinishReason: string | null = null;

  while (true) {
    const outcome = await runSingleGoogleRequest(options, contents, emitEnd);
    lastFinishReason = outcome.finishReason;

    if (endGuard.hasEnded()) break;

    if (outcome.toolCalls.length === 0) {
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

    const modelParts: GooglePart[] = [
      ...(outcome.text ? [{ text: outcome.text } as const] : []),
      // `thoughtSignature` is spread back on as a SIBLING of `functionCall`, in the same shape the
      // response delivered it, and only when the response actually carried one — a `functionCall`
      // part with no signature is legal; one with an empty-string signature is not.
      ...outcome.toolCalls.map(
        (call) =>
          ({
            functionCall: { name: call.name, args: call.input, id: call.id },
            ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
          }) as const,
      ),
    ];
    const functionResponseParts: GooglePart[] = [];
    // Every `functionResponse` part for this batch is pushed here first; the labeled image parts
    // below are only ever folded into the SAME single continuation `Content`, after the loop —
    // matching `openai-chat.ts`'s batching discipline even though Gemini's wire format doesn't
    // strictly require it (see module doc for why this module still does it this way).
    const followUpParts: GooglePart[] = [];
    for (const call of outcome.toolCalls) {
      const result = await options.executeTool(call);
      const sanitized = sanitizeGoogleToolResult(result);
      options.onEvent({ type: 'tool_result', toolUseId: call.id, content: sanitized.content, isError: sanitized.isError });
      const split = splitGoogleToolResultContent(sanitized.content);
      functionResponseParts.push({
        functionResponse: {
          name: call.name,
          id: call.id,
          response: { content: split.responseContent, isError: sanitized.isError },
        },
      });
      if (split.imageParts.length > 0) {
        // Attribution label — see module doc for why an unlabeled image is unsafe here.
        followUpParts.push({ text: `Image output from tool \`${call.name}\` (tool_call_id: ${call.id}):` });
        followUpParts.push(...split.imageParts);
      }
    }

    contents = [
      ...contents,
      { role: 'model', parts: modelParts },
      // `inlineData` parts ride in the same `Content` as the `functionResponse` parts they belong
      // to — no separate follow-up message needed here, unlike `openai-chat.ts` (see module doc's
      // "No documented way to attach an image to a functionResponse" section for why).
      { role: 'user', parts: [...functionResponseParts, ...followUpParts] },
    ];
  }

  return { finishReason: lastFinishReason, toolTurns };
}
