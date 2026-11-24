/** Test-only helper: listens an Express app on a loopback port and closes every app after each test. */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Express } from 'express';
import { afterEach } from 'vitest';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

/** Starts `app` on an ephemeral loopback port; returns the base URL. */
export async function listen({ app }: { readonly app: Express }, _optional: Record<string, never> = {}): Promise<string> {
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
