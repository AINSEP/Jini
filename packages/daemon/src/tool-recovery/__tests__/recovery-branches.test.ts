/** Branch pins for `withToolFailureRecovery` (recovery.ts): every gate the recovery loop can stop at,
 *  the bounded diagnostic scan, the remedy-plan shapes it accepts or backs off from, and the
 *  credential-setup prefill checks. Real surface-exchange store, typed fakes for every other port. */
import { describe, expect, it, vi } from 'vitest';
import type { Principal, SurfaceEmitter, ToolDescriptor } from '@jini-ai/core';
import { createSystemClock } from '@jini-ai/core/primitives';
import type { ToolExecutor, ToolExecutionResult } from '../../tool-executor.js';
import { createSurfaceExchangeStore, SURFACE_DISMISSED_PARAM, type SurfaceExchangeStore } from '../../surface-exchanges.js';
import { createTimeoutScheduler } from '../../scheduler.js';
import { constrainPrincipalToReadOnlyTools } from '../../core/read-only-tools.js';
import { issueToolFailureDiagnostic, withToolFailureRecovery, type ToolFailureDiagnostic, type ToolFailureRecoveryDeps } from '../index.js';

type ExecuteArgs = Parameters<ToolExecutor['execute']>[0];
type ExecuteOptional = NonNullable<Parameters<ToolExecutor['execute']>[1]>;
type FormArgs = Parameters<ToolFailureRecoveryDeps['buildRecoveryForm']>[0];

const principal: Principal = { id: 'operator' };
const required: ExecuteArgs = { principal, run: { id: 'run' }, toolId: 'original', input: { label: 'fixture-label' } };
const readOnlyMessages = { unverifiableMessage: 'cannot verify', toolRefusalMessage: ({ toolId }: { toolId: string }) => `write refused: ${toolId}`, unknownToolMessage: () => 'unknown tool' };

function remedy(inputSchema: unknown, extra: Partial<ToolDescriptor> = {}): ToolDescriptor {
  return { id: 'remedy', readOnly: true, inputSchema, ...extra };
}
const objectSchema = (requiredKeys: unknown, properties: unknown = {}) => ({ type: 'object', required: requiredKeys, properties });

function diagnosticOf(fields: ToolFailureDiagnostic = { hint: 'saving a label may help', remedyToolId: 'remedy' }): ToolFailureDiagnostic {
  return issueToolFailureDiagnostic({ diagnostic: { ...fields } }, {});
}

interface Setup {
  readonly descriptors?: readonly ToolDescriptor[];
  readonly originalOutput?: unknown;
  readonly originalStatus?: ToolExecutionResult['status'];
  readonly remedyResult?: Omit<ToolExecutionResult, 'executionId'>;
  /** Output of every original call after the first (the retry); defaults to `'retried'`. */
  readonly retryOutput?: unknown;
  readonly containsSecret?: ToolFailureRecoveryDeps['containsSecret'];
  readonly assertCredentialFreeField?: ToolFailureRecoveryDeps['assertCredentialFreeField'];
}

interface Call { readonly toolId: string; readonly input: unknown; readonly optional: ExecuteOptional | undefined }

function harness(setup: Setup = {}) {
  const store: SurfaceExchangeStore = createSurfaceExchangeStore({ scheduler: createTimeoutScheduler({}, {}), clock: createSystemClock(),
    idGenerator: { newId: () => 'exchange' }, defaultChannel: 'mcp-ui' });
  const calls: Call[] = [];
  const forms: FormArgs[] = [];
  const secretChecks: string[] = [];
  const inner: ToolExecutor = {
    execute: async ({ toolId, input }, optional) => {
      calls.push({ toolId, input, optional });
      if (toolId === 'remedy') return { executionId: `remedy-${calls.length}`, ...(setup.remedyResult ?? { status: 'completed', output: { saved: true } }) };
      return { executionId: `original-${calls.length}`, status: setup.originalStatus ?? 'completed', output: calls.length === 1 ? setup.originalOutput : (setup.retryOutput ?? 'retried') };
    },
    resumeConfirmation: vi.fn(),
    cancel: vi.fn(),
    getAuditRecord: vi.fn(() => null),
  };
  const wrapped = withToolFailureRecovery({ inner, surfaceExchanges: store, registry: { list: () => setup.descriptors ?? [remedy(objectSchema([]))] },
    recoveryToolId: 'host-recovery',
    containsSecret: setup.containsSecret ?? (({ text }) => { secretChecks.push(text); return false; }),
    assertCredentialFreeField: setup.assertCredentialFreeField ?? (() => {}), readOnlyMessages,
    formatReadOnlyRemedyRefusal: ({ refusal }) => `Automatic recovery not attempted: ${refusal}`,
    buildRecoveryForm: (form) => { forms.push(form); return { form: form.exchangeId }; } }, {});
  /** An emitter that answers the recovery surface with `params` as soon as it is shown. */
  const answering = (params: Record<string, unknown>): SurfaceEmitter => async () => {
    store.deliver({ exchangeId: 'exchange', principalId: 'operator', params }, { toolId: 'host-recovery', channel: 'mcp-ui' });
  };
  return { inner, wrapped, calls, forms, secretChecks, answering };
}

