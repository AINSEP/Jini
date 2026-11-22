import { type OpenAiContentPart, type OpenAiToolResult, type OpenAiTextPart, type OpenAiImageUrlPart, type OpenAiMessageParam, type OpenAiToolExecutor, type OpenAiToolCall, type OpenAiTurnEvent, type OpenAiToolCallParam } from './openai-chat-types.js';
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
export function invalidOpenAiContentPartReason({ part }: { part: OpenAiContentPart }, _optional: Record<string, never> = {}): string | null {
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
export function sanitizeOpenAiToolResult({ result }: { result: OpenAiToolResult }, _optional: Record<string, never> = {}): SanitizedOpenAiToolResult {
  if (typeof result.content === 'string') return { content: result.content, isError: false };
  if (result.content.length > MAX_IMAGES_PER_OPENAI_TOOL_RESULT) {
    return { content: `tool result rejected: exceeds the ${MAX_IMAGES_PER_OPENAI_TOOL_RESULT}-image-per-request guard (${result.content.length} parts)`, isError: true };
  }
  for (const part of result.content) {
    const reason = invalidOpenAiContentPartReason({ part: part });
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
export function splitOpenAiToolResultContent({ content }: { content: string | readonly OpenAiContentPart[] }, _optional: Record<string, never> = {}): SplitOpenAiToolResultContent {
  if (typeof content === 'string') return { toolMessageContent: content, imageParts: [] };
  const textParts = content.filter((part): part is OpenAiTextPart => part.type === 'text');
  const imageParts = content.filter((part): part is OpenAiImageUrlPart => part.type === 'image_url');
  const toolMessageContent: readonly OpenAiTextPart[] =
    textParts.length > 0 ? textParts : [{ type: 'text', text: '(tool result included only non-text content; see the following message)' }];
  return { toolMessageContent, imageParts };
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
export async function executeOpenAiToolCalls({ executeTool, calls, onEvent }: { executeTool: OpenAiToolExecutor; calls: readonly OpenAiToolCall[]; onEvent: (event: OpenAiTurnEvent) => void }, _optional: Record<string, never> = {}
): Promise<OpenAiToolExecutionOutcome> {
  const toolResultMessages: OpenAiMessageParam[] = [];
  const followUpParts: OpenAiContentPart[] = [];
  for (const call of calls) {
    const result = await executeTool(call);
    const sanitized = sanitizeOpenAiToolResult({ result: result });
    onEvent({ type: 'tool_result', toolUseId: call.id, content: sanitized.content, isError: sanitized.isError });
    const split = splitOpenAiToolResultContent({ content: sanitized.content });
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
export function buildOpenAiAssistantToolCallMessage({ text, toolCalls }: { text: string; toolCalls: readonly OpenAiToolCallParam[] }, _optional: Record<string, never> = {}): OpenAiMessageParam {
  return { role: 'assistant', content: text || null, tool_calls: toolCalls };
}

/** Appends the batch's `tool` messages plus, when present, the single labeled-image follow-up message — see module doc's "Tool messages cannot carry an image" section for why the follow-up is at most one message per batch. */
export function buildOpenAiToolExchangeMessages({ toolResultMessages, followUpParts }: { toolResultMessages: readonly OpenAiMessageParam[]; followUpParts: readonly OpenAiContentPart[] }, _optional: Record<string, never> = {}): OpenAiMessageParam[] {
  return [...toolResultMessages, ...(followUpParts.length > 0 ? [{ role: 'user' as const, content: followUpParts }] : [])];
}
