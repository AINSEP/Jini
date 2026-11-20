import { expect, test, vi } from 'vitest';
import { createToolRegistry } from '@jini-ai/core';
import { createNoopObservabilityPort, type ObservabilityPort } from '@jini-ai/core/contracts/observability';
import { createAssistantToolExecutor } from '../stack.js';
import * as observation from '../observability.js';
import { issueCredentialSetup } from '../diagnostics.js';
import { createSurfaceExchangeStore } from '../../surface-exchanges.js';
import { createTimeoutScheduler } from '../../scheduler.js';
import type { ToolExecutionResult, ToolExecutor } from '../../tool-executor-types.js';

const call = { principal: { id: 'operator' }, run: { id: 'run-1' }, toolId: 'read', input: {} };

function assemble({ observability }: { observability: ObservabilityPort }, { observabilityEnabled }: { observabilityEnabled?: () => boolean } = {}) {
  const registry = createToolRegistry({});
  let ids = 0;
  const executor = createAssistantToolExecutor({ registry, observability, ...(observabilityEnabled ? { observabilityEnabled } : {}),
    surfaceExchanges: createSurfaceExchangeStore({ scheduler: createTimeoutScheduler({}, {}), clock: { nowMs: () => 0 },
      idGenerator: { newId: () => 'exchange' }, defaultChannel: 'mcp-ui' }),
    newExecutionId: () => `exec-${++ids}`, recoveryToolId: 'recovery',
    containsSecret: () => false, assertCredentialFreeField: () => {},
    readOnlyMessages: { unverifiableMessage: 'cannot verify', toolRefusalMessage: () => 'write refused', unknownToolMessage: () => 'unknown tool' },
    formatReadOnlyRemedyRefusal: ({ refusal }) => refusal, buildRecoveryForm: () => ({}),
    toolFailures: { mintErrorId: () => 'ERR-AAAA-BBBB-CCCC-DDDD', redactSecretShapes: ({ text }) => ({ text, redactions: 0 }), onFailure: () => {} },
  });
  return { registry, executor };
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

test('the singleton no-op port skips constructing observation and still executes once', async () => {
  const decorate = vi.spyOn(observation, 'withToolCallObservability');
  const { registry, executor } = assemble({ observability: createNoopObservabilityPort({}) });
  const output = { saved: true };
  const handler = vi.fn(async () => output);
  registry.register({ descriptor: { id: 'read' }, policy: { authorize: () => 'allow' }, handler });
  expect(decorate).not.toHaveBeenCalled();
  expect((await executor.execute(call)).output).toBe(output);
  expect(handler).toHaveBeenCalledTimes(1);
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
  const disabled = observation.withToolCallObservability({ inner, observability: { ...createNoopObservabilityPort({}), trackOperation } },
    { observabilityEnabled: () => enabled });
  const options = { signal: new AbortController().signal };
  expect(disabled.execute(call, options)).toBe(promise);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0]).toEqual([call, options]);
  expect(trackOperation).toHaveBeenCalledTimes(1);
});