const toolIds = (calls: readonly Call[]) => calls.map((call) => call.toolId);

describe('withToolFailureRecovery — when recovery is never considered', () => {
  it('returns a non-completed original result untouched without scanning it', async () => {
    const h = harness({ originalStatus: 'failed', originalOutput: diagnosticOf() });
    const result = await h.wrapped.execute(required, { emitSurface: h.answering({}) });
    expect(result).toEqual({ executionId: 'original-1', status: 'failed', output: expect.anything() });
    expect(toolIds(h.calls)).toEqual(['original']);
  });

  it('returns a completed result carrying no diagnostic untouched', async () => {
    const h = harness({ originalOutput: { rows: [1, 2, 3] } });
    expect((await h.wrapped.execute(required, { emitSurface: h.answering({}) })).output).toEqual({ rows: [1, 2, 3] });
    expect(toolIds(h.calls)).toEqual(['original']);
  });

  it('returns the original when there is no surface channel to ask through', async () => {
    const diagnostic = diagnosticOf();
    const h = harness({ originalOutput: diagnostic });
    expect((await h.wrapped.execute(required, {})).output).toBe(diagnostic);
    expect(toolIds(h.calls)).toEqual(['original']);
  });

  it('returns the original when called with no optional argument at all', async () => {
    const h = harness({ originalOutput: diagnosticOf() });
    expect((await h.wrapped.execute(required)).executionId).toBe('original-1');
    expect(h.calls[0]?.optional).toEqual({});
  });

  it.each<[string, ToolFailureDiagnostic]>([
    ['a hint with no remedy tool', { hint: 'may help' }],
    ['an empty hint', { hint: '', remedyToolId: 'remedy' }],
    ['an empty remedy tool id', { hint: 'may help', remedyToolId: '' }],
  ])('ignores an issued diagnostic with %s', async (_name, fields) => {
    const h = harness({ originalOutput: diagnosticOf(fields) });
    await h.wrapped.execute(required, { emitSurface: h.answering({}) });
    expect(toolIds(h.calls)).toEqual(['original']);
  });
});

describe('withToolFailureRecovery — bounded diagnostic scan', () => {
  const nestedIn = (value: unknown, levels: number): unknown => (levels === 0 ? value : { inner: nestedIn(value, levels - 1) });

  it('finds a diagnostic inside an array nested in an object', async () => {
    const h = harness({ originalOutput: { results: ['first', { other: true }, diagnosticOf()] } });
    await h.wrapped.execute(required, { emitSurface: h.answering({}) });
    expect(toolIds(h.calls)).toEqual(['original', 'remedy', 'original']);
  });

  it('finds a diagnostic at the deepest scanned depth (6)', async () => {
    const h = harness({ originalOutput: nestedIn(diagnosticOf(), 6) });
    await h.wrapped.execute(required, { emitSurface: h.answering({}) });
    expect(toolIds(h.calls)).toEqual(['original', 'remedy', 'original']);
  });

  it('ignores a diagnostic one level past the depth bound (7)', async () => {
    const h = harness({ originalOutput: nestedIn(diagnosticOf(), 7) });
    await h.wrapped.execute(required, { emitSurface: h.answering({}) });
    expect(toolIds(h.calls)).toEqual(['original']);
  });

  it('finds a diagnostic that is the 500th node visited', async () => {
    // The root array is node 1, its 498 leaves are nodes 2..499, the diagnostic is node 500.
    const h = harness({ originalOutput: [...Array.from({ length: 498 }, () => 0), diagnosticOf()] });
    await h.wrapped.execute(required, { emitSurface: h.answering({}) });
    expect(toolIds(h.calls)).toEqual(['original', 'remedy', 'original']);
  });

  it('ignores a diagnostic past the 500-node budget', async () => {
    const h = harness({ originalOutput: [...Array.from({ length: 499 }, () => 0), diagnosticOf()] });
    await h.wrapped.execute(required, { emitSurface: h.answering({}) });
    expect(toolIds(h.calls)).toEqual(['original']);
  });
});

