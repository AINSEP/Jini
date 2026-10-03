import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createToolRegistry, isReadOnlyTool, type Principal, type ToolRegistry } from '@jini-ai/core';
import { createToolExecutor, type ToolExecutor } from '../index.js';
import {
  constrainPrincipalToReadOnlyTools,
  principalIsReadOnlyConstrained,
  readOnlyToolRefusalMessage,
  readOnlyRemedyRefusalMessage,
  refuseNonReadOnlyDispatch,
  withReadOnlyToolConstraint,
  type ReadOnlyToolMessages,
} from '../read-only-tools.js';
import * as canonical from '../read-only-tools.js';

// Generalized from the copied composition regression. Host features are replaced
// with real kernel registrations whose write is observable in a durable-store fixture.
const RUN = { id: 'run-read-only' };
const PRINCIPAL: Principal = { id: 'principal-under-test', roles: ['operator'] };
const messages: ReadOnlyToolMessages = {
  unverifiableMessage: 'No registry; execution refused.',
  toolRefusalMessage: ({ toolId }) => `Tool "${toolId}" cannot run in this read-only execution.`,
};
const READ_ONLY = constrainPrincipalToReadOnlyTools({ principal: PRINCIPAL });

function harness() {
  const registry = createToolRegistry({});
  const store = new Map<string, string>();
  const calls: string[] = [];
  let reads = 0;
  for (const [id, readOnly] of [['verify', true], ['set', false], ['pick', true]] as const) {
    registry.register({
      descriptor: { id, readOnly, inputSchema: { type: 'object' } },
      policy: { authorize: () => 'allow' },
      handler: async () => {
        calls.push(id);
        if (id === 'set') store.set('username', 'saved@example.com');
        if (id === 'verify') {
          reads += 1;
          return reads === 1 ? { status: 'invalid', remedyToolId: 'set' } : { ok: true };
        }
        return { ok: true };
      },
    });
  }
  let ids = 0;
  const gate = withReadOnlyToolConstraint({
    inner: createToolExecutor({ registry }), registry, messages,
    idGenerator: { newId: () => `denied-${++ids}` },
  });
  return { registry, store, calls, gate };
}

// This outer decorator cooperates before asking a human, just like a recovery loop.
function recovery(inner: ToolExecutor, registry: ToolRegistry, remedy: string, surfaces: string[]): ToolExecutor {
  return {
    ...inner,
    execute: async ({ principal, run, toolId, input }, { signal, emitSurface } = {}) => {
      const result = await inner.execute({ principal, run, toolId, input }, { ...(signal === undefined ? {} : { signal }), ...(emitSurface === undefined ? {} : { emitSurface }) });
      const refusal = refuseNonReadOnlyDispatch({ principal, toolId: remedy, registry, messages });
      if (refusal !== null) return {
        ...result, error: readOnlyRemedyRefusalMessage({
          refusal, formatMessage: ({ refusal }) => `Automatic recovery declined: ${refusal}`,
        })
      };
      surfaces.push(remedy);
      await inner.execute({ principal, run, toolId: remedy, input }, { ...(signal === undefined ? {} : { signal }), ...(emitSurface === undefined ? {} : { emitSurface }) });
      return inner.execute({ principal, run, toolId, input }, { ...(signal === undefined ? {} : { signal }), ...(emitSurface === undefined ? {} : { emitSurface }) });
    },
  };
}

test('PREMISE: the original reads and its remedy writes', () => {
  const { registry } = harness();
  const descriptors = registry.list({});
  assert.equal(isReadOnlyTool({ descriptor: descriptors.find((d) => d.id === 'verify') }), true);
  assert.equal(isReadOnlyTool({ descriptor: descriptors.find((d) => d.id === 'set') }), false);
});

test('READ-ONLY: recovery performs no durable write and raises no human surface', async () => {
  const { registry, store, gate, calls } = harness();
  const surfaces: string[] = [];
  assert.equal(store.has('username'), false);
  const result = await recovery(gate, registry, 'set', surfaces).execute({ principal: READ_ONLY, run: RUN, toolId: 'verify', input: {} });
  assert.equal(store.has('username'), false);
  assert.deepEqual(surfaces, []);
  assert.deepEqual(calls, ['verify']);
  assert.equal(result.status, 'completed');
});

test('READ-ONLY: the original failure and explicit remedy refusal both survive', async () => {
  const { registry, gate } = harness();
  const result = await recovery(gate, registry, 'set', []).execute({ principal: READ_ONLY, run: RUN, toolId: 'verify', input: {} });
  assert.deepEqual(result.output, { status: 'invalid', remedyToolId: 'set' });
  assert.equal(result.error, 'Automatic recovery declined: Tool "set" cannot run in this read-only execution.');
});

