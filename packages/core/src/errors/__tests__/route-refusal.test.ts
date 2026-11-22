import { describe, expect, it } from 'vitest';
import { RouteRefusalError, rejectRoute } from '../route-refusal.js';

/** Runs `rejectRoute` and hands back what it threw, failing if it returned. */
function refusalOf(required: Parameters<typeof rejectRoute>[0]): unknown {
  try {
    rejectRoute(required);
  } catch (error) {
    return error;
  }
  throw new Error('rejectRoute returned instead of throwing');
}

describe('rejectRoute', () => {
  it('throws a RouteRefusalError that is an Error, keeps the inherited name and the fixed message', () => {
    const error = refusalOf({ status: 404, error: 'workspace was not found' });
    expect(error).toBeInstanceOf(RouteRefusalError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('Error');
    expect((error as Error).message).toBe('settings request rejected');
  });

  it('carries the exact response for a bare 404, with no code or details keys', () => {
    const error = refusalOf({ status: 404, error: 'workspace was not found' }) as RouteRefusalError;
    expect(error.response).toStrictEqual({ status: 404, body: { error: 'workspace was not found' } });
    expect(Object.keys(error.response.body as object)).toEqual(['error']);
  });

  it('carries the exact response for a 403 with code and permission details', () => {
    const error = refusalOf({
      status: 403, error: "principal 'p1' is not authorized for 'settings.write' (role)",
      code: 'FORBIDDEN', details: { permission: 'settings.write', reason: 'role' },
    }) as RouteRefusalError;
    expect(error.response).toStrictEqual({
      status: 403,
      body: { error: "principal 'p1' is not authorized for 'settings.write' (role)", code: 'FORBIDDEN', details: { permission: 'settings.write', reason: 'role' } },
    });
  });

  it('accepts the optional args pad', () => {
    expect(() => rejectRoute({ status: 400, error: 'no' }, {})).toThrow(RouteRefusalError);
  });
});
