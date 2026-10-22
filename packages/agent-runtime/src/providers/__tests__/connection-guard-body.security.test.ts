import { Readable } from 'node:stream';
import { expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ response: undefined as unknown }));
vi.mock('node:http', async () => {
  const { EventEmitter } = await import('node:events');
  return { request: (_options: unknown, onResponse: (response: unknown) => void) => {
    const request = Object.assign(new EventEmitter(), {
      setTimeout: () => {}, destroy: () => {},
      end: () => { queueMicrotask(() => onResponse(transport.response)); },
    });
    return request;
  } };
});
import { pinnedFetch } from '../connection-guard.js';

it('the native transport caps error text and closes its upstream without opening sockets', async () => {
  const body = Object.assign(Readable.from([Buffer.alloc(65536), Buffer.from('private@example.test')]), {
    statusCode: 500, headers: {},
  });
  transport.response = body;
  const response = await pinnedFetch({ url: 'http://provider.test/v1',
    init: { method: 'POST', headers: {}, body: '{}' }, pinnedAddress: { address: '192.0.2.1', family: 4 },
  });
  expect(response.status).toBe(500);
  await expect(response.text()).rejects.toThrow('byte limit');
  expect(body.destroyed).toBe(true);
});
