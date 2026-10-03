import { expect, it, vi } from 'vitest';
import { createDaemonSupervisor } from '../supervisor.js';
import { createRespawnPolicy } from '../respawn-policy.js';

// REGRESSION: fails if supervisor.ts re-exports supervisor-node.ts.
vi.mock('@jini-ai/platform', () => { throw new Error('Node platform adapter must remain optional'); });
it('runs the generic supervisor using process ports while the platform adapter is unavailable', () => {
  const on = vi.fn();
  const spawnDaemonProcess = vi.fn(() => ({ pid: 7, on, kill: () => true }));
  const supervisor = createDaemonSupervisor({
    spawnDaemonProcess, terminateProcess: () => {},
    policy: createRespawnPolicy({ now: () => 0 }), now: () => 0,
    scheduler: { schedule: () => () => {} },
    classifyExit: () => ({ isPortConflict: false, reason: 'exit' }),
    failureReporter: { clear: () => {}, record: () => {} }, logger: { emit: () => {} },
  });
  supervisor.start();
  expect(spawnDaemonProcess).toHaveBeenCalledTimes(1);
  supervisor.shutdown();
});
