import { runAnthropicToolTurn, type AnthropicMessageParam, type AnthropicToolCall, type AnthropicToolResultContentBlock, type AnthropicToolDef } from './anthropic-messages.js';
import { runAzureToolTurn } from './azure-chat.js';
import { runGoogleToolTurn, type GoogleContent, type GoogleToolCall, type GoogleToolDef, type GoogleToolResultPart } from './google-messages.js';
import { runOpenAiToolTurn, type OpenAiContentPart, type OpenAiFunctionToolDef, type OpenAiMessageParam, type OpenAiToolCall } from './openai-chat.js';
import type { ProviderTurnAdapters, ProviderTurnEvent, ProviderToolCall, ProviderToolResult, ProviderToolDescriptor, ProviderToolTurnInput, ProviderToolTurnResult, ProviderToolTurnOptions, ProviderToolSnapshotOptions } from './tool-turn-types.js';
import { createToolNameMap } from '@jini-ai/core';
import { compileOperationSchema, type CompiledOperationSchema } from './operation-schema.js';
export type * from './tool-turn-types.js';
export { compileOperationSchema } from './operation-schema.js';
export type { CompiledOperationSchema, OperationSchemaFallbackReason } from './operation-schema.js';
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
function imageUrlMimeType({ url }: { url: string }, _options = {}): string {
  return /^data:([^;,]+)/.exec(url)?.[1] ?? "url";
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
    return imageUrlMimeType({ url: imageUrl.url });
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
interface ProjectedTool {
  readonly name: string;
  readonly description?: string;
  readonly operation: CompiledOperationSchema;
}
interface PublishedTool { readonly id: string; readonly operation: CompiledOperationSchema }
/** Invalid snapshot names fail closed before an adapter can dispatch an ambiguous operation. */
export class ProviderToolProjectionError extends Error {
  readonly code = 'invalid-wire-name';
  constructor(_required: Record<string, never>, options: ErrorOptions = {}) {
    super('Invalid or conflicting tool wire name', options);
    this.name = 'ProviderToolProjectionError';
  }
}
function pinWireName(descriptor: ProviderToolDescriptor, names: Map<string, string>, occupied: Map<string, string>): void {
  if (descriptor.wireName === undefined) return;
  const existing = names.get(descriptor.id);
  const owner = occupied.get(descriptor.wireName);
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(descriptor.wireName)) throw new ProviderToolProjectionError({});
  if (existing !== undefined && existing !== descriptor.wireName) throw new ProviderToolProjectionError({});
  if (owner !== undefined && owner !== descriptor.id) throw new ProviderToolProjectionError({});
  names.set(descriptor.id, descriptor.wireName);
  occupied.set(descriptor.wireName, descriptor.id);
}
function pinWireNames(descriptors: readonly ProviderToolDescriptor[], names: Map<string, string>): void {
  const occupied = new Map([...names].map(([id, name]) => [name, id]));
  for (const descriptor of descriptors) pinWireName(descriptor, names, occupied);
  const pending = descriptors.filter(descriptor => !names.has(descriptor.id));
  const mapping = createToolNameMap({ toolIds: pending.map(descriptor => descriptor.id) }, { reservedNames: [...occupied.keys()] });
  for (const descriptor of pending) names.set(descriptor.id, mapping.wireNameFor({ toolId: descriptor.id })!);
}
/** Per-turn projection state only; the host registry/executor retains definition and policy ownership.
 * Names and previously published decoders survive refresh so in-flight calls remain resolvable.
 * Snapshot work is O(n log n + s) for n IDs and s bounded expanded schema nodes; host ports own I/O.
 */
