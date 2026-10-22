/**
 * @module resolve
 *
 * Resolves A2UI's `Dynamic*` binding types (literal | `DataBinding` | `FunctionCall`) against a
 * surface's data model. This is the piece the task brief called out as GenUI/AG-UI having no
 * equivalent of: AG-UI's `state_update` event is "some path changed, some value" with no binding
 * *resolution* step — A2UI's `Dynamic*` types are unresolved references a renderer must actively
 * walk the data model to answer.
 *
 * **Never throws.** Every failure mode (a path that doesn't resolve, a function that isn't
 * registered, a function that crosses a `callableFrom` boundary it isn't allowed to cross, a
 * registered function whose implementation throws on the arguments it was handed, `@index`
 * used outside a list-template context) returns a tagged `ResolveFailure` instead — this is the
 * direct answer to this task's adversarial question "a binding whose path doesn't resolve — does
 * it crash or degrade sanely?": it degrades sanely, always, by construction (no code path in this
 * module can throw on bad *input data*; only a genuine programming error, e.g. calling this module
 * incorrectly, would).
 */
import { getAtPointer, joinPointer, parsePointerTokens } from './json-pointer.js';
import type { CallableFrom, Catalog, FunctionSpec } from './catalog.js';
import { callableFromOf, isFunctionRegistered } from './catalog.js';
import type { DataBinding, FunctionCall } from './common-types.js';

export type ResolveSide = 'renderer' | 'agent';

/** Set while resolving one item of a `ChildList` template (`common_types.json`'s "Collection Scope"): relative (no leading `/`) `DataBinding` paths resolve under `${basePath}/${index}/...` instead of the data-model root. */
export interface ItemScope {
  readonly basePath: string;
  readonly index: number;
}

export interface ResolveContext {
  readonly dataModel: unknown;
  readonly catalog: Catalog;
  /** Which side is *evaluating* this binding — the renderer resolving a component's own props (`'renderer'`), or something acting on the agent's behalf. A2UI's spec doesn't explicitly name a case where the agent-side evaluates a `Dynamic*` binding (that's a renderer-only concept — the agent only ever sends `callFunction` for direct RPC), but `callableFromOf` is checked against this side regardless, so a future agent-side evaluator (e.g. resolving `action.event.context` bindings before dispatch — which today happens on the renderer, see `interpreter.ts`'s `buildAction`) is covered by the same boundary without a second resolver. */
  readonly side: ResolveSide;
  readonly itemScope?: ItemScope | undefined;
}

export type ResolveFailureReason =
  | 'PATH_NOT_FOUND'
  | 'FUNCTION_NOT_REGISTERED'
  | 'FUNCTION_NOT_CALLABLE_FROM_SIDE'
  | 'FUNCTION_NOT_IMPLEMENTED'
  | 'FUNCTION_THREW'
  | 'INDEX_OUTSIDE_LIST_CONTEXT'
  | 'RELATIVE_PATH_OUTSIDE_LIST_CONTEXT';

export interface ResolveFailure {
  readonly ok: false;
  readonly reason: ResolveFailureReason;
  readonly detail: string;
}
export interface ResolveOk {
  readonly ok: true;
  readonly value: unknown;
}
export type ResolveResult = ResolveOk | ResolveFailure;

/**
 * `path` must actually be a *string*, not merely present — the same check `isFunctionCall` already
 * makes on `call`, and its absence here was a live crash rather than a nicety. `FunctionCall.args`
 * accepts a plain object (`common-types.ts`'s `ArgValueSchema` record branch), so an agent could
 * send `{path: 7}` as an arg, pass wire validation, get classified as a binding here, and blow up
 * on `path.startsWith` inside `resolveBindingPath` — a throw straight out through
 * `applyAgentMessage`, which this module's own doc says cannot happen.
 */
function isDataBinding(value: unknown): value is DataBinding {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'path' in value
    && typeof (value as { path: unknown }).path === 'string'
    && Object.keys(value).length === 1;
}
function isFunctionCall(value: unknown): value is FunctionCall {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'call' in value && typeof (value as { call: unknown }).call === 'string';
}

