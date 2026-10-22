/**
 * @file The default {@link DnsExchange}: one DNS message over UDP (port 53) to one server address,
 * the first datagram back is the reply. Socket factory and timers are injectable for tests.
 */
import { createSocket as nodeCreateSocket, type Socket } from 'node:dgram';
import { isIP } from 'node:net';

/** Send one DNS message to `address` and resolve with the reply; rejects on error or timeout. */
export type DnsExchange = (required: { readonly address: string; readonly message: Uint8Array; readonly timeoutMs: number }) => Promise<Uint8Array>;

type SocketLike = Pick<Socket, 'once' | 'send' | 'close'>;

export interface UdpDnsExchangeOptions {
  readonly createSocket?: (type: 'udp4' | 'udp6') => SocketLike;
  /** Default 53. */
  readonly port?: number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/**
 * Build the UDP exchange.
 * @complexity O(1) per exchange: one datagram out, one in.
 * @example createUdpDnsExchange({})
 */
export function createUdpDnsExchange(_required: Record<string, never> = {}, optional: UdpDnsExchangeOptions = {}): DnsExchange {
  const create = optional.createSocket ?? ((type: 'udp4' | 'udp6') => nodeCreateSocket(type));
  const setTimer = optional.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = optional.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  return ({ address, message, timeoutMs }) => new Promise<Uint8Array>((resolve, reject) => {
    const socket = create(isIP(address) === 6 ? 'udp6' : 'udp4');
    let done = false;
    const finish = (outcome: { error: Error } | { reply: Uint8Array }): void => {
      if (done) return;
      done = true;
      clearTimer(timer);
      socket.close();
      if ('error' in outcome) reject(outcome.error);
      else resolve(outcome.reply);
    };
    const timer = setTimer(() => finish({ error: Object.assign(new Error('The DNS server did not answer in time.'), { code: 'ETIMEOUT' }) }), timeoutMs);
    socket.once('error', error => finish({ error }));
    socket.once('message', reply => finish({ reply: new Uint8Array(reply) }));
    socket.send(message, optional.port ?? 53, address, error => {
      if (error) finish({ error });
    });
  });
}
