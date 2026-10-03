import { describe, expect, it } from 'vitest';
import { createLabCatalog, type Catalog, type FunctionSpec } from '../catalog.js';
import { resolveDynamicValue, type ResolveContext } from '../resolve.js';

const catalog = createLabCatalog({});

function ctx(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return { dataModel: { user: { name: 'Ada', active: true } }, catalog, side: 'renderer', ...overrides };
}

describe('resolveDynamicValue — literals', () => {
  it('passes through a literal string/number/boolean/array unchanged', () => {
    expect(resolveDynamicValue({ value: 'hi', ctx: ctx() })).toEqual({ ok: true, value: 'hi' });
    expect(resolveDynamicValue({ value: 42, ctx: ctx() })).toEqual({ ok: true, value: 42 });
    expect(resolveDynamicValue({ value: true, ctx: ctx() })).toEqual({ ok: true, value: true });
    expect(resolveDynamicValue({ value: [1, 2], ctx: ctx() })).toEqual({ ok: true, value: [1, 2] });
  });
});

describe('resolveDynamicValue — DataBinding', () => {
  it('resolves an absolute path against the data model root', () => {
    expect(resolveDynamicValue({ value: { path: '/user/name' }, ctx: ctx() })).toEqual({ ok: true, value: 'Ada' });
  });

  it('adversarial: a path that does not resolve degrades sanely (does not throw), tagged PATH_NOT_FOUND', () => {
    const result = resolveDynamicValue({ value: { path: '/user/nonexistent/deeper' }, ctx: ctx() });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, reason: 'PATH_NOT_FOUND' });
  });

  it('resolves a relative path inside an item scope (collection-scope binding)', () => {
    const scoped = ctx({ dataModel: { items: [{ label: 'first' }, { label: 'second' }] }, itemScope: { basePath: '/items', index: 1 } });
    expect(resolveDynamicValue({ value: { path: 'label' }, ctx: scoped }, { itemScope: scoped.itemScope })).toEqual({ ok: true, value: 'second' });
  });

  it('adversarial: a relative path used outside any item scope degrades sanely, not throws', () => {
    const result = resolveDynamicValue({ value: { path: 'label' }, ctx: ctx() });
    expect(result).toMatchObject({ ok: false, reason: 'RELATIVE_PATH_OUTSIDE_LIST_CONTEXT' });
  });

  // Regression: a relative path is still RFC 6901 syntax, so `~1` means a literal `/` inside one
  // key. Resolving it used to split the raw string on `/` and re-escape each piece, so a relative
  // `a~1b` reached the key named `a~1b` while the equivalent absolute pointer reached `a/b`. Both
  // spellings must agree — that disagreement is what this pins.
  const escapedKeyModel = { items: [{ 'a/b': 'CORRECT', 'a~1b': 'literal-tilde-one-key' }] };

  it('resolves a relative path whose token contains an escaped "/" (~1) to the same key an absolute pointer reaches', () => {
    const scoped = ctx({ dataModel: escapedKeyModel, itemScope: { basePath: '/items', index: 0 } });
    expect(resolveDynamicValue({ value: { path: 'a~1b' }, ctx: scoped }, { itemScope: scoped.itemScope })).toEqual({ ok: true, value: 'CORRECT' });
    expect(resolveDynamicValue({ value: { path: '/items/0/a~1b' }, ctx: scoped }, { itemScope: scoped.itemScope })).toEqual({ ok: true, value: 'CORRECT' });
  });

  it('resolves a relative path whose token contains an escaped "~" (~0)', () => {
    const scoped = ctx({ dataModel: { items: [{ 'a~b': 'tilde' }] }, itemScope: { basePath: '/items', index: 0 } });
    expect(resolveDynamicValue({ value: { path: 'a~0b' }, ctx: scoped }, { itemScope: scoped.itemScope })).toEqual({ ok: true, value: 'tilde' });
  });
});

