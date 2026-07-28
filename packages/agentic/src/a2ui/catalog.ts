/**
 * @module catalog
 *
 * A2UI's catalog is the spec's own named security boundary: "a JSON Schema that whitelists which
 * component types and functions may be used" (`specification/v1_0/json/catalog_definition.json`,
 * fetched from https://github.com/a2ui-project/a2ui this session). A component type or function
 * name absent from the active catalog — or a function invoked across a `callableFrom` boundary it
 * isn't permitted to cross — must be refused, not silently rendered or executed. This module is
 * that whitelist plus the closed per-component-type property shape for the small subset this port
 * actually renders; `interpreter.ts` is the code path that enforces it at message-processing time.
 *
 * **Scope**: `createLabCatalog()` below implements **all 18** of the real basic catalog's
 * components (`specification/v1_0/catalogs/basic/catalog.json`, 53KB, fetched from the spec repo
 * and read directly — every property name, type, enum member, default value, required-ness and
 * mixin below was copied field-for-field from it, not inferred from the component's name). It
 * implements 3 of that catalog's 14 **functions** (`and`/`or`/`not`, the only ones with
 * unambiguous, fully-specified semantics reachable from the fetched schema text alone — the
 * others, e.g. `formatString`/`formatDate`, depend on locale/formatting semantics not pinned down
 * by the schema text, and are deliberately not guessed at). The remaining 11 functions are **not
 * implemented** — see `../source-map.md` for the full gap list. `createLabCatalog()` also adds
 * three lab-only demo functions (`greetUser`/`logServerEvent`/`adminReset`, clearly not part of
 * the real basic catalog) purely to exercise all three `callableFrom` values end-to-end — the real
 * basic catalog's own 14 functions are all `rendererOnly`, which alone can't test the `agentOnly` /
 * `rendererOrAgent` boundary this spec explicitly calls out as security-relevant.
 *
 * Note that "implemented" here means **the protocol/validation layer**: a component type in this
 * catalog is accepted, closed-schema-validated and held in interpreter state. Whether any given
 * host renderer draws it is a separate concern this package has no opinion on.
 */
import { z } from 'zod';
import {
  AccessibilityAttributesSchema,
  ActionSchema,
  CheckRuleSchema,
  ChildListSchema,
  ChildSchema,
  DataBindingSchema,
  DynamicBooleanSchema,
  DynamicNumberSchema,
  DynamicStringListSchema,
  DynamicStringSchema,
} from './common-types.js';

export type CallableFrom = 'rendererOnly' | 'agentOnly' | 'rendererOrAgent';

/** `catalog_definition.json#/$defs/FunctionDefinition` — the metadata half (not the JSON-Schema-validation half, which this port doesn't implement generically — see module doc). */
export interface FunctionSpec {
  readonly returnType: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any' | 'void';
  /** Defaults to `'rendererOnly'` per the real schema's own `default`, matched here explicitly rather than left implicit — every lookup site in this package treats an absent entry (function not registered at all) and an explicit `rendererOnly` entry identically, per the spec's "or if the function is not registered at all, the renderer MUST immediately reject" wording. */
  readonly callableFrom: CallableFrom;
  /** Pure implementation, only present for functions this port can actually evaluate. A function present in `functions` but with no `impl` is registered (so `callableFrom` checks against it are meaningful and testable) but cannot be evaluated — `resolve.ts` reports that as a distinct, non-crashing "not implemented" resolution failure rather than pretending it doesn't exist. */
  readonly impl?: (args: Record<string, unknown>) => unknown;
}

/**
 * A coarse rendering hint, not a spec concept — the real catalog has no notion of "kind". It
 * groups the 18 component types by the shape a host renderer would draw them with, so a renderer
 * can fall back to something sane for a type it has no bespoke case for.
 */
export type ComponentKind =
  | 'text'
  | 'container'
  | 'button'
  | 'image'
  | 'icon'
  | 'video'
  | 'audio'
  | 'card'
  | 'tabs'
  | 'modal'
  | 'divider'
  | 'input';

