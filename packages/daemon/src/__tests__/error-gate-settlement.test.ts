import { expect, it, vi } from 'vitest';
import type { TerminalService } from '@jini-ai/core/contracts/runtime';
import { createTerminalSessionManager } from '../terminal-session.js';

it('preserves a terminal action rejection and runs the queued action once', async () => {
  const failure = new Error('terminal write refused');
  const session = { id: 'terminal', projectId: null, cwd: '/work', shell: '/bin/sh', cols: 80, rows: 24,
    status: 'running' as const, createdAt: 0, updatedAt: 0, exitCode: null, signal: null };
  const write = vi.fn().mockImplementationOnce(() => { throw failure; }).mockReturnValue(true);
  const service = { create: async () => session, get: () => session, list: () => [session], write,
    resize: () => true, kill: () => true, attach: () => 'attached' as const, detach: () => {}, shutdownActive: async () => {}, isTerminal: status => status === 'exited' } satisfies TerminalService;
  const manager = createTerminalSessionManager({ terminalService: service });
  const principal = { id: 'owner' };
  await manager.create({ principal, options: { cwd: '/work' } });
  const first = manager.write({ principal, id: session.id, input: 'first' });
  const rejected = expect(first).rejects.toBe(failure);
  const second = manager.write({ principal, id: session.id, input: 'second' });
  await rejected;
  await expect(second).resolves.toMatchObject({ status: 'ok', ok: true, session: { id: session.id } });
  expect(write.mock.calls).toEqual([[session.id, 'first'], [session.id, 'second']]);
});
