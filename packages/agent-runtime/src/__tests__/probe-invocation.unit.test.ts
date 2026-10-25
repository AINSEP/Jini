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

// Stryker L3 (F3): the exact default options and the "already finished child" short-circuit.
it('defaults to SIGKILL and the OS tmpdir, and lets the caller override both', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const execute: NonNullable<NonNullable<Parameters<typeof execAgentFile>[1]>['execute']> = (input) => {
    seen.push(input.options as Record<string, unknown>);
    return Object.assign(Promise.resolve({ stdout: '', stderr: '' }), { child: undefined as unknown as ChildProcess });
  };
  await execAgentFile({ command: '/fake-cli', args: ['--version'] }, { execute });
  await execAgentFile({ command: '/fake-cli', args: ['x'] }, { execute, options: { cwd: '/w', killSignal: 'SIGTERM' } });
  const { tmpdir } = await import('node:os');
  expect(seen[0]).toMatchObject({ killSignal: 'SIGKILL', cwd: tmpdir() });
  expect(seen[1]).toMatchObject({ killSignal: 'SIGTERM', cwd: '/w' });
});

it.each([
  ['exited', { pid: 1, exitCode: 0, signalCode: null }],
  ['signaled', { pid: 1, exitCode: null, signalCode: 'SIGTERM' }],
  ['never spawned (no pid)', { pid: undefined, exitCode: null, signalCode: null }],
])('does not wait for close on a child that already %s', async (_label, state) => {
  const child = Object.assign(new EventEmitter(), state);
  const execute: NonNullable<NonNullable<Parameters<typeof execAgentFile>[1]>['execute']> = () =>
    Object.assign(Promise.resolve({ stdout: 'done', stderr: '' }), { child: child as unknown as ChildProcess });
  await expect(execAgentFile({ command: '/fake-cli', args: [] }, { execute })).resolves.toEqual({ stdout: 'done', stderr: '' });
});
