import { ChildProcess } from 'node:child_process';
import * as childProcess from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeLockHandoffContext, RuntimeLockHold } from '@jini-ai/agent-runtime';
import * as executor from '../index.js';
import { armHandoffWatcher } from '../handoff.js';

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}));

describe('agent executor split parity', () => {
  // PARITY
  it('keeps session ids outside status wire payloads and ignores malformed input', () => {
    expect(executor.translateAgentRuntimeEvent({ rawEvent: {
      type: 'status', label: 'ready', sessionId: 'session-1', model: null,
    } })).toEqual({ kind: 'agent', payload: { type: 'status', label: 'ready' }, sessionId: 'session-1' });
    expect(executor.translateAgentRuntimeEvent({ rawEvent: null })).toEqual({ kind: 'ignored' });
    expect(executor.translateAgentRuntimeEvent({ rawEvent: { type: 'turn_end', stopReason: 'tool_use' } }))
      .toEqual({ kind: 'turn-end', stopReason: 'tool_use' });
  });

  // PARITY
  it('preserves existing MCP servers and instructions while keeping credentials out of argv', () => {
    const bridge = executor.buildMcpBridgeDelivery({
      cwd: '/workspace', runId: 'run-1', strategy: 'opencode-env-content',
      options: { command: 'bridge', args: ['serve'], daemonUrl: 'http://127.0.0.1:4000' },
      credential: 'run-token',
    });
    const env = executor.computeChildEnv({ spawnEnv: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { existing: { enabled: true } }, instructions: ['host.md'] }),
    }, mcpBridge: bridge }, { stagedInstructionsFile: { varName: 'OPENCODE_CONFIG_CONTENT', path: '/scratch/overlay.md' } });
    expect(env.OPENCODE_CONFIG_CONTENT).toBe(JSON.stringify({
      mcp: {
        existing: { enabled: true },
        jini: { type: 'local', command: ['bridge', 'serve'], environment: {
          JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://127.0.0.1:4000', JINI_DAEMON_TOKEN: 'run-token',
        }, enabled: true },
      },
      instructions: ['host.md', '/scratch/overlay.md'],
    }));
  });

  // PARITY
  it('returns the original environment object when no delivery applies', () => {
    const spawnEnv = { PATH: '/bin' };
    expect(executor.computeChildEnv({ spawnEnv, mcpBridge: null })).toBe(spawnEnv);
    expect(executor.buildAgentBuildArgsOptions({ input: {}, systemPromptOverlay: undefined }))
      .toEqual({ permissionMode: 'restricted' });
  });

  // PARITY
  it('keeps spawn synchronous so the caller can immediately register listeners', () => {
    const child = new ChildProcess();
    const spawnChild = vi.mocked(childProcess.spawn).mockReturnValue(child);
    const childEnv = { PATH: '/bin' };
    const result = executor.spawnAgentChildProcess({ input: {
      cwd: '/workspace', childEnv,
      invocation: { command: 'agent', args: ['--stdio'], windowsVerbatimArguments: false },
    }, deps: { spawn: childProcess.spawn } });
    expect(result).toEqual({ kind: 'ok', child });
    expect(spawnChild).toHaveBeenCalledTimes(1);
    expect(spawnChild).toHaveBeenCalledWith('agent', ['--stdio'], {
      cwd: '/workspace', env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsVerbatimArguments: false,
    });
    if (result.kind !== 'ok') throw new Error('Expected synchronous spawn success');
    const onError = vi.fn();
    result.child.once('error', onError);
    const failure = new Error('early spawn error');
    child.emit('error', failure);
    expect(onError).toHaveBeenCalledWith(failure);
    spawnChild.mockReset();
  });

  // PARITY
  it.each(['resolve', 'reject'])('releases only after a handoff watcher settles: %s', async (outcome) => {
    let resolveHandoff!: () => void;
    let rejectHandoff!: (error: Error) => void;
    const handoff = new Promise<void>((resolve, reject) => {
      resolveHandoff = resolve;
      rejectHandoff = reject;
    });
    const waitForHandoff = vi.fn((_context: RuntimeLockHandoffContext) => handoff);
    const release = vi.fn();
    const hold: RuntimeLockHold = { release, waitForHandoff };
    const handoffInput = { logFilePath: '/scratch/agent.log', model: undefined, processExited: new AbortController().signal };
    expect(armHandoffWatcher({ runtimeLockHold: hold, handoffInput, release })).toBeUndefined();
    expect(waitForHandoff).toHaveBeenCalledTimes(1);
    expect(waitForHandoff).toHaveBeenCalledWith(handoffInput);
    expect(release).not.toHaveBeenCalled();
    if (outcome === 'resolve') resolveHandoff();
    else rejectHandoff(new Error('watcher unavailable'));
    await handoff.catch(() => undefined);
    expect(release).toHaveBeenCalledTimes(1);
  });

  // PARITY
  it('does not release a lock with no handoff watcher before process exit', () => {
    const release = vi.fn();
    const handoffInput = { logFilePath: undefined, model: undefined, processExited: new AbortController().signal };
    armHandoffWatcher({ runtimeLockHold: undefined, handoffInput, release });
    armHandoffWatcher({ runtimeLockHold: { release }, handoffInput, release });
    expect(release).not.toHaveBeenCalled();
  });

});
