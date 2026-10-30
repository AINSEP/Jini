/**
 * `provider.ts`'s only job is translating `E2bProviderConfig`/`BootOptions` into the
 * `Sandbox.create()` call, wrapping the result via `toE2bHandle`, and the `wrapE2bSandbox`
 * config — both the SDK and the wrapping logic are mocked out so what's under test is that
 * translation, not a real sandbox boot or `toE2bHandle`'s own logic (that's
 * `to-e2b-handle.test.ts`'s job). The assertion that matters is the *shape* of what gets passed
 * through: default-filling, and that an omitted config key is genuinely absent from the SDK call
 * rather than present as `undefined` (this package's `exactOptionalPropertyTypes: true` makes
 * that distinction real, not cosmetic).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sandbox } from '@e2b/code-interpreter';
import { SandboxOperationError } from '../../core/errors.js';

const sandboxCreate = vi.fn();
vi.mock('@e2b/code-interpreter', () => ({
  Sandbox: { create: (...args: unknown[]) => sandboxCreate(...args) },
}));

const wrapE2bSandboxMock = vi.fn();
vi.mock('../wrap-e2b-sandbox.js', () => ({
  wrapE2bSandbox: (...args: unknown[]) => wrapE2bSandboxMock(...args),
}));

const { createE2bSandboxProvider } = await import('../provider.js');

/** Minimal shape `toE2bHandle` needs to build a handle without throwing — its own translation
 *  logic (does `files.write` get the right args, etc.) is covered by `to-e2b-handle.test.ts`,
 *  not here. */
const FAKE_SANDBOX = {
  commands: { run: vi.fn() },
  files: { write: vi.fn(), read: vi.fn(), list: vi.fn(), watchDir: vi.fn() },
  getHost: vi.fn(),
  kill: vi.fn(),
};
const FAKE_SESSION = { fake: 'session' };

beforeEach(() => {
  sandboxCreate.mockReset().mockResolvedValue(FAKE_SANDBOX);
  wrapE2bSandboxMock.mockReset().mockResolvedValue(FAKE_SESSION);
});

describe('createE2bSandboxProvider', () => {
  it('C54: releases failed boots and returns non-zero command exits as results', async () => {
    // Keep SDK -> handle -> session translation real for both halves of this finding.
    const { wrapE2bSandbox } = await vi.importActual<typeof import('../wrap-e2b-sandbox.js')>('../wrap-e2b-sandbox.js');
    const { CommandExitError } = await vi.importActual<typeof import('@e2b/code-interpreter')>('@e2b/code-interpreter');
    wrapE2bSandboxMock.mockImplementation(wrapE2bSandbox);
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    const cause = new Error('watch unavailable');
    const watchDir = vi.fn().mockRejectedValueOnce(cause)
      .mockResolvedValue({ stop: vi.fn().mockResolvedValue(undefined) });
    const sandbox = { ...FAKE_SANDBOX, commands: { run }, files: { ...FAKE_SANDBOX.files, watchDir } };
    const kill = vi.fn().mockResolvedValue(true);
    sandboxCreate.mockResolvedValueOnce({ ...sandbox, kill });

    await expect(createE2bSandboxProvider({}).boot({})).rejects.toMatchObject({ cause });

    // Creation succeeded, so failed setup must release the paid VM before boot rejects.
    expect.soft(kill).toHaveBeenCalledOnce();

    sandboxCreate.mockResolvedValueOnce({ ...sandbox, kill: vi.fn().mockResolvedValue(true) });
    const session = await createE2bSandboxProvider({}).boot({});
    const result = { stdout: 'partial output', stderr: 'command failed', exitCode: 2 };
    run.mockRejectedValue(new CommandExitError(result));
    try {
      await expect.soft(session.runCommand({ command: 'false' })).resolves.toEqual(result);
      await expect(session.installDependencies({})).resolves.toEqual(result);
    } finally {
      await session.teardown();
    }
  });

  it('wraps SDK creation errors with the core category, message and original cause', async () => {
    const cause = Object.assign(new Error('bad credentials'), { name: 'AuthenticationError' });
    sandboxCreate.mockRejectedValueOnce(cause);
    const pending = createE2bSandboxProvider({}).boot({});
    await expect(pending).rejects.toBeInstanceOf(SandboxOperationError);
    await expect(pending).rejects.toMatchObject({
      category: 'permission-denied', message: 'Failed to create the sandbox', cause,
    });
    expect(wrapE2bSandboxMock).not.toHaveBeenCalled();
  });

  it('wraps injected creation failures too, including non-Error values', async () => {
    const cause = 'factory unavailable';
    const provider = createE2bSandboxProvider({}, { createSandbox: async () => { throw cause; } });
    const pending = provider.boot({});
    await expect(pending).rejects.toBeInstanceOf(SandboxOperationError);
    await expect(pending).rejects.toMatchObject({ category: 'unknown', cause });
    expect(wrapE2bSandboxMock).not.toHaveBeenCalled();
  });

  it('applies its own defaults when config and boot options are both empty', async () => {
    const provider = createE2bSandboxProvider({});

    const session = await provider.boot({});

    expect(sandboxCreate).toHaveBeenCalledWith({});
    expect(wrapE2bSandboxMock).toHaveBeenCalledOnce();
    const { handle: handleArg, config: configArg } = wrapE2bSandboxMock.mock.calls[0]![0] as { handle: unknown; config: unknown };
    // Proves boot() wrapped `sandboxCreate`'s result through `toE2bHandle` (its `commands` is
    // passed through by reference, per to-e2b-handle.test.ts) rather than passing the raw
    // Sandbox straight to wrapE2bSandbox.
    expect(typeof (handleArg as { commands: { run: unknown } }).commands.run).toBe('function');
    expect(configArg).toEqual({
      projectRoot: '/home/user/app',
      previewPort: 5173,
      previewCheckTimeoutMs: 3000,
    });
    expect(session).toBe(FAKE_SESSION);
  });

  it('passes explicit config and a boot-time template through with no leaked undefined keys', async () => {
    const provider = createE2bSandboxProvider({}, {
      apiKey: 'key-123',
      timeoutMs: 60_000,
      projectRoot: '/workspace',
      previewPort: 3000,
      previewCheckTimeoutMs: 500,
    });

    await provider.boot({}, { template: 'my-template' });

    // Not `{ apiKey: 'key-123', timeoutMs: 60_000, template: 'my-template' }` merely by value —
    // asserting the exact object also proves no stray `apiKey: undefined`-shaped key survived
    // from the conditional-spread construction in provider.ts.
    expect(sandboxCreate).toHaveBeenCalledWith({
      apiKey: 'key-123',
      timeoutMs: 60_000,
      template: 'my-template',
    });
    expect(wrapE2bSandboxMock.mock.calls[0]?.[0].config).toEqual({
      projectRoot: '/workspace',
      previewPort: 3000,
      previewCheckTimeoutMs: 500,
    });
  });

  it('omits apiKey/timeoutMs from the SDK call when config sets them but boot supplies no template', async () => {
    const provider = createE2bSandboxProvider({}, { apiKey: 'key-123' });

    await provider.boot({});

    expect(sandboxCreate).toHaveBeenCalledWith({ apiKey: 'key-123' });
  });
});

