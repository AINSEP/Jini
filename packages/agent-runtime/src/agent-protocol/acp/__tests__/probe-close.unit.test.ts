import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { detectAcpModels } from '../models.js';

function createProbeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    killed: false, exitCode: null as number | null,
    kill() { child.killed = true; return true; },
  });
  return child;
}

it('holds ACP discovery open until its metadata process closes', async () => {
  const child = createProbeChild();
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

it('P16: settles after the probe exits even when an inherited stdout pipe stays open', async () => {
  vi.useFakeTimers();
  const child = createProbeChild();
  const spawnProcess = (() => child) as unknown as typeof spawn;
  const settled: unknown[] = [];
  const pending = detectAcpModels({ bin: '/fake-npx', args: ['acp'] }, { spawnProcess, env: {} });
  const observed = pending.then(
    (models) => { settled.push(models); },
    (error) => { settled.push(error); },
  );
  try {
    child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n');
    child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 2, result: {
      models: { availableModels: [{ modelId: 'exact-model-v2', name: 'exact-model-v2' }] },
    } }) + '\n');
    // A descendant can retain stdout after the direct child exits. Node emits
    // exit now, but cannot emit close until that inherited pipe is released.
    child.exitCode = 0;
    child.emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(251);
    expect(settled).toEqual([[
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'exact-model-v2', label: 'exact-model-v2' },
    ]]);
  } finally {
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    child.emit('close', 0, null);
    await observed;
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
