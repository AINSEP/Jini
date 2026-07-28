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
 * **Scope**: the real basic catalog (`specification/v1_0/catalogs/basic/catalog.json`, fetched and
 * inspected this session — 53KB, 18 components, 14 functions) is far larger than what this port
 * renders. `LAB_CATALOG` below implements 4 components verbatim from that real catalog's own
 * property definitions (`Text`, `Column`, `Row`, `Button` — copied field-for-field, including
 * default values and enum members) plus 3 of its real functions (`and`/`or`/`not`, the only ones
 * with unambiguous, fully-specified semantics reachable from the fetched schema text alone — the
 * others, e.g. `formatString`/`formatDate`, depend on formatting semantics not fully pinned down
 * in what was fetched, and were deliberately not guessed at). The remaining 14 basic-catalog
 * components (`Image`, `Icon`, `Video`, `AudioPlayer`, `List`, `Card`, `Tabs`, `Modal`, `Divider`,
 * `TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput`) and 11 functions are **not
 * implemented** — see `../source-map.md` for the full gap list. `LAB_CATALOG` also adds three
 * lab-only demo functions (`greetUser`/`logServerEvent`/`adminReset`, clearly not part of the real
 * basic catalog) purely to exercise all three `callableFrom` values end-to-end — the real basic
 * catalog's own 14 functions are all `rendererOnly`, which alone can't test the `agentOnly` /
 * `rendererOrAgent` boundary this spec explicitly calls out as security-relevant.
 */
import { z } from 'zod';
import {
  ActionSchema,
  CheckRuleSchema,
  ChildListSchema,
  ChildSchema,
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

export type ComponentKind = 'text' | 'container' | 'button';

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
// ---------------------------------------------------------------------------------------------

const TextPropsSchema = z
  .object({
    text: DynamicStringSchema,
    variant: z.enum(['caption', 'body']).default('body'),
    weight: z.number().optional(),
  })
  .strict();

const JUSTIFY_VALUES = ['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'] as const;
const ALIGN_VALUES = ['center', 'end', 'start', 'stretch'] as const;

const ContainerPropsSchema = z
  .object({
    children: ChildListSchema,
    justify: z.enum(JUSTIFY_VALUES).default('start'),
    align: z.enum(ALIGN_VALUES).default('stretch'),
    weight: z.number().optional(),
  })
  .strict();

const ButtonPropsSchema = z
  .object({
    child: ChildSchema,
    variant: z.enum(['default', 'primary', 'borderless']).default('default'),
    action: ActionSchema,
    weight: z.number().optional(),
    // Real Button mixes in `Checkable` (`common_types.json#/$defs/Checkable`), not just its own
    // properties — `checks` is a real `CheckRule[]`, not an unvalidated array (fixed after
    // cross-checking `specification/v1_0/test/cases/button_checks.json`'s real fixture, which
    // exercises a nested `and`/`or`/`required` check composition this schema must actually accept).
    checks: z.array(CheckRuleSchema).optional(),
  })
  .strict();

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
  const components = new Map<string, ComponentSpec>([
    ['Text', { kind: 'text', propsSchema: TextPropsSchema }],
    ['Column', { kind: 'container', propsSchema: ContainerPropsSchema }],
    ['Row', { kind: 'container', propsSchema: ContainerPropsSchema }],
    ['Button', { kind: 'button', propsSchema: ButtonPropsSchema }],
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
