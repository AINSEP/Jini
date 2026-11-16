/**
 * @file Conformance checks any `Server` adapter must pass: the contract's path syntax, precedence,
 * decoding and HEAD rules. The caller supplies its test runner, so core imports none.
 */
import type { Server } from '../server.js';

/** The test-runner functions the suite needs (vitest, jest and node:test all fit). */
export interface ConformanceRunner {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => void | Promise<void>): void;
  expect(value: unknown): { toBe(expected: unknown): void; toEqual(expected: unknown): void; toThrow(): void };
}

/** A fresh adapter under test: the `Server` to register on and a way to send it a request. */
export interface ConformanceTarget {
  readonly server: Server;
  fetch(request: Request): Promise<Response>;
}

const get = (path: string) => new Request(`http://localhost${path}`);
const answer = (label: string) => () => new Response(label);

/** Registers the conformance suite for the adapter `makeServer` builds (a fresh one per case). */
export function serverConformance(
  { describe, it, expect }: ConformanceRunner,
  { makeServer }: { makeServer: () => ConformanceTarget },
): void {
  describe('Server contract conformance', () => {
    it('prefers a literal segment over :param', async () => {
      const t = makeServer();
      t.server.route({ method: 'GET', path: '/x/:id', handler: answer('param') });
      t.server.route({ method: 'GET', path: '/x/new', handler: answer('literal') });
      expect(await (await t.fetch(get('/x/new'))).text()).toBe('literal');
      expect(await (await t.fetch(get('/x/other'))).text()).toBe('param');
    });
    it('decides precedence segment by segment from the left', async () => {
      const t = makeServer();
      t.server.route({ method: 'GET', path: '/a/:p/c', handler: answer('late') });
      t.server.route({ method: 'GET', path: '/a/b/:q', handler: answer('early') });
      expect(await (await t.fetch(get('/a/b/c'))).text()).toBe('early');
    });
    it('decodes params and treats malformed encoding as no match', async () => {
      const t = makeServer();
      t.server.route({ method: 'GET', path: '/n/:id', handler: ({ params }) => new Response(params.id ?? '') });
      expect(await (await t.fetch(get('/n/a%20b'))).text()).toBe('a b');
      expect((await t.fetch(get('/n/%'))).status).toBe(404);
    });
    it('never matches an empty segment against :name', async () => {
      const t = makeServer();
      t.server.route({ method: 'GET', path: '/n/:id', handler: answer('hit') });
      expect((await t.fetch(get('/n/'))).status).toBe(404);
    });
    it('answers HEAD from the GET route without a body', async () => {
      const t = makeServer();
      t.server.route({ method: 'GET', path: '/h', handler: answer('body') });
      const response = await t.fetch(new Request('http://localhost/h', { method: 'HEAD' }));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('');
    });
    it('refuses a duplicate registration', () => {
      const t = makeServer();
      t.server.route({ method: 'GET', path: '/d/:a', handler: answer('1') });
      expect(() => t.server.route({ method: 'GET', path: '/d/:b', handler: answer('2') })).toThrow();
    });
    it('answers an unmatched request with 404, or 405 when only the method differs', async () => {
      const t = makeServer();
      t.server.route({ method: 'POST', path: '/p', handler: answer('p') });
      expect((await t.fetch(get('/missing'))).status).toBe(404);
      expect((await t.fetch(get('/p'))).status).toBe(405);
    });
  });
}
