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
  checkReadOnlyTool,
  defaultDaemonMessages,
  filterReadOnlyToolCatalog,
  type ReadOnlyToolMessages,
} from '../read-only-tools.js';
import * as canonical from '../read-only-tools.js';
import type { ToolCatalogQuery } from '../http/tool-catalog.js';

test('a read-only principal cannot discover writes or unclassified tools AND cannot invoke them', async () => {
  const { registry, gate, store } = harness();
  let unclassifiedCalls = 0;
  registry.register({ descriptor: { id: 'unclassified' }, policy: { authorize: () => 'allow' }, handler: async () => { unclassifiedCalls++; } });
  const hits = ['set', 'unclassified', 'pick'].map(id => ({ id, description: 'probe', source: 'test', score: 1 }));
  const catalog: ToolCatalogQuery = {
    search: (_input, { limit = 10 } = {}) => hits.slice(0, limit),
    describe: ({ id }) => hits.find(hit => hit.id === id) ?? null,
  };
  const visible = filterReadOnlyToolCatalog({ principal: READ_ONLY, registry, catalog });
  assert.deepEqual(visible.search({ query: 'probe' }, { limit: 1 }).map(hit => hit.id), ['pick'], 'withheld writes must not displace reads at the cutoff');
  for (const toolId of ['set', 'unclassified']) {
    assert.equal(visible.describe({ id: toolId }), null);
    assert.equal((await gate.execute({ principal: READ_ONLY, run: RUN, toolId, input: {} })).status, 'denied');
  }
  assert.equal(store.size, 0);
  assert.equal(unclassifiedCalls, 0);
  assert.equal(visible.describe({ id: 'pick' })?.id, 'pick');
  assert.equal((await gate.execute({ principal: READ_ONLY, run: RUN, toolId: 'pick', input: {} })).status, 'completed');
  const ordinary = filterReadOnlyToolCatalog({ principal: PRINCIPAL, registry, catalog });
  assert.equal(ordinary, catalog);
  assert.equal(ordinary.describe({ id: 'set' })?.id, 'set');
  assert.equal((await gate.execute({ principal: PRINCIPAL, run: RUN, toolId: 'set', input: {} })).status, 'completed');
  assert.equal(store.size, 1);
});

// Generalized from the copied composition regression. Host features are replaced
// with real kernel registrations whose write is observable in a durable-store fixture.
const RUN = { id: 'run-read-only' };
const PRINCIPAL: Principal = { id: 'principal-under-test', roles: ['operator'] };
const messages: ReadOnlyToolMessages = {
  unverifiableMessage: 'No registry; execution refused.',
  toolRefusalMessage: ({ toolId }) => `Tool "${toolId}" cannot run in this read-only execution.`,
  unknownToolMessage: ({ toolId }) => `No tool "${toolId}" is registered.`,
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
  assert.equal((await gate.execute({ principal: READ_ONLY, run: RUN, toolId: 'unknown', input: {} })).error, 'No tool "unknown" is registered.');
  assert.equal((await gate.execute({ principal: READ_ONLY, run: RUN, toolId: 'unclassified', input: {} })).error, 'Tool "unclassified" cannot run in this read-only execution.');
  assert.deepEqual(calls, []);
});

test('unknown read-only tool ids suggest registered prefix candidates instead of a mutation retry', () => {
  const registry = createToolRegistry({});
  for (const id of ['other', ...Array.from({ length: 10 }, (_, index) => `content_read.type${index}`)]) {
    registry.register({ descriptor: { id, readOnly: true }, policy: { authorize: () => 'allow' }, handler: async () => null });
  }
  const refusal = checkReadOnlyTool({ toolId: 'content_read', registry, messages: defaultDaemonMessages.readOnly });
  assert.equal(refusal, `no tool "content_read" is registered; use search_tools — did you mean ${Array.from({ length: 8 }, (_, index) => `content_read.type${index}`).join(', ')}?`);
  assert.equal(refusal?.includes('execute_delegated_tool'), false);
});

test('unknown read-only tool suggestions exclude contains-only matches and keep catalog order for equal similarity', () => {
  const { registry } = harness();
  for (const id of ['site_content_read', ...[9, 2, 7, 1, 8, 3, 6, 0, 5, 4].map((index) => `content_read_${index}`)]) {
    registry.register({ descriptor: { id, readOnly: true }, policy: { authorize: () => 'allow' }, handler: async () => null });
  }
  const refusal = checkReadOnlyTool({ toolId: 'content_read', registry, messages: defaultDaemonMessages.readOnly });
  assert.equal(refusal, 'no tool "content_read" is registered; use search_tools — did you mean content_read_9, content_read_2, content_read_7, content_read_1, content_read_8, content_read_3, content_read_6, content_read_0?');
  assert.equal(refusal.includes('site_content_read'), false);
});

