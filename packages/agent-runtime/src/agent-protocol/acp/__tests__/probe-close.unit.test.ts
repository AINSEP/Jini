import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { expect, it } from 'vitest';
import { detectAcpModels } from '../models.js';

it('holds ACP discovery open until its metadata process closes', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    killed: false, exitCode: null as number | null,
    kill() { child.killed = true; return true; },
  });
  const spawnProcess = (() => child) as unknown as typeof spawn;
  let settled = false;
  const pending = detectAcpModels({ bin: '/fake-cli', args: ['acp'] }, { spawnProcess });
  void pending.then(() => { settled = true; });
  child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n');
  child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { models: { availableModels: [{ modelId: 'exact-model-v2', name: 'exact-model-v2' }] } } }) + '\n');
  await Promise.resolve();
  expect(child.killed).toBe(true);
  expect(settled).toBe(false);
  child.exitCode = 0;
  child.emit('close', 0, null);
  const models = await pending;
  expect(models.some(model => model.id === 'exact-model-v2')).toBe(true);
  expect(settled).toBe(true);
});
