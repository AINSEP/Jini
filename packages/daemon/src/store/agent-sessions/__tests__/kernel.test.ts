/** Transport selection routes each kernel to its dialect adapter without I/O. */
import { expect, it, vi } from 'vitest';
import { createAgentSessionStoreForKernel } from '../kernel.js';

const testClock = { nowMs: () => Date.now() };
const kernelOf = (dialect: string, transport: string) => ({ dialect, transport, run: vi.fn(), execute: vi.fn(), close: vi.fn() });

it.each([
 ['sqlite', 'better-sqlite3'],
 ['postgres', 'pglite'],
 ['postgres', 'pglite-socket'],
 ['postgres', 'node-postgres'],
] as const)('routes a %s/%s kernel to its adapter without I/O', (dialect, transport) => {
 const kernel = kernelOf(dialect, transport);
 const store = createAgentSessionStoreForKernel({ kernel: kernel as any, clock: testClock });
 expect(Object.keys(store).sort()).toEqual(['clearSessionId', 'getSessionId', 'setSessionId']);
 expect(kernel.run).not.toHaveBeenCalled(); expect(kernel.execute).not.toHaveBeenCalled(); expect(kernel.close).not.toHaveBeenCalled();
});

// A dialect that contradicts the transport is refused by the adapter the transport selected,
// which proves which adapter the selector chose.
it.each([
 ['postgres', 'better-sqlite3'],
 ['sqlite', 'pglite'],
 ['sqlite', 'pglite-socket'],
 ['sqlite', 'node-postgres'],
 ['sqlite', 'unknown'],
] as const)('refuses a %s-dialect %s kernel through the selected adapter', (dialect, transport) => {
 const kernel = kernelOf(dialect, transport);
 expect(() => createAgentSessionStoreForKernel({ kernel: kernel as any, clock: testClock })).toThrow('invalid agent session kernel');
 expect(kernel.run).not.toHaveBeenCalled();
});
