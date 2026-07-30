import { describe, expect, it, vi } from 'vitest';
import type { AgentExecutor, AgentExecutorRunInput } from '../../agent-executor.js';
import { createDefaultRunStartHandler, type ResolveRunInputContext } from '../run-start-handler.js';

function fakeExecutor(): { executor: AgentExecutor; calls: AgentExecutorRunInput[] } {
  const calls: AgentExecutorRunInput[] = [];
  return {
    calls,
    executor: {
      run: async (input) => {
        calls.push(input);
      },
    },
  };
}

describe('createDefaultRunStartHandler', () => {
  it('resolves run input and hands it straight to agentExecutor.run(), including a supplied agentId and env', async () => {
    const { executor, calls } = fakeExecutor();
    const resolveRunInput = vi.fn(async (ctx: ResolveRunInputContext) => ({
      agentId: ctx.agentId ?? 'fallback-agent',
      prompt: `prompt for ${ctx.contextRef}`,
      cwd: '/work',
      env: { FOO: 'bar' },
    }));
    const handler = createDefaultRunStartHandler({ agentExecutor: executor, resolveRunInput });

    await handler({ request: { contextRef: 'ctx-1', agentId: 'claude' }, run: { id: 'run-1' } });

    expect(resolveRunInput).toHaveBeenCalledWith({ runId: 'run-1', contextRef: 'ctx-1', agentId: 'claude' });
    expect(calls).toEqual([{ runId: 'run-1', agentId: 'claude', prompt: 'prompt for ctx-1', cwd: '/work', env: { FOO: 'bar' } }]);
  });

  it('omits agentId from the resolveRunInput context when the request has none, and omits env from the executor call when unresolved', async () => {
    const { executor, calls } = fakeExecutor();
    const resolveRunInput = vi.fn((ctx: ResolveRunInputContext) => ({
      agentId: 'default-agent',
      prompt: `prompt for ${ctx.contextRef}`,
      cwd: '/work',
    }));
    const handler = createDefaultRunStartHandler({ agentExecutor: executor, resolveRunInput });

    await handler({ request: { contextRef: 'ctx-2' }, run: { id: 'run-2' } });

    expect(resolveRunInput).toHaveBeenCalledWith({ runId: 'run-2', contextRef: 'ctx-2' });
    const call = calls[0]!;
    expect(call).toEqual({ runId: 'run-2', agentId: 'default-agent', prompt: 'prompt for ctx-2', cwd: '/work' });
    expect('env' in call).toBe(false);
  });

  it('propagates a resolveRunInput rejection without calling agentExecutor.run', async () => {
    const { executor, calls } = fakeExecutor();
    const resolveRunInput = vi.fn(async () => {
      throw new Error('cannot compose prompt');
    });
    const handler = createDefaultRunStartHandler({ agentExecutor: executor, resolveRunInput });

    await expect(handler({ request: { contextRef: 'ctx-3' }, run: { id: 'run-3' } })).rejects.toThrow('cannot compose prompt');
    expect(calls).toHaveLength(0);
  });

  it('propagates an agentExecutor.run() rejection', async () => {
    const executor: AgentExecutor = {
      run: async () => {
        throw new Error('spawn failed');
      },
    };
    const resolveRunInput = () => ({ agentId: 'a', prompt: 'p', cwd: '/work' });
    const handler = createDefaultRunStartHandler({ agentExecutor: executor, resolveRunInput });

    await expect(handler({ request: { contextRef: 'ctx-4' }, run: { id: 'run-4' } })).rejects.toThrow('spawn failed');
  });
});

describe('createDefaultRunStartHandler — optional executor passthroughs', () => {
  const base = { agentId: 'claude', prompt: 'hi', cwd: '/work' } as const;

  // The regression this exists to prevent: a host that had been calling AgentExecutor.run() by hand
  // with permissionMode: 'restricted' and then adopts this handler must be able to keep that posture.
  // Before ResolvedRunInput carried the field, adopting the handler silently dropped it and every run
  // began auto-approving.
  it('forwards permissionMode to the executor', async () => {
    const { executor, calls } = fakeExecutor();
    const handler = createDefaultRunStartHandler({
      agentExecutor: executor,
      resolveRunInput: () => ({ ...base, permissionMode: 'restricted' as const }),
    });

    await handler({ request: { contextRef: 'ctx-1' }, run: { id: 'run-1' } });

    expect(calls[0]!.permissionMode).toBe('restricted');
  });

  it('forwards model, reasoning, and credentialEnv', async () => {
    const { executor, calls } = fakeExecutor();
    const handler = createDefaultRunStartHandler({
      agentExecutor: executor,
      resolveRunInput: () => ({
        ...base,
        model: 'some-model',
        reasoning: 'high',
        credentialEnv: { ANTHROPIC_API_KEY: 'sk-test' },
      }),
    });

    await handler({ request: { contextRef: 'ctx-1' }, run: { id: 'run-1' } });

    expect(calls[0]).toMatchObject({
      model: 'some-model',
      reasoning: 'high',
      credentialEnv: { ANTHROPIC_API_KEY: 'sk-test' },
    });
  });

  // The three file-bearing inputs `AgentExecutorRunInput` grew and this handler never caught up with.
  // A host that adopts the default handler and needs any of them — an attached screenshot, a second
  // readable directory, a pi-rpc upload root — silently got a run without them: the agent simply
  // cannot see the image it was asked about, with nothing anywhere saying why.
  it('forwards imagePaths, extraAllowedDirs, and uploadRoot', async () => {
    const { executor, calls } = fakeExecutor();
    const handler = createDefaultRunStartHandler({
      agentExecutor: executor,
      resolveRunInput: () => ({
        ...base,
        imagePaths: ['/uploads/run-1/shot.png'],
        extraAllowedDirs: ['/work/vendor', '/work/docs'],
        uploadRoot: '/uploads/run-1',
      }),
    });

    await handler({ request: { contextRef: 'ctx-1' }, run: { id: 'run-1' } });

    expect(calls[0]).toMatchObject({
      imagePaths: ['/uploads/run-1/shot.png'],
      extraAllowedDirs: ['/work/vendor', '/work/docs'],
      uploadRoot: '/uploads/run-1',
    });
  });

  // Absent must stay absent, not become an explicit `undefined`: for permissionMode the executor
  // treats absence as "use the def's own auto-approve default", so the two are not equivalent.
  it('omits every optional passthrough the resolver did not supply', async () => {
    const { executor, calls } = fakeExecutor();
    const handler = createDefaultRunStartHandler({
      agentExecutor: executor,
      resolveRunInput: () => ({ ...base }),
    });

    await handler({ request: { contextRef: 'ctx-1' }, run: { id: 'run-1' } });

    expect(Object.keys(calls[0]!).sort()).toEqual(['agentId', 'cwd', 'prompt', 'runId']);
  });
});
