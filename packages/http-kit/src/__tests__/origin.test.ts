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
    expect(isLocalSameOrigin).toHaveBeenCalledWith({}, 7456);
  });

  it('rejects the request when isLocalSameOrigin says the origin does not match', () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const result = guardSameOrigin({} as any, origin);
    expect(result).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'cross-origin request rejected' },
    });
  });
});
