import { afterEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  calls: [] as Array<{ file: string; args: string[]; options: Record<string, unknown> }>,
}));

vi.mock('node:child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    options: Record<string, unknown>,
    cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
    mockState.calls.push({ file, args, options });
    cb(null, { stdout: 'ok', stderr: '' });
  },
}));

import { execAgentFile } from '../invocation.js';

afterEach(() => {
  mockState.calls = [];
});

describe('execAgentFile', () => {
  it('defaults cwd to the OS tmpdir when no cwd is supplied', async () => {
    await execAgentFile({ command: 'some-bin', args: ['--version'] });
    expect(mockState.calls).toHaveLength(1);
    const call = mockState.calls[0]!;
    expect(call.file).toBe('some-bin');
    expect(call.args).toEqual(['--version']);
    expect(typeof call.options.cwd).toBe('string');
    expect((call.options.cwd as string).length).toBeGreaterThan(0);
  });

  it('honors an explicit cwd instead of the tmpdir default', async () => {
    await execAgentFile({ command: 'some-bin', args: [] }, { options: { cwd: '/explicit/dir' } });
    expect(mockState.calls[0]!.options.cwd).toBe('/explicit/dir');
  });

  it('passes options.env through to createCommandInvocation and the exec call', async () => {
    await execAgentFile({ command: 'some-bin', args: ['x'] }, { options: { env: { FOO: 'bar' } } });
    expect(mockState.calls[0]!.options.env).toEqual({ FOO: 'bar' });
  });

  it('omits env from the invocation request when none is supplied', async () => {
    await execAgentFile({ command: 'some-bin', args: ['x'] }, { options: { timeout: 5000 } });
    const call = mockState.calls[0]!;
    expect(call.options.timeout).toBe(5000);
    expect(call.options.env).toBeUndefined();
  });

  it('resolves with the child process stdout/stderr', async () => {
    const result = await execAgentFile({ command: 'some-bin', args: [] });
    expect(result).toEqual({ stdout: 'ok', stderr: '' });
  });
});
