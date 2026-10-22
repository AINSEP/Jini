import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { expect, it } from 'vitest';
import { execAgentFile } from '../invocation.js';

it('retains the process slot after abort rejection until the child closes', async () => {
  const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null });
  let reject!: (error: Error) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const firstResult = Object.assign(new Promise<{ stdout: string; stderr: string }>((_resolve, fail) => { reject = fail; }), { child: child as unknown as ChildProcess });
  let calls = 0;
  const execute: NonNullable<NonNullable<Parameters<typeof execAgentFile>[1]>['execute']> = () => {
    calls++; started();
    return calls === 1 ? firstResult : Object.assign(Promise.resolve({ stdout: 'ok', stderr: '' }), { child: Object.assign(new EventEmitter(), { pid: 456, exitCode: 0, signalCode: null }) as unknown as ChildProcess });
  };
  const first = execAgentFile({ command: '/fake-cli', args: ['models'] }, { execute });
  const rejected = expect(first).rejects.toThrow('aborted');
  await ready;
  const second = execAgentFile({ command: '/fake-cli', args: ['--version'] }, { execute });
  reject(new Error('aborted'));
  await Promise.resolve(); await Promise.resolve();
  expect(calls).toBe(1);
  child.emit('close', null, 'SIGKILL');
  await rejected;
  expect(await second).toEqual({ stdout: 'ok', stderr: '' });
  expect(calls).toBe(2);
});
