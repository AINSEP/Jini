// J3 (w3-rtfnd): `routeReply` is the envelope a JSON handler returns to choose its own status,
// response headers, or an empty body; `isRouteReply` tells it apart from an ordinary value.
import { describe, expect, it } from 'vitest';
import { isRouteReply, routeReply } from '../route-reply.js';

describe('routeReply', () => {
  it('builds a frozen, branded reply carrying only the given fields', () => {
    const reply = routeReply({ status: 429, body: { error: 'slow down' }, headers: { 'retry-after': '30' } });
    expect([reply.status, reply.body, reply.headers]).toEqual([429, { error: 'slow down' }, { 'retry-after': '30' }]);
    expect(Object.isFrozen(reply)).toBe(true);
    expect(isRouteReply(reply)).toBe(true);
    const empty = routeReply({ status: 204 });
    expect(Object.keys(empty).sort()).toEqual(['status']);
    expect(isRouteReply(empty)).toBe(true);
  });

  it('does not mistake an ordinary value, even one shaped like a reply, for a reply', () => {
    for (const value of [undefined, null, 0, 'x', [], { status: 204 }, { status: 200, body: {}, headers: {} }]) {
      expect(isRouteReply(value)).toBe(false);
    }
  });

  it('keeps the brand out of the JSON serialization of a body that is itself a reply', () => {
    expect(JSON.stringify(routeReply({ status: 200, body: { a: 1 } }))).toBe('{"status":200,"body":{"a":1}}');
  });
});
