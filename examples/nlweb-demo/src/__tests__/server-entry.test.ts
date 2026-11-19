import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';

vi.mock('node:http', () => ({ createServer: vi.fn() }));
afterEach(() => { vi.resetModules(); vi.clearAllMocks(); });

it('can be imported without creating a listener', async () => {
  const entry = await import('../server.js');
  expect(entry.main).toBeTypeOf('function');
  expect(createServer).not.toHaveBeenCalled();
});

it('starts the server on the supplied port and loopback host', async () => {
  const listen = vi.fn();
  vi.mocked(createServer).mockReturnValue({ listen } as unknown as ReturnType<typeof createServer>);
  const { main } = await import('../server.js');
  main({ port: 4321 });
  expect(listen).toHaveBeenCalledWith(4321, '127.0.0.1', expect.any(Function));
});
