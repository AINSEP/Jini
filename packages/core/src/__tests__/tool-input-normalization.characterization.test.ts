import { describe, expect, it } from 'vitest';
import { ToolInputError, ToolInputNormalizationError } from '../tool-input-errors.js';
import { canonicalizeToolInputKeys, normalizeToolInput, withNormalizationNotes } from '../tool-input-normalization.js';
import type { ToolRegistration } from '../tool-registry.js';

type Definition = Pick<ToolRegistration, 'descriptor' | 'normalizeInput'>;
const tool = (inputSchema: unknown, normalizeInput?: Definition['normalizeInput']): Definition =>
  ({ descriptor: { id: 'pin', inputSchema: inputSchema as Definition['descriptor']['inputSchema'] }, ...(normalizeInput ? { normalizeInput } : {}) });
const run = (input: unknown, inputSchema: unknown, normalizeInput?: Definition['normalizeInput']) =>
  normalizeToolInput({ input, registration: tool(inputSchema, normalizeInput) });
const closed = (properties: Record<string, unknown>, required: unknown = Object.keys(properties)) =>
  ({ type: 'object', additionalProperties: false, properties, required });

describe('normalizeToolInput: schema shapes that leave input untouched', () => {
  it('returns any input unchanged when there is no object schema', async () => {
    expect(await run('raw', undefined)).toEqual({ input: 'raw', notes: [] });
  });

  it('returns a non-object value unchanged when the schema is not an object tool', async () => {
    expect(await run(7, { type: 'integer' })).toEqual({ input: 7, notes: [] });
  });

  it('treats a non-object properties field as no declared properties', async () => {
    expect(await run({ a_b: '1' }, { type: 'object', properties: 'bogus' })).toEqual({ input: { a_b: '1' }, notes: [] });
  });

  it('passes an unknown key through an open schema using an object additionalProperties schema', async () => {
    const result = await run({ extra: 'true' }, { type: 'object', additionalProperties: { type: 'boolean' } });
    expect(result).toEqual({ input: { extra: true }, notes: ['extra: string→boolean'] });
  });

  it('records the nested location of an additionalProperties coercion', async () => {
    const schema = { type: 'object', properties: { box: { type: 'object', additionalProperties: { type: 'integer' } } } };
    expect((await run({ box: { n: '4' } }, schema)).notes).toEqual(['box.n: string→integer']);
  });
});

describe('normalizeToolInput: scalar coercion', () => {
  it('trims and lower-cases boolean words', async () => {
    expect((await run({ on: '  TRUE ' }, closed({ on: { type: 'boolean' } }))).input).toEqual({ on: true });
  });

  it('accepts a single type string as well as a type list', async () => {
    expect((await run({ n: '2' }, closed({ n: { type: ['integer', 'null'] } }))).input).toEqual({ n: 2 });
  });

  it('notes number when a schema allows both number and integer, and keeps an unsafe integer', async () => {
    const result = await run({ n: '9007199254740993' }, closed({ n: { type: ['integer', 'number'] } }));
    expect(result).toEqual({ input: { n: 9007199254740992 }, notes: ['n: string→number'] });
  });

  it('leaves a numeric string that overflows to Infinity', async () => {
    expect((await run({ n: '1e999' }, closed({ n: { type: 'number' } }))).input).toEqual({ n: '1e999' });
  });

  it('leaves a non-numeric string for a number field', async () => {
    expect((await run({ n: 'ten' }, closed({ n: { type: 'number' } }))).input).toEqual({ n: 'ten' });
  });

  it('leaves a string when the schema permits neither boolean nor number', async () => {
    expect((await run({ n: 'true' }, closed({ n: { type: 'object' } }))).input).toEqual({ n: 'true' });
  });

  it('leaves a non-string scalar alone', async () => {
    expect((await run({ n: true }, closed({ n: { type: 'integer' } }))).input).toEqual({ n: true });
  });
});

describe('normalizeToolInput: arrays', () => {
  it('maps each array element through the items schema with indexed paths', async () => {
    const result = await run({ list: ['1', '2'] }, closed({ list: { type: 'array', items: { type: 'integer' } } }));
    expect(result).toEqual({ input: { list: [1, 2] }, notes: ['list[0]: string→integer', 'list[1]: string→integer'] });
  });

  it('wraps a single object only under a property named items, including nested', async () => {
    const schema = closed({ box: closed({ items: { type: 'array', items: { type: 'object' } } }) });
    const result = await run({ box: { items: { a: 1 } } }, schema);
    expect(result).toEqual({ input: { box: { items: [{ a: 1 }] } }, notes: ['box.items: object→one-item array'] });
  });

  it('does not wrap a single object under any other array property', async () => {
    expect((await run({ list: { a: 1 } }, closed({ list: { type: 'array' } }))).input).toEqual({ list: { a: 1 } });
  });

  it('returns a scalar unchanged for an array-typed property', async () => {
    expect((await run({ list: 'x' }, closed({ list: { type: 'array' } }))).input).toEqual({ list: 'x' });
  });
});

