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

  describe('lenientPaths (opt-in, the way Express 4 matches)', () => {
    const lenient = () => {
      const table = createRouteTable({}, { lenientPaths: true });
      table.route({ method: 'GET', path: '/api/runs', handler: text('list') });
      table.route({ method: 'GET', path: '/api/runs/:runId', handler: text('one') });
      table.route({ method: 'GET', path: '/api/tools/search', handler: text('search') });
      table.route({ method: 'GET', path: '/api/tools/:id', handler: text('entry') });
      return table;
    };
    const reached = (table: ReturnType<typeof lenient>, pathname: string) => {
      const found = table.match({ method: 'GET', pathname });
      return found.kind === 'route' ? { path: found.route.path, params: found.params } : found.kind;
    };

    it('is off by default: the exact table still refuses a slash, another case and a bad escape as "no match"', () => {
      const table = createRouteTable();
      table.route({ method: 'GET', path: '/api/runs/:runId', handler: text('one') });
      expect(table.match({ method: 'GET', pathname: '/api/runs/a/' })).toEqual({ kind: 'not-found' });
      expect(table.match({ method: 'GET', pathname: '/API/runs/a' })).toEqual({ kind: 'not-found' });
      expect(table.match({ method: 'GET', pathname: '/api/runs/%E0%A4%A' })).toEqual({ kind: 'not-found' });
    });

    it('accepts one trailing slash and no more, and leaves "/" alone', () => {
      const table = lenient();
      expect(reached(table, '/api/runs/')).toEqual({ path: '/api/runs', params: {} });
      expect(reached(table, '/api/runs/abc/')).toEqual({ path: '/api/runs/:runId', params: { runId: 'abc' } });
      expect(reached(table, '/api/runs//')).toBe('not-found');
      expect(reached(table, '/api/runs/abc//')).toBe('not-found');
      expect(reached(table, '/')).toBe('not-found');
    });

    it('ignores the letter case of fixed segments but keeps the case of a param value', () => {
      const table = lenient();
      expect(reached(table, '/API/Runs/AbC')).toEqual({ path: '/api/runs/:runId', params: { runId: 'AbC' } });
    });

    it('a fixed segment in another case still beats a :param, as the exact one does', () => {
      const table = lenient();
      expect(reached(table, '/api/tools/SEARCH')).toEqual({ path: '/api/tools/search', params: {} });
      expect(reached(table, '/api/tools/Other')).toEqual({ path: '/api/tools/:id', params: { id: 'Other' } });
    });

    it('reports a :name segment that is not valid percent-encoding as malformed-path, and a fully matching route wins over it', () => {
      const table = lenient();
      expect(table.match({ method: 'GET', pathname: '/api/tools/%E0%A4%A' })).toEqual({ kind: 'malformed-path' });
      expect(table.match({ method: 'GET', pathname: '/api/nothing/%E0%A4%A' })).toEqual({ kind: 'not-found' });
      expect(reached(table, '/api/tools/search')).toEqual({ path: '/api/tools/search', params: {} });
    });

    it('refuses two registrations that differ only in letter case', () => {
      const table = createRouteTable({}, { lenientPaths: true });
      table.route({ method: 'GET', path: '/Api/x', handler: text('a') });
      expect(() => table.route({ method: 'GET', path: '/api/X', handler: text('b') })).toThrow('registered twice');
      expect(() => createRouteTable().route({ method: 'GET', path: '/Api/x', handler: text('a') })).not.toThrow();
    });
  });
});

