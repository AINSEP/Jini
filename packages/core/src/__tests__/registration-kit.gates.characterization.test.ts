import { describe, expect, it } from 'vitest';
import type { AgentToolDefinition, AgentToolSideEffect } from '../agent-tools.js';
import {
  assertToolIsWirable, buildDomainRegistrations, decorateWithSchema, fromResult, humanConfirmedHandler, indexCatalogById,
  mergeDerivedRiskMaps, optionalBoolean, optionalNumber, optionalString, requireNoInput, requireNumber, requireObject,
  withSchemaOnRejection,
} from '../registration-kit.js';
import { ToolInputError, type ToolHandler } from '../tool-registry.js';
import type { ToolInputNormalizer } from '../tool-input-normalization.js';

const inputSchema = { type: 'object' } as const;
const entry = (name: string, overrides: Partial<AgentToolDefinition> = {}): AgentToolDefinition =>
  ({ name, description: `${name} description`, sideEffects: 'none', authorization: { permission: 'p' }, inputSchema, ...overrides });
const schemaless = (name: string): AgentToolDefinition => { const { inputSchema: _omitted, ...rest } = entry(name); return rest; };
const handler: ToolHandler = async () => 'ok';
const human = humanConfirmedHandler({ prepare: async () => null, askHuman: async () => ({ confirmed: true }), run: async () => 'ran' });

describe('input readers: exact refusals and pass-through', () => {
  it('indexCatalogById keys entries by name', () => {
    const a = entry('a'); const b = entry('b');
    expect([...indexCatalogById({ catalog: [a, b] })]).toEqual([['a', a], ['b', b]]);
  });

  it('requireNumber refuses a non-finite present number without a key hint', () => {
    expect(() => requireNumber({ input: { n: Number.NaN, x: 1 }, key: 'n' })).toThrow(new ToolInputError({ message: "'n' (number) is required" }));
  });

  it('requireNumber returns a finite number', () => {
    expect(requireNumber({ input: { n: 0 }, key: 'n' })).toBe(0);
  });

  it('requireObject refuses an array value', () => {
    expect(() => requireObject({ input: { o: [] }, key: 'o' })).toThrow(new ToolInputError({ message: "'o' (object) is required" }));
  });

  it('requireObject returns the record', () => {
    const value = { a: 1 };
    expect(requireObject({ input: { o: value }, key: 'o' })).toBe(value);
  });

  it.each([
    ['optionalString', () => optionalString({ input: { k: 1 }, key: 'k' }), "'k' must be a string"],
    ['optionalNumber', () => optionalNumber({ input: { k: Infinity }, key: 'k' }), "'k' must be a number"],
    ['optionalBoolean', () => optionalBoolean({ input: { k: 'true' }, key: 'k' }), "'k' must be a boolean"],
  ])('%s names the field and type it expected', (_name, read, message) => {
    expect(read).toThrow(new ToolInputError({ message }));
  });

  it('optional readers return undefined for an absent key and the value when valid', () => {
    expect([optionalString({ input: {}, key: 'k' }), optionalNumber({ input: {}, key: 'k' }), optionalBoolean({ input: {}, key: 'k' })]).toEqual([undefined, undefined, undefined]);
    expect([optionalString({ input: { k: '' }, key: 'k' }), optionalNumber({ input: { k: -1 }, key: 'k' }), optionalBoolean({ input: { k: false }, key: 'k' })]).toEqual(['', -1, false]);
  });

  it('requireNoInput accepts undefined and an empty object, refuses a non-record', () => {
    expect(requireNoInput({ input: undefined })).toBeUndefined();
    expect(requireNoInput({ input: {} })).toBeUndefined();
    expect(() => requireNoInput({ input: 'x' })).toThrow(new ToolInputError({ message: "this tool accepts no input — omit 'input' or pass {}" }));
  });

  it('fromResult unwraps ok and throws the error of a failed result', async () => {
    expect(await fromResult({ fn: async () => ({ ok: true as const, value: 3 }) })).toBe(3);
    const failure = new Error('domain failed');
    await expect(fromResult({ fn: async () => ({ ok: false as const, error: failure }) })).rejects.toBe(failure);
  });
});

