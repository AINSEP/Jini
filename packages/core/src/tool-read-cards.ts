/**
 * @file Generic mechanics for collapsing a host's paired read tools (a single-item `get` and a
 * `list`) into one "read card" tool: input-schema union and selector renaming, get/list dispatch by
 * selector presence, and the small path/description walkers those need. Pure and effect-free.
 *
 * The host owns which tools pair up, the card ids, permissions and every model-facing card copy; it
 * passes the source registrations' own published schemas and handlers in. Nothing here re-validates
 * input or re-checks permission: each branch calls the ORIGINAL handler unchanged, so its own input
 * validation and permission enforcement run exactly once.
 */
import { isRecord } from './records.js';
import { ToolInputError } from './tool-input-errors.js';
import type { NormalizedToolInput } from './tool-input-normalization.js';
import type { ToolHandler } from './tool-registry.js';

/** A JSON object schema as published on a tool descriptor. */
export type ReadCardSchema = Readonly<Record<string, unknown>>;

/** Typed explicitly because a bare `{}` literal has no index signature. */
const EMPTY_SCHEMA: ReadCardSchema = {};

/** The schema's `properties`, or an empty record. @complexity O(1). */
function schemaProperties({ schema }: { schema: ReadCardSchema }): Readonly<Record<string, unknown>> {
  return (schema.properties as Readonly<Record<string, unknown>> | undefined) ?? EMPTY_SCHEMA;
}

/** The schema's `required` list, or an empty list. @complexity O(1). */
function schemaRequired({ schema }: { schema: ReadCardSchema }): readonly string[] {
  return (schema.required as readonly string[] | undefined) ?? [];
}

/** Applies `rewriteText` to every string `description` in a JSON schema.
 *  @complexity O(n) in the schema size. */
export function rewriteSchemaDescriptions({ value, rewriteText }: { value: unknown; rewriteText: (required: { text: string }) => string }, _optional = {}): unknown {
  if (Array.isArray(value)) return value.map((child) => rewriteSchemaDescriptions({ value: child, rewriteText: rewriteText }));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, key === "description" && typeof child === "string" ? rewriteText({ text: child }) : rewriteSchemaDescriptions({ value: child, rewriteText: rewriteText })]),
  );
}

/** The value at `path` inside `item`, or `undefined` when any step is not a record.
 *  @complexity O(path length). */
export function valueAtPath({ item, path }: { item: unknown; path: readonly string[] }, _optional = {}): unknown {
  let current: unknown = item;
  for (const key of path) {
    const candidate = { value: current };
    if (!isRecord(candidate)) return undefined;
    current = candidate.value[key];
  }
  return current;
}

/**
 * **The one shared handler factory** every merged (get+list) card wires through. Dispatches to
 * `get` when the caller supplied `idProperty`, to `list` otherwise — both branches invoke the
 * ORIGINAL, already-shipped handler completely unchanged, including its own input validation and
 * its own permission enforcement.
 *
 * `value !== undefined` rather than a stricter non-empty-string check: an empty-string id is left
 * for the underlying `get` handler's own `requireString` to reject with its own message, rather
 * than this wrapper inventing a second, possibly-inconsistent validation error.
 * A batch-enabled get owns `items` before id dispatch: its existing wrapper validates the batch
 * and runs each item through get, so a missing item id fails instead of disclosing a whole list.
 *
 * @complexity O(1) plus whichever branch's own cost.
 */
export function dispatchByIdPresence(
  { idProperty, get, list }: { idProperty: string; get: ToolHandler; list: ToolHandler },
  { batchGet = false }: { batchGet?: boolean } = {},
): ToolHandler {
  return async (ctx, options) => {
    const candidate = { value: ctx.input };
    if (batchGet && isRecord(candidate) && Object.hasOwn(candidate.value, "items")) return get(ctx, options);
    const value = isRecord(candidate) ? candidate.value[idProperty] : undefined;
    return value !== undefined ? get(ctx, options) : list(ctx, options);
  };
}

/** The get-side id property entry of a union schema, with its "omit to list" note. @complexity O(1). */
function unionIdPropertyEntry({ getProps, idProperty }: { getProps: Readonly<Record<string, unknown>>; idProperty: string }): Record<string, unknown> {
  const idSchema = getProps[idProperty] as Record<string, unknown> | undefined;
  if (!idSchema) return {};
  return {
    [idProperty]: {
      ...idSchema,
      description: `${(idSchema.description as string | undefined) ?? ""} Omit to list instead of fetching a single item.`.trim(),
    },
  };
}

