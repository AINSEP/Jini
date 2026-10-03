import { runAnthropicToolTurn, type AnthropicMessageParam, type AnthropicToolCall, type AnthropicToolResultContentBlock, type AnthropicToolDef } from './anthropic-messages.js';
import { runAzureToolTurn, type AzureContentPart, type AzureFunctionToolDef, type AzureMessageParam, type AzureToolCall } from './azure-chat.js';
import { runGoogleToolTurn, type GoogleContent, type GoogleToolCall, type GoogleToolDef, type GoogleToolResultPart } from './google-messages.js';
import { runOpenAiToolTurn, type OpenAiContentPart, type OpenAiFunctionToolDef, type OpenAiMessageParam, type OpenAiToolCall } from './openai-chat.js';
import type { ProviderTurnAdapters, ProviderTurnEvent, ProviderToolResult, ProviderToolDescriptor, ProviderToolTurnInput, ProviderToolTurnResult, ProviderToolTurnOptions } from './tool-turn-types.js';
import { googleParametersOf, findNumericEnumPaths, coerceNumericEnumStringsToNumbers } from './google-schema.js';
export type * from './tool-turn-types.js';
export { googleParametersOf, sanitizeGoogleSchema, findNumericEnumPaths, coerceNumericEnumStringsToNumbers } from './google-schema.js';
/** Existing provider loops, ready for host composition; callers may replace any adapter. */
export const providerTurnAdapters: ProviderTurnAdapters = Object.freeze({ anthropic: runAnthropicToolTurn, openai: runOpenAiToolTurn, azure: runAzureToolTurn, google: runGoogleToolTurn });
type InternalTurnInput = ProviderToolTurnInput & ProviderToolTurnOptions;
const TOOL_ERROR_PREFIX = "[tool error] ";
type AnthropicImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
function toAnthropicToolContent(content: ProviderToolResult["content"]): string | AnthropicToolResultContentBlock[] {
  if (typeof content === "string")
    return content;
  return content.map((block) => block.type === "text"
    ? { type: "text", text: block.text }
    : { type: "image", source: { type: "base64", media_type: block.mimeType as AnthropicImageMediaType, data: block.data } });
}
function toOpenAiToolContent(content: ProviderToolResult["content"]): string | OpenAiContentPart[] {
  if (typeof content === "string")
    return content;
  return content.map((block) => block.type === "text" ? { type: "text", text: block.text } : { type: "image_url", image_url: { url: `data:${block.mimeType};base64,${block.data}` } });
}
function toGoogleToolContent(content: ProviderToolResult["content"]): string | GoogleToolResultPart[] {
  if (typeof content === "string")
    return content;
  return content.map((block) => (block.type === "text" ? { text: block.text } : { inlineData: { mimeType: block.mimeType, data: block.data } }));
}
function foldToolError(content: string | OpenAiContentPart[], isError: boolean | undefined): string | OpenAiContentPart[] {
  if (!isError)
    return content;
  return typeof content === "string" ? `${TOOL_ERROR_PREFIX}${content}` : [{ type: "text", text: TOOL_ERROR_PREFIX.trimEnd() }, ...content];
}
function imagePartMimeType(part: Record<string, unknown>): string | null {
  const source = part.source as {
    media_type?: unknown;
  } | undefined;
  if (part.type === "image" && typeof source?.media_type === "string")
    return source.media_type;
  const imageUrl = part.image_url as {
    url?: unknown;
  } | undefined;
  if (part.type === "image_url" && typeof imageUrl?.url === "string")
    return /^data:([^;,]+)/.exec(imageUrl.url)?.[1] ?? "url";
  const inlineData = part.inlineData as {
    mimeType?: unknown;
  } | undefined;
  if (typeof inlineData?.mimeType === "string")
    return inlineData.mimeType;
  return null;
}
function describeToolResultContent(content: unknown): string {
  if (typeof content === "string")
    return content;
  if (!Array.isArray(content))
    return JSON.stringify(content);
  return content
    .map((part: Record<string, unknown>) => {
      if (typeof part.text === "string")
        return part.text;
      const mimeType = imagePartMimeType(part);
      return mimeType === null ? JSON.stringify(part) : `[image: ${mimeType}]`;
    })
    .join("\n");
}
function inputSchemaOf(descriptor: ProviderToolDescriptor): Record<string, unknown> {
  return descriptor.inputSchema && typeof descriptor.inputSchema === "object"
    ? (descriptor.inputSchema as Record<string, unknown>)
    : { type: "object", additionalProperties: false, required: [], properties: {} };
}
function normalizeTurnResult(result: {
  stopReason?: string | null;
  finishReason?: string | null;
  toolTurns: number;
}, capturedEndReason: string | null = null): ProviderToolTurnResult {
  return { stopReason: capturedEndReason ?? result.stopReason ?? result.finishReason ?? null, toolTurns: result.toolTurns };
}
async function runAnthropicTurn(input: InternalTurnInput): Promise<ProviderToolTurnResult> {
  const tools: AnthropicToolDef[] = input.tools.map((d) => ({
    name: d.id,
    ...(d.description !== undefined ? { description: d.description } : {}),
    input_schema: inputSchemaOf(d),
  }));
  const messages: AnthropicMessageParam[] = input.messages.map((m) => ({ role: m.role, content: m.content }));
  const executeTool = async (call: AnthropicToolCall) => {
    const result = await input.executeTool({ id: call.id, name: call.name, input: call.input });
    return { content: toAnthropicToolContent(result.content), ...(result.isError !== undefined ? { isError: result.isError } : {}) };
  };
  let capturedEndReason: string | null = null;
  const result = await (({ apiKey, model, messages, maxTokens, onEvent, ...optionalArgs }: Parameters<typeof input.adapters.anthropic>[0] & NonNullable<Parameters<typeof input.adapters.anthropic>[1]>) => input.adapters.anthropic({ apiKey, model, messages, maxTokens, onEvent }, optionalArgs))({
    apiKey: input.apiKey,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    model: input.model,
    system: input.system,
    messages,
    tools,
    maxTokens: input.maxTokens ?? 8192,
    ...(input.maxToolTurns !== undefined ? { maxToolTurns: input.maxToolTurns } : {}),
    executeTool,
    ...(input.signal ? { signal: input.signal } : {}),
    onEvent: (event) => {
      if (event.type === "fabricated_role_marker")
        return;
      if (event.type === "end")
        capturedEndReason = event.reason;
      if (event.type === "tool_result") {
        input.onEvent({
          type: "tool_result",
          toolUseId: event.toolUseId,
          content: describeToolResultContent(event.content),
          isError: event.isError,
        });
        return;
      }
      input.onEvent(event as ProviderTurnEvent);
    },
  });
  return normalizeTurnResult(result, capturedEndReason);
}
async function runOpenAiTurn(input: InternalTurnInput): Promise<ProviderToolTurnResult> {
  const tools: OpenAiFunctionToolDef[] = input.tools.map((d) => ({
    type: "function",
    function: { name: d.id, ...(d.description !== undefined ? { description: d.description } : {}), parameters: inputSchemaOf(d) },
  }));
  const messages: OpenAiMessageParam[] = [
    { role: "system", content: input.system },
    ...input.messages.map((m) => ({ role: m.role, content: m.content }) as OpenAiMessageParam),
  ];
  const executeTool = async (call: OpenAiToolCall) => {
    const result = await input.executeTool({ id: call.id, name: call.name, input: call.input });
    return { content: foldToolError(toOpenAiToolContent(result.content), result.isError) };
  };
  let capturedEndReason: string | null = null;
  const result = await (({ apiKey, model, messages, onEvent, ...optionalArgs }: Parameters<typeof input.adapters.openai>[0] & NonNullable<Parameters<typeof input.adapters.openai>[1]>) => input.adapters.openai({ apiKey, model, messages, onEvent }, optionalArgs))({
    apiKey: input.apiKey,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    model: input.model,
    messages,
    tools,
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    ...(input.maxToolTurns !== undefined ? { maxToolTurns: input.maxToolTurns } : {}),
    executeTool,
    ...(input.signal ? { signal: input.signal } : {}),
    onEvent: (event) => {
      if (event.type === "fabricated_role_marker")
        return;
      if (event.type === "end")
        capturedEndReason = event.reason;
      if (event.type === "tool_result") {
        const content = describeToolResultContent(event.content);
        input.onEvent({ type: "tool_result", toolUseId: event.toolUseId, content, isError: event.isError || content.startsWith(TOOL_ERROR_PREFIX.trimEnd()) });
        return;
      }
      input.onEvent(event as ProviderTurnEvent);
    },
  });
  return normalizeTurnResult(result, capturedEndReason);
}
async function runAzureTurn(input: InternalTurnInput): Promise<ProviderToolTurnResult> {
  if (!input.baseUrl) {
    input.onEvent({ type: "error", message: "the azure protocol requires a base URL (each Azure OpenAI resource has its own endpoint)" });
    input.onEvent({ type: "end", reason: "error" });
    return { stopReason: "error", toolTurns: 0 };
  }
  const tools: AzureFunctionToolDef[] = input.tools.map((d) => ({
    type: "function",
    function: { name: d.id, ...(d.description !== undefined ? { description: d.description } : {}), parameters: inputSchemaOf(d) },
  }));
  const messages: AzureMessageParam[] = [
    { role: "system", content: input.system },
    ...input.messages.map((m) => ({ role: m.role, content: m.content }) as AzureMessageParam),
  ];
  const executeTool = async (call: AzureToolCall) => {
    const result = await input.executeTool({ id: call.id, name: call.name, input: call.input });
    return { content: foldToolError(toOpenAiToolContent(result.content), result.isError) as string | AzureContentPart[] };
  };
  let capturedEndReason: string | null = null;
  const result = await (({ apiKey, baseUrl, model, messages, onEvent, ...optionalArgs }: Parameters<typeof input.adapters.azure>[0] & NonNullable<Parameters<typeof input.adapters.azure>[1]>) => input.adapters.azure({ apiKey, baseUrl, model, messages, onEvent }, optionalArgs))({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    model: input.model,
    messages,
    tools,
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    ...(input.maxToolTurns !== undefined ? { maxToolTurns: input.maxToolTurns } : {}),
    executeTool,
    ...(input.signal ? { signal: input.signal } : {}),
    onEvent: (event) => {
      if (event.type === "fabricated_role_marker")
        return;
      if (event.type === "end")
        capturedEndReason = event.reason;
      if (event.type === "tool_result") {
        const content = describeToolResultContent(event.content);
        input.onEvent({ type: "tool_result", toolUseId: event.toolUseId, content, isError: event.isError || content.startsWith(TOOL_ERROR_PREFIX.trimEnd()) });
        return;
      }
      input.onEvent(event as ProviderTurnEvent);
    },
  });
  return normalizeTurnResult(result, capturedEndReason);
}
async function runGoogleTurn(input: InternalTurnInput): Promise<ProviderToolTurnResult> {
  const tools: GoogleToolDef[] = [
    { functionDeclarations: input.tools.map((d) => ({ name: d.id, ...(d.description !== undefined ? { description: d.description } : {}), parameters: googleParametersOf({ descriptor: d }) })) },
  ];
  const numericEnumPathsByToolName = new Map<string, readonly string[]>(input.tools.map((d) => [d.id, findNumericEnumPaths({ schema: inputSchemaOf(d) })]));
  const contents: GoogleContent[] = input.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const executeTool = async (call: GoogleToolCall) => {
    const coercedInput = coerceNumericEnumStringsToNumbers({ input: call.input, paths: numericEnumPathsByToolName.get(call.name) ?? [] });
    const result = await input.executeTool({ id: call.id, name: call.name, input: coercedInput });
    return { content: toGoogleToolContent(result.content), ...(result.isError !== undefined ? { isError: result.isError } : {}) };
  };
  let capturedEndReason: string | null = null;
  const result = await (({ apiKey, model, contents, onEvent, ...optionalArgs }: Parameters<typeof input.adapters.google>[0] & NonNullable<Parameters<typeof input.adapters.google>[1]>) => input.adapters.google({ apiKey, model, contents, onEvent }, optionalArgs))({
    apiKey: input.apiKey,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    model: input.model,
    system: input.system,
    contents,
    tools,
    ...(input.maxTokens !== undefined ? { maxOutputTokens: input.maxTokens } : {}),
    ...(input.maxToolTurns !== undefined ? { maxToolTurns: input.maxToolTurns } : {}),
    executeTool,
    ...(input.signal ? { signal: input.signal } : {}),
    onEvent: (event) => {
      if (event.type === "fabricated_role_marker")
        return;
      if (event.type === "end")
        capturedEndReason = event.reason;
      if (event.type === "tool_result") {
        input.onEvent({
          type: "tool_result",
          toolUseId: event.toolUseId,
          content: describeToolResultContent(event.content),
          isError: event.isError,
        });
        return;
      }
      input.onEvent(event as ProviderTurnEvent);
    },
  });
  return normalizeTurnResult(result, capturedEndReason);
}
/** Runs one provider-neutral turn through the supplied adapters. The adapter end event takes precedence over a raw provider stop code.
 * Local mapping is proportional to the descriptors, expanded schemas and emitted result parts; request and loop cost belongs to the adapter ports.
 */
export async function runProviderToolTurn(required: ProviderToolTurnInput, optional: ProviderToolTurnOptions = {}): Promise<ProviderToolTurnResult> {
  const input: InternalTurnInput = { ...optional, ...required };
  switch (input.protocol) {
    case "anthropic":
      return runAnthropicTurn(input);
    case "openai":
      return runOpenAiTurn(input);
    case "azure":
      return runAzureTurn(input);
    case "google":
      return runGoogleTurn(input);
  }
}
