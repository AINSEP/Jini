import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { bindings, createDaemon, definePack, token } from '@injini/core';
import { mountPackHttp } from '../pack-http.js';

interface Greeter {
  greeting: string;
}

const GreeterToken = token<Greeter>('test.greeter');

describe('mountPackHttp', () => {
  it('calls a pack\'s http registrar with the mounted app and its own composed services', () => {
    const calls: Array<{ app: unknown; services: unknown }> = [];
    const greetPack = definePack({
      name: 'greet',
      deps: [GreeterToken],
      services: (c) => ({ say: () => c.get(GreeterToken).greeting }),
      http: (app: unknown, services: unknown) => calls.push({ app, services }),
    });

    const daemon = createDaemon({
      packs: [greetPack],
      bindings: bindings().bind(GreeterToken, { greeting: 'hi' }),
    });

    const fakeApp = { get: () => {} };
    mountPackHttp(fakeApp as any, [greetPack], daemon);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.app).toBe(fakeApp);
    expect((calls[0]!.services as { say: () => string }).say()).toBe('hi');
  });

  it('skips packs with no http registrar', () => {
    const cliOnlyPack = definePack({
      name: 'cliOnly',
      deps: [],
      services: () => ({}),
    });

    const daemon = createDaemon({ packs: [cliOnlyPack], bindings: bindings() });

    expect(() => mountPackHttp({} as any, [cliOnlyPack], daemon)).not.toThrow();
  });

  it('mounts multiple packs in order, each with its own services', () => {
    const order: string[] = [];
    const packA = definePack({
      name: 'a',
      deps: [],
      services: () => ({ id: 'a' }),
      http: (_app: unknown, services: any) => order.push(services.id),
    });
    const packB = definePack({
      name: 'b',
      deps: [],
      services: () => ({ id: 'b' }),
      http: (_app: unknown, services: any) => order.push(services.id),
    });

    const daemon = createDaemon({ packs: [packA, packB], bindings: bindings() });
    mountPackHttp({} as any, [packA, packB], daemon);

    expect(order).toEqual(['a', 'b']);
  });

  it('mounts onto a host-owned Express app and serves the pack route over real HTTP', async () => {
    const hostApp = express();
    hostApp.get('/host-health', (_request, response) => response.json({ host: 'owned' }));

    const greetingPack = definePack({
      name: 'library-mode-greeting',
      deps: [],
      services: () => ({ greeting: 'hello from a pack' }),
      http: (app, services) => {
        (app as Express).get('/pack-greeting', (_request, response) => response.json({ greeting: services.greeting }));
      },
    });
    const daemon = createDaemon({ packs: [greetingPack], bindings: bindings() });
    mountPackHttp(hostApp, [greetingPack], daemon);

    const server = await new Promise<ReturnType<Express['listen']>>((resolve) => {
      const listening = hostApp.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      await expect(fetch(`${origin}/host-health`).then((response) => response.json())).resolves.toEqual({ host: 'owned' });
      await expect(fetch(`${origin}/pack-greeting`).then((response) => response.json())).resolves.toEqual({
        greeting: 'hello from a pack',
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