export interface ComponentSpec {
  readonly kind: ComponentKind;
  /**
   * Validates everything on the wire component object except `id`/`component` (already checked
   * generically by `WireComponentSchema`). Typed as `z.ZodTypeAny` rather than
   * `z.ZodType<Record<string, unknown>>` deliberately — each concrete schema's *input* type is
   * narrower than a bare record (known keys, some required), and zod's `parse`/`safeParse` are
   * effectively contravariant in that position; callers (`interpreter.ts`) treat `.safeParse(...)`'s
   * `data` as `Record<string, unknown>` via an explicit cast instead of fighting that variance here.
   */
  readonly propsSchema: z.ZodTypeAny;
}

export interface Catalog {
  readonly catalogId: string;
  readonly components: ReadonlyMap<string, ComponentSpec>;
  readonly functions: ReadonlyMap<string, FunctionSpec>;
}

export function isComponentAllowed(catalog: Catalog, componentType: string): boolean {
  return catalog.components.has(componentType);
}

/** Mirrors the spec's own default: absent registration behaves exactly like an explicit `rendererOnly` entry. */
export function callableFromOf(catalog: Catalog, functionName: string): CallableFrom {
  return catalog.functions.get(functionName)?.callableFrom ?? 'rendererOnly';
}

export function isFunctionRegistered(catalog: Catalog, functionName: string): boolean {
  return catalog.functions.has(functionName);
}

// ---------------------------------------------------------------------------------------------
// Component property schemas — ported field-for-field from the real basic catalog's own
// component definitions (`specification/v1_0/catalogs/basic/catalog.json`).
//
// Every one of the real catalog's 18 components is composed the same way:
//   `allOf: [ComponentCommon, (Checkable,) {its own properties}]` + `unevaluatedProperties: false`.
// The two builders below reproduce that composition literally — `.strict()` is Zod's equivalent of
// the `unevaluatedProperties: false` closure, and the shared halves are spread in rather than
// copy-pasted 18 times.
// ---------------------------------------------------------------------------------------------

/**
 * `common_types.json#/$defs/ComponentCommon` minus `id` — the interpreter strips `id`/`component`
 * off the wire object before per-type validation, so `accessibility` is the only part of
 * ComponentCommon that ever reaches a props schema. All 18 components `allOf` ComponentCommon, so
 * `accessibility` is legal on every one of them.
 *
 * This was a real bug before the full-catalog pass: no props schema listed `accessibility`, and
 * every schema is `.strict()`, so a spec-valid component carrying it was refused with
 * `VALIDATION_FAILED` ("Unrecognized key(s) in object: 'accessibility'"). `AccessibilityAttributes`
 * existed as a tested wire type in `common-types.ts` but nothing actually accepted it on a
 * component.
 */
const COMMON_PROPS = { accessibility: AccessibilityAttributesSchema.optional() };

/**
 * `weight` is **not** part of ComponentCommon — each of the 18 components re-declares it
 * individually, with an identical type and description ("The relative weight of this component
 * within a Row or Column..."). Verified identical across all 18 before hoisting it here.
 */
const WEIGHT_PROP = { weight: z.number().optional() };

/**
 * `common_types.json#/$defs/Checkable` — mixed in by exactly 6 of the 18 (`Button`, `TextField`,
 * `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput`), verified against each component's own
 * `allOf` list rather than assumed from which ones "look like" form inputs. `checks` is a real
 * `CheckRule[]`, not an unvalidated array — `specification/v1_0/test/cases/button_checks.json` and
 * `checkable_components.json` both exercise nested `and`/`or`/`not`/`required` check compositions
 * these schemas must actually accept.
 */
const CHECKABLE_PROPS = { checks: z.array(CheckRuleSchema).optional() };

function componentProps<Shape extends z.ZodRawShape>(own: Shape) {
  return z.object({ ...COMMON_PROPS, ...WEIGHT_PROP, ...own }).strict();
}

