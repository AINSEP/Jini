import { expect, it } from 'vitest';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { adaptSdkTransport, resolveSdkTransport } from '../sdk-transport.js';
import type { McpTransportLike } from '../ports.js';

/** A hand-written SDK transport: records what was sent and how often close ran. */
function fakeSdkTransport(): Transport & { closes: number } {
  return {
    closes: 0,
    async start() {},
    async send() {},
    async close() { this.closes += 1; },
  };
}

it('reads no onmessage handler until the SDK side has one, then forwards messages through the port shape', () => {
  const sdk = fakeSdkTransport();
  const port = adaptSdkTransport({ transport: sdk });
  expect(port.onmessage).toBeUndefined();
  const seen: unknown[] = [];
  sdk.onmessage = (message) => { seen.push(message); };
  port.onmessage?.({ message: { jsonrpc: '2.0', method: 'ping' } });
  expect(seen).toEqual([{ jsonrpc: '2.0', method: 'ping' }]);
});

it('installs a port onmessage handler on the SDK side and removes it again when cleared', () => {
  const sdk = fakeSdkTransport();
  const port = adaptSdkTransport({ transport: sdk });
  const seen: unknown[] = [];
  port.onmessage = ({ message }) => { seen.push(message); };
  sdk.onmessage?.({ jsonrpc: '2.0', id: 1, result: {} });
  expect(seen).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
  port.onmessage = undefined;
  expect('onmessage' in sdk).toBe(false);
});

it('passes onclose straight through and deletes it when cleared', () => {
  const sdk = fakeSdkTransport();
  const port = adaptSdkTransport({ transport: sdk });
  const onclose = () => undefined;
  port.onclose = onclose;
  expect(sdk.onclose).toBe(onclose);
  expect(port.onclose).toBe(onclose);
  port.onclose = undefined;
  expect('onclose' in sdk).toBe(false);
  expect(port.onclose).toBeUndefined();
});

it('closes the SDK transport through the port', async () => {
  const sdk = fakeSdkTransport();
  await adaptSdkTransport({ transport: sdk }).close({});
  expect(sdk.closes).toBe(1);
});

it('resolves an adapted port back to its SDK transport and treats any other port as structurally usable', () => {
  const sdk = fakeSdkTransport();
  expect(resolveSdkTransport({ transport: adaptSdkTransport({ transport: sdk }) })).toBe(sdk);
  const hostPort: McpTransportLike = { close: async () => undefined };
  expect(resolveSdkTransport({ transport: hostPort })).toBe(hostPort);
});