describe('schema decoration', () => {
  const catalog = indexCatalogById({ catalog: [entry('t'), schemaless('bare')] });

  it('omits the schema for a tool that publishes none or is not in the catalog', () => {
    const expected = 'bad. Fix the input and retry — this will not resolve on retry without an input change.';
    expect(decorateWithSchema({ toolId: 'bare', catalog, message: 'bad' }).message).toBe(expected);
    expect(decorateWithSchema({ toolId: 'missing', catalog, message: 'bad' }).message).toBe(expected);
  });

  it('stringifies an object rejection that has no message', async () => {
    const error = await withSchemaOnRejection({ toolId: 'bare', catalog, isShapeRejection: () => true, fn: () => Promise.reject({ code: 1 }) }).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe('[object Object]. Fix the input and retry — this will not resolve on retry without an input change.');
  });

  it('stringifies a null rejection', async () => {
    const error = await withSchemaOnRejection({ toolId: 'bare', catalog, isShapeRejection: () => true, fn: () => Promise.reject(null) }).catch((caught: unknown) => caught);
    expect((error as Error).message).toMatch(/^null\. Fix the input/);
  });

  it('returns the value of a successful call', async () => {
    expect(await withSchemaOnRejection({ toolId: 't', catalog, isShapeRejection: () => true, fn: async () => 5 })).toBe(5);
  });
});

describe('assertToolIsWirable', () => {
  const risk = (sideEffects: AgentToolSideEffect = 'none') => new Map([['t', sideEffects]]);

  it.each([
    ['an empty permission', { permission: '' }],
    ['a blank permission', { permission: '   ' }],
    ['a non-string permission', { permission: 3 }],
  ])('refuses %s', (_kind, authorization) => {
    // Malformed catalog fixture on purpose: the gate must refuse what the type would forbid.
    const catalogEntry = entry('t', { authorization: authorization as unknown as AgentToolDefinition['authorization'] });
    expect(() => assertToolIsWirable({ toolId: 't', catalogEntry, derivedRisk: risk() })).toThrow("tool-registrations: 't' must declare an authorization permission before wiring");
  });

  it('refuses an entry with no authorization object at all', () => {
    // Malformed catalog fixture on purpose.
    const catalogEntry = { ...entry('t'), authorization: undefined } as unknown as AgentToolDefinition;
    expect(() => assertToolIsWirable({ toolId: 't', catalogEntry, derivedRisk: risk() })).toThrow("tool-registrations: 't' must declare an authorization permission before wiring");
  });

  it('refuses an unclassified tool', () => {
    expect(() => assertToolIsWirable({ toolId: 't', catalogEntry: entry('t'), derivedRisk: new Map() }))
      .toThrow("tool-registrations: 't' has no entry in DERIVED_RISK_BY_TOOL_ID — classify what its handler actually does before wiring it (unknown operations are refused, never assumed safe)");
  });

  it('refuses a declared side effect that disagrees with the derived one', () => {
    expect(() => assertToolIsWirable({ toolId: 't', catalogEntry: entry('t'), derivedRisk: risk('deletes-durable-state') }))
      .toThrow("tool-registrations: 't' declares sideEffects 'none' but this layer derives 'deletes-durable-state' from what its handler calls — reconcile the two rather than trusting the declaration");
  });

  const humanMessage = "tool-registrations: 't' declares actorClassRule 'confirmer-must-equal-own-delegatedBy', which needs a human confirmer — build its handler with humanConfirmedHandler so a human answers through the host's confirmation transport (see ACTOR_CLASS_RULES_REQUIRING_CONFIRMATION_TRANSPORT)";
  const ruled = entry('t', { actorClassRule: 'confirmer-must-equal-own-delegatedBy' });

  it('refuses a confirmation-rule tool checked without a handler', () => {
    expect(() => assertToolIsWirable({ toolId: 't', catalogEntry: ruled, derivedRisk: risk() })).toThrow(humanMessage);
  });

  it('refuses a confirmation-rule tool with a plain handler', () => {
    expect(() => assertToolIsWirable({ toolId: 't', catalogEntry: ruled, derivedRisk: risk() }, { handler })).toThrow(humanMessage);
  });

  it('accepts a confirmation-rule tool with a human-confirmed handler', () => {
    expect(assertToolIsWirable({ toolId: 't', catalogEntry: ruled, derivedRisk: risk() }, { handler: human })).toBeUndefined();
  });

  it('does not require a human for other actor rules', () => {
    for (const actorClassRule of ['user-only', 'none'] as const) {
      expect(assertToolIsWirable({ toolId: 't', catalogEntry: entry('t', { actorClassRule }), derivedRisk: risk() }, { handler })).toBeUndefined();
    }
  });
});

