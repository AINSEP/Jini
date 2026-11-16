import { afterEach, expect, test } from 'vitest';
import net from 'node:net';
import { isPortFree, pickFreePort } from '../free-port.js';

const open: net.Server[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))); });
const busy = (taken: readonly number[]) => async ({ port }: { port: number }) => !taken.includes(port);

test('pickFreePort returns the first port in the range the probe reports free', async () => {
  expect(await pickFreePort({ start: 5273, span: 10 }, { isPortFree: busy([5273, 5274]) })).toBe(5275);
});

test('pickFreePort returns null when every port is taken, without probing past the range', async () => {
  const probed: number[] = [];
  const probe = async ({ port }: { port: number }) => { probed.push(port); return false; };
  expect(await pickFreePort({ start: 5273, span: 3 }, { isPortFree: probe })).toBeNull();
  expect(probed).toEqual([5273, 5274, 5275]);
});

test('isPortFree reports a port held on the probed host as taken and an unused one as free', async () => {
  const server = net.createServer();
  open.push(server);
  await new Promise<void>((resolve) => server.listen({ port: 0, host: '127.0.0.1' }, resolve));
  const { port } = server.address() as net.AddressInfo;
  expect(await isPortFree({ port }, { hosts: ['127.0.0.1'] })).toBe(false);
  open.splice(0).forEach((s) => s.close());
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(await isPortFree({ port }, { hosts: ['127.0.0.1'] })).toBe(true);
});

test('a host whose address family is unavailable does not make a port look taken', async () => {
  expect(await isPortFree({ port: 1 }, { hosts: ['192.0.2.1'] })).toBe(true); // TEST-NET-1: EADDRNOTAVAIL, not EADDRINUSE
});