describe('normalizeToolInput: key canonicalization and refusals', () => {
  it('prefixes rename notes with the parent path', async () => {
    const result = await run({ outer: { inner_key: 1 } }, closed({ outer: closed({ innerKey: {} }) }));
    expect(result.notes).toEqual(['outer.inner_key→innerKey']);
  });

  it('names the nested location of an ambiguous key', async () => {
    const schema = { type: 'object', properties: { outer: { type: 'object', properties: { fooBar: {}, foo_bar: {} } } } };
    await expect(run({ outer: { 'foo-bar': 1 } }, schema)).rejects.toThrow("Ambiguous input 'outer.foo-bar': matches fooBar, foo_bar. Use exactly one canonical property name.");
  });

  it('names both colliding keys and the canonical target', async () => {
    await expect(run({ a_b: 1, 'a-b': 2 }, closed({ aB: {} }))).rejects.toThrow("Conflicting inputs 'a_b' and 'a-b' both name 'aB'. Send only 'aB'.");
  });

  it('accepts an unknown key when additionalProperties is not false', async () => {
    expect((await run({ other: 1 }, { type: 'object', properties: { a: {} } })).input).toEqual({ other: 1 });
  });

  it('ignores non-string and non-array required lists when hinting', async () => {
    await expect(run({ ab: 1 }, closed({ abc: {} }, 'abc'))).rejects.toThrow("Unknown input 'ab'. Use only the declared properties");
    await expect(run({ ab: 1 }, closed({ abc: {} }, [3, 'abc']))).rejects.toThrow("Unknown input 'ab'; possible required property: abc. Use the canonical property explicitly; no value was guessed.");
  });

  it('hints only required names, not optional ones', async () => {
    await expect(run({ ab: 1 }, closed({ abc: {} }, []))).rejects.toThrow("Unknown input 'ab'. Use only the declared properties; declare target and permission fields in the tool schema before using them.");
  });

  it.each([
    ['substitution', 'abxd', 'abcd'],
    ['adjacent transposition', 'abdc', 'abcd'],
    ['deletion', 'abd', 'abcd'],
    ['insertion', 'abxcd', 'abcd'],
    ['last-character change', 'abcx', 'abcd'],
  ])('hints a %s', async (_kind, key, name) => {
    await expect(run({ [key]: 1 }, closed({ [name]: {} }))).rejects.toThrow(`possible required property: ${name}.`);
  });

  it.each([
    ['two edits', 'axcy', 'abcd'],
    ['a non-adjacent swap', 'dbca', 'abcd'],
    ['a length gap of two', 'ab', 'abcd'],
    ['a key longer than 128', 'a'.repeat(129), 'a'.repeat(128) + 'b'],
    ['a name longer than 128', 'a'.repeat(128), 'a'.repeat(129)],
  ])('gives no hint for %s', async (_kind, key, name) => {
    await expect(run({ [key]: 1 }, closed({ [name]: {} }))).rejects.toThrow(/^Unknown input '[a-z]+'\. Use only the declared properties/);
  });

  it('compares hint shapes ignoring separators and case', async () => {
    await expect(run({ Expected_Versoin: 1 }, closed({ expectedVersion: {} }))).rejects.toThrow('possible required property: expectedVersion.');
  });
});

describe('normalizeToolInput: depth limit', () => {
  const nested = (levels: number): Record<string, unknown> => {
    let value: Record<string, unknown> = {};
    for (let level = 0; level < levels; level++) value = { a: value };
    return value;
  };
  const recursive: Record<string, unknown> = { type: 'object' };
  recursive.properties = { a: recursive };

  it('accepts input 64 levels below the root', async () => {
    expect((await run(nested(64), recursive)).input).toEqual(nested(64));
  });

  it('refuses input 65 levels below the root', async () => {
    await expect(run(nested(65), recursive)).rejects.toThrow('Tool input exceeds the 64-level normalization limit. Send a shallower object.');
  });

  it('does not count levels without a schema', async () => {
    expect((await run(nested(80), { type: 'object' })).input).toEqual(nested(80));
  });
});

