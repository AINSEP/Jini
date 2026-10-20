/** Shared sequential batching. Each merged item re-enters the invoking executor's gates. */
import { createToolRegistry, type ToolHandler, type ToolRegistration } from './tool-registry.js';
import { ToolInputError } from './tool-input-errors.js';
import { canonicalizeToolInputKeys, normalizeToolInput, withNormalizationNotes } from './tool-input-normalization.js';

/** One tool that accepts `items`. `itemDefaults` sit under the caller's own fields: a batch that
 *  returns every item's full body could overflow one tool result, so a reader can default to a
 *  smaller window per item that the caller may still raise. */
export interface BatchableTool {
  readonly toolId: string;
  readonly maxItems?: number;
  readonly itemDefaults?: Readonly<Record<string, unknown>>;
  /** Host-specific result constraints, checked on the normalized item before its handler runs. */
  readonly validateItem?: (required: { input: unknown }) => void;
}

/** Used when a {@link BatchableTool} names no `maxItems`. */
export const DEFAULT_MAX_BATCH_ITEMS = 25;

/** One item's outcome. `error` is the domain's own message without the appended input schema,
 *  which the tool already publishes and which would otherwise repeat once per failed item. */
export type BatchItemResult =
  | { readonly index: number; readonly ok: true; readonly result: unknown }
  | { readonly index: number; readonly ok: false; readonly error: string; readonly result?: unknown };

/** What a batch call returns. A failed item never stops the ones after it. */
export interface BatchResult {
  readonly batch: true;
  readonly outcome: 'completed' | 'partial_failure' | 'error';
  readonly isError?: true;
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly results: readonly BatchItemResult[];
}

/** Classify a batch result, including legacy envelopes, without dropping per-item evidence.
 * @returns Undefined for non-batches; error when every item failed, partial_failure for a mix.
 * @complexity O(n) in per-item results; no effects.
 */
export function batchOutcomeFor({ output }: { output: unknown }, _options = {}): BatchResult['outcome'] | undefined {
  if (!isPlainObject(output) || output.batch !== true || !Array.isArray(output.results) || output.results.length === 0) return undefined;
  const failed = output.results.filter(item => isPlainObject(item) && item.ok === false).length;
  return failed === 0 ? 'completed' : failed === output.results.length ? 'error' : 'partial_failure';
}

/** A JSON object: not null, not an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ObjectSchema {
  readonly type?: unknown;
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

/**
 * The descriptor a batchable tool publishes: its own schema plus an `items` array, its top-level
 * `required` list moved into the `items` description (a batch call sets those per item or once at
 * the top level through the declared legacy normalization), and batch guidance appended to its description.
 *
 * @param required.descriptor - The tool's registered descriptor.
 * @param required.tool - Its batch settings.
 * @returns A new descriptor; the input is not mutated.
 * @throws {Error} If the tool publishes no object schema, or already has an `items` property
 * (the batch field would shadow it) — both developer errors caught at composition time.
 * @complexity O(p) in the schema's top-level property count.
 */
export function batchDescriptorFor(
  { descriptor, tool }: { descriptor: ToolRegistration["descriptor"]; tool: BatchableTool },
  _optional: Record<string, never> = {},
): ToolRegistration["descriptor"] {
  const schema = descriptor.inputSchema as ObjectSchema | undefined;
  if (!isPlainObject(schema) || !isPlainObject(schema.properties)) {
    throw new Error(`batch-tool-inputs.ts: '${descriptor.id}' publishes no object inputSchema, so it cannot take items`);
  }
  if (Object.hasOwn(schema.properties, "items")) {
    throw new Error(`batch-tool-inputs.ts: '${descriptor.id}' already has an 'items' input, so the batch field would shadow it`);
  }
  const maxItems = tool.maxItems ?? DEFAULT_MAX_BATCH_ITEMS;
  const requiredFields = schema.required ?? [];
  const { required: _required, ...rest } = schema;
  const needs = requiredFields.length > 0 ? ` Each item needs ${requiredFields.join(", ")} (inside each item).` : "";
  const items = {
    type: "array",
    minItems: 1,
    maxItems,
    description:
      `Batch: up to ${maxItems} inputs run in ONE call, in order. Each item takes the same fields as a single call; ` +
      `Canonical shape: {items:[{...}, ...]} only. Legacy shared top-level fields are normalized into each item before execution; an item's own value wins.${needs}`,
    items: { type: "object", description: "One item: the same fields as a single call of this tool." },
  };
  return {
    ...descriptor,
    description:
      `${descriptor.description ?? ""} Batch: to do several at once, pass items: [{...}, ...] (up to ${maxItems}) in ONE call instead of one call per item. ` +
      "Canonical shape: {items:[{...}, ...]} only. Legacy shared top-level fields are normalized into each item; item values win. " +
      "Returns { batch: true, outcome: completed | partial_failure | error, total, succeeded, failed, results: [{ index, ok, result | error }] }; one item's failure does not stop the others.",
    inputSchema: { ...rest, properties: { ...schema.properties, items } },
  };
}