/**
 * Builds a merged card's inputSchema as the union of its `get` and `list` members' own ALREADY-
 * PUBLISHED schemas — never hand-authored, so it cannot drift from what those two tools actually
 * accept. `idProperty` becomes optional in the union (its presence, not a `required` entry, is the
 * dispatch signal {@link dispatchByIdPresence} reads) with a one-line note appended explaining that.
 * `required` is the intersection of the two members' own required fields (with `idProperty` removed
 * from `get`'s side first) — a field required by only ONE branch cannot be required overall, since
 * the other branch never needs it.
 *
 * @param optional.sharedOnlyKeys - Properties a merged card may advertise only when BOTH branches
 *        declare them (e.g. a host's peer-read selector), since either branch may receive the call.
 * @complexity O(p) in combined property count.
 */
export function unionInputSchema(
  { getSchema, listSchema, idProperty }: { getSchema: ReadCardSchema; listSchema: ReadCardSchema; idProperty: string },
  { sharedOnlyKeys = [] }: { sharedOnlyKeys?: readonly string[] } = {},
): ReadCardSchema {
  const getProps = schemaProperties({ schema: getSchema });
  const listProps = schemaProperties({ schema: listSchema });
  const getRequired = new Set(schemaRequired({ schema: getSchema }).filter((key) => key !== idProperty));
  const listRequired = new Set(schemaRequired({ schema: listSchema }));
  const required = [...getRequired].filter((key) => listRequired.has(key));

  const properties: Record<string, unknown> = { ...listProps, ...getProps, ...unionIdPropertyEntry({ getProps, idProperty }) };
  for (const key of sharedOnlyKeys) {
    if (!Object.hasOwn(listProps, key) || !Object.hasOwn(getProps, key)) delete properties[key];
  }

  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

/** Project the source selector `from` to `to`, including a source-owned batch's item schema.
 * Other filters, required context and natural-key constraints are preserved verbatim.
 * @complexity O(p) time/space in the single and batch-item properties; no effects.
 */
export function renameSchemaSelector(
  { inputSchema, from, to }: { inputSchema: ReadCardSchema; from: string; to: string },
  _options = {},
): ReadCardSchema {
  // A schema-less reader keeps its empty fallback: there is no selector to project.
  if (inputSchema.properties === undefined && inputSchema.required === undefined) return inputSchema;
  const properties = schemaProperties({ schema: inputSchema });
  const projected = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key === from ? to : key, value]));
  const batch = properties.items as ReadCardSchema | undefined;
  if (batch?.items) projected.items = { ...batch, items: renameSchemaSelector({ inputSchema: batch.items as ReadCardSchema, from, to }) };
  return { ...inputSchema, properties: projected,
    required: schemaRequired({ schema: inputSchema }).map((key) => key === from ? to : key),
  };
}

/** Rename one selector without mutating caller input or exposing values in errors/notes.
 * @throws ToolInputError for conflicting spellings, even when their values are equal.
 * @complexity O(k) time/space for k input keys; no I/O.
 */
export function renameInputSelector(
  { input, from, to }: { input: unknown; from: string; to: string }, _options = {},
): NormalizedToolInput {
  const candidate = { value: input };
  if (!isRecord(candidate) || !Object.hasOwn(candidate.value, from)) return { input, notes: [] };
  if (Object.hasOwn(candidate.value, to)) throw new ToolInputError({ message: `Conflicting inputs '${from}' and '${to}' both name '${to}'. Send only '${to}'.` });
  const { [from]: selector, ...rest } = candidate.value;
  return { input: { ...rest, [to]: selector }, notes: [`${from}→${to}`] };
}

/** Translate only the target selector at the root and in source-owned batch items.
 * Batch execution, limits, per-item authorization and result envelopes remain with the batch owner.
 * @throws ToolInputError if any single item contains both spellings, before a read begins.
 * @complexity O(k) time/space in root and batch-item keys; no per-item I/O.
 */
export function renameInputSelectors(
  { input, from, to }: { input: unknown; from: string; to: string }, _options = {},
): NormalizedToolInput {
  const renamed = renameInputSelector({ input, from, to });
  const candidate = { value: renamed.input };
  if (!isRecord(candidate) || !Array.isArray(candidate.value.items)) return renamed;
  const notes = [...renamed.notes];
  const items = candidate.value.items.map((item, index) => {
    const result = renameInputSelector({ input: item, from, to });
    notes.push(...result.notes.map((note) => `items[${index}].${note}`));
    return result.input;
  });
  return { input: { ...candidate.value, items }, notes };
}
