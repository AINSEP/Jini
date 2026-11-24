import { runAnthropicToolTurn, type AnthropicMessageParam, type AnthropicToolCall, type AnthropicToolResultContentBlock, type AnthropicToolDef } from './anthropic-messages.js';
import { runAzureToolTurn } from './azure-chat.js';
import { runGoogleToolTurn, type GoogleContent, type GoogleToolCall, type GoogleToolDef, type GoogleToolResultPart } from './google-messages.js';
import { runOpenAiToolTurn } from './openai-chat.js';
import { type OpenAiContentPart, type OpenAiFunctionToolDef, type OpenAiMessageParam, type OpenAiToolCall } from './openai-chat-types.js';
import type { ProviderTurnAdapters, ProviderTurnEvent, ProviderToolCall, ProviderToolResult, ProviderToolDescriptor, ProviderToolTurnInput, ProviderToolTurnResult, ProviderToolTurnOptions, ProviderToolSnapshotOptions, ProviderProtocol } from './tool-turn-types.js';
import { createToolNameMap } from '@jini-ai/core';
import { compileOperationSchema, type CompiledOperationSchema } from './operation-schema.js';
export type * from './tool-turn-types.js';
export { compileOperationSchema } from './operation-schema.js';
export type { CompiledOperationSchema, OperationSchemaFallbackReason } from './operation-schema.js';
export { googleParametersOf, sanitizeGoogleSchema, findNumericEnumPaths, coerceNumericEnumStringsToNumbers } from './google-schema.js';
/** Existing provider loops, ready for host composition; callers may replace any adapter. */
export const providerTurnAdapters: ProviderTurnAdapters = Object.freeze({ anthropic: runAnthropicToolTurn, openai: runOpenAiToolTurn, azure: runAzureToolTurn, google: runGoogleToolTurn });
type InternalTurnInput = ProviderToolTurnInput & ProviderToolTurnOptions;
/** A stored, free-form provider string narrowed to a protocol the default adapters can dispatch, or
 * null when it names something else. Case- and whitespace-insensitive because the stored column is
 * free-form. The adapters themselves own the supported protocols; no second allowlist lives here.
 * @complexity O(n) in provider length. */
