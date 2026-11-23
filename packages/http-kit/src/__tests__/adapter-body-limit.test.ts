// A Core `defineJsonRoute` spec's `maxBodyBytes` must survive `mountJsonRoute` (Tovu open-bugs
// 2026-11-23): the route's declared ceiling used to be silently dropped, so an oversized body got
// the host parser's limit instead. Real Express app, real socket, real `express.json()` in front.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { defineJsonRoute as defineCoreJsonRoute, ok } from '@jini-ai/core/contracts/server';
import { defineJsonRoute, mountJsonRoute } from '../adapter.js';

/** The host parser's limit in these tests; small so the "host default" cases stay cheap. */
const HOST_PARSER_LIMIT_BYTES = 1024;

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

/** Mounts `spec` behind `express.json({ limit })` on a listening app; counts handler calls. */
async function hostWith(maxBodyBytes: number | undefined, { parser = express.json({ limit: HOST_PARSER_LIMIT_BYTES }), contentType = 'application/json' }: { readonly parser?: express.RequestHandler; readonly contentType?: string } = {}): Promise<{ post: (body: string) => Promise<Response>; handled: () => number }> {
  let calls = 0;
  // Built with Core's `defineJsonRoute`, as the bug report describes. Core's `ports` are typed for
  // a web `Request` host, so the Express mount takes the spec without them (none are set here).
  const { ports: _corePorts, ...route } = defineCoreJsonRoute<unknown, { echoed: boolean }, object>({
    method: 'post', path: '/capped',
    parse: ({ body }) => ok({ value: body }),
    handle: () => { calls += 1; return ok({ value: { echoed: true } }); },
  }, maxBodyBytes === undefined ? {} : { maxBodyBytes });
  const app = express();
  app.use(parser);
  mountJsonRoute({ app, spec: route, deps: {} });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    post: (body) => fetch(`http://127.0.0.1:${port}/capped`, { method: 'POST', headers: { 'content-type': contentType }, body }),
    handled: () => calls,
  };
}

/** A JSON object whose serialized form is exactly `bytes` long. */
const jsonOfBytes = (bytes: number): string => JSON.stringify({ p: 'a'.repeat(bytes - '{"p":""}'.length) });

describe("mountJsonRoute honours a spec's maxBodyBytes", () => {
  it('refuses a body over the spec cap with 413 and the plain-words refusal, before the handler runs', async () => {
    const host = await hostWith(64);
    const response = await host.post(jsonOfBytes(65));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is larger than the 64 bytes this address accepts. Send less data.' },
    });
    expect(host.handled()).toBe(0);
  });

  it('answers a body at or under the spec cap', async () => {
    const host = await hostWith(64);
    const response = await host.post(jsonOfBytes(64));
    expect([response.status, await response.json(), host.handled()]).toEqual([200, { echoed: true }, 1]);
  });

  it('keeps the host default when the spec declares no cap', async () => {
    const host = await hostWith(undefined);
    const under = await host.post(jsonOfBytes(HOST_PARSER_LIMIT_BYTES - 24));
    expect(under.status).toBe(200);
    const over = await host.post(jsonOfBytes(HOST_PARSER_LIMIT_BYTES + 1));
    expect(over.status).toBe(413);
    expect(host.handled()).toBe(1);
  });

  // Clamped, not honoured: the host's JSON parser reads the wire before any route runs, so a route
  // can only tighten the ceiling, never widen it. Same contract as daemon `gatedJsonRoute`
  // ("limits the body to the host's limit, not the spec's").
  it('clamps a spec cap larger than the host default to the host default', async () => {
    const host = await hostWith(1_000_000);
    const response = await host.post(jsonOfBytes(HOST_PARSER_LIMIT_BYTES + 1));
    expect(response.status).toBe(413);
    expect(host.handled()).toBe(0);
  });

  // A host may parse a route's body as raw bytes or text instead of JSON; the cap measures those bytes as-is.
  for (const [name, parser, contentType] of [
    ['raw bytes', express.raw({ limit: HOST_PARSER_LIMIT_BYTES }), 'application/octet-stream'],
    ['text', express.text({ limit: HOST_PARSER_LIMIT_BYTES }), 'text/plain'],
  ] as const) {
    it(`measures a ${name} body by its own bytes`, async () => {
      const host = await hostWith(8, { parser, contentType });
      const statuses = [(await host.post('12345678')).status, (await host.post('123456789')).status];
      expect([statuses, host.handled()]).toEqual([[200, 413], 1]);
    });
  }

  it("carries maxBodyBytes through http-kit's own defineJsonRoute", () => {
    const route = defineJsonRoute({ method: 'post', path: '/x', parse: () => ok({ value: undefined }), handle: () => ok({ value: undefined }) }, { maxBodyBytes: 10 });
    expect(route.maxBodyBytes).toBe(10);
  });
});