test('READ-ONLY: a directly named write is refused before the durable handler', async () => {
  const { gate, store, calls } = harness();
  const result = await gate.execute({ principal: READ_ONLY, run: RUN, toolId: 'set', input: {} });
  assert.deepEqual(result, { executionId: 'denied-1', status: 'denied', error: 'Tool "set" cannot run in this read-only execution.' });
  assert.equal(store.has('username'), false);
  assert.deepEqual(calls, []);
});

test('UNCONSTRAINED: the identical recovery performs the durable write', async () => {
  const { gate, registry, store, calls } = harness();
  const surfaces: string[] = [];
  await recovery(gate, registry, 'set', surfaces).execute({ principal: PRINCIPAL, run: RUN, toolId: 'verify', input: {} });
  assert.equal(store.get('username'), 'saved@example.com');
  assert.deepEqual(surfaces, ['set']);
  assert.deepEqual(calls, ['verify', 'set', 'verify']);
});

test('READ-ONLY: a read-only remedy still runs and the original is retried', async () => {
  const { gate, registry, calls, store } = harness();
  const surfaces: string[] = [];
  const result = await recovery(gate, registry, 'pick', surfaces).execute({ principal: READ_ONLY, run: RUN, toolId: 'verify', input: {} });
  assert.deepEqual(calls, ['verify', 'pick', 'verify']);
  assert.deepEqual(surfaces, ['pick']);
  assert.deepEqual(result.output, { ok: true });
  assert.equal(store.has('username'), false);
});

test('FAIL CLOSED: absent registry refuses constrained dispatch and leaves ordinary calls alone', async () => {
  let reached = 0;
  const inner: ToolExecutor = {
    execute: async () => { reached += 1; return { executionId: 'e', status: 'completed', output: {} }; },
    resumeConfirmation: () => { }, cancel: () => { }, getAuditRecord: () => null,
  };
  const gate = withReadOnlyToolConstraint({ inner, registry: undefined, messages, idGenerator: { newId: () => 'denied' } });
  const result = await gate.execute({ principal: READ_ONLY, run: RUN, toolId: 'anything', input: {} });
  assert.deepEqual(result, { executionId: 'denied', status: 'denied', error: 'No registry; execution refused.' });
  assert.equal(reached, 0);
  assert.equal((await gate.execute({ principal: PRINCIPAL, run: RUN, toolId: 'anything', input: {} })).status, 'completed');
  assert.equal(reached, 1);
});

test('FAIL CLOSED: unknown and unclassified tools are each refused', async () => {
  const { gate, registry, calls } = harness();
  registry.register({ descriptor: { id: 'unclassified', inputSchema: {} }, policy: { authorize: () => 'allow' }, handler: async () => calls.push('unsafe') });
  for (const toolId of ['unknown', 'unclassified']) {
    assert.equal((await gate.execute({ principal: READ_ONLY, run: RUN, toolId, input: {} })).error, `Tool "${toolId}" cannot run in this read-only execution.`);
  }
  assert.deepEqual(calls, []);
});

test('DEFECT CLASS: an unaware outer decorator cannot substitute a durable write', async () => {
  const { gate, store, calls } = harness();
  const substituting: ToolExecutor = {
    ...gate,
    execute: ({ principal, run, input }, { signal, emitSurface } = {}) => gate.execute({ principal, run, toolId: 'set', input }, { ...(signal === undefined ? {} : { signal }), ...(emitSurface === undefined ? {} : { emitSurface }) }),
  };
  assert.equal((await substituting.execute({ principal: READ_ONLY, run: RUN, toolId: 'verify', input: {} })).status, 'denied');
  assert.equal(store.has('username'), false);
  assert.deepEqual(calls, []);
});

test('attenuation copies the principal without changing its roles', () => {
  assert.deepEqual(PRINCIPAL, { id: 'principal-under-test', roles: ['operator'] });
  assert.deepEqual(READ_ONLY, { ...PRINCIPAL, toolAccess: 'read-only' });
  assert.notEqual(READ_ONLY, PRINCIPAL);
  assert.equal(READ_ONLY.roles, PRINCIPAL.roles);
  assert.equal(principalIsReadOnlyConstrained({ principal: READ_ONLY }), true);
  assert.equal(principalIsReadOnlyConstrained({ principal: PRINCIPAL }), false);
});