describe('normalizeToolInput: gate wrapping and the domain hook', () => {
  it('wraps a ToolInputError as a ToolInputNormalizationError with the same message', async () => {
    const error = await run({ a_b: 1, 'a-b': 2 }, closed({ aB: {} })).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ToolInputNormalizationError);
    expect((error as Error).message).toBe("Conflicting inputs 'a_b' and 'a-b' both name 'aB'. Send only 'aB'.");
  });

  it('rethrows a non-input error from the hook unchanged', async () => {
    const failure = new RangeError('hook broke');
    const error = await run({ a: 1 }, closed({ a: {} }), () => { throw failure; }).catch((caught: unknown) => caught);
    expect(error).toBe(failure);
  });

  it('wraps a ToolInputError thrown by the hook', async () => {
    const error = await run({ a: 1 }, closed({ a: {} }), () => { throw new ToolInputError({ message: 'hook refused' }); }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ToolInputNormalizationError);
    expect((error as Error).message).toBe('hook refused');
  });

  it('refuses a hook result that is not an object for an object tool', async () => {
    await expect(run({ a: 1 }, closed({ a: {} }), () => ({ input: 'x', notes: [] }))).rejects.toThrow('pin: normalization must produce one input object.');
  });

  it('accepts a non-object hook result when the schema is not an object tool', async () => {
    expect(await run({ a: 1 }, { properties: { a: {} } }, () => ({ input: 'x', notes: ['n'] }))).toEqual({ input: 'x', notes: ['n'] });
  });

  it('skips the hook when the first pass did not yield an object', async () => {
    let called = false;
    expect(await run('x', undefined, () => { called = true; return { input: {}, notes: [] }; })).toEqual({ input: 'x', notes: [] });
    expect(called).toBe(false);
  });

  it('closes the schema only on the final pass so the hook can rename unknown keys', async () => {
    const hook: Definition['normalizeInput'] = ({ input }) => ({ input: { a: input.legacy }, notes: ['legacy→a'] });
    expect(await run({ legacy: 1 }, closed({ a: {} }), hook)).toEqual({ input: { a: 1 }, notes: ['legacy→a'] });
  });
});

describe('canonicalizeToolInputKeys', () => {
  const schema = closed({ maxChars: { type: 'integer' }, items: { type: 'array', items: { type: 'object' } } });

  it('renames keys but does not coerce values or wrap items', () => {
    expect(canonicalizeToolInputKeys({ input: { max_chars: '10', items: { a: 1 } }, schema }))
      .toEqual({ input: { maxChars: '10', items: { a: 1 } }, notes: ['max_chars→maxChars'] });
  });

  it('keeps unknown keys because the closed check belongs to the final pass', () => {
    expect(canonicalizeToolInputKeys({ input: { other: 1 }, schema }).input).toEqual({ other: 1 });
  });

  it('throws the unwrapped ToolInputError on a collision', () => {
    let error: unknown;
    try { canonicalizeToolInputKeys({ input: { max_chars: 1, maxChars: 2 }, schema }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ToolInputError);
    expect(error).not.toBeInstanceOf(ToolInputNormalizationError);
    expect((error as Error).message).toBe("Conflicting inputs 'max_chars' and 'maxChars' both name 'maxChars'. Send only 'maxChars'.");
  });

  it('maps array elements with keys-only canonicalization', () => {
    const listSchema = closed({ items: { type: 'array', items: closed({ themeId: { type: 'integer' } }) } });
    expect(canonicalizeToolInputKeys({ input: { items: [{ theme_id: '1' }] }, schema: listSchema }))
      .toEqual({ input: { items: [{ themeId: '1' }] }, notes: ['items[0].theme_id→themeId'] });
  });
});

describe('withNormalizationNotes', () => {
  it('returns the output itself when there are no notes', () => {
    const output = { a: 1 };
    expect(withNormalizationNotes({ output, notes: [] })).toBe(output);
  });

  it('adds notes to an object without a content array', () => {
    expect(withNormalizationNotes({ output: { a: 1, content: 'text' }, notes: ['x→y'] })).toEqual({ a: 1, content: 'text', normalizationNotes: ['x→y'] });
  });

  it('wraps a non-object, non-string result', () => {
    expect(withNormalizationNotes({ output: 5, notes: ['x→y', 'p→q'] })).toEqual({ result: 5, normalizationNotes: ['x→y', 'p→q'] });
  });
});
