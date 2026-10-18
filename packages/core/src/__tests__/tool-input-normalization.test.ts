import { describe, expect, it } from 'vitest';
import { normalizeToolInput, withNormalizationNotes } from '../tool-input-normalization.js';
import type { ToolRegistration } from '../tool-registry.js';

const schema = {
  type: 'object', additionalProperties: false, required: ['expectedVersion'],
  properties: {
    expectedVersion: { type: 'integer' }, isEnabled: { type: 'boolean' },
    amount: { type: 'number' }, caption: { type: 'string' },
    data: { type: 'object', additionalProperties: true },
    items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { themeId: { type: 'string' } } } },
  },
};
const registration = { descriptor: { id: 'example', inputSchema: schema } };
const normalize = (input: unknown, definition = registration) => normalizeToolInput({ input, registration: definition });

describe('schema-guided tool input normalization', () => {
  it.each(['expected_version', 'expected-version', 'ExpectedVersion', 'EXPECTEDVERSION'])('accepts %s and records only keys/types', async key => {
    const input = { [key]: '3', is_enabled: 'true', amount: '-2.5e2', caption: '3' };
    const result = await normalize(input);
    expect(result.input).toEqual({ expectedVersion: 3, isEnabled: true, amount: -250, caption: '3' });
    expect(result.notes).toContain(`${key}→expectedVersion`);
    expect(result.notes).toContain('expectedVersion: string→integer');
    expect(input).toEqual({ [key]: '3', is_enabled: 'true', amount: '-2.5e2', caption: '3' });
  });

  it('normalizes nested keys and one-object items while preserving unstructured data', async () => {
    const data = { arbitrary_key: 'true', count: '3' };
    const result = await normalize({ expectedVersion: 3, items: { 'theme-id': 'plain' }, data });
    expect(result.input).toEqual({ expectedVersion: 3, items: [{ themeId: 'plain' }], data });
    expect(result.notes).toContain('items: object→one-item array');
    expect(result.notes.join(' ')).not.toContain('private value');
  });

  it.each(['', 'Infinity', 'NaN', '0x10', '3.5', '3x', '9007199254740993'])('leaves invalid integer %j for the validator', async value => {
    expect((await normalize({ expectedVersion: value })).input).toEqual({ expectedVersion: value });
  });

  it('does not coerce values where the schema also permits strings', async () => {
    const result = await normalizeToolInput({ input: { value: 'true' }, registration: { descriptor: { id: 'union', inputSchema: { properties: { value: { type: ['boolean', 'string'] } } } } } });
    expect(result).toEqual({ input: { value: 'true' }, notes: [] });
  });

  it('keeps false and zero distinct and refuses to infer booleans from arbitrary strings', async () => {
    expect((await normalize({ expectedVersion: '0', isEnabled: 'false', amount: '0' })).input)
      .toEqual({ expectedVersion: 0, isEnabled: false, amount: 0 });
    expect((await normalize({ expectedVersion: 3, isEnabled: 'yes' })).input)
      .toEqual({ expectedVersion: 3, isEnabled: 'yes' });
  });

  it('rejects canonical/variant collisions without picking one value', async () => {
    await expect(normalize({ expectedVersion: 3, expected_version: 4 })).rejects.toThrow("Send only 'expectedVersion'");
  });

  it('rejects a variant that can name two schema properties', async () => {
    await expect(normalizeToolInput({ input: { 'foo-bar': 1 }, registration: { descriptor: { id: 'ambiguous', inputSchema: { properties: { fooBar: {}, foo_bar: {} } } } } })).rejects.toThrow('matches fooBar, foo_bar');
  });

  it.each(['expectedVersoin', 'expectedVersio', 'expectedVersions'])('refuses to discard near-miss required property %s', async key => {
    await expect(normalize({ [key]: 3 })).rejects.toThrow('Use the canonical property explicitly');
  });

  it('refuses unknown fields even in an empty closed schema before a guard can lose them', async () => {
    await expect(normalizeToolInput({ input: { site: 'other' }, registration: { descriptor: { id: 'empty', inputSchema: { type: 'object', additionalProperties: false } } } })).rejects.toThrow("Unknown input 'site'. Use only the declared properties");
  });

  it('lets a domain alias run before closed-schema checks, then normalizes its canonical result', async () => {
    const definition: Pick<ToolRegistration, 'descriptor' | 'normalizeInput'> = {
      descriptor: { id: 'alias', inputSchema: schema },
      normalizeInput: ({ input }) => { const { version, ...rest } = input; return { input: { ...rest, expectedVersion: version }, notes: ['version→expectedVersion'] }; },
    };
    expect(await normalizeToolInput({ input: { version: '3' }, registration: definition })).toEqual({ input: { expectedVersion: 3 }, notes: ['version→expectedVersion', 'expectedVersion: string→integer'] });
  });

  it('requires one input object for object tools', async () => {
    for (const input of [null, [], '3']) await expect(normalize(input)).rejects.toThrow('send one input object');
  });

  it('appends notes to MCP text without removing human surfaces', () => {
    const content = [{ type: 'resource', resource: { uri: 'ui://private' } }];
    const output = withNormalizationNotes({ output: { content }, notes: ['region→handle'] });
    expect(output).toEqual({ content: [...content, { type: 'text', text: 'normalized: region→handle' }], normalizationNotes: ['region→handle'] });
    expect(withNormalizationNotes({ output: 'ok', notes: ['region→handle'] })).toBe('ok\nnormalized: region→handle');
  });
});