describe('buildDomainRegistrations', () => {
  const base = (catalog: AgentToolDefinition[], handlers: Record<string, ToolHandler>) => ({
    domain: 'Things', catalogModule: 'things/agent-tools.ts', catalog: indexCatalogById({ catalog }), handlers,
    derivedRisk: new Map(catalog.map(item => [item.name, item.sideEffects])),
  });

  it('refuses a handler with no catalog entry', () => {
    expect(() => buildDomainRegistrations(base([], { ghost: handler })))
      .toThrow("tool-registrations: Things catalog has no entry named 'ghost' — things/agent-tools.ts drifted");
  });

  it('runs the wirability gate before the schema check', () => {
    expect(() => buildDomainRegistrations({ ...base([schemaless('t')], { t: handler }), derivedRisk: new Map() }))
      .toThrow("'t' has no entry in DERIVED_RISK_BY_TOOL_ID");
  });

  it('refuses a wired tool without an input schema', () => {
    expect(() => buildDomainRegistrations(base([schemaless('t')], { t: handler })))
      .toThrow("tool-registrations: wired tool 't' publishes no inputSchema — add one to its entry in things/agent-tools.ts so the model gets a contract, or leave the tool unwired");
  });

  it('builds a descriptor, handler and allow-all policy, in handler order, with no optional fields by default', async () => {
    const [b, a] = buildDomainRegistrations(base([entry('a'), entry('b', { sideEffects: 'mutates-durable-state' })], { b: handler, a: handler }));
    expect(b).toEqual({ descriptor: { id: 'b', description: 'b description', inputSchema, readOnly: false, sideEffects: 'mutates-durable-state' }, handler, policy: { authorize: expect.any(Function) } });
    expect(a!.descriptor.id).toBe('a');
    expect(await b!.policy.authorize({ principal: { id: 'p' }, run: { id: 'r' }, tool: b!.descriptor, input: {} })).toBe('allow');
  });

  it('prefers catalog metadata over the host metadata map', () => {
    const own = { search: { keywords: 'own' } };
    const [registration] = buildDomainRegistrations({ ...base([entry('t', { metadata: own })], { t: handler }), metadata: { t: { search: { keywords: 'host' } } } });
    expect(registration!.descriptor.metadata).toBe(own);
  });

  it('falls back to the host metadata map', () => {
    const host = { search: { keywords: 'host' } };
    const [registration] = buildDomainRegistrations({ ...base([entry('t')], { t: handler }), metadata: { t: host } });
    expect(registration!.descriptor.metadata).toBe(host);
  });

  it('attaches only the normalizer registered for that id', () => {
    const normalizer: ToolInputNormalizer = ({ input }) => ({ input, notes: [] });
    const [a, b] = buildDomainRegistrations({ ...base([entry('a'), entry('b')], { a: handler, b: handler }), inputNormalizers: { a: normalizer } });
    expect(a!.normalizeInput).toBe(normalizer);
    expect(b).not.toHaveProperty('normalizeInput');
  });

  it('refuses a catalog entry that is neither wired nor declared unwired', () => {
    expect(() => buildDomainRegistrations(base([entry('a'), entry('b')], { a: handler })))
      .toThrow("tool-registrations: Things catalog entry 'b' is neither wired nor declared unwired — wire a handler for it, or add it to that domain's unwired set with the reason recorded next to it");
  });

  it('accepts a catalog entry declared unwired', () => {
    expect(buildDomainRegistrations(base([entry('a'), entry('b')], { a: handler }), { unwiredToolIds: new Set(['b']) })).toHaveLength(1);
  });

  it('lets a catalog entry named like an Object.prototype member skip the unwired tripwire (reported, not fixed)', () => {
    expect(buildDomainRegistrations(base([entry('toString')], {}))).toEqual([]);
  });

  it('attaches an inherited Object.prototype member as the normalizer of a tool named after it (reported, not fixed)', () => {
    const [registration] = buildDomainRegistrations({ ...base([entry('toString')], { toString: handler }), inputNormalizers: {} });
    expect(registration!.normalizeInput).toBe(Object.prototype.toString);
  });
});

describe('mergeDerivedRiskMaps', () => {
  it('merges disjoint slices in order', () => {
    const merged = mergeDerivedRiskMaps({ slices: [
      { domain: 'A', risk: new Map<string, AgentToolSideEffect>([['a', 'none']]) },
      { domain: 'B', risk: new Map<string, AgentToolSideEffect>([['b', 'deletes-durable-state']]) },
    ] });
    expect([...merged]).toEqual([['a', 'none'], ['b', 'deletes-durable-state']]);
  });

  it('refuses an id classified by two domains', () => {
    expect(() => mergeDerivedRiskMaps({ slices: [
      { domain: 'A', risk: new Map<string, AgentToolSideEffect>([['x', 'none']]) },
      { domain: 'B', risk: new Map<string, AgentToolSideEffect>([['x', 'none']]) },
    ] })).toThrow("tool-registrations: tool id 'x' is wired by both the A and B domains — one id must resolve to exactly one handler; wire it in whichever domain owns the real operation and declare it unwired in the other");
  });
});
