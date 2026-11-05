import assert from 'node:assert/strict';
import { test } from 'vitest';
import { admitFormRequest } from '../request-admission.js';
test('site budget is checked before attacker-controlled keys; site refusal consumes no per-source work', async () => {
  const keys: string[] = [];
  const result = await admitFormRequest({ workspaceId: 'w', sourceIp: 'ip', site: { check: async ({ key }) => { keys.push(key); return { allowed: false, retryAfterSeconds: 40 }; } }, source: { check: async () => assert.fail('site already refused') } });
  assert.deepEqual(result, { allowed: false, retryAfterSeconds: 40 }); assert.deepEqual(keys, ['w']);
});
test('invalid payloads and different form slugs share the pre-body source admission budget', async () => {
  const keys: string[] = [];
  const result = await admitFormRequest({ workspaceId: 'w', sourceIp: 'ip', site: { check: async () => ({ allowed: true }) }, source: { check: async ({ key }) => { keys.push(key); return { allowed: false, retryAfterSeconds: 20 }; } } });
  assert.deepEqual(result, { allowed: false, retryAfterSeconds: 20 }); assert.deepEqual(keys, ['w:ip']);
});

test('URL-encoded requests use source admission without consuming multipart site allowance', async () => {
  let sourceChecks = 0;
  const result = await admitFormRequest({ workspaceId: 'w', sourceIp: 'ip', site: { check: async () => assert.fail('URL-encoded request must not charge multipart site budget') }, source: { check: async () => { sourceChecks++; return { allowed: true }; } } }, { multipart: false });
  assert.equal(result.allowed, true); assert.equal(sourceChecks, 1);
});