describe('withToolFailureRecovery — remedy plan from the remedy tool schema', () => {
  async function planOutcome(descriptors: readonly ToolDescriptor[], input: unknown = required.input) {
    const h = harness({ descriptors, originalOutput: diagnosticOf() });
    await h.wrapped.execute({ ...required, input }, { emitSurface: h.answering({}) });
    return h;
  }

  it('backs off when the remedy tool is not registered', async () => {
    const h = await planOutcome([]);
    expect(toolIds(h.calls)).toEqual(['original']);
    expect(h.forms).toEqual([]);
  });

  it('backs off when the remedy schema is not an object', async () => {
    expect(toolIds((await planOutcome([remedy('not-a-schema')])).calls)).toEqual(['original']);
  });

  it('treats a non-array required list as no required fields', async () => {
    const h = await planOutcome([remedy({ type: 'object', required: 'label' })]);
    expect(h.calls[1]).toMatchObject({ toolId: 'remedy', input: {} });
  });

  it('ignores non-string entries in the required list', async () => {
    const h = await planOutcome([remedy(objectSchema([7, 'label']))]);
    expect(h.calls[1]).toMatchObject({ toolId: 'remedy', input: { label: 'fixture-label' } });
  });

  it('treats a non-object original input as supplying nothing', async () => {
    const h = await planOutcome([remedy(objectSchema(['label'], 'not-properties'))], 'raw text');
    // `label` is now the one unknown field, but non-object properties give it no text schema.
    expect(toolIds(h.calls)).toEqual(['original']);
  });

  it('backs off when more than one required field is unknown', async () => {
    const h = await planOutcome([remedy(objectSchema(['label', 'a', 'b'], { a: { type: 'string' }, b: { type: 'string' } }))]);
    expect(toolIds(h.calls)).toEqual(['original']);
    expect(h.forms).toEqual([]);
  });

  it('carries forward every JSON-primitive known field verbatim', async () => {
    const input = { s: 'text', n: 3, t: true, z: null, unrelated: 'dropped' };
    const h = await planOutcome([remedy(objectSchema(['s', 'n', 't', 'z']))], input);
    expect(h.calls[1]).toMatchObject({ toolId: 'remedy', input: { s: 'text', n: 3, t: true, z: null } });
  });

  it('backs off when a known required field is not a JSON primitive', async () => {
    expect(toolIds((await planOutcome([remedy(objectSchema(['label']))], { label: { nested: true } })).calls)).toEqual(['original']);
  });

  it('builds the recovery form without a field when nothing needs asking', async () => {
    const h = await planOutcome([remedy(objectSchema(['label']))]);
    expect(h.forms).toEqual([{ exchangeId: 'exchange', hint: 'saving a label may help', remedyToolId: 'remedy' }]);
  });

  it.each<[string, unknown]>([
    ['has no schema entry', {}],
    ['is not an object', { name: 'string' }],
    ['is a number', { name: { type: 'number' } }],
    ['mixes string with a non-null type', { name: { type: ['string', 'number'] } }],
  ])('backs off when the one unknown field %s', async (_name, properties) => {
    const h = await planOutcome([remedy(objectSchema(['label', 'name'], properties))]);
    expect(toolIds(h.calls)).toEqual(['original']);
    expect(h.forms).toEqual([]);
  });

  it('asks for a nullable string field using its description as the prompt', async () => {
    const h = await planOutcome([remedy(objectSchema(['label', 'name'], { name: { type: ['string', 'null'], description: 'Your account name' } }))]);
    expect(h.forms[0]?.askFor).toEqual({ key: 'name', prompt: 'Your account name' });
  });

  it.each<[string, unknown]>([
    ['blank', '   '],
    ['missing', undefined],
  ])('falls back to the field key as the prompt when its description is %s', async (_name, description) => {
    const h = await planOutcome([remedy(objectSchema(['label', 'name'], { name: { type: 'string', description } }))]);
    expect(h.forms[0]?.askFor).toEqual({ key: 'name', prompt: 'name' });
  });
});

