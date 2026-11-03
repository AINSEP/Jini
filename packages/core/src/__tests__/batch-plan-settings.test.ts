import { expect, it } from 'vitest';
import { applyBatchInputs } from '../batch-tool-inputs.js';
import type { ToolExecutionContext, ToolRegistration } from '../tool-registry.js';

it('a configured combined plan receives the complete batch once instead of one call per item', async () => {
  let calls = 0;
  const registration: ToolRegistration = { descriptor: { id: 'replace_files', inputSchema: {
    type: 'object', required: ['path'], properties: { path: { type: 'string' } },
  } }, policy: { authorize: () => 'allow' }, handler: async ctx => { calls++; return ctx.input; } };
  const [wrapped] = applyBatchInputs({ registrations: [registration] }, { tools: [{ toolId: 'replace_files', mode: 'plan' }] });
  const input = { items: [{ path: 'a' }, { path: 'b' }] };
  const ctx: ToolExecutionContext = { executionId: 'exec', run: { id: 'run' }, principal: { id: 'owner' }, input, signal: new AbortController().signal };
  expect(await wrapped!.handler(ctx)).toEqual(input);
  expect(calls).toBe(1);
});