export function resolveProviderProtocol({ provider }: { provider: string }, _optional = {}): ProviderProtocol | null {
  const normalized = provider.trim().toLowerCase();
  return Object.hasOwn(providerTurnAdapters, normalized) ? normalized as ProviderProtocol : null;
}
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
function foldToolError(content: string | OpenAiContentPart[], isError = false): string | OpenAiContentPart[] {
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
  if (!/^[A-Za-z_]\w{0,63}$/.test(descriptor.wireName)) throw new ProviderToolProjectionError({});
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
    // Descriptors only, never handlers — the same public shape `ToolRegistry.list()` returns
    // (`@jini-ai/core`'s own "handlers never publicly retrievable" invariant, see that package's
    // `tool-registry.ts` module doc). Mapped into each protocol's own tool-def shape below.
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
type AdapterLoopEvent = Parameters<Parameters<ProviderTurnAdapters['anthropic']>[0]['onEvent']>[0]
  | Parameters<Parameters<ProviderTurnAdapters['openai']>[0]['onEvent']>[0]
  | Parameters<Parameters<ProviderTurnAdapters['google']>[0]['onEvent']>[0];

/** Projects adapter events and retains the adapter end reason, which overrides the raw stop code. */
function forwardAdapterEvents(
  { input, projection }: { input: InternalTurnInput; projection: ReturnType<typeof createToolProjection> },
  { errorFromContentPrefix = false }: { errorFromContentPrefix?: boolean } = {},
) {
  let endReason: string | null = null;
  const onEvent = (event: AdapterLoopEvent): void => {
    if (event.type === 'fabricated_role_marker') return;
    if (event.type === 'end') endReason = event.reason;
    if (event.type === 'tool_result') {
      const content = describeToolResultContent(event.content);
      input.onEvent({ type: 'tool_result', toolUseId: event.toolUseId, content, isError: event.isError || (errorFromContentPrefix && content.startsWith(TOOL_ERROR_PREFIX.trimEnd())) });
      return;
    }
    projection.onEvent(event as ProviderTurnEvent);
  };
  return {
    onEvent,
    endReason: (_required: Record<string, never> = {}, _optional: Record<string, never> = {}) => endReason,
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
  const forward = forwardAdapterEvents({ input, projection });
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
    onEvent: forward.onEvent,
  });
  return normalizeTurnResult(result, forward.endReason());
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
  const forward = forwardAdapterEvents({ input, projection }, { errorFromContentPrefix: true });
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
    onEvent: forward.onEvent,
  });
  return normalizeTurnResult(result, forward.endReason());
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
  const forward = forwardAdapterEvents({ input, projection });
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
    onEvent: forward.onEvent,
  });
  return normalizeTurnResult(result, forward.endReason());
}
/** Runs one provider-neutral turn through the supplied adapters. The adapter end event takes precedence over a raw provider stop code.
 * Local mapping is proportional to the descriptors, expanded schemas and emitted result parts; request and loop cost belongs to the adapter ports.
 *
 * Provider mapping constraints (implemented here and in `google-schema.ts`):
 *
 * OpenAI/Azure have no host-tool-error flag on their wire. A shared fold marker carries failures
 * into content and restores `isError` on outgoing events; adapter validation alone cannot detect a
 * host denial in an otherwise valid string result. Azure uses the same content shape as OpenAI.
 * Anthropic accepts JPEG/PNG/GIF/WebP image sources; its adapter guards unsupported media types.
 * OpenAI/Azure move image parts into a follow-up user message because tool messages are text-only;
 * Gemini places inline data beside function responses. Transcript events describe each image by
 * MIME type instead of emitting base64 noise. Plain string results remain unchanged.
 * Missing input schemas use an empty-object schema; schema dialect is a consumer concern.
 *
 * Gemini's restricted Schema cannot express full JSON Schema. Its supported-key allowlist follows
 * the validator's Available Fields list (the Google AI Developer forum's "oneOf in response_schema"
 * thread), which includes fields omitted by the prose API docs. Unsupported keys are dropped only
 * from model guidance: tool handlers still validate inputs server-side. `const` becomes `enum`;
 * `oneOf` becomes `anyOf`. That conversion is equivalent for disjoint tagged unions (e.g. navigation
 * targets and TipTap nodes); overlapping future branches require an owner decision because the
 * conversion would loosen the constraint.
 *
 * Local #/$defs references are resolved against the nearest enclosing, per-call definitions map,
 * preventing concurrent turns from sharing definitions. Unknown references degrade to object
 * guidance instead of failing an entire turn. References are inlined because Gemini has no $ref;
 * ordinary object/array traversal does not consume the reference-depth budget.
 * The reference cap is 4, a chosen bound rather than a product invariant: TipTap's recursive
 * eight-branch block union grows combinatorially, and two reference hops represent one visible
 * list/blockquote nesting level. Four hops cover two such levels while bounding request size.
 * A navigation tree's separate depth limit does not determine this cap. Deeper content
 * remains permissible but undescribed by a shallow type/description stub (union stubs use object);
 * the stub must not recurse into properties, items or branches and recreate unbounded expansion.
 *
 * Gemini requires every array schema to declare items and every node to declare type unless it
 * has anyOf. Unknown array items degrade to string, the narrowest valid approximation, rather than
 * inviting arbitrary objects. Structural repair applies only at schema positions (properties.*, items,
 * anyOf), never arbitrary default/example objects, which must not acquire invented type fields.
 * Properties preserve author-chosen keys. Validation must use googleParametersOf, including shape
 * repair, so it checks the actual wire schema rather than an incomplete lower-level conversion.
 *
 * Bare const literals infer boolean/integer/number/string; object/array const sites need an explicit
 * type instead of broader inference. A type array collapses to one non-null type plus nullable;
 * multiple non-null types lose precision and require an owner decision if used. Null enum members
 * are removed because Gemini's enum accepts strings only and sibling nullable already conveys null.
 * Numeric enums are stringified for Gemini and must be converted back at the tool-call boundary:
 * a handler such as a redirect's statusCode still requires a number. Numeric paths come from the original
 * unsanitized schema, once per tool, because sanitization overwrites the numeric type. The original
 * type check prevents coercing numeric enum values on nonnumeric fields. Discovery traverses only
 * properties, not arrays, unions or $refs; a numeric enum in those positions needs an extension.
 * Coercion accepts only finite numeric-looking, nonblank strings and clones only the changed path;
 * malformed paths/arguments remain untouched for the handler's validation rather than inventing data.
 *
 * The adapter's captured end-event reason takes precedence over the final response's raw stop code:
 * a raw tool_use can mean the loop hit its cap while the model still wanted tools. Raw stop/finish
 * fields are fallbacks only when no end event was observed; callers must explain the loop's actual
 * stop. Anthropic alone requires a max-token default when omitted, so the shared mapping supplies it.
 * Provider-internal fabricated-role-marker diagnostics are filtered because the client has no event case.
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
    default: {
      // Unreachable: every supported protocol has a case above, and a new one fails typecheck here.
      const unsupported: never = input.protocol;
      throw new TypeError(`Unsupported provider tool-turn protocol: ${String(unsupported)}`);
    }
  }
}