describe('withToolFailureRecovery — the human answer', () => {
  const askingDescriptor = remedy(objectSchema(['label', 'name'], { name: { type: 'string' } }));

  async function answer(params: Record<string, unknown>) {
    const h = harness({ descriptors: [askingDescriptor], originalOutput: diagnosticOf() });
    const result = await h.wrapped.execute(required, { emitSurface: h.answering(params) });
    return { h, result };
  }

  it('sends the trimmed answer and the carried-forward fields to the remedy, then retries once', async () => {
    const { h, result } = await answer({ name: '  octo  ' });
    expect(h.calls.map(({ toolId, input }) => ({ toolId, input }))).toEqual([
      { toolId: 'original', input: { label: 'fixture-label' } },
      { toolId: 'remedy', input: { label: 'fixture-label', name: 'octo' } },
      { toolId: 'original', input: { label: 'fixture-label' } },
    ]);
    expect(result).toEqual({ executionId: 'original-3', status: 'completed', output: 'retried' });
  });

  it.each<[string, Record<string, unknown>]>([
    ['blank', { name: '   ' }],
    ['not a string', { name: 42 }],
    ['absent', {}],
  ])('does not proceed when the answer is %s', async (_name, params) => {
    const { h, result } = await answer(params);
    expect(toolIds(h.calls)).toEqual(['original']);
    expect(result.executionId).toBe('original-1');
  });

  it('does not proceed when the surface is dismissed', async () => {
    const { h } = await answer({ [SURFACE_DISMISSED_PARAM]: true, name: 'octo' });
    expect(toolIds(h.calls)).toEqual(['original']);
  });

  it('does not proceed when the caller aborts while the surface is open', async () => {
    const h = harness({ originalOutput: diagnosticOf() });
    const controller = new AbortController();
    const result = await h.wrapped.execute(required, { signal: controller.signal, emitSurface: async () => { controller.abort(); } });
    expect(result.executionId).toBe('original-1');
    expect(toolIds(h.calls)).toEqual(['original']);
  });

  it('detaches its abort listener once the answer is in', async () => {
    const h = harness({ originalOutput: diagnosticOf() });
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    await h.wrapped.execute(required, { signal: controller.signal, emitSurface: h.answering({}) });
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(h.calls[1]?.optional?.signal).toBe(controller.signal);
  });

  it('asks a plain text field for a secret-named key (reported, not fixed)', async () => {
    // SEC: unlike the credential-setup path, the generic plan has no key-name or secret-value
    // filter, so a remedy whose one unknown required field is `apiKey` is asked for in plain text
    // and the typed answer is forwarded without a `containsSecret` check.
    const apiKey = 'sk' + '-' + 'x'.repeat(24);
    const h = harness({ descriptors: [remedy(objectSchema(['label', 'apiKey'], { apiKey: { type: 'string' } }))], originalOutput: diagnosticOf() });
    await h.wrapped.execute(required, { emitSurface: h.answering({ apiKey }) });
    expect(h.forms[0]?.askFor).toEqual({ key: 'apiKey', prompt: 'apiKey' });
    expect(h.calls[1]).toMatchObject({ toolId: 'remedy', input: { label: 'fixture-label', apiKey } });
    expect(h.secretChecks).toEqual([]);
  });
});