test('read-only constraint uses the resource hint for diagnostics without executing an alternate registration', async () => {
  const { registry, gate, calls } = harness();
  for (const id of ['content_read.backup_restore_point', 'content_read.theme']) {
    registry.register({ descriptor: { id, readOnly: true }, policy: { authorize: () => 'allow' }, handler: async () => calls.push(id) });
  }
  const input = { resource: 'theme' };
  const expected = 'no tool "content_read" is registered; use search_tools — did you mean content_read.theme, content_read.backup_restore_point?';
  assert.equal(checkReadOnlyTool({ toolId: 'content_read', input, registry, messages: defaultDaemonMessages.readOnly }), expected);
  const constrained = withReadOnlyToolConstraint({ inner: gate, registry, messages: defaultDaemonMessages.readOnly, idGenerator: { newId: () => 'denial' } });
  assert.deepEqual(await constrained.execute({ principal: READ_ONLY, run: RUN, toolId: 'content_read', input }), {
    status: 'denied', executionId: 'denial', error: expected,
  });
  assert.deepEqual(calls, []);
});

test('a delegated check_messages refusal routes the caller to the MCP-local tool', () => {
  const { registry, calls } = harness();
  assert.equal(checkReadOnlyTool({ toolId: 'check_messages', registry, messages: defaultDaemonMessages.readOnly }),
    'check_messages is an MCP-local tool; call check_messages directly, never as toolId in a delegated gateway');
  assert.deepEqual(calls, []);
  assert.equal(checkReadOnlyTool({ toolId: 'check_messages', registry: undefined, messages: defaultDaemonMessages.readOnly }),
    defaultDaemonMessages.readOnly.unverifiableMessage);
});

test('unknown read-only tool ids without candidates still direct discovery; registered writes keep their refusal', () => {
  const { registry } = harness();
  assert.equal(checkReadOnlyTool({ toolId: 'missing', registry, messages: defaultDaemonMessages.readOnly }), 'no tool "missing" is registered; use search_tools');
  assert.equal(checkReadOnlyTool({ toolId: 'set', registry, messages: defaultDaemonMessages.readOnly }), defaultDaemonMessages.readOnly.toolRefusalMessage({ toolId: 'set' }));
  assert.equal(checkReadOnlyTool({ toolId: 'verify', registry, messages: defaultDaemonMessages.readOnly }), null);
  assert.equal(checkReadOnlyTool({ toolId: 'verify', registry: undefined, messages: defaultDaemonMessages.readOnly }), defaultDaemonMessages.readOnly.unverifiableMessage);
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
  assert.equal(canonical.refuseNonReadOnlyDispatch({ principal: READ_ONLY, toolId: 'unknown', registry, messages: canonical.defaultDaemonMessages.readOnly }),
    'no tool "unknown" is registered; use search_tools');
  for (const toolId of ['set', 'unclassified']) {
    assert.equal(canonical.refuseNonReadOnlyDispatch({ principal: READ_ONLY, toolId, registry , messages: canonical.defaultDaemonMessages.readOnly }), canonical.readOnlyToolRefusalMessage({ toolId , messages: canonical.defaultDaemonMessages.readOnly }));
  }
  assert.equal(canonical.refuseNonReadOnlyDispatch({ principal: READ_ONLY, toolId: 'verify', registry: undefined , messages: canonical.defaultDaemonMessages.readOnly }), canonical.defaultDaemonMessages.readOnly.unverifiableMessage);
  assert.equal(canonical.refuseNonReadOnlyDispatch({ principal: READ_ONLY, toolId: 'verify', registry , messages: canonical.defaultDaemonMessages.readOnly }), null);
  assert.equal(canonical.refuseNonReadOnlyDispatch({ principal: PRINCIPAL, toolId: 'set', registry: undefined , messages: canonical.defaultDaemonMessages.readOnly }), null);
});

test('read-only catalog search and describe carry live registration metadata', () => {
  const { registry } = harness();
  const hit = { id: 'pick', source: 'test', description: 'Read', score: 1 };
  const visible = filterReadOnlyToolCatalog({ principal: READ_ONLY, registry, catalog: { search: () => [hit], describe: () => hit } });
  assert.deepEqual(visible.search({ query: 'read' }), [{ ...hit, readOnly: true, sideEffects: 'none' }]);
  assert.deepEqual(visible.describe({ id: 'pick' }), { ...hit, readOnly: true, sideEffects: 'none' });
});