describe('resolveDynamicValue — FunctionCall / @index system function', () => {
  it('resolves @index to the current item scope index plus optional offset', () => {
    const scoped = ctx({ itemScope: { basePath: '/items', index: 2 } });
    expect(resolveDynamicValue({ value: { call: '@index' }, ctx: scoped }, { itemScope: scoped.itemScope })).toEqual({ ok: true, value: 2 });
    expect(resolveDynamicValue({ value: { call: '@index', args: { offset: 1 } }, ctx: scoped }, { itemScope: scoped.itemScope })).toEqual({ ok: true, value: 3 });
  });

  it('treats a resolved-but-non-numeric offset as 0 rather than producing NaN or throwing', () => {
    const scoped = ctx({ itemScope: { basePath: '/items', index: 5 } });
    expect(resolveDynamicValue({ value: { call: '@index', args: { offset: 'not-a-number' } }, ctx: scoped }, { itemScope: scoped.itemScope })).toEqual({ ok: true, value: 5 });
  });

  it('propagates a failed @index offset resolution instead of silently falling back to 0', () => {
    const scoped = ctx({ itemScope: { basePath: '/items', index: 2 } });
    const result = resolveDynamicValue({ value: { call: '@index', args: { offset: { path: '/nope' } } }, ctx: scoped }, { itemScope: scoped.itemScope });
    expect(result).toMatchObject({ ok: false, reason: 'PATH_NOT_FOUND' });
  });

  it('adversarial: @index outside a list context degrades sanely, tagged INDEX_OUTSIDE_LIST_CONTEXT', () => {
    const result = resolveDynamicValue({ value: { call: '@index' }, ctx: ctx() });
    expect(result).toMatchObject({ ok: false, reason: 'INDEX_OUTSIDE_LIST_CONTEXT' });
  });

  it('evaluates a registered, callable-from-this-side function (real basic-catalog "not")', () => {
    expect(resolveDynamicValue({ value: { call: 'not', args: { value: false } }, ctx: ctx() })).toEqual({ ok: true, value: true });
  });

  it('evaluates "and"/"or" over the real basic-catalog arg shape: args.values, an array of DynamicBoolean (not an arbitrary flat map — verified against the spec repo\'s own basic_catalog.json and button_checks.json conformance fixture)', () => {
    expect(resolveDynamicValue({ value: { call: 'and', args: { values: [true, { path: '/user/active' }] } }, ctx: ctx() })).toEqual({ ok: true, value: true });
    expect(resolveDynamicValue({ value: { call: 'or', args: { values: [false, false] } }, ctx: ctx() })).toEqual({ ok: true, value: false });
    expect(resolveDynamicValue({ value: { call: 'or', args: { values: [false, true] } }, ctx: ctx() })).toEqual({ ok: true, value: true });
  });

  it('resolves nested DataBinding/FunctionCall entries INSIDE an array-typed arg (not just the top-level arg value) — the exact shape real button "checks" compose and/or/required in', () => {
    // Mirrors the nesting shape in the spec repo's own button_checks.json fixture: and(values: [<nested FunctionCall>, ...]).
    const result = resolveDynamicValue({ value: { call: 'and', args: { values: [{ path: '/user/active' }, { call: 'not', args: { value: false } }] } }, ctx: ctx() }
    );
    expect(result).toEqual({ ok: true, value: true });
  });

  it('adversarial: a failing nested resolution inside an array-typed arg propagates instead of being silently dropped', () => {
    const result = resolveDynamicValue({ value: { call: 'and', args: { values: [true, { path: '/does/not/exist' }] } }, ctx: ctx() });
    expect(result).toMatchObject({ ok: false, reason: 'PATH_NOT_FOUND' });
  });

  it('adversarial: and/or called with a malformed (missing or non-array) "values" arg degrades to a defined, non-throwing result instead of crashing on a bad wire message', () => {
    expect(resolveDynamicValue({ value: { call: 'and' }, ctx: ctx() })).toEqual({ ok: true, value: false });
    expect(resolveDynamicValue({ value: { call: 'and', args: { values: 'not-an-array' } }, ctx: ctx() })).toEqual({ ok: true, value: false });
    expect(resolveDynamicValue({ value: { call: 'or', args: {} }, ctx: ctx() })).toEqual({ ok: true, value: false });
  });

  it('adversarial: an unregistered function name degrades sanely, tagged FUNCTION_NOT_REGISTERED', () => {
    const result = resolveDynamicValue({ value: { call: 'doesNotExist' }, ctx: ctx() });
    expect(result).toMatchObject({ ok: false, reason: 'FUNCTION_NOT_REGISTERED' });
  });

  it('adversarial: an agentOnly function invoked from the renderer side is refused, tagged FUNCTION_NOT_CALLABLE_FROM_SIDE', () => {
    const result = resolveDynamicValue({ value: { call: 'logServerEvent' }, ctx: ctx({ side: 'renderer' }) });
    expect(result).toMatchObject({ ok: false, reason: 'FUNCTION_NOT_CALLABLE_FROM_SIDE' });
  });

  it('adversarial: a rendererOnly function invoked from the agent side is refused (the exact case the spec names explicitly)', () => {
    const result = resolveDynamicValue({ value: { call: 'adminReset' }, ctx: ctx({ side: 'agent' }) });
    expect(result).toMatchObject({ ok: false, reason: 'FUNCTION_NOT_CALLABLE_FROM_SIDE' });
  });

  it('the same rendererOnly function succeeds when invoked from its actually-permitted side (renderer)', () => {
    expect(resolveDynamicValue({ value: { call: 'adminReset' }, ctx: ctx({ side: 'renderer' }) })).toEqual({ ok: true, value: undefined });
  });

  it('a rendererOrAgent function is callable from either side', () => {
    expect(resolveDynamicValue({ value: { call: 'greetUser', args: { name: 'Ada' } }, ctx: ctx({ side: 'renderer' }) })).toEqual({ ok: true, value: 'Hello, Ada!' });
    expect(resolveDynamicValue({ value: { call: 'greetUser', args: { name: 'Ada' } }, ctx: ctx({ side: 'agent' }) })).toEqual({ ok: true, value: 'Hello, Ada!' });
  });

  it('greetUser falls back to "there" when called with no (or a non-string) name arg', () => {
    expect(resolveDynamicValue({ value: { call: 'greetUser' }, ctx: ctx() })).toEqual({ ok: true, value: 'Hello, there!' });
    expect(resolveDynamicValue({ value: { call: 'greetUser', args: { name: 42 } }, ctx: ctx() })).toEqual({ ok: true, value: 'Hello, there!' });
  });

  it('reports FUNCTION_NOT_IMPLEMENTED for a registered function with no impl, rather than crashing', () => {
    const base = createLabCatalog({});
    const functions = new Map<string, FunctionSpec>(base.functions);
    functions.set('registeredOnly', { returnType: 'void', callableFrom: 'rendererOnly' });
    const noImplCatalog: Catalog = { ...base, functions };
    const result = resolveDynamicValue({ value: { call: 'registeredOnly' }, ctx: ctx({ catalog: noImplCatalog }) });
    expect(result).toMatchObject({ ok: false, reason: 'FUNCTION_NOT_IMPLEMENTED' });
  });

  it('propagates a failed nested-arg resolution instead of swallowing it', () => {
    const result = resolveDynamicValue({ value: { call: 'not', args: { value: { path: '/nope' } } }, ctx: ctx() });
    expect(result).toMatchObject({ ok: false, reason: 'PATH_NOT_FOUND' });
  });
});

