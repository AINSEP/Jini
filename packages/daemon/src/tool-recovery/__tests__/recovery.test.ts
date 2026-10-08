/** A2 extraction contract: issued provenance, bounded retries and injected host policy.
 * Uses real exchange delivery and DI fakes; imports no UI, chat or federation implementation. */
import { expect, test } from 'vitest';
import type { SurfaceEmitter, ToolDescriptor } from '@jini-ai/core';
import { createSystemClock } from '@jini-ai/core/primitives';
import type { ToolExecutor, ToolExecutionResult } from '../../tool-executor.js';
import { createSurfaceExchangeStore } from '../../surface-exchanges.js';
import { createTimeoutScheduler } from '../../scheduler.js';
import { issueToolFailureDiagnostic, issueCredentialSetup, withToolFailureRecovery, withRedactedToolFailures } from '../index.js';

const required = { principal: { id: 'operator' }, run: { id: 'run' }, toolId: 'original', input: {} };
const readOnlyMessages = { unverifiableMessage: 'cannot verify', toolRefusalMessage: () => 'write refused' };
const descriptor: ToolDescriptor = { id: 'remedy', readOnly: true, inputSchema: { type: 'object', required: [], properties: {} } };
function exchanges() {
  return createSurfaceExchangeStore({ scheduler: createTimeoutScheduler({}, {}), clock: createSystemClock(),
    idGenerator: { newId: () => 'exchange' }, defaultChannel: 'mcp-ui' });
}
function executor(execute: ToolExecutor['execute']): ToolExecutor {
  return { execute, resumeConfirmation: () => {}, cancel: () => {}, getAuditRecord: () => null };
}

test('issued diagnostics ask once and call only original, remedy and one retry through inner', async () => {
  const store = exchanges();
  const calls: string[] = [];
  const diagnostic = issueToolFailureDiagnostic({ diagnostic: { hint: 'a change may help', remedyToolId: 'remedy' } }, {});
  const inner = executor(async ({ toolId }) => {
    calls.push(toolId);
    return { executionId: `execution-${calls.length}`, status: 'completed', output: toolId === 'remedy' ? { saved: true } : diagnostic };
  });
  const wrapped = withToolFailureRecovery({ inner, surfaceExchanges: store, registry: { list: () => [descriptor] },
    recoveryToolId: 'host-recovery', containsSecret: () => false, assertCredentialFreeField: () => {}, readOnlyMessages,
    formatReadOnlyRemedyRefusal: ({ refusal }) => refusal,
    buildRecoveryForm: ({ exchangeId }) => ({ exchangeId, view: 'alternate-host-form' }) }, {});
  const emitted: unknown[] = [];
  const emitSurface: SurfaceEmitter = async emission => {
    emitted.push(emission.payload.resource);
    store.deliver({ exchangeId: 'exchange', principalId: 'operator', params: {} }, { toolId: 'host-recovery', channel: 'mcp-ui' });
  };
  const result = await wrapped.execute(required, { emitSurface });
  expect(result.executionId).toBe('execution-3');
  expect(result.output).toBe(diagnostic);
  expect(calls).toEqual(['original', 'remedy', 'original']);
  expect(emitted).toEqual([{ exchangeId: 'exchange', view: 'alternate-host-form' }]);
});

test('a copied diagnostic cannot acquire authority to open a recovery surface', async () => {
  const diagnostic = issueToolFailureDiagnostic({ diagnostic: { hint: 'may help', remedyToolId: 'remedy' } }, {});
  const original: ToolExecutionResult = { executionId: 'original', status: 'completed', output: { ...diagnostic } };
  let emitted = false;
  const wrapped = withToolFailureRecovery({ inner: executor(async () => original), surfaceExchanges: exchanges(),
    registry: { list: () => [descriptor] }, recoveryToolId: 'host-recovery', containsSecret: () => false,
    assertCredentialFreeField: () => {}, readOnlyMessages, formatReadOnlyRemedyRefusal: ({ refusal }) => refusal,
    buildRecoveryForm: () => ({}) }, {});
  expect(await wrapped.execute(required, { emitSurface: async () => { emitted = true; } })).toBe(original);
  expect(emitted).toBe(false);
});

test('an alternate host metadata detector changes recovery output without a package fork', async () => {
  const diagnostic = issueCredentialSetup({ setupToolId: 'remedy', prefill: { label: 'fixture-label' },
    assertCredentialFreeField: () => {}, containsSecret: () => false }, {});
  const probe = async (rejectMetadata: boolean) => {
    let originalCalls = 0;
    const inner = executor(async ({ toolId }) => ({ executionId: toolId, status: 'completed',
      output: toolId === 'remedy' ? { saved: true } : (++originalCalls === 1 ? diagnostic : 'recovered') }));
    const wrapped = withToolFailureRecovery({ inner, surfaceExchanges: exchanges(), recoveryToolId: 'host-recovery',
      registry: { list: () => [{ ...descriptor, inputSchema: { type: 'object', required: ['label'], properties: { label: { type: 'string' } } } }] },
      containsSecret: () => rejectMetadata, assertCredentialFreeField: () => {}, readOnlyMessages,
      formatReadOnlyRemedyRefusal: ({ refusal }) => refusal, buildRecoveryForm: () => ({}) }, {});
    return wrapped.execute(required, { emitSurface: async () => {} });
  };
  // The only differential is the injected detector: rejection retains the first result;
  // accepting metadata permits the remedy and returns the original tool's retried output.
  expect((await probe(false)).output).toBe('recovered');
  expect((await probe(true)).output).toBe(diagnostic);
});

test('redaction retains safe failure text when its reporting port throws', async () => {
  const wrapped = withRedactedToolFailures({ inner: executor(async () => ({ executionId: 'execution', status: 'failed', error: 'unsafe fixture' })),
    redactSecretShapes: () => ({ text: 'safe failure', redactions: 1 }), mintErrorId: () => 'ERR-0000-0000-0000-0000',
    onFailure: () => { throw new Error('observer failure'); } }, {});
  expect((await wrapped.execute(required, {})).error).toBe('Error ERR-0000-0000-0000-0000: safe failure');
});
