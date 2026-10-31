import { expect, it } from 'vitest';
import { createToolRegistry } from '@jini-ai/core';
import { createToolExecutor } from '../tool-executor.js';
it('host can require confirmation for an input without weakening the descriptor gate', async () => {
  const registry = createToolRegistry({}); let effects = 0;
  registry.register({ descriptor: { id: 'fill' }, policy: { authorize: () => 'allow' }, handler: async () => ++effects });
  const executor = createToolExecutor({ registry }, { delegate: { onConfirm: () => 'deny' } });
  const refused = await executor.execute({ principal: { id: 'g' }, run: { id: 'r' }, toolId: 'fill', input: {} }, { requireConfirmation: true });
  expect(refused.status).toBe('confirmation-denied'); expect(effects).toBe(0);
  expect((await executor.execute({ principal: { id: 'g' }, run: { id: 'r' }, toolId: 'fill', input: {} })).status).toBe('completed');
  expect(effects).toBe(1);
});
