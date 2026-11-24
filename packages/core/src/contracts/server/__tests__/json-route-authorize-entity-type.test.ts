// J4 (w3-rtfnd): core's web-`Request` `jsonRoute` follows the same rule as the Express adapter: an
// `authorize` call without `entityType` reaches the host port without that key.
import { describe, expect, it } from 'vitest';
import { defineJsonRoute, jsonRoute } from '../json-route.js';
import { ok } from '../result.js';

describe('jsonRoute authorize without entityType', () => {
  it('omits the entityType key when the handler gave none, and forwards it when given', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const spec = defineJsonRoute<void, object, object, { id: string }>({
      method: 'get', path: '/roles', parse: () => ok({ value: undefined }),
      handle: async ({ authorize }) => {
        await authorize!({ permission: 'users.read' });
        await authorize!({ permission: 'users.write', entityType: 'user' });
        return ok({ value: {} });
      },
    }, { ports: { authenticate: () => ({ id: 'caller' }), authorize: (required) => { seen.push({ ...required }); } } });
    const route = jsonRoute({ spec, deps: {}, reportInternalError: () => { throw new Error('unexpected'); } });
    const response = await route.handler({ request: new Request('http://x/roles'), params: {} });
    expect(response.status).toBe(200);
    expect(seen).toStrictEqual([
      { context: { id: 'caller' }, deps: {}, permission: 'users.read' },
      { context: { id: 'caller' }, deps: {}, permission: 'users.write', entityType: 'user' },
    ]);
  });
});