/** The domain message without `withSchemaOnRejection`'s appended schema. */
function itemErrorMessage({ error, toolId }: { error: unknown; toolId: string }): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(` Schema for '${toolId}': `)[0] ?? message;
}

/** Validates the batch half of an input and returns its items, or throws a caller-actionable error. */
function readItems({ items, toolId, maxItems }: { items: unknown; toolId: string; maxItems: number }): readonly Record<string, unknown>[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ToolInputError({ message: `${toolId}: 'items' must be a non-empty array of inputs` });
  }
  if (items.length > maxItems) {
    throw new ToolInputError({ message: `${toolId}: 'items' has ${items.length} entries; the most one call takes is ${maxItems}. Split them into several calls.` });
  }
  const bad = items.findIndex((item) => !isPlainObject(item));
  if (bad !== -1) throw new ToolInputError({ message: `${toolId}: items[${bad}] must be an object of this tool's input fields` });
  return items as Record<string, unknown>[];
}

/** Defaults < shared fields < item, after resolving spellings independently in each layer.
 * Domain aliases, scalar conversion and closed-schema rejection run on the final merged input.
 * @throws ToolInputError on a collision within any layer or invalid final input.
 * @complexity Three bounded schema walks plus the registered normalizer's cost.
 */
async function normalizeBatchItem({ registration, defaults, shared, item }: {
  registration: ToolRegistration; defaults: Readonly<Record<string, unknown>> | undefined;
  shared: Record<string, unknown>; item: Record<string, unknown>;
}) {
  const schema = registration.descriptor.inputSchema;
  const layers = [defaults ?? {}, shared, item].map(input => canonicalizeToolInputKeys({ input, schema }));
  const input = { ...layers[0]!.input, ...layers[1]!.input, ...layers[2]!.input };
  const normalized = await normalizeToolInput({ input, registration });
  return { input: normalized.input, notes: [...layers.flatMap(layer => layer.notes), ...normalized.notes] };
}

/**
 * Wraps one registration so it also accepts `items`. Single calls retain their handler.
 * Ordinary merged items re-enter the executor; plan batches normalize all items at the outer
 * gate and retain their combined approval handler.
 *
 * @param required.registration - The registration to extend (already approval-wrapped).
 * @param required.tool - Its batch settings.
 * @param optional.mode - `plan` normalizes every merged item before policy, leaving the
 * existing handler to prepare and confirm the combined plan once; `items` gates each item.
 * @returns The registration with {@link batchDescriptorFor}'s descriptor and a batch-aware handler.
 * @throws {Error} At composition time, per {@link batchDescriptorFor}. The returned handler throws
 * {@link ToolInputError} for a malformed `items`, and `AbortError` if the call is cancelled between
 * items; an item's own failure is reported in its result instead.
 * @complexity O(n) bounded normalization/target checks for n items, plus the existing
 * per-item executor or combined plan lifecycle. The default cap is 25.
 */
