import { createToolRegistry, type Principal } from '@jini-ai/core';
import { describe, expect, it, vi } from 'vitest';
import { createToolExecutor, type ToolExecutor } from '../tool-executor.js';
import { createRoutingToolExecutor } from '../routing-tool-executor.js';

const principal: Principal = { id: 'user-1' };
const run = { id: 'run-1' };

function fakeRemote(): ToolExecutor & { execute: ReturnType<typeof vi.fn> } {
  return {
    execute: vi.fn(async () => ({ executionId: 'remote-1', status: 'completed' as const, output: 'remote' })),
    resumeConfirmation: vi.fn(() => { throw new Error('remote'); }),
    cancel: vi.fn(),
    getAuditRecord: vi.fn(() => null),
  };
}

function setup() {
  const registry = createToolRegistry({});
  const localHandler = vi.fn(async () => 'local');
  registry.register({ descriptor: { id: 'page.read' }, policy: { authorize: () => 'allow' }, handler: localHandler });
  const local = createToolExecutor({ registry });
  const remote = fakeRemote();
  const routing = createRoutingToolExecutor({ local, remote, isLocal: ({ toolId }) => registry.has({ toolId }) });
  return { local, remote, routing, localHandler };
}

describe('createRoutingToolExecutor', () => {
  it('runs a locally registered id locally', async () => {
    const { remote, routing, localHandler } = setup();
    await expect(routing.execute({ principal, run, toolId: 'page.read', input: {} })).resolves.toMatchObject({ status: 'completed', output: 'local' });
    expect(localHandler).toHaveBeenCalledTimes(1);
    expect(remote.execute).not.toHaveBeenCalled();
  });

  it('sends any other id remote with its options, never through a local placeholder', async () => {
    const { remote, routing, localHandler } = setup();
    const signal = new AbortController().signal;
    await expect(routing.execute({ principal, run, toolId: 'site.publish', input: { a: 1 } }, { signal })).resolves.toMatchObject({ output: 'remote' });
    expect(remote.execute).toHaveBeenCalledWith({ principal, run, toolId: 'site.publish', input: { a: 1 } }, { signal });
    expect(localHandler).not.toHaveBeenCalled();
  });

  it('cancels on both sides, reads audit locally first, and resumes confirmations locally', async () => {
    const { local, remote, routing } = setup();
    const result = await routing.execute({ principal, run, toolId: 'page.read', input: {} });
    expect(routing.getAuditRecord({ executionId: result.executionId })).toEqual(local.getAuditRecord({ executionId: result.executionId }));
    expect(routing.getAuditRecord({ executionId: 'remote-1' })).toBeNull();
    expect(remote.getAuditRecord).toHaveBeenCalledWith({ executionId: 'remote-1' });
    routing.cancel({ executionId: 'remote-1' });
    expect(remote.cancel).toHaveBeenCalledWith({ executionId: 'remote-1' });
    expect(() => routing.resumeConfirmation({ executionId: 'nope', decision: 'confirm' })).toThrow();
    expect(remote.resumeConfirmation).not.toHaveBeenCalled();
  });
});