function resolveBindingPath(path: string, ctx: ResolveContext): ResolveResult {
  // A relative path is still RFC 6901 syntax, so its `~0`/`~1` escapes must be decoded into real
  // token text before `joinPointer` re-escapes them. Splitting the raw string on `/` instead would
  // hand `joinPointer` already-escaped text and double-escape it, making a relative `a~1b` resolve
  // the literal key `a~1b` while the equivalent absolute pointer correctly resolves `a/b`.
  const absolute = path.startsWith('/')
    ? path
    : ctx.itemScope
      ? joinPointer({ base: ctx.itemScope.basePath, tokens: [String(ctx.itemScope.index), ...parsePointerTokens({ pointer: `/${path}` })] })
      : null;
  if (absolute === null) {
    return { ok: false, reason: 'RELATIVE_PATH_OUTSIDE_LIST_CONTEXT', detail: `relative path "${path}" used outside a list-template item context` };
  }
  const result = getAtPointer({ doc: ctx.dataModel, pointer: absolute });
  if (!result.found) {
    return { ok: false, reason: 'PATH_NOT_FOUND', detail: `no value at "${absolute}" in the current data model` };
  }
  return { ok: true, value: result.value };
}

/** `@index` (the one system function, answered without the catalog): the item scope's index plus an optional, resolved `offset` arg (non-numeric counts as 0). */
function resolveIndexCall(call: FunctionCall, ctx: ResolveContext): ResolveResult {
  if (!ctx.itemScope) {
    return { ok: false, reason: 'INDEX_OUTSIDE_LIST_CONTEXT', detail: '@index used outside a list-template item context' };
  }
  const offsetArg = call.args?.offset;
  const offsetResult = offsetArg === undefined ? { ok: true as const, value: 0 } : resolveValue(offsetArg, ctx);
  if (!offsetResult.ok) return offsetResult;
  const offset = typeof offsetResult.value === 'number' ? offsetResult.value : 0;
  return { ok: true, value: ctx.itemScope.index + offset };
}

function isCallableFromSide(callableFrom: CallableFrom, side: ResolveSide): boolean {
  return callableFrom === 'rendererOrAgent' || (callableFrom === 'rendererOnly' && side === 'renderer') || (callableFrom === 'agentOnly' && side === 'agent');
}

/** The catalog-side refusals, in the order they apply: not registered, then the `callableFrom` boundary, then no implementation. Returns the implementation when all three pass. */
function lookUpCallableImpl(call: FunctionCall, ctx: ResolveContext): ResolveFailure | { readonly ok: true; readonly impl: NonNullable<FunctionSpec['impl']> } {
  if (!isFunctionRegistered({ catalog: ctx.catalog, functionName: call.call })) {
    return { ok: false, reason: 'FUNCTION_NOT_REGISTERED', detail: `function "${call.call}" is not registered in catalog "${ctx.catalog.catalogId}"` };
  }
  const callableFrom = callableFromOf({ catalog: ctx.catalog, functionName: call.call });
  if (!isCallableFromSide(callableFrom, ctx.side)) {
    return {
      ok: false,
      reason: 'FUNCTION_NOT_CALLABLE_FROM_SIDE',
      detail: `function "${call.call}" has callableFrom="${callableFrom}", not callable from the "${ctx.side}" side`,
    };
  }
  const impl = ctx.catalog.functions.get(call.call)?.impl;
  if (!impl) {
    return { ok: false, reason: 'FUNCTION_NOT_IMPLEMENTED', detail: `function "${call.call}" is registered but this renderer has no implementation for it` };
  }
  return { ok: true, impl };
}