describe('withToolFailureRecovery — remedy outcome', () => {
  it('returns the original untouched when the remedy does not complete', async () => {
    const diagnostic = diagnosticOf();
    const h = harness({ originalOutput: diagnostic, remedyResult: { status: 'failed', error: 'remedy broke' } });
    const result = await h.wrapped.execute(required, { emitSurface: h.answering({}) });
    expect(result).toEqual({ executionId: 'original-1', status: 'completed', output: diagnostic });
    expect(toolIds(h.calls)).toEqual(['original', 'remedy']);
  });

  it.each<[string, unknown]>([
    ['saved: false', { saved: false }],
    ['created: false', { created: false }],
    ['cancelled: true', { cancelled: true }],
    ['connected: false', { connected: false }],
  ])('does not retry when the remedy reports %s', async (_name, output) => {
    const h = harness({ originalOutput: diagnosticOf(), remedyResult: { status: 'completed', output } });
    expect((await h.wrapped.execute(required, { emitSurface: h.answering({}) })).executionId).toBe('original-1');
    expect(toolIds(h.calls)).toEqual(['original', 'remedy']);
  });

  it('retries when the remedy completes with a non-object output', async () => {
    const h = harness({ originalOutput: diagnosticOf(), remedyResult: { status: 'completed', output: 'ok' } });
    expect((await h.wrapped.execute(required, { emitSurface: h.answering({}) })).output).toBe('retried');
  });

  it('never starts a second cycle from a diagnostic on the retry', async () => {
    const retryDiagnostic = diagnosticOf();
    const h = harness({ originalOutput: diagnosticOf(), retryOutput: retryDiagnostic });
    let surfaces = 0;
    const answer = h.answering({});
    const result = await h.wrapped.execute(required, { emitSurface: async (emission) => { surfaces += 1; await answer(emission); } });
    expect(result.output).toBe(retryDiagnostic);
    expect(surfaces).toBe(1);
    expect(toolIds(h.calls)).toEqual(['original', 'remedy', 'original']);
  });
});

describe('withToolFailureRecovery — read-only constrained callers', () => {
  const readOnly = constrainPrincipalToReadOnlyTools({ principal });

  it('refuses a writing remedy before asking, keeping the original output and explaining why', async () => {
    const diagnostic = diagnosticOf();
    const h = harness({ descriptors: [remedy(objectSchema([]), { readOnly: false })], originalOutput: diagnostic });
    const result = await h.wrapped.execute({ ...required, principal: readOnly }, { emitSurface: h.answering({}) });
    expect(result).toEqual({ executionId: 'original-1', status: 'completed', output: diagnostic, error: 'Automatic recovery not attempted: write refused: remedy' });
    expect(h.forms).toEqual([]);
    expect(toolIds(h.calls)).toEqual(['original']);
  });

  it('lets a read-only remedy proceed for a read-only caller', async () => {
    const h = harness({ originalOutput: diagnosticOf() });
    await h.wrapped.execute({ ...required, principal: readOnly }, { emitSurface: h.answering({}) });
    expect(toolIds(h.calls)).toEqual(['original', 'remedy', 'original']);
  });
});