function checkableComponentProps<Shape extends z.ZodRawShape>(own: Shape) {
  return z.object({ ...COMMON_PROPS, ...WEIGHT_PROP, ...CHECKABLE_PROPS, ...own }).strict();
}

const TextPropsSchema = componentProps({
  text: DynamicStringSchema,
  variant: z.enum(['caption', 'body']).default('body'),
});

const JUSTIFY_VALUES = ['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'] as const;
const ALIGN_VALUES = ['center', 'end', 'start', 'stretch'] as const;

const ContainerPropsSchema = componentProps({
  children: ChildListSchema,
  justify: z.enum(JUSTIFY_VALUES).default('start'),
  align: z.enum(ALIGN_VALUES).default('stretch'),
});

const ButtonPropsSchema = checkableComponentProps({
  child: ChildSchema,
  variant: z.enum(['default', 'primary', 'borderless']).default('default'),
  action: ActionSchema,
});

const ImagePropsSchema = componentProps({
  url: DynamicStringSchema,
  description: DynamicStringSchema.optional(),
  fit: z.enum(['contain', 'cover', 'fill', 'none', 'scaleDown']).default('fill'),
  variant: z.enum(['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header']).default('mediumFeature'),
});

/**
 * The real `Icon.name` enum, all 59 members, generated directly from the fetched catalog JSON
 * rather than typed out by hand. Note it is **not** a `DynamicString`: the spec's `oneOf` admits a
 * literal enum member, a `{svgPath}` object, or a bare `DataBinding` — but *not* a `FunctionCall`.
 */
const ICON_NAMES = [
  'accountCircle', 'add', 'arrowBack', 'arrowForward', 'attachFile', 'calendarToday', 'call', 'camera',
  'check', 'close', 'delete', 'download', 'edit', 'event', 'error', 'fastForward', 'favorite',
  'favoriteOff', 'folder', 'help', 'home', 'info', 'locationOn', 'lock', 'lockOpen', 'mail', 'menu',
  'moreVert', 'moreHoriz', 'notificationsOff', 'notifications', 'pause', 'payment', 'person', 'phone',
  'photo', 'play', 'print', 'refresh', 'rewind', 'search', 'send', 'settings', 'share', 'shoppingCart',
  'skipNext', 'skipPrevious', 'star', 'starHalf', 'starOff', 'stop', 'upload', 'visibility',
  'visibilityOff', 'volumeDown', 'volumeMute', 'volumeOff', 'volumeUp', 'warning',
] as const;

const IconPropsSchema = componentProps({
  name: z.union([
    z.enum(ICON_NAMES),
    z.object({ svgPath: DynamicStringSchema }).strict(),
    DataBindingSchema,
  ]),
});

const VideoPropsSchema = componentProps({
  url: DynamicStringSchema,
  posterUrl: DynamicStringSchema.optional(),
});

const AudioPlayerPropsSchema = componentProps({
  url: DynamicStringSchema,
  description: DynamicStringSchema.optional(),
});

/** `List` is layout-shaped like Row/Column but has its own distinct property set: `direction` (not `justify`). */
const ListPropsSchema = componentProps({
  children: ChildListSchema,
  direction: z.enum(['vertical', 'horizontal']).default('vertical'),
  align: z.enum(['start', 'center', 'end', 'stretch']).default('stretch'),
});

const CardPropsSchema = componentProps({
  child: ChildSchema,
});

const TabsPropsSchema = componentProps({
  tabs: z
    .array(z.object({ title: DynamicStringSchema, child: ChildSchema }).strict())
    .min(1),
});

const ModalPropsSchema = componentProps({
  trigger: ChildSchema,
  content: ChildSchema,
});

const DividerPropsSchema = componentProps({
  axis: z.enum(['horizontal', 'vertical']).default('horizontal'),
});

const TextFieldPropsSchema = checkableComponentProps({
  label: DynamicStringSchema,
  value: DynamicStringSchema.optional(),
  placeholder: DynamicStringSchema.optional(),
  variant: z.enum(['longText', 'number', 'shortText', 'obscured']).default('shortText'),
});

