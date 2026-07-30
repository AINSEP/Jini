import { beforeEach, describe, expect, it, vi } from 'vitest';
import { guardSameOrigin } from '../origin.js';
import { isLocalSameOrigin } from '../origin-validation.js';

vi.mock('../origin-validation.js', () => ({
  isLocalSameOrigin: vi.fn(),
}));

const origin = { resolvedPortRef: { current: 7456 } };

beforeEach(() => {
  vi.mocked(isLocalSameOrigin).mockReset();
});

describe('guardSameOrigin', () => {
  it('allows the request when isLocalSameOrigin says the origin matches', () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(true);
    const result = guardSameOrigin({} as any, origin);
    expect(result).toEqual({ ok: true, value: undefined });
    expect(isLocalSameOrigin).toHaveBeenCalledWith({}, 7456, process.env);
  });

  it('rejects the request when isLocalSameOrigin says the origin does not match', () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const result = guardSameOrigin({} as any, origin);
    expect(result).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'cross-origin request rejected' },
    });
  });

  // The origin-guard MIDDLEWARE is already handed an explicit `env` by every composition that has
  // one. Without the same seam here the two halves of one decision read two different environments,
  // so a host that injects its own env gets a bind host, an allow-list and a web port the per-route
  // guard never sees.
  it("reads the context's own env when the host injected one, instead of the real process env", () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(true);
    const injected: NodeJS.ProcessEnv = { JINI_BIND_HOST: '10.1.2.3', JINI_ALLOWED_ORIGINS: 'https://ok.example' };

    guardSameOrigin({} as any, { resolvedPortRef: { current: 7456 }, env: injected });

    expect(isLocalSameOrigin).toHaveBeenCalledWith({}, 7456, injected);
    expect(vi.mocked(isLocalSameOrigin).mock.calls[0]![2]).not.toBe(process.env);
  });

  it('falls back to the REAL process env object when the context names none', () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(true);
    guardSameOrigin({} as any, { resolvedPortRef: { current: 7456 } });
    // Identity, not deep equality: a snapshot copy would silently stop tracking later mutations
    // (`createLocalNodeDaemon` writes `JINI_BIND_HOST` at boot).
    expect(vi.mocked(isLocalSameOrigin).mock.calls[0]![2]).toBe(process.env);
  });
});
