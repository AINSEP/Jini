import { describe, expect, it } from 'vitest';
import type { ServerHandler } from '../../server.js';
import { createRouteTable } from '../route-table.js';


const text = (body: string): ServerHandler => () => new Response(body);

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://local/x', { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
}


describe('createRouteTable', () => {
  it('matches literal over :param regardless of registration order, and decodes params', () => {
    const table = createRouteTable();
    table.route({ method: 'GET', path: '/runs/:id', handler: text('param') });
    table.route({ method: 'GET', path: '/runs/active', handler: text('literal') });
    const literal = table.match({ method: 'GET', pathname: '/runs/active' });
    expect(literal.kind === 'route' && literal.route.path).toBe('/runs/active');
    const param = table.match({ method: 'GET', pathname: '/runs/a%20b' });
    expect(param.kind === 'route' && param.params).toEqual({ id: 'a b' });
  });

  it('answers HEAD from GET, reports 405 with Allow, and not-found otherwise', () => {
    const table = createRouteTable();
    table.route({ method: 'GET', path: '/x', handler: text('get') });
    expect(table.match({ method: 'HEAD', pathname: '/x' }).kind).toBe('route');
    expect(table.match({ method: 'POST', pathname: '/x' })).toEqual({ kind: 'method-not-allowed', allow: ['GET', 'HEAD'] });
    expect(table.match({ method: 'GET', pathname: '/x/' })).toEqual({ kind: 'not-found' });
    expect(table.match({ method: 'GET', pathname: '/x%ZZ' })).toEqual({ kind: 'not-found' });
  });

  it('refuses the same method + path shape twice, in plain words', () => {
    const table = createRouteTable();
    table.route({ method: 'GET', path: '/x/:id', handler: text('a') });
    expect(() => table.route({ method: 'GET', path: '/x/:slug', handler: text('b') })).toThrow('The route GET /x/:slug is registered twice. Remove one of the two registrations.');
    expect(() => table.route({ method: 'POST', path: '/x/:slug', handler: text('b') })).not.toThrow();
  });
});