// Regression (2026-07-29 audit). This module's own doc claims "**Never throws** ... no code path
// in this module can throw on bad *input data*". Two paths did.
describe('resolveDynamicValue — the two paths that broke the never-throws contract', () => {
  it('does not mistake a non-string "path" for a DataBinding', () => {
    // `isFunctionCall` already required `call` to be a string; `isDataBinding` checked only that
    // the key existed, so `{path: 7}` was routed into the binding resolver and died on
    // `path.startsWith`. It is not a binding — it is an ordinary object literal.
    expect(resolveDynamicValue({ value: { path: 7 } as never, ctx: ctx() })).toEqual({ ok: true, value: { path: 7 } });
    expect(resolveDynamicValue({ value: { path: null } as never, ctx: ctx() })).toEqual({ ok: true, value: { path: null } });
    expect(resolveDynamicValue({ value: { path: { nested: true } } as never, ctx: ctx() }))
      .toEqual({ ok: true, value: { path: { nested: true } } });
  });

  it('reports a throwing catalog implementation as a failure instead of letting it escape', () => {
    // `impl` is host-supplied and receives agent-authored args. An ordinary implementation
    // (`args.name.toUpperCase()`) throws the moment an agent sends a number, and that throw used
    // to travel all the way out through `applyAgentMessage` into the host's render.
    const base = createLabCatalog({});
    const functions = new Map<string, FunctionSpec>(base.functions);
    functions.set('shout', {
      returnType: 'string',
      callableFrom: 'rendererOrAgent',
      impl: (args) => (args.name as string).toUpperCase(),
    });
    const throwingCatalog: Catalog = { ...base, functions };

    const result = resolveDynamicValue({ value: { call: 'shout', args: { name: 42 } }, ctx: ctx({ catalog: throwingCatalog }) });
    expect(result).toMatchObject({ ok: false, reason: 'FUNCTION_THREW' });
    expect(result.ok ? '' : result.detail).toMatch(/shout/);
    // ...and the same function still returns its value when the args are the shape it expects.
    expect(resolveDynamicValue({ value: { call: 'shout', args: { name: 'ada' } }, ctx: ctx({ catalog: throwingCatalog }) }))
      .toEqual({ ok: true, value: 'ADA' });
  });

  it('reports a non-Error thrown by an implementation without crashing on it either', () => {
    const base = createLabCatalog({});
    const functions = new Map<string, FunctionSpec>(base.functions);
    functions.set('rude', {
      returnType: 'void',
      callableFrom: 'rendererOnly',
      impl: () => { throw 'just a string'; },
    });
    const result = resolveDynamicValue({ value: { call: 'rude' }, ctx: ctx({ catalog: { ...base, functions } }) });
    expect(result).toMatchObject({ ok: false, reason: 'FUNCTION_THREW' });
    expect(result.ok ? '' : result.detail).toContain('just a string');
  });
});