// Bug class: catalog guidance (retired-alias pointers, namespace overviews) is not a tool, so the
// read-only view cannot judge it by its own id. Each guidance entry names its targets; the view
// shows it only when every target is a registered read-only tool, and fails closed otherwise.
test('a read-only caller sees catalog guidance only when every tool it points at is read-only', () => {
  const { registry } = harness();
  const guidance: Record<string, { id: string; source: string; description: string; targetToolIds?: readonly string[] }> = {
    old_pick: { id: 'old_pick', source: 'test', description: 'old_pick was renamed to pick.', targetToolIds: ['pick'] },
    old_set: { id: 'old_set', source: 'test', description: 'old_set was renamed to set.', targetToolIds: ['set'] },
    mixed: { id: 'mixed', source: 'test', description: 'pick and set.', targetToolIds: ['pick', 'set'] },
    untargeted: { id: 'untargeted', source: 'test', description: 'Points somewhere unknown.' },
    empty: { id: 'empty', source: 'test', description: 'Points nowhere.', targetToolIds: [] },
  };
  const catalog: ToolCatalogQuery = {
    search: () => [],
    describe: ({ id }) => guidance[id] ?? null,
  };
  const visible = filterReadOnlyToolCatalog({ principal: READ_ONLY, registry, catalog });
  assert.deepEqual(visible.describe({ id: 'old_pick' }), guidance.old_pick, 'an alias to a read-only tool stays visible');
  for (const id of ['old_set', 'mixed', 'untargeted', 'empty']) {
    assert.equal(visible.describe({ id }), null, `${id} must not reach a read-only caller`);
  }
  assert.deepEqual(filterReadOnlyToolCatalog({ principal: PRINCIPAL, registry, catalog }).describe({ id: 'old_set' }), guidance.old_set);
});

test('a read-only caller gets a namespace overview built from read-only members only', () => {
  const { registry } = harness();
  const members = ['verify', 'set', 'pick'];
  const seen: (ReadonlySet<string> | undefined)[] = [];
  const catalog: ToolCatalogQuery = {
    search: () => [],
    describe: ({ id }, { visibleToolIds } = {}) => {
      if (id !== 'family') return null;
      seen.push(visibleToolIds);
      const listed = members.filter(member => !visibleToolIds || visibleToolIds.has(member));
      return { id, source: 'test', description: listed.join('\n'), targetToolIds: listed };
    },
  };
  const overview = filterReadOnlyToolCatalog({ principal: READ_ONLY, registry, catalog }).describe({ id: 'family' });
  assert.deepEqual(overview?.targetToolIds, ['verify', 'pick']);
  assert.equal(overview?.description, 'verify\npick');
  assert.deepEqual([...(seen[0] ?? [])].sort(), ['pick', 'verify']);
  // A producer that ignores the visible set still cannot leak a write member: fail closed.
  const careless: ToolCatalogQuery = {
    search: () => [],
    describe: ({ id }) => id === 'family' ? { id, source: 'test', description: members.join('\n'), targetToolIds: members } : null,
  };
  assert.equal(filterReadOnlyToolCatalog({ principal: READ_ONLY, registry, catalog: careless }).describe({ id: 'family' }), null);
});

test('a read-only namespace overview honors the caller’s narrower visible-tool set', () => {
  const { registry } = harness();
  const catalog: ToolCatalogQuery = {
    search: () => [],
    describe: ({ id }, { visibleToolIds } = {}) => {
      if (id !== 'family') return null;
      const targetToolIds = ['verify', 'pick', 'set'].filter(id => visibleToolIds?.has(id));
      return { id, source: 'test', description: targetToolIds.join(', '), targetToolIds };
    },
  };
  const view = filterReadOnlyToolCatalog({ principal: READ_ONLY, registry, catalog });
  const visibleToolIds = new Set(['pick', 'set']);
  assert.deepEqual(view.describe({ id: 'family' }, { visibleToolIds })?.targetToolIds, ['pick']);
  assert.equal(view.describe({ id: 'family' }, { visibleToolIds: new Set() }), null);
  assert.deepEqual([...visibleToolIds], ['pick', 'set']);
  const careless: ToolCatalogQuery = { search: () => [], describe: () => ({ id: 'family', source: 'test', description: 'verify', targetToolIds: ['verify'] }) };
  assert.equal(filterReadOnlyToolCatalog({ principal: READ_ONLY, registry, catalog: careless }).describe({ id: 'family' }, { visibleToolIds }), null);
});
