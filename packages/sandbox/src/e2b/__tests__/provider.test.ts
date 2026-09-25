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
  commands: { fake: 'commands' },
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
  it('applies its own defaults when config and boot options are both empty', async () => {
    const provider = createE2bSandboxProvider();

    const session = await provider.boot();

    expect(sandboxCreate).toHaveBeenCalledWith({});
    expect(wrapE2bSandboxMock).toHaveBeenCalledOnce();
    const [handleArg, configArg] = wrapE2bSandboxMock.mock.calls[0] as [unknown, unknown];
    // Proves boot() wrapped `sandboxCreate`'s result through `toE2bHandle` (its `commands` is
    // passed through by reference, per to-e2b-handle.test.ts) rather than passing the raw
    // Sandbox straight to wrapE2bSandbox.
    expect((handleArg as { commands: unknown }).commands).toBe(FAKE_SANDBOX.commands);
    expect(configArg).toEqual({
      projectRoot: '/home/user/app',
      previewPort: 5173,
      previewCheckTimeoutMs: 3000,
    });
    expect(session).toBe(FAKE_SESSION);
  });

  it('passes explicit config and a boot-time template through with no leaked undefined keys', async () => {
    const provider = createE2bSandboxProvider({
      apiKey: 'key-123',
      timeoutMs: 60_000,
      projectRoot: '/workspace',
      previewPort: 3000,
      previewCheckTimeoutMs: 500,
    });

    await provider.boot({ template: 'my-template' });

    // Not `{ apiKey: 'key-123', timeoutMs: 60_000, template: 'my-template' }` merely by value —
    // asserting the exact object also proves no stray `apiKey: undefined`-shaped key survived
    // from the conditional-spread construction in provider.ts.
    expect(sandboxCreate).toHaveBeenCalledWith({
      apiKey: 'key-123',
      timeoutMs: 60_000,
      template: 'my-template',
    });
    expect(wrapE2bSandboxMock.mock.calls[0]?.[1]).toEqual({
      projectRoot: '/workspace',
      previewPort: 3000,
      previewCheckTimeoutMs: 500,
    });
  });

  it('omits apiKey/timeoutMs from the SDK call when config sets them but boot supplies no template', async () => {
    const provider = createE2bSandboxProvider({ apiKey: 'key-123' });

    await provider.boot();

    expect(sandboxCreate).toHaveBeenCalledWith({ apiKey: 'key-123' });
  });
});
