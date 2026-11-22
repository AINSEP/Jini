import { describe, expect, it } from 'vitest';
import type { AcpModelProbe } from '@jini-ai/core/contracts/agents';
import { ambientCommandShell, execAgentFile } from '../invocation.js';
import { createAcpDiscoveryAdapter } from '../model-discovery-adapters.js';

type Execute = NonNullable<NonNullable<Parameters<typeof execAgentFile>[1]>['execute']>;
type Captured = { command: string; args: string[]; options: { windowsVerbatimArguments?: boolean | undefined } };

/** A fake `execute` port: records what `execAgentFile` hands it and resolves like execFile would. */
function recordingExecute() {
  const calls: Captured[] = [];
  const execute: Execute = (input) => {
    calls.push(input);
    return Promise.resolve({ stdout: '', stderr: '' }) as ReturnType<Execute>;
  };
  return { calls, execute };
}

const win32 = (ComSpec?: string) => ({ platform: 'win32' as const, fallbackComSpec: ComSpec });

describe('execAgentFile command planning (simulated platform, no global stubs)', () => {
  it('(a) wraps a .cmd shim for win32 using the ComSpec of the PASSED env', async () => {
    const { calls, execute } = recordingExecute();
    await execAgentFile(
      { command: 'claude.cmd', args: ['--version'] },
      { options: { env: { ComSpec: 'C:\\passed\\cmd.exe' } }, execute, commandShell: win32('C:\\ambient\\cmd.exe') },
    );
    expect(calls[0]!.command).toBe('C:\\passed\\cmd.exe');
    expect(calls[0]!.args).toEqual(['/d', '/s', '/c', '"claude.cmd --version"']);
    expect(calls[0]!.options.windowsVerbatimArguments).toBe(true);
  });

  it('(b) falls back to the AMBIENT ComSpec when the passed env carries none (host-built env)', async () => {
    const { calls, execute } = recordingExecute();
    await execAgentFile(
      { command: 'claude.cmd', args: ['--version'] },
      { options: { env: { PATH: 'C:\\bin' } }, execute, commandShell: win32('C:\\fake\\cmd.exe') },
    );
    expect(calls[0]!.command).toBe('C:\\fake\\cmd.exe');
    expect(calls[0]!.options.windowsVerbatimArguments).toBe(true);
  });

  it('(b2) uses bare cmd.exe only when neither env carries a ComSpec', async () => {
    const { calls, execute } = recordingExecute();
    await execAgentFile(
      { command: 'claude.bat', args: [] },
      { options: { env: {} }, execute, commandShell: win32(undefined) },
    );
    expect(calls[0]!.command).toBe('cmd.exe');
  });

  it('passes a .cmd command straight through on linux (platform is not hard-coded to win32)', async () => {
    const { calls, execute } = recordingExecute();
    await execAgentFile(
      { command: 'claude.cmd', args: ['--version'] },
      { options: { env: { ComSpec: 'C:\\passed\\cmd.exe' } }, execute, commandShell: { platform: 'linux', fallbackComSpec: 'C:\\x\\cmd.exe' } },
    );
    expect(calls[0]!.command).toBe('claude.cmd');
    expect(calls[0]!.args).toEqual(['--version']);
    expect(calls[0]!.options.windowsVerbatimArguments).toBeUndefined();
  });

  it('T2: hands execute the planned command and args unchanged for a plain binary', async () => {
    const { calls, execute } = recordingExecute();
    await execAgentFile({ command: '/usr/bin/agent', args: ['models', '--json'] }, { execute });
    expect(calls[0]!.command).toBe('/usr/bin/agent');
    expect(calls[0]!.args).toEqual(['models', '--json']);
  });

  it('with no env passed, the ambient ComSpec is used (the old default was the process env)', async () => {
    const { calls, execute } = recordingExecute();
    await execAgentFile({ command: 'claude.cmd', args: [] }, { execute, commandShell: win32('C:\\process\\cmd.exe') });
    expect(calls[0]!.command).toBe('C:\\process\\cmd.exe');
  });
});

describe('ambientCommandShell', () => {
  it('reads the ambient ComSpec from the injected env and the injected platform', () => {
    expect(ambientCommandShell({}, { platform: 'win32', ambientEnv: { ComSpec: 'C:\\fake\\cmd.exe' } }))
      .toEqual({ platform: 'win32', fallbackComSpec: 'C:\\fake\\cmd.exe' });
  });

  it('reads process.platform and process.env on every call, never hoisted', () => {
    const previous = process.env.ComSpec;
    try {
      process.env.ComSpec = 'first';
      expect(ambientCommandShell({}, {}).fallbackComSpec).toBe('first');
      process.env.ComSpec = 'second';
      const shell = ambientCommandShell({});
      expect(shell.fallbackComSpec).toBe('second');
      expect(shell.platform).toBe(process.platform);
    } finally {
      if (previous === undefined) delete process.env.ComSpec;
      else process.env.ComSpec = previous;
    }
  });
});

describe('createAcpDiscoveryAdapter command planning', () => {
  const input = (env: Record<string, string>) => ({ context: { executable: 'agent.cmd', cwd: '/w', env }, args: ['acp'], signal: new AbortController().signal });
  const recordingProbe = () => {
    const seen: { bin: string; args: string[] }[] = [];
    const probe: AcpModelProbe = { async detectModels(required) { seen.push({ bin: required.bin, args: [...required.args] }); return []; } };
    return { seen, probe };
  };

  it('hands the probe the cmd-shim plan with the AMBIENT ComSpec when the context env has none', async () => {
    const { seen, probe } = recordingProbe();
    await createAcpDiscoveryAdapter({ probe }, { commandShell: win32('C:\\fake\\cmd.exe') }).probe(input({ PATH: 'p' }));
    expect(seen).toEqual([{ bin: 'C:\\fake\\cmd.exe', args: ['/d', '/s', '/c', '"agent.cmd acp"'] }]);
  });

  it('prefers the ComSpec of the context env and passes through on linux', async () => {
    const win = recordingProbe();
    await createAcpDiscoveryAdapter({ probe: win.probe }, { commandShell: win32('C:\\ambient\\cmd.exe') }).probe(input({ ComSpec: 'C:\\ctx\\cmd.exe' }));
    expect(win.seen[0]!.bin).toBe('C:\\ctx\\cmd.exe');
    const linux = recordingProbe();
    await createAcpDiscoveryAdapter({ probe: linux.probe }, { commandShell: { platform: 'linux', fallbackComSpec: undefined } }).probe(input({}));
    expect(linux.seen).toEqual([{ bin: 'agent.cmd', args: ['acp'] }]);
  });
});
