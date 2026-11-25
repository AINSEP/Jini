import { expect, test, vi } from 'vitest';
import { createToolRegistry } from '@jini-ai/core';
import { createNoopObservabilityPort, type ObservabilityPort } from '@jini-ai/core/contracts/observability';
import { createRecordingReporter } from '@jini-ai/core/errors/testing';
import { createAssistantToolExecutor } from '../stack.js';
import * as observation from '../observability.js';
import { issueCredentialSetup } from '../diagnostics.js';
import { createSurfaceExchangeStore } from '../../surface-exchanges.js';
import { createTimeoutScheduler } from '../../scheduler.js';
import type { ToolExecutionResult, ToolExecutor } from '../../tool-executor-types.js';

const call = { principal: { id: 'operator' }, run: { id: 'run-1' }, toolId: 'read', input: {} };

function assemble({ observability }: { observability: ObservabilityPort }, { observabilityEnabled }: { observabilityEnabled?: () => boolean } = {}) {
  const registry = createToolRegistry({});
  const recorded = createRecordingReporter({ ids: ['ERR-0001-0000-0000-0000'], iso: '2026-11-25T00:00:00.000Z' });
  let ids = 0;
  const executor = createAssistantToolExecutor({ registry, observability, ...(observabilityEnabled ? { observabilityEnabled } : {}),
    surfaceExchanges: createSurfaceExchangeStore({ scheduler: createTimeoutScheduler({}, {}), clock: { nowMs: () => 0 },
      idGenerator: { newId: () => 'exchange' }, defaultChannel: 'mcp-ui' }),
    newExecutionId: () => `exec-${++ids}`, recoveryToolId: 'recovery',
    containsSecret: () => false, assertCredentialFreeField: () => {},
    readOnlyMessages: { unverifiableMessage: 'cannot verify', toolRefusalMessage: () => 'write refused', unknownToolMessage: () => 'unknown tool' },
    formatReadOnlyRemedyRefusal: ({ refusal }) => refusal, buildRecoveryForm: () => ({}),
    toolFailures: { mintErrorId: () => 'ERR-AAAA-BBBB-CCCC-DDDD', redactSecretShapes: ({ text }) => ({ text, redactions: 0 }) },
    reporter: recorded.reporter,
  });
  return { registry, executor, entries: recorded.entries };
}

test('completed and denied attempts each settle one tool.call with the registered label', async () => {
  const end = vi.fn();
  const trackOperation = vi.fn<ObservabilityPort['trackOperation']>(() => ({ run: work => work(), end }));
  const { registry, executor } = assemble({ observability: { ...createNoopObservabilityPort({}), trackOperation } });
  const handler = vi.fn(async () => 1);
  registry.register({ descriptor: { id: 'read' }, policy: { authorize: () => 'allow' }, handler });
  registry.register({ descriptor: { id: 'denied' }, policy: { authorize: () => 'deny' }, handler });
  expect(await executor.execute(call)).toMatchObject({ status: 'completed', output: 1 });
  expect(await executor.execute({ ...call, toolId: 'denied' })).toMatchObject({ status: 'denied' });
  expect(handler).toHaveBeenCalledTimes(1);
  expect(trackOperation.mock.calls).toEqual([
    [{ name: 'tool.call', attributes: { 'tool.id': 'read', 'agent.run.id': 'run-1', 'user.id': 'operator' } }],
    [{ name: 'tool.call', attributes: { 'tool.id': 'denied', 'agent.run.id': 'run-1', 'user.id': 'operator' } }],
  ]);
  expect(end.mock.calls).toEqual([[{ outcome: 'completed', failed: false }], [{ outcome: 'denied', failed: false }]]);
});

