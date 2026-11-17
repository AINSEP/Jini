/**
 * @file Advisory free-port scan for development launchers.
 *
 * A probe is a hint, not a reservation: another process can take the port between the probe and
 * the real bind. Pair it with a strict bind that fails loudly; for a server this package binds
 * itself, prefer `listenServer`, which retries on the real bind and has no probe/bind race.
 */
import net from 'node:net';

/** Both loopback addresses. A dev server that binds `localhost` can land on `::1` while other
 * servers bind `127.0.0.1`, so a probe of one family can report free a port a strict bind on the
 * other family then fails on. */
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '::1'];

/** Only EADDRINUSE counts as taken. Any other bind error (e.g. EADDRNOTAVAIL for `::1` on a host
 * with IPv6 disabled) means that address family cannot be used at all, which says nothing about the port.
 * @complexity One bind/close round trip. */
function isPortFreeOn({ port, host }: { port: number; host: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error: NodeJS.ErrnoException) => resolve(error.code !== 'EADDRINUSE'));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

/** Whether nothing listens on `port` on every host (default: both loopbacks), probed in order and
 * stopping at the first taken one.
 * @complexity One bind/close round trip per host. */
export async function isPortFree({ port }: { port: number }, { hosts = LOOPBACK_HOSTS }: { hosts?: readonly string[] } = {}): Promise<boolean> {
  for (const host of hosts) {
    if (!(await isPortFreeOn({ port, host }))) return false;
  }
  return true;
}

/** The first port in `[start, start + span)` the probe reports free, or `null` when none is.
 * Scans upward from a fixed base rather than asking the OS for `:0`, so a single instance lands on a
 * predictable port (easy to spot in logs) while a second instance still gets the next one.
 * @complexity O(span) probes in the worst case. */
export async function pickFreePort({ start, span }: { start: number; span: number }, {
  isPortFree: probe = ({ port }: { port: number }) => isPortFree({ port }),
}: { isPortFree?: (args: { port: number }) => Promise<boolean> } = {}): Promise<number | null> {
  for (let port = start; port < start + span; port += 1) {
    if (await probe({ port })) return port;
  }
  return null;
}