describe('withToolFailureRecovery — credential setup prefill', () => {
  const setupDescriptor = remedy(objectSchema(['label'], { label: { type: 'string' }, region: { type: 'string' }, port: { type: 'number' }, apiKey: { type: 'string' }, extra: { type: 'object' } }));
  const setup = (prefill: Record<string, unknown>, setupToolId = 'remedy'): ToolFailureDiagnostic =>
    // Malformed-input fixture: `prefill` is widened to `unknown` values so non-primitive cases can be built.
    diagnosticOf({ hint: 'save the credential', remedyToolId: 'remedy', setupToolId, prefill: prefill as NonNullable<ToolFailureDiagnostic['prefill']> });

  it('sends a clean prefill straight to the setup tool without opening a recovery surface', async () => {
    let surfaces = 0;
    const h = harness({ descriptors: [setupDescriptor], originalOutput: setup({ label: 'fixture-label', port: 443, region: null }) });
    const result = await h.wrapped.execute(required, { emitSurface: async () => { surfaces += 1; } });
    expect(h.calls[1]).toMatchObject({ toolId: 'remedy', input: { label: 'fixture-label', port: 443, region: null } });
    expect(result.output).toBe('retried');
    expect(surfaces).toBe(0);
    expect(h.forms).toEqual([]);
  });

  it('checks string prefill values for secrets but not numbers', async () => {
    const h = harness({ descriptors: [setupDescriptor], originalOutput: setup({ label: 'fixture-label', port: 443 }) });
    await h.wrapped.execute(required, { emitSurface: h.answering({}) });
    expect(h.secretChecks).toEqual(['fixture-label']);
  });

  it('passes each string prefill field to the credential-free assertion', async () => {
    const asserted: Array<{ value: string; field: string }> = [];
    const h = harness({ descriptors: [setupDescriptor], originalOutput: setup({ label: 'fixture-label', port: 443 }), assertCredentialFreeField: (field) => { asserted.push(field); } });
    await h.wrapped.execute(required, { emitSurface: h.answering({}) });
    expect(asserted).toEqual([{ value: 'fixture-label', field: 'label' }]);
  });

  async function refused(diagnostic: ToolFailureDiagnostic, overrides: Partial<Setup> = {}) {
    const h = harness({ descriptors: [setupDescriptor], originalOutput: diagnostic, ...overrides });
    const result = await h.wrapped.execute(required, { emitSurface: h.answering({}) });
    expect(result.output).toBe(diagnostic);
    return h;
  }

  it('refuses when the remedy tool is not registered', async () => {
    expect(toolIds((await refused(setup({ label: 'fixture-label' }), { descriptors: [] })).calls)).toEqual(['original']);
  });

  it('refuses when the setup tool is not the remedy tool', async () => {
    expect(toolIds((await refused(setup({ label: 'fixture-label' }, 'other-tool'))).calls)).toEqual(['original']);
  });

  it('refuses when the setup diagnostic carries no prefill', async () => {
    const h = await refused(diagnosticOf({ hint: 'save the credential', remedyToolId: 'remedy', setupToolId: 'remedy' }));
    expect(toolIds(h.calls)).toEqual(['original']);
  });

  it('refuses a prefill key the setup schema does not declare', async () => {
    expect(toolIds((await refused(setup({ label: 'fixture-label', undeclared: 'x' }))).calls)).toEqual(['original']);
  });

  it.each(['apiKey', 'TOKEN', 'clientSecret', 'password', 'Authorization', 'env', 'headers', 'body'])('refuses the secret-shaped prefill key %s', async (key) => {
    const descriptor = remedy(objectSchema(['label'], { label: { type: 'string' }, [key]: { type: 'string' } }));
    expect(toolIds((await refused(setup({ label: 'fixture-label', [key]: 'value' }), { descriptors: [descriptor] })).calls)).toEqual(['original']);
  });

  it('refuses a non-primitive prefill value', async () => {
    expect(toolIds((await refused(setup({ label: 'fixture-label', extra: { nested: true } }))).calls)).toEqual(['original']);
  });

  it('refuses a string prefill value the secret detector flags', async () => {
    const h = await refused(setup({ label: 'fixture-label' }), { containsSecret: () => true });
    expect(toolIds(h.calls)).toEqual(['original']);
  });

  it('refuses a string prefill value the credential-free assertion rejects', async () => {
    const h = await refused(setup({ label: 'fixture-label' }), { assertCredentialFreeField: () => { throw new Error('credential-shaped value'); } });
    expect(toolIds(h.calls)).toEqual(['original']);
  });

  it('refuses a prefill missing a field the setup schema requires', async () => {
    expect(toolIds((await refused(setup({ region: 'eu' }))).calls)).toEqual(['original']);
  });

  it('still needs a surface channel even though the setup path never opens one', async () => {
    const diagnostic = setup({ label: 'fixture-label' });
    const h = harness({ descriptors: [setupDescriptor], originalOutput: diagnostic });
    expect((await h.wrapped.execute(required, {})).output).toBe(diagnostic);
    expect(toolIds(h.calls)).toEqual(['original']);
  });
});

describe('withToolFailureRecovery — delegated executor methods', () => {
  it('passes resumeConfirmation, cancel and getAuditRecord straight through to inner', () => {
    const h = harness();
    h.wrapped.resumeConfirmation({ executionId: 'e1', decision: 'confirm' });
    h.wrapped.cancel({ executionId: 'e2' });
    expect(h.wrapped.getAuditRecord({ executionId: 'e3' })).toBeNull();
    expect(h.inner.resumeConfirmation).toHaveBeenCalledWith({ executionId: 'e1', decision: 'confirm' });
    expect(h.inner.cancel).toHaveBeenCalledWith({ executionId: 'e2' });
    expect(h.inner.getAuditRecord).toHaveBeenCalledWith({ executionId: 'e3' });
  });
});