export function withBatchInput(
  { registration, tool }: { registration: ToolRegistration; tool: BatchableTool },
  { mode = 'items' }: { mode?: 'items' | 'plan' } = {},
): ToolRegistration {
  const toolId = registration.descriptor.id;
  const maxItems = tool.maxItems ?? DEFAULT_MAX_BATCH_ITEMS;
  const descriptor = batchDescriptorFor({ descriptor: registration.descriptor, tool });
  if (mode === 'plan') return {
    ...registration, descriptor: { ...descriptor,
      description: `${registration.descriptor.description ?? ''} Batch: up to ${maxItems} inputs are normalized before authorization and passed to the existing combined approval plan.`,
    },
    // The plan owns one confirmation. Normalize every merged item before the outer gate so
    // its policy and planner receive the same targets; never execute items to preflight them.
    normalizeInput: async ({ input }) => {
      if (!Object.hasOwn(input, 'items')) return normalizeToolInput({ input, registration });
      const { items: rawItems, ...shared } = input;
      const items = readItems({ items: rawItems, toolId, maxItems });
      const normalized = [];
      for (const item of items) {
        const result = await normalizeBatchItem({ registration, defaults: tool.itemDefaults, shared, item });
        tool.validateItem?.({ input: result.input });
        normalized.push(result);
      }
      return { input: { items: normalized.map(item => item.input) }, notes: normalized.flatMap(item => item.notes) };
    },
  };
  const original = registration.handler;
  const itemRegistry = createToolRegistry({});
  itemRegistry.register(registration);
  const handler: ToolHandler = async (ctx, options) => {
    if (!isPlainObject(ctx.input) || !Object.hasOwn(ctx.input, "items")) return original(ctx, options);
    const { items: rawItems, ...shared } = ctx.input;
    const items = readItems({ items: rawItems, toolId, maxItems });
    const results: BatchItemResult[] = [];
    for (const [index, item] of items.entries()) {
      ctx.signal.throwIfAborted();
      let notes: readonly string[] = [];
      try {
        const normalized = await normalizeBatchItem({ registration, defaults: tool.itemDefaults, shared, item });
        notes = normalized.notes;
        tool.validateItem?.({ input: normalized.input });
        if (!options?.invokeTool) throw new Error(`${toolId}: batch items require the gated ToolExecutor invocation port`);
        const output = await options.invokeTool({ toolId, input: normalized.input }, { registry: itemRegistry });
        const outcome = batchOutcomeFor({ output });
        if (isPlainObject(output) && (output.isError === true || outcome === 'error' || outcome === 'partial_failure')) {
          results.push({ index, ok: false, error: typeof output.error === 'string' ? output.error : 'item returned an error', result: output });
        } else results.push({ index, ok: true, result: withNormalizationNotes({ output, notes: normalized.notes }) });
      } catch (error) {
        results.push({ index, ok: false, error: withNormalizationNotes({ output: itemErrorMessage({ error, toolId }), notes }) as string });
      }
    }
    const succeeded = results.filter((result) => result.ok).length;
    const outcome = succeeded === results.length ? 'completed' : succeeded === 0 ? 'error' : 'partial_failure';
    return { batch: true, outcome, ...(succeeded === 0 ? { isError: true as const } : {}), total: results.length, succeeded, failed: results.length - succeeded, results } satisfies BatchResult;
  };
  return { ...registration, descriptor, handler,
    // Domain normalization belongs to each merged item, not the incomplete shared layer.
    normalizeInput: async ({ input }, options) => Object.hasOwn(input, 'items') || !registration.normalizeInput
      ? { input, notes: [] }
      : registration.normalizeInput({ input }, options),
  };
}

/**
 * Applies {@link withBatchInput} to every listed tool present in `registrations`; every other
 * registration is returned as the same object. A listed id that is not registered is skipped (a
 * domain may be absent in a narrower composition, e.g. a test building one domain).
 *
 * @param required.registrations - The assembled registration list.
 * @param optional.tools - Explicit host-owned batchable tool list.
 * @returns A new list in the same order.
 * @complexity O(r + b) for r registrations and b batchable tools.
 */
export function applyBatchInputs(
  { registrations }: { registrations: readonly ToolRegistration[] },
  { tools = [] }: { tools?: readonly BatchableTool[] } = {},
): ToolRegistration[] {
  const byId = new Map(tools.map((tool) => [tool.toolId, tool]));
  return registrations.map((registration) => {
    const tool = byId.get(registration.descriptor.id);
    return tool ? withBatchInput({ registration, tool }) : registration;
  });
}
