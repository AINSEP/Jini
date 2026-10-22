import { describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import { bindings, createDaemon, definePack, token } from '@jini-ai/core';
import { mountPackHttp } from '../pack-http.js';

interface Greeter {
  greeting: string;
}

const GreeterToken = token<Greeter>({ id: 'test.greeter' });

describe('mountPackHttp', () => {
  it('calls a pack\'s http registrar with the mounted app and its own composed services', () => {
    const calls: Array<{ app: unknown; services: { say: () => string } }> = [];
    const greetPack = definePack({
      name: 'greet',
      deps: [GreeterToken],
      services: (c) => ({ say: () => c.get({ token: GreeterToken }).greeting }),
    }, {
      http: ({ app, services }) => { calls.push({ app, services }); },
    });

    const daemon = createDaemon({
      packs: [greetPack],
      bindings: bindings({}).bind({ token: GreeterToken, impl: { greeting: 'hi' } }),
    });

    const fakeApp = { get: () => { } };
    mountPackHttp({ app: fakeApp, packs: [greetPack], daemon });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.app).toBe(fakeApp);
    expect(calls[0]!.services.say()).toBe('hi');
  });

  it('skips packs with no http registrar', () => {
    const cliOnlyPack = definePack({
      name: 'cliOnly',
      deps: [],
      services: () => ({}),
    });

    const daemon = createDaemon({ packs: [cliOnlyPack], bindings: bindings({}) });

    expect(() => mountPackHttp({ app: {}, packs: [cliOnlyPack], daemon })).not.toThrow();
  });

  it('mounts multiple packs in order, each with its own services', () => {
    const order: string[] = [];
    const packA = definePack({
      name: 'a',
      deps: [],
      services: () => ({ id: 'a' }),
    }, {
      http: ({ services }) => { order.push(services.id); },
    });
    const packB = definePack({
      name: 'b',
      deps: [],
      services: () => ({ id: 'b' }),
    }, {
      http: ({ services }) => { order.push(services.id); },
    });

    const daemon = createDaemon({ packs: [packA, packB], bindings: bindings({}) });
    mountPackHttp({ app: {}, packs: [packA, packB], daemon });

    expect(order).toEqual(['a', 'b']);
  });

  it('mounts onto a host-owned Express app and serves the pack route over real HTTP', async () => {
    const hostApp = express();
    hostApp.get('/host-health', (_request, response) => response.json({ host: 'owned' }));

    const greetingPack = definePack({
      name: 'library-mode-greeting',
      deps: [],
      services: () => ({ greeting: 'hello from a pack' }),
    }, {
      http: ({ app, services }) => {
        expect(app).toBe(hostApp);
        hostApp.get('/pack-greeting', (_request, response) => response.json({ greeting: services.greeting }));
      },
    });
    const daemon = createDaemon({ packs: [greetingPack], bindings: bindings({}) });
    mountPackHttp({ app: hostApp, packs: [greetingPack], daemon });

    const server = await new Promise<ReturnType<Express['listen']>>((resolve) => {
      const listening = hostApp.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('Expected a listening TCP server');
      }
      const origin = `http://127.0.0.1:${address.port}`;
      await expect(fetch(`${origin}/host-health`).then((response) => response.json())).resolves.toEqual({ host: 'owned' });
      await expect(fetch(`${origin}/pack-greeting`).then((response) => response.json())).resolves.toEqual({
        greeting: 'hello from a pack',
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
