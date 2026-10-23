import { describe, expect, it } from 'vitest';
import { normalizeToolInput, withNormalizationNotes } from '../tool-input-normalization.js';
import { withBatchInput } from '../batch-tool-inputs.js';
import { authorizeToolInvocation } from '../tool-registry.js';
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

  it.each(['expectedVersoin', 'expectedVersio', 'expectedVersions'])('applies the sole near-miss required property %s', async key => {
    expect(await normalize({ [key]: '3' })).toEqual({
      input: { expectedVersion: 3 }, notes: [`${key}→expectedVersion`, 'expectedVersion: string→integer'],
    });
  });

  it.each(['id', 'menuI', 'menu_idd'])('applies the sole optional menuId hint for %s without exposing values', async key => {
    const input = { [key]: 'private-menu-value' };
    const definition = { descriptor: { id: 'read', inputSchema: { type: 'object', additionalProperties: false, properties: { menuId: { type: 'string' } } } } };
    expect(await normalizeToolInput({ input, registration: definition })).toEqual({
      input: { menuId: 'private-menu-value' }, notes: [`${key}→menuId`],
    });
    expect(input).toEqual({ [key]: 'private-menu-value' });
  });

  it('applies a sole resource-specific id shorthand in either direction', async () => {
    const definition = { descriptor: { id: 'read', inputSchema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } } } } };
    expect(await normalizeToolInput({ input: { menuId: 'private-menu-value' }, registration: definition })).toEqual({
      input: { id: 'private-menu-value' }, notes: ['menuId→id'],
    });
  });

  it('lists required names first even without a near miss', async () => {
    const definition = { descriptor: { id: 'read', inputSchema: {
      type: 'object', additionalProperties: false, required: ['expectedVersion'],
      properties: { menuId: { type: 'string' }, expectedVersion: { type: 'integer' } },
    } } };
    await expect(normalizeToolInput({ input: { unrelated: 'private-menu-value' }, registration: definition })).rejects.toThrow(
      "Unknown input 'unrelated'. Declared inputs: expectedVersion (required), menuId (optional). Resend with the declared name.",
    );
  });

  it('lists multiple id suggestions required first without selecting a property', async () => {
    const definition = { descriptor: { id: 'read', inputSchema: {
      type: 'object', additionalProperties: false, required: ['pageId'],
      properties: { menuId: { type: 'string' }, pageId: { type: 'string' } },
    } } };
    await expect(normalizeToolInput({ input: { id: 'private-menu-value' }, registration: definition })).rejects.toThrow(
      "Unknown input 'id'. Declared inputs: pageId (required), menuId (optional). Did you mean 'pageId', 'menuId'? Resend with the declared name.",
    );
  });

  it('includes the nested array path in a sole-hint rename note', async () => {
    expect(await normalize({ items: [{ id: 'private-theme-value' }] })).toEqual({
      input: { items: [{ themeId: 'private-theme-value' }] }, notes: ['items[0].id→themeId'],
    });
  });

  it.each([
    { id: 'private-value', entityId: 'other-private-value' },
    { entityId: 'other-private-value', id: 'private-value' },
  ])('refuses a sole hint colliding with its canonical key in either order', async input => {
    const definition = { descriptor: { id: 'remove', inputSchema: { type: 'object', additionalProperties: false, properties: { entityId: { type: 'string' } } } } };
    await expect(normalizeToolInput({ input, registration: definition })).rejects.toThrow("Send only 'entityId'");
  });

  it('keeps exact names ahead of shape matches and near misses', async () => {
    const definition = { descriptor: { id: 'read', inputSchema: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string' }, entityId: { type: 'string' }, topic: { type: 'string' }, topics: { type: 'array', items: { type: 'string' } },
      fooBar: {}, foo_bar: {},
    } } } };
    const input = { id: 'private-value', topics: ['one', 'two'], fooBar: 1 };
    expect(await normalizeToolInput({ input, registration: definition })).toEqual({ input, notes: [] });
  });

  it('prefers a case/separator match over other near-miss candidates', async () => {
    const definition = { descriptor: { id: 'read', inputSchema: { type: 'object', additionalProperties: false, properties: { id: {}, entityId: {}, entityIds: {} } } } };
    expect(await normalizeToolInput({ input: { ENTITY_ID: 'private-value' }, registration: definition })).toEqual({
      input: { entityId: 'private-value' }, notes: ['ENTITY_ID→entityId'],
    });
  });

  it('refuses two near-miss candidates instead of selecting the first', async () => {
    const definition = { descriptor: { id: 'read', inputSchema: { type: 'object', additionalProperties: false, properties: { topic: {}, tonic: {} } } } };
    await expect(normalizeToolInput({ input: { topnic: 'private-value' }, registration: definition })).rejects.toThrow("Did you mean 'topic', 'tonic'?");
  });

  it.each([
    ['topics', 'topic'], ['topic', 'topics'],
  ])('applies the sole singular/plural hint from %s to %s', async (key, name) => {
    const definition = { descriptor: { id: 'guide', inputSchema: { type: 'object', additionalProperties: false, properties: { [name]: { type: 'string' } } } } };
    const input = { [key]: ['private-topic'] };
    expect(await normalizeToolInput({ input, registration: definition })).toEqual({
      input: { [name]: 'private-topic' }, notes: [`${key}→${name}`, `${name}: one-item string array→string`],
    });
    expect(input).toEqual({ [key]: ['private-topic'] });
  });

  it('unwraps a string array at the canonical field and records no values', async () => {
    expect(await normalize({ caption: ['private-caption'] })).toEqual({
      input: { caption: 'private-caption' }, notes: ['caption: one-item string array→string'],
    });
  });

  it.each([
    { value: ['plugins', 'how-tovu-works-plugins'] }, { value: [] }, { value: [3] }, { value: [null] },
    { value: [{}] }, { value: [['plugins']] }, { value: ['plugins', 3] },
  ])('refuses a non-singleton or malformed string array $value without exposing its values', async ({ value }) => {
    const definition = { descriptor: { id: 'guide', inputSchema: { type: 'object', additionalProperties: false, properties: { operation: { type: 'string' }, topic: { type: 'string' } } } } };
    await expect(normalizeToolInput({ input: { operation: 'explain', topics: value }, registration: definition })).rejects.toThrow(
      "topic: send one value as a string or a one-element string array.",
    );
  });

  it('preserves arrays allowed by a union and unconstrained nested data', async () => {
    const data = { topics: ['private-one', 'private-two'], id: 'private-id' };
    const definition = { descriptor: { id: 'read', inputSchema: { properties: {
      topic: { type: ['string', 'array'], items: { type: 'string' } }, data: {},
    } } } };
    const result = await normalizeToolInput({ input: { topic: ['one', 'two'], data }, registration: definition });
    expect(result).toEqual({ input: { topic: ['one', 'two'], data }, notes: [] });
    expect((result.input as { data: unknown }).data).toEqual(data);
  });

  it('normalizes a sole id hint before authorization and retains its note through batching', async () => {
    const seen: unknown[] = [];
    const definition: ToolRegistration = {
      descriptor: { id: 'remove', inputSchema: { type: 'object', additionalProperties: false, properties: { entityId: { type: 'string' } } } },
      policy: { authorize: ({ input }) => { seen.push(input); return 'allow'; } },
      handler: async ({ input }) => ({ removed: (input as { entityId: string }).entityId === 'private-target' }),
    };
    const batched = withBatchInput({ registration: definition, tool: { toolId: 'remove' } });
    const context = { signal: new AbortController().signal, principal: { id: 'owner' }, run: { id: 'run' }, executionId: 'execution' };
    const output = await batched.handler({ ...context, input: { items: [{ id: 'private-target' }] } }, {
      invokeTool: async ({ toolId, input }, { registry } = {}) => {
        const admitted = await authorizeToolInvocation({ registry: registry!, toolId, input, principal: { id: 'owner' }, run: { id: 'run' } });
        if (!admitted || admitted.decision !== 'allow') throw new Error('authorization refused');
        return admitted.handler({ ...context, input: admitted.input });
      },
    });
    expect(seen).toEqual([{ entityId: 'private-target' }]);
    expect(output).toMatchObject({ succeeded: 1, failed: 0, results: [{ ok: true, result: { removed: true, normalizationNotes: ['id→entityId'] } }] });
  });

  it('refuses unknown fields even in an empty closed schema before a guard can lose them', async () => {
    await expect(normalizeToolInput({ input: { site: 'other' }, registration: { descriptor: { id: 'empty', inputSchema: { type: 'object', additionalProperties: false } } } })).rejects.toThrow("Unknown input 'site'. Declared inputs: none. Resend with the declared name.");
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

it('execution-only callback fields remain closed and do not enter the model-facing descriptor', async () => {
  const descriptor = { id: 'ask', inputSchema: { type: 'object', additionalProperties: false, properties: { question: { type: 'string' } } } };
  const callback = { choice: 'Now', ticket: 'bound-ticket' };
  const invocationSchema = { type: 'object', additionalProperties: false, properties: { question: { type: 'string' }, choice: { type: 'string' }, ticket: { type: 'string' } } };
  expect(await normalizeToolInput({ input: callback, registration: { descriptor, invocationSchema } })).toEqual({ input: callback, notes: [] });
  await expect(normalizeToolInput({ input: callback, registration: { descriptor } })).rejects.toThrow("Unknown input 'choice'");
  await expect(normalizeToolInput({ input: { ...callback, invented: true }, registration: { descriptor, invocationSchema } })).rejects.toThrow("Unknown input 'invented'");
  expect(descriptor.inputSchema.properties).toEqual({ question: { type: 'string' } });
});