/** Resolves every arg value in key order, stopping at the first failure. */
function resolveArgs(args: FunctionCall['args'], ctx: ResolveContext): ResolveFailure | { readonly ok: true; readonly value: Record<string, unknown> } {
  const resolvedArgs: Record<string, unknown> = {};
  for (const [key, argValue] of Object.entries(args ?? {})) {
    const argResult = resolveArgValue(argValue, ctx);
    if (!argResult.ok) return argResult;
    resolvedArgs[key] = argResult.value;
  }
  return { ok: true, value: resolvedArgs };
}

function resolveFunctionCall(call: FunctionCall, ctx: ResolveContext): ResolveResult {
  if (call.call === '@index') return resolveIndexCall(call, ctx);

  const lookup = lookUpCallableImpl(call, ctx);
  if (!lookup.ok) return lookup;
  const argsResult = resolveArgs(call.args, ctx);
  if (!argsResult.ok) return argsResult;
  // `impl` is host-supplied code handed agent-supplied arguments, and this module validates
  // neither against the other (the catalog's per-function arg schemas are not implemented — see
  // `catalog.ts`'s module doc). An entirely ordinary implementation therefore throws the moment an
  // agent sends the wrong shape (`args.name.toUpperCase()` on a number), and that throw used to
  // travel out through `applyAgentMessage` into the host's render, where nothing catches it. It is
  // a resolution failure like any other: reported, not propagated.
  try {
    return { ok: true, value: lookup.impl(argsResult.value) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: 'FUNCTION_THREW', detail: `function "${call.call}" threw while evaluating: ${detail}` };
  }
}

/**
 * Resolves one `FunctionCall` arg value, recursing into arrays element-by-element. Real
 * basic-catalog functions commonly type an arg as an *array* of `Dynamic*` values (e.g. `and`/`or`'s
 * `values: DynamicBoolean[]`, confirmed against `specification/v1_0/catalogs/basic/catalog.json`'s
 * own function definitions and the spec repo's `button_checks.json` conformance fixture, both
 * fetched this session) — `common_types.json`'s generic `DynamicValue` schema's own `array` branch
 * has no `items` sub-schema (it does not itself promise recursive binding resolution), so this
 * per-element recursion is a deliberate generalization by this port, not a literal requirement of
 * that one generic type — done because without it, an array-of-`DynamicBoolean` arg's own nested
 * `DataBinding`/`FunctionCall` entries would pass through unresolved (as raw, non-boolean objects)
 * to a function's `impl`, silently producing wrong results instead of a clean failure or a correct
 * answer. `resolveDynamicValue` itself is left alone (a literal-array `DynamicValue` at the top
 * level — e.g. a `DynamicStringList`'s literal-array branch — still passes through as-is, matching
 * the generic type's own contract); only this arg-resolution path recurses.
 */
function resolveArgValue(argValue: unknown, ctx: ResolveContext): ResolveResult {
  if (Array.isArray(argValue)) {
    const resolvedItems: unknown[] = [];
    for (const item of argValue) {
      const itemResult = resolveArgValue(item, ctx);
      if (!itemResult.ok) return itemResult;
      resolvedItems.push(itemResult.value);
    }
    return { ok: true, value: resolvedItems };
  }
  return resolveValue(argValue, ctx);
}

/** Resolves one `Dynamic*` value in an already-built context (the item scope, if any, is in `ctx`). */
function resolveValue(value: unknown, ctx: ResolveContext): ResolveResult {
  if (isDataBinding(value)) return resolveBindingPath(value.path, ctx);
  if (isFunctionCall(value)) return resolveFunctionCall(value, ctx);
  return { ok: true, value };
}

/** Resolves any `Dynamic*` value (`DynamicString`/`DynamicNumber`/`DynamicBoolean`/`DynamicStringList`/`DynamicValue` all share this one shape: literal | `DataBinding` | `FunctionCall`). */
export function resolveDynamicValue({ value, ctx }: { value: unknown; ctx: Omit<ResolveContext, 'itemScope'> }, { itemScope }: { itemScope?: ItemScope | undefined } = {}): ResolveResult {
  return resolveValue(value, { ...ctx, ...(itemScope === undefined ? {} : { itemScope }) });
}