describe('provider boot characterization', () => {
  it('retains the setup error when cleanup of the newly created VM also rejects', async () => {
    const cause = new Error('watch failed');
    const kill = vi.fn().mockRejectedValueOnce(new Error('VM cleanup failed'));
    const sandbox = { ...FAKE_SANDBOX, kill } as unknown as Sandbox;
    wrapE2bSandboxMock.mockRejectedValueOnce(cause);
    const provider = createE2bSandboxProvider({}, { createSandbox: async () => sandbox });
    await expect(provider.boot({})).rejects.toBe(cause);
    expect(kill).toHaveBeenCalledExactlyOnceWith();
  });
  it('preserves empty credentials, zero timeout, an empty template and falsy session settings', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await createE2bSandboxProvider({}, {
      apiKey: '', timeoutMs: 0, projectRoot: '', previewPort: 0, previewCheckTimeoutMs: 0, fetchImpl,
    }).boot({}, { template: '' });

    expect(sandboxCreate).toHaveBeenCalledExactlyOnceWith({ apiKey: '', timeoutMs: 0, template: '' });
    expect(wrapE2bSandboxMock.mock.calls[0]?.[0].config).toEqual({
      projectRoot: '', previewPort: 0, previewCheckTimeoutMs: 0,
    });
    expect(wrapE2bSandboxMock.mock.calls[0]?.[1]).toEqual({ fetchImpl });
  });

  it('omits all creation keys with empty boot options and passes an empty fetch options object', async () => {
    await createE2bSandboxProvider({}).boot({}, {});
    expect(sandboxCreate).toHaveBeenCalledExactlyOnceWith({});
    expect(wrapE2bSandboxMock.mock.calls[0]?.[1]).toEqual({});
  });

  it('uses the injected creation port and resolves defaults separately for each boot', async () => {
    const sandbox = await Sandbox.create({});
    sandboxCreate.mockClear();
    const createSandbox = vi.fn<({ options }: {
      options: { apiKey?: string; timeoutMs?: number; template?: string };
    }) => Promise<Sandbox>>().mockResolvedValue(sandbox);
    const config = { createSandbox, projectRoot: '/first' };
    const provider = createE2bSandboxProvider({}, config);

    await provider.boot({}, { template: 'starter' });
    config.projectRoot = '/second';
    await provider.boot({});

    expect(sandboxCreate).not.toHaveBeenCalled();
    expect(createSandbox.mock.calls).toEqual([
      [{ options: { template: 'starter' } }], [{ options: {} }],
    ]);
    expect(wrapE2bSandboxMock.mock.calls.map(call => call[0].config)).toEqual([
      { projectRoot: '/first', previewPort: 5173, previewCheckTimeoutMs: 3000 },
      { projectRoot: '/second', previewPort: 5173, previewCheckTimeoutMs: 3000 },
    ]);
  });

  it('propagates wrapping failures unchanged after sandbox creation succeeds', async () => {
    const cause = new Error('watch failed');
    wrapE2bSandboxMock.mockRejectedValueOnce(cause);
    await expect(createE2bSandboxProvider({}).boot({})).rejects.toBe(cause);
    expect(sandboxCreate).toHaveBeenCalledExactlyOnceWith({});
  });
});
