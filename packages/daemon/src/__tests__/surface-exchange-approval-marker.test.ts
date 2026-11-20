import { expect, test } from 'vitest';
import type { SurfaceEmission, SurfaceEmitter } from '@jini-ai/core';
import { createSurfaceExchangeStore } from '../surface-exchanges.js';

test('only the decision prompt carries pendingApproval on an exchange that later sends a result', async () => {
  const emissions: SurfaceEmission[] = [];
  const emit: SurfaceEmitter = Object.assign(async (emission: SurfaceEmission) => { emissions.push(emission); }, {
    exchangeLifetime: { runId: 'run', principalId: 'owner', signal: new AbortController().signal,
      toolId: 'tool', retry: async () => {} },
  });
  const store = createSurfaceExchangeStore({ clock: { nowMs: () => 0 }, idGenerator: { newId: () => 'exchange' },
    scheduler: { schedule: () => () => {} }, defaultChannel: 'mcp-ui' });
  const exchange = store.open({ binding: { toolId: 'tool', principalId: 'owner' }, emit });
  const pendingApproval = { id: 'approval', reason: 'confirmation', toolCallId: 'call', message: 'Allow action?' };
  const prompt = { type: 'resource', resource: { uri: 'ui://prompt', mimeType: 'text/html', text: '<p>Allow action?</p>' } };
  const result = { type: 'resource', resource: { uri: 'ui://result', mimeType: 'text/html', text: '<p>Completed</p>' } };
  await exchange.send({ emission: { channel: 'mcp-ui', payload: { resource: prompt, pendingApproval } } });
  await exchange.send({ emission: { channel: 'mcp-ui', payload: { resource: result } } });
  expect(emissions).toEqual([
    { channel: 'mcp-ui', payload: { resource: prompt, pendingApproval, surfaceExchange: { exchangeId: 'exchange', toolId: 'tool', runId: 'run' } } },
    { channel: 'mcp-ui', payload: { resource: result, surfaceExchange: { exchangeId: 'exchange', toolId: 'tool', runId: 'run' } } },
  ]);
  expect(emissions[1]!.payload).not.toHaveProperty('pendingApproval');
  exchange.close({});
});
