import { describe, expect, it } from 'vitest';
import { serverConformance } from '../conformance.js';
import { createInMemoryServer } from '../testing.js';

serverConformance({ describe, it, expect: (value) => expect(value) as never }, { makeServer: () => createInMemoryServer() });

it('fails the decoding conformance case when an adapter drops route parameters', async () => {
  const cases = new Map<string, () => void | Promise<void>>();
  serverConformance({
    describe: (_name, define) => define(),
    it: (name, body) => { cases.set(name, body); },
    expect,
  }, {
    makeServer: () => {
      const target = createInMemoryServer();
      return {
        server: { route: (route) => target.server.route({ ...route, handler: (args) => route.handler({ ...args, params: {} }) }) },
        fetch: target.fetch,
      };
    },
  });
  const run = cases.get('decodes params and treats malformed encoding as no match');
  if (!run) throw new Error('Missing route parameter decoding contract');
  await expect(Promise.resolve().then(run)).rejects.toThrow(/expected '' to be 'a b'/i);
});
