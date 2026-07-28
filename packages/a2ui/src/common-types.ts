/**
 * @module common-types
 *
 * A2UI ("Agent-to-UI") v1.0 common wire types — Zod schemas mirroring
 * `specification/v1_0/json/common_types.json` from https://github.com/a2ui-project/a2ui
 * (fetched and read directly from that repo's `main` branch this session; every field name below
 * was copied from the real JSON Schema `$defs`, not guessed). A2UI is a real, versioned,
 * actively-maintained spec (v1.0 is a release candidate at the time this was written) for agents
 * to stream a declarative, catalog-whitelisted component tree + JSON-Pointer-bound data model to a
 * renderer. See `../source-map.md` for provenance, what was verified against the primary source,
 * and — importantly — why this was hand-rolled from the JSON Schemas rather than built on the
 * official `@a2ui/web_core` npm package (materially version-drifted: see that doc).
 *
 * Scope note: this module is the **wire shape** only (what a message/type looks like on the
 * wire). Catalog membership (which component/function names are actually legal for a given
 * surface) is a separate, runtime concern — see `catalog.ts` and `interpreter.ts`. A component
 * object's own per-type property shape (e.g. what `Text` requires beyond `id`/`component`) is
 * also not encoded here — see `catalog.ts`'s `LAB_CATALOG` and the React renderer for the small,
 * real subset of the "basic" catalog this port actually renders.
 */
import { z } from 'zod';

/** `common_types.json#/$defs/ComponentId` — "The unique identifier for a component, used for both definitions and references within the same surface." */
export const ComponentIdSchema = z.string();
export type ComponentId = z.infer<typeof ComponentIdSchema>;

/** `common_types.json#/$defs/CallId` — "The unique identifier for an agent initiated function call." */
export const CallIdSchema = z.string();
export type CallId = z.infer<typeof CallIdSchema>;

/** `common_types.json#/$defs/DataBinding` — a JSON Pointer (RFC 6901) reference into the data model. */
export const DataBindingSchema = z.object({ path: z.string() }).strict();
export type DataBinding = z.infer<typeof DataBindingSchema>;

/**
 * `common_types.json#/$defs/FunctionCall` — "Invokes a named function on the renderer."
 * The real schema additionally constrains `call`/`args` via a `oneOf` against
 * `catalog.json#/$defs/anyFunction` (i.e. the active catalog's own function definitions) or
 * `IndexSystemFunction`. That constraint is catalog-dependent and cannot be expressed in a static
 * wire schema shared across every catalog — it is enforced at runtime instead, by
 * `catalog.ts`/`resolve.ts` (function-name whitelist + `callableFrom` execution-boundary check).
 * This schema only validates the wire shape: `call` is a non-empty string, `args` (if present) is
 * a plain object.
 */
export const FunctionCallSchema: z.ZodType<FunctionCall> = z.lazy(() =>
  z
    .object({
      call: z.string(),
      args: z.record(z.string(), ArgValueSchema).optional(),
    })
    .strict(),
);
export interface FunctionCall {
  call: string;
  // `| undefined` spelled out explicitly (not just `args?:`) because `exactOptionalPropertyTypes`
  // makes those two subtly different, and zod's own `.optional()` inference produces the
  // `| undefined` form — this has to match exactly for `z.ZodType<FunctionCall>` below to
  // typecheck against the recursive lazy schema.
  args?: Record<string, ArgValue> | undefined;
}

/** `common_types.json#/$defs/DynamicValue`'s `args`-position shape: a `DynamicValue`, or a literal object (catalog-defined config). Recursive because `args` values may themselves be `FunctionCall`s. */
const ArgValueSchema: z.ZodType<ArgValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.array(z.unknown()), DataBindingSchema, FunctionCallSchema, z.record(z.string(), z.unknown())]),
);
export type ArgValue = string | number | boolean | unknown[] | DataBinding | FunctionCall | Record<string, unknown>;

/** `common_types.json#/$defs/DynamicValue` — "A value that can be a literal, a path, or a function call returning any type." */
export const DynamicValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.unknown()),
  DataBindingSchema,
  FunctionCallSchema,
]);
export type DynamicValue = z.infer<typeof DynamicValueSchema>;

/** `common_types.json#/$defs/DynamicString` — literal, JSON-Pointer binding, or `FunctionCall` returning a string. */
export const DynamicStringSchema = z.union([z.string(), DataBindingSchema, FunctionCallSchema]);
export type DynamicString = z.infer<typeof DynamicStringSchema>;