const CheckBoxPropsSchema = checkableComponentProps({
  label: DynamicStringSchema,
  value: DynamicBooleanSchema,
});

const ChoicePickerPropsSchema = checkableComponentProps({
  label: DynamicStringSchema.optional(),
  variant: z.enum(['multipleSelection', 'mutuallyExclusive']).default('mutuallyExclusive'),
  // `options.items.value` is a plain `string`, deliberately NOT a DynamicString — the real schema
  // calls it "the stable value associated with this option", and the array has no `minItems`, so an
  // empty `options` array is spec-legal.
  options: z.array(z.object({ label: DynamicStringSchema, value: z.string() }).strict()),
  value: DynamicStringListSchema,
  displayStyle: z.enum(['checkbox', 'chips']).default('checkbox'),
  filterable: z.boolean().default(false),
});

const SliderPropsSchema = checkableComponentProps({
  label: DynamicStringSchema.optional(),
  // `min`/`max` are plain numbers here (only `value` is dynamic), and `max` is required while
  // `min` has a default of 0 — an asymmetry copied from the real schema, not a transcription slip.
  min: z.number().default(0),
  max: z.number(),
  value: DynamicNumberSchema,
  steps: z.number().int().min(1).optional(),
});

/**
 * `DateTimeInput.min`/`max` — the one place in the 18 where the real schema is genuinely ambiguous,
 * so this is a **documented judgment call** rather than a literal port.
 *
 * The real definition is `allOf: [DynamicString, {if: {type: string}, then: {oneOf: [{format: date},
 * {format: time}, {format: date-time}]}}]`. Two readings collide:
 *
 *  - JSON Schema's `format` is an *annotation* by default — a validator only asserts it if it opts
 *    in (ajv, which the spec's own conformance runner uses, needs `ajv-formats` for this). Under
 *    that reading the constraint is advisory and any string passes.
 *  - But the author explicitly wrapped it in an `if`/`then`/`oneOf`, which is only meaningful as an
 *    *assertion*. A structural wrapper around three annotations would be dead weight otherwise.
 *
 * Decision: assert it, because a validating renderer catching a malformed agent-sent bound is the
 * entire point of this layer — but assert **ISO 8601** (what the property's own description says,
 * "in ISO 8601 format") rather than RFC 3339, which is what JSON Schema's `format: time`/`date-time`
 * formally mean. RFC 3339 *requires* a UTC offset, so a literal `"09:00"` would be refused under it
 * while being perfectly good ISO 8601 and an obvious thing for an agent to send. Rejecting that
 * seemed clearly worse than accepting a value RFC 3339 purists would call under-specified.
 *
 * So: literal strings must parse as an ISO 8601 date, time, or date-time (offset optional);
 * `DataBinding`/`FunctionCall` forms are passed through unchecked, since their value isn't known
 * until resolution time. `oneOf` is implemented as "matches at least one" — the three grammars are
 * mutually exclusive in practice, so exactly-one and at-least-one coincide.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})?$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})?$/;

const IsoDateTimeBoundSchema = DynamicStringSchema.superRefine((value, ctx) => {
  if (typeof value !== 'string') return;
  if (ISO_DATE.test(value) || ISO_TIME.test(value) || ISO_DATE_TIME.test(value)) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `literal date/time bound ${JSON.stringify(value)} is not an ISO 8601 date, time, or date-time`,
  });
});

const DateTimeInputPropsSchema = checkableComponentProps({
  value: DynamicStringSchema,
  enableDate: z.boolean().default(false),
  enableTime: z.boolean().default(false),
  min: IsoDateTimeBoundSchema.optional(),
  max: IsoDateTimeBoundSchema.optional(),
  label: DynamicStringSchema.optional(),
});

/**
 * Real basic-catalog functions this port can actually evaluate (boolean combinators — unambiguous
 * from the fetched schema alone, no formatting/locale semantics to guess at). Arg shapes copied
 * field-for-field from `specification/v1_0/catalogs/basic/catalog.json`'s own function
 * definitions, cross-checked against the spec repo's own conformance fixtures
 * (`specification/v1_0/test/cases/button_checks.json`, fetched and inspected this session) — an
 * earlier version of this port had `and`/`or` reading an arbitrary flat map of args instead of the
 * real `{values: DynamicBoolean[]}` shape (a plural, array-typed, `minItems: 2` property), caught
 * by cross-referencing that real fixture rather than trusting this file's own first read of
 * `common_types.json` alone (which only shows the generic `FunctionCall` envelope, not any one
 * function's own specific `args` shape).
 */