function createToolProjection(input: InternalTurnInput, _options = {}) {
  const names = new Map<string, string>();
  const published = new Map<string, PublishedTool>();
  const reported = new Set<string>();
  function getTools({ strict = false }: ProviderToolSnapshotOptions = {}, { reportFallback = true } = {}): ProjectedTool[] {
    const descriptors = input.getToolSnapshot?.() ?? input.tools;
    pinWireNames(descriptors, names);
    return descriptors.map(descriptor => {
      const operation = compileOperationSchema({ schema: descriptor.inputSchema, protocol: input.protocol }, { strict });
      const name = names.get(descriptor.id)!;
      published.set(name, { id: descriptor.id, operation });
      const diagnosticKey = `${descriptor.id}:${operation.fallbackReason}`;
      if (reportFallback && operation.fallbackReason && !reported.has(diagnosticKey)) {
        reported.add(diagnosticKey);
        input.onSchemaFallback?.({ toolId: descriptor.id, protocol: input.protocol, reason: operation.fallbackReason });
      }
      return { name, ...(descriptor.description !== undefined ? { description: descriptor.description } : {}), operation };
    });
  }
  function decode(call: ProviderToolCall): ProviderToolCall {
    const tool = published.get(call.name);
    return tool ? { ...call, name: tool.id, input: tool.operation.decodeInput(call.input) } : call;
  }
  return {
    getTools,
    /** Dispatch a published call or await host refusal wording/audit; callback errors propagate.
     * O(1) local lookup and space; host callback/executor costs belong to those ports.
     */
    async execute(call: ProviderToolCall, _options = {}): Promise<ProviderToolResult> {
      if (!published.has(call.name)) {
        // MOVE: Refusal auditing must stay separate from execution so a policy change during
        // the callback cannot authorize a call whose name was never published this turn.
        const refusal = await input.onUnexposedToolCall?.({ toolName: call.name, callId: call.id, input: call.input, protocol: input.protocol });
        return { isError: true, content: refusal?.text ?? 'Tool is not exposed in this turn.' };
      }
      return input.executeTool(decode(call));
    },
    onEvent(event: ProviderTurnEvent): void {
      input.onEvent(event.type === 'tool_use' ? { ...event, ...decode(event) } : event);
    },
  };
}
function anthropicTools(tools: readonly ProjectedTool[]): AnthropicToolDef[] {
  return tools.map(({ name, description, operation }) => ({ name, ...(description !== undefined ? { description } : {}), input_schema: operation.schema, ...(operation.strict ? { strict: true } : {}) }));
}
function openAiTools(tools: readonly ProjectedTool[]): OpenAiFunctionToolDef[] {
  return tools.map(({ name, description, operation }) => ({ type: 'function', function: { name, ...(description !== undefined ? { description } : {}), parameters: operation.schema, ...(operation.strict ? { strict: true } : {}) } }));
}
function googleTools(tools: readonly ProjectedTool[]): GoogleToolDef[] {
  return [{ functionDeclarations: tools.map(({ name, description, operation }) => ({ name, ...(description !== undefined ? { description } : {}), parameters: operation.schema })) }];
}
function normalizeTurnResult(result: {
  stopReason?: string | null;
  finishReason?: string | null;
  toolTurns: number;
}, capturedEndReason: string | null = null): ProviderToolTurnResult {
  return { stopReason: capturedEndReason ?? result.stopReason ?? result.finishReason ?? null, toolTurns: result.toolTurns };
}
async function runAnthropicTurn(input: InternalTurnInput): Promise<ProviderToolTurnResult> {
  const projection = createToolProjection(input);
  const getTools = (options: ProviderToolSnapshotOptions = {}) => anthropicTools(projection.getTools(options));
  const tools = anthropicTools(projection.getTools({}, { reportFallback: false }));
  const messages: AnthropicMessageParam[] = input.messages.map((m) => ({ role: m.role, content: m.images?.length ? toAnthropicToolContent([
    { type: 'text', text: m.content }, ...m.images.map(image => ({ type: 'image' as const, ...image })),
  ]) : m.content }));
  const executeTool = async (call: AnthropicToolCall) => {
    const result = await projection.execute({ id: call.id, name: call.name, input: call.input });
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
    getTools,
    ...(input.onSchemaFallback ? { onSchemaFallback: input.onSchemaFallback } : {}),
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
      projection.onEvent(event as ProviderTurnEvent);
    },
  });
  return normalizeTurnResult(result, capturedEndReason);
}
/** OpenAI and Azure share message/tool projection; the selected adapter retains its native request semantics. */
async function runOpenAiCompatibleTurn(input: InternalTurnInput, _options = {}): Promise<ProviderToolTurnResult> {
  const projection = createToolProjection(input);
  const getTools = (options: ProviderToolSnapshotOptions = {}) => openAiTools(projection.getTools(options));
  const tools = openAiTools(projection.getTools({}, { reportFallback: false }));
  const messages: OpenAiMessageParam[] = [
    { role: "system", content: input.system },
    ...input.messages.map((m) => ({ role: m.role, content: m.images?.length ? toOpenAiToolContent([
      { type: 'text', text: m.content }, ...m.images.map(image => ({ type: 'image' as const, ...image })),
    ]) : m.content }) as OpenAiMessageParam),
  ];
  const executeTool = async (call: OpenAiToolCall) => {
    const result = await projection.execute({ id: call.id, name: call.name, input: call.input });
    return { content: foldToolError(toOpenAiToolContent(result.content), result.isError) };
  };
  let capturedEndReason: string | null = null;
  const result = await (({ apiKey, model, messages, onEvent, ...optionalArgs }: Parameters<typeof input.adapters.openai>[0] & NonNullable<Parameters<typeof input.adapters.openai>[1]>) => {
    if (input.protocol === 'azure') {
      // runAzureTurn checks the required endpoint before any projection or adapter work.
      const { baseUrl, ...azureOptions } = optionalArgs;
      return input.adapters.azure({ apiKey, baseUrl: baseUrl!, model, messages, onEvent }, azureOptions);
    }
    return input.adapters.openai({ apiKey, model, messages, onEvent }, optionalArgs);
  })({
    apiKey: input.apiKey,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    model: input.model,
    messages,
    tools,
    getTools,
    ...(input.onSchemaFallback ? { onSchemaFallback: input.onSchemaFallback } : {}),
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
      projection.onEvent(event as ProviderTurnEvent);
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
  return runOpenAiCompatibleTurn(input);
}
async function runGoogleTurn(input: InternalTurnInput): Promise<ProviderToolTurnResult> {
  const projection = createToolProjection(input);
  const getTools = (options: ProviderToolSnapshotOptions = {}) => googleTools(projection.getTools(options));
  const tools = googleTools(projection.getTools({}, { reportFallback: false }));
  const contents: GoogleContent[] = input.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }, ...(m.images ?? []).map(image => ({ inlineData: image }))],
  }));
  const executeTool = async (call: GoogleToolCall) => {
    const result = await projection.execute({ id: call.id, name: call.name, input: call.input });
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
    getTools,
    ...(input.onSchemaFallback ? { onSchemaFallback: input.onSchemaFallback } : {}),
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
      projection.onEvent(event as ProviderTurnEvent);
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
      return runOpenAiCompatibleTurn(input);
    case "azure":
      return runAzureTurn(input);
    case "google":
      return runGoogleTurn(input);
  }
}