/** `common_types.json#/$defs/DynamicNumber`. */
export const DynamicNumberSchema = z.union([z.number(), DataBindingSchema, FunctionCallSchema]);
export type DynamicNumber = z.infer<typeof DynamicNumberSchema>;

/** `common_types.json#/$defs/DynamicBoolean`. */
export const DynamicBooleanSchema = z.union([z.boolean(), DataBindingSchema, FunctionCallSchema]);
export type DynamicBoolean = z.infer<typeof DynamicBooleanSchema>;

/** `common_types.json#/$defs/DynamicStringList`. */
export const DynamicStringListSchema = z.union([z.array(z.string()), DataBindingSchema, FunctionCallSchema]);
export type DynamicStringList = z.infer<typeof DynamicStringListSchema>;

/**
 * `common_types.json#/$defs/IndexSystemFunction` — "Returns the 0-based index of the current item
 * when rendering a dynamic list from a template. This function MUST ONLY be available when
 * evaluating template items within a list context." `call` is the literal `@index`; catalogs
 * "MUST NOT define functions prefixed with `@`" per the catalog spec's system-namespace rule, so
 * this is the one function name every catalog implicitly carries.
 */
export const IndexSystemFunctionSchema = z
  .object({
    call: z.literal('@index'),
    args: z.object({ offset: DynamicNumberSchema.optional() }).strict().optional(),
  })
  .strict();
export type IndexSystemFunction = z.infer<typeof IndexSystemFunctionSchema>;

/** `common_types.json#/$defs/AccessibilityAttributes`. */
export const AccessibilityAttributesSchema = z
  .object({
    label: DynamicStringSchema.optional(),
    description: DynamicStringSchema.optional(),
  })
  .strict();
export type AccessibilityAttributes = z.infer<typeof AccessibilityAttributesSchema>;

/** `common_types.json#/$defs/ComponentCommon` — every component carries at least `id`. */
export const ComponentCommonSchema = z.object({
  id: ComponentIdSchema,
  accessibility: AccessibilityAttributesSchema.optional(),
});
export type ComponentCommon = z.infer<typeof ComponentCommonSchema>;

/** `common_types.json#/$defs/Child` — "A reference to a single child component ID." */
export const ChildSchema = ComponentIdSchema;
export type Child = ComponentId;

/**
 * `common_types.json#/$defs/ChildList` — either a static array of `ComponentId`s, or a template
 * object (`{componentId, path}`) that generates one child per item in a data-model list.
 */
export const ChildListSchema = z.union([
  z.array(ComponentIdSchema),
  z.object({ componentId: ComponentIdSchema, path: z.string() }).strict(),
]);
export type ChildList = z.infer<typeof ChildListSchema>;
export type ChildListTemplate = Extract<ChildList, { componentId: string }>;

/** `common_types.json#/$defs/CheckRule` — "A single validation rule applied to an input component." */
export const CheckRuleSchema = z
  .object({
    condition: DynamicBooleanSchema,
    message: z.string(),
  })
  .strict();
export type CheckRule = z.infer<typeof CheckRuleSchema>;

/** `common_types.json#/$defs/Checkable`. */
export const CheckableSchema = z.object({ checks: z.array(CheckRuleSchema).optional() });
export type Checkable = z.infer<typeof CheckableSchema>;

/**
 * `common_types.json#/$defs/Action` — "Defines an interaction handler that can either trigger an
 * agent-side event or execute a local renderer-side function." The two variants are mutually
 * exclusive on the wire (each is `.strict()` with only its own key).
 */
export const AgentActionEventSchema = z
  .object({
    name: z.string(),
    context: z.record(z.string(), DynamicValueSchema).optional(),
    wantResponse: z.boolean().optional(),
    responsePath: z.string().optional(),
  })
  .strict();
export type AgentActionEvent = z.infer<typeof AgentActionEventSchema>;

export const ActionSchema = z.union([
  z.object({ event: AgentActionEventSchema }).strict(),
  z.object({ functionCall: FunctionCallSchema }).strict(),
]);
export type Action = z.infer<typeof ActionSchema>;
export type AgentEventAction = Extract<Action, { event: AgentActionEvent }>;
export type LocalFunctionAction = Extract<Action, { functionCall: FunctionCall }>;

export function isAgentEventAction(action: Action): action is AgentEventAction {
  return 'event' in action;
}
export function isLocalFunctionAction(action: Action): action is LocalFunctionAction {
  return 'functionCall' in action;
}