test('a recovery remedy and retry each settle their own attempted dispatch', async () => {
  const end = vi.fn();
  const trackOperation = vi.fn<ObservabilityPort['trackOperation']>(() => ({ run: work => work(), end }));
  const { registry, executor } = assemble({ observability: { ...createNoopObservabilityPort({}), trackOperation } });
  const diagnostic = issueCredentialSetup({ setupToolId: 'remedy', prefill: {},
    containsSecret: () => false, assertCredentialFreeField: () => {} }, {});
  const handler = vi.fn().mockResolvedValueOnce(diagnostic).mockResolvedValueOnce({ saved: true });
  const remedy = vi.fn(async () => ({ saved: true }));
  registry.register({ descriptor: { id: 'read' }, policy: { authorize: () => 'allow' }, handler });
  registry.register({ descriptor: { id: 'remedy', inputSchema: { type: 'object', properties: {} } },
    policy: { authorize: () => 'allow' }, handler: remedy });
  expect(await executor.execute(call, { emitSurface: async () => {} })).toMatchObject({ status: 'completed', output: { saved: true } });
  expect(handler).toHaveBeenCalledTimes(2);
  expect(remedy).toHaveBeenCalledTimes(1);
  expect(trackOperation.mock.calls.map(([input]) => [input.name, input.attributes?.['tool.id']])).toEqual([
    ['tool.call', 'read'], ['tool.call', 'remedy'], ['tool.call', 'read'],
  ]);
  expect(end.mock.calls).toEqual(Array.from({ length: 3 }, () => [{ outcome: 'completed', failed: false }]));
});

test('the singleton no-op port still installs the decorator, starts no operation, executes once and records a failure', async () => {
  const decorate = vi.spyOn(observation, 'withToolCallObservability');
  const noop = createNoopObservabilityPort({});
  const { registry, executor, entries } = assemble({ observability: noop });
  const output = { saved: true };
  const handler = vi.fn(async () => output);
  registry.register({ descriptor: { id: 'read' }, policy: { authorize: () => 'allow' }, handler });
  registry.register({ descriptor: { id: 'broken' }, policy: { authorize: () => 'allow' }, handler: async () => { throw new Error('upstream 500'); } });
  expect(decorate).toHaveBeenCalledTimes(1);
  expect(decorate.mock.calls[0]?.[0]).not.toHaveProperty('observability');
  expect((await executor.execute(call)).output).toBe(output);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(entries).toEqual([]);
  expect((await executor.execute({ ...call, toolId: 'broken' })).error).toBe('Error ERR-AAAA-BBBB-CCCC-DDDD: upstream 500');
  expect(entries.map((entry) => entry.meta?.errorId)).toEqual(['ERR-AAAA-BBBB-CCCC-DDDD']);
  decorate.mockRestore();
});

test('the live gate suppresses the next attempt without changing its result or error', async () => {
  let enabled = true;
  const trackOperation = vi.fn<ObservabilityPort['trackOperation']>(() => ({ run: work => work(), end: () => {} }));
  const { registry, executor } = assemble({ observability: { ...createNoopObservabilityPort({}), trackOperation } }, { observabilityEnabled: () => enabled });
  const output = { saved: true };
  const handler = vi.fn(async () => output);
  registry.register({ descriptor: { id: 'read' }, policy: { authorize: () => 'allow' }, handler });
  expect((await executor.execute(call)).output).toBe(output);
  enabled = false;
  expect((await executor.execute(call)).output).toBe(output);
  expect(handler).toHaveBeenCalledTimes(2);
  expect(trackOperation).toHaveBeenCalledTimes(1);
  await expect(executor.execute({ ...call, toolId: 'missing' })).rejects.toThrow('missing');
  expect(trackOperation).toHaveBeenCalledTimes(1);
  const result: ToolExecutionResult = { executionId: 'e', status: 'completed', output };
  const promise = Promise.resolve(result);
  const execute = vi.fn(() => promise);
  const inner: ToolExecutor = { execute, resumeConfirmation: () => {}, cancel: () => {}, getAuditRecord: () => null };
  const disabled = observation.withToolCallObservability({ inner, reporter: { record: vi.fn(() => ({ errorId: 'unused' })) }, observability: { ...createNoopObservabilityPort({}), trackOperation } },
    { observabilityEnabled: () => enabled });
  const options = { signal: new AbortController().signal };
  // Disabled tracing still passes through the decorator (it must be able to record), so the
  // result is the same object, no longer the same promise.
  expect(await disabled.execute(call, options)).toBe(result);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0]).toEqual([call, options]);
  expect(trackOperation).toHaveBeenCalledTimes(1);
});