function and(args: Record<string, unknown>): boolean {
  const values = Array.isArray(args.values) ? args.values : [];
  return values.length > 0 && values.every((v) => v === true);
}
function or(args: Record<string, unknown>): boolean {
  const values = Array.isArray(args.values) ? args.values : [];
  return values.some((v) => v === true);
}
/** `not`'s arg shape (singular `value`, not `values`) was already correct — real basic catalog: `args: {value: DynamicBoolean}`. */
function not(args: Record<string, unknown>): boolean {
  return args.value !== true;
}

/**
 * Builds the demo catalog this port's interpreter/fixture is validated against. A fresh object
 * each call (not a shared singleton) so tests can register their own `impl`s / mutate a copy
 * without cross-test leakage.
 */
export function createLabCatalog(): Catalog {
  // All 18 components of the real basic catalog, in that catalog's own declaration order.
  const components = new Map<string, ComponentSpec>([
    ['Text', { kind: 'text', propsSchema: TextPropsSchema }],
    ['Image', { kind: 'image', propsSchema: ImagePropsSchema }],
    ['Icon', { kind: 'icon', propsSchema: IconPropsSchema }],
    ['Video', { kind: 'video', propsSchema: VideoPropsSchema }],
    ['AudioPlayer', { kind: 'audio', propsSchema: AudioPlayerPropsSchema }],
    ['Row', { kind: 'container', propsSchema: ContainerPropsSchema }],
    ['Column', { kind: 'container', propsSchema: ContainerPropsSchema }],
    ['List', { kind: 'container', propsSchema: ListPropsSchema }],
    ['Card', { kind: 'card', propsSchema: CardPropsSchema }],
    ['Tabs', { kind: 'tabs', propsSchema: TabsPropsSchema }],
    ['Modal', { kind: 'modal', propsSchema: ModalPropsSchema }],
    ['Divider', { kind: 'divider', propsSchema: DividerPropsSchema }],
    ['Button', { kind: 'button', propsSchema: ButtonPropsSchema }],
    ['TextField', { kind: 'input', propsSchema: TextFieldPropsSchema }],
    ['CheckBox', { kind: 'input', propsSchema: CheckBoxPropsSchema }],
    ['ChoicePicker', { kind: 'input', propsSchema: ChoicePickerPropsSchema }],
    ['Slider', { kind: 'input', propsSchema: SliderPropsSchema }],
    ['DateTimeInput', { kind: 'input', propsSchema: DateTimeInputPropsSchema }],
  ]);

  const functions = new Map<string, FunctionSpec>([
    ['and', { returnType: 'boolean', callableFrom: 'rendererOnly', impl: and }],
    ['or', { returnType: 'boolean', callableFrom: 'rendererOnly', impl: or }],
    ['not', { returnType: 'boolean', callableFrom: 'rendererOnly', impl: not }],
    // Lab-only demo functions (not part of the real basic catalog) — exist purely to exercise
    // all three callableFrom values, see module doc.
    [
      'greetUser',
      {
        returnType: 'string',
        callableFrom: 'rendererOrAgent',
        impl: (args) => `Hello, ${typeof args.name === 'string' ? args.name : 'there'}!`,
      },
    ],
    ['logServerEvent', { returnType: 'void', callableFrom: 'agentOnly', impl: () => undefined }],
    ['adminReset', { returnType: 'void', callableFrom: 'rendererOnly', impl: () => undefined }],
  ]);

  return { catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json#lab-subset', components, functions };
}