// REGRESSION: fails if inner.execute(requiredArgs, optionalArgs) reverts to positional forwarding.
test('gate forwards identity, input, signal and surface emitter; controls delegate unchanged', async () => {
  const args: unknown[][] = [];
  const result = { executionId: 'original', status: 'completed' as const, output: { ok: true } };
  const inner: ToolExecutor = {
    execute: async (...input) => { args.push(input); return result; },
    resumeConfirmation: (...input) => { args.push(input); },
    cancel: (...input) => { args.push(input); },
    getAuditRecord: (...input) => { args.push(input); return null; },
  };
  const input = { value: 42 };
  const signal = new AbortController().signal;
  const emit = async () => { };
  const gate = withReadOnlyToolConstraint({ inner, registry: undefined, messages, idGenerator: { newId: () => { throw new Error('must not mint'); } } });
  assert.equal(await gate.execute({ principal: PRINCIPAL, run: RUN, toolId: 'anything', input }, { signal, emitSurface: emit }), result);
  assert.deepEqual(args[0], [{ principal: PRINCIPAL, run: RUN, toolId: 'anything', input }, { signal, emitSurface: emit }]);
  assert.deepEqual(args[0]![0], { principal: PRINCIPAL, run: RUN, toolId: 'anything', input });
  gate.resumeConfirmation({ executionId: 'e', decision: 'confirm' });
  gate.cancel({ executionId: 'e' });
  assert.equal(gate.getAuditRecord({ executionId: 'e' }), null);
  assert.deepEqual(args.slice(1), [[{ executionId: 'e', decision: 'confirm' }], [{ executionId: 'e' }], [{ executionId: 'e' }]]);
});

test('host wording is required and retained verbatim on both refusal surfaces', () => {
  assert.equal(readOnlyToolRefusalMessage({ toolId: 'set', messages }), 'Tool "set" cannot run in this read-only execution.');
  assert.equal(readOnlyRemedyRefusalMessage({ refusal: 'exact refusal', formatMessage: ({ refusal }) => `Recovery refused: ${refusal}` }), 'Recovery refused: exact refusal');
});

// PARITY: existing gateway refusal wording survives removal of the facades.
test('PARITY: canonical read-only defaults retain exact gateway refusal text', async () => {
  const constrained = canonical.constrainPrincipalToReadOnlyTools({ principal: PRINCIPAL });
  assert.equal(canonical.principalIsReadOnlyConstrained({ principal: constrained }), true);
  assert.equal(canonical.principalIsReadOnlyConstrained({ principal: PRINCIPAL }), false);
  const { registry, gate } = harness();
  const expected = 'tool "set" is not registered as read-only — this gateway executes only tools whose registration declares readOnly; call it through execute_delegated_tool instead';
  assert.equal(canonical.readOnlyToolRefusalMessage({ toolId: 'set' , messages: canonical.defaultDaemonMessages.readOnly }), expected);
  assert.equal(canonical.refuseNonReadOnlyDispatch({ principal: constrained, toolId: 'set', registry , messages: canonical.defaultDaemonMessages.readOnly }), expected);
  assert.equal(canonical.refuseNonReadOnlyDispatch({ principal: constrained, toolId: 'set', registry: undefined , messages: canonical.defaultDaemonMessages.readOnly }), canonical.defaultDaemonMessages.readOnly.unverifiableMessage);
  const wrapper = canonical.withReadOnlyToolConstraint({ inner: gate, registry, messages: canonical.defaultDaemonMessages.readOnly, idGenerator: { newId: () => "denial" } });
  assert.equal((await wrapper.execute({ principal: constrained, run: RUN, toolId: 'set', input: {} })).error, expected);
});

test('canonical dispatch preflight fails closed for every unverified registration', () => {
  const { registry } = harness();
  registry.register({ descriptor: { id: 'unclassified' }, policy: { authorize: () => 'allow' }, handler: async () => ({}) });
  for (const toolId of ['set', 'unknown', 'unclassified']) {
    assert.equal(canonical.refuseNonReadOnlyDispatch({ principal: READ_ONLY, toolId, registry , messages: canonical.defaultDaemonMessages.readOnly }), canonical.readOnlyToolRefusalMessage({ toolId , messages: canonical.defaultDaemonMessages.readOnly }));
  }
  assert.equal(canonical.refuseNonReadOnlyDispatch({ principal: READ_ONLY, toolId: 'verify', registry: undefined , messages: canonical.defaultDaemonMessages.readOnly }), canonical.defaultDaemonMessages.readOnly.unverifiableMessage);
  assert.equal(canonical.refuseNonReadOnlyDispatch({ principal: READ_ONLY, toolId: 'verify', registry , messages: canonical.defaultDaemonMessages.readOnly }), null);
  assert.equal(canonical.refuseNonReadOnlyDispatch({ principal: PRINCIPAL, toolId: 'set', registry: undefined , messages: canonical.defaultDaemonMessages.readOnly }), null);
});
