import { describe, expect, it } from 'vitest';
import { createFakeSiteUpdatePort } from '../fake.js';
import { ERR_MESSAGE, siteUpdateContractSuite } from './contract-suite.js';

siteUpdateContractSuite({ describe, it, expect }, { makePort: ({ scenario }) => createFakeSiteUpdatePort(scenario) });

describe('createFakeSiteUpdatePort', () => {
  it('mints error ids through the injected port', async () => {
    const port = createFakeSiteUpdatePort(
      { runningVersion: '1.0.0', releases: [{ version: '1.0.0', notes: '' }], backups: [] },
      { mintErrorId: () => 'ERR-ABCD-0000-0000-0001' },
    );
    const result = await port.rollback({ to: '0.0.1', approval: { to: '0.0.1', receipt: 'r', approvedBy: 'human' } });
    expect(result).toMatchObject({ status: 'refused', errorId: 'ERR-ABCD-0000-0000-0001' });
    if (result.status === 'refused') expect(result.message).toMatch(ERR_MESSAGE);
  });

  it('mints distinct default error ids without any global source', async () => {
    const port = createFakeSiteUpdatePort({ runningVersion: '1.0.0', releases: [], backups: [] });
    const first = await port.rollback({ to: 'a', approval: { to: 'a', receipt: 'r', approvedBy: 'human' } });
    const second = await port.rollback({ to: 'b', approval: { to: 'b', receipt: 'r', approvedBy: 'human' } });
    expect(first.status === 'refused' && second.status === 'refused' && first.errorId !== second.errorId).toBe(true);
  });

  it('reports rollback_failed, never rolled_back, when restoring fails too', async () => {
    const port = createFakeSiteUpdatePort({
      runningVersion: '1.0.0', releases: [{ version: '1.1.0', notes: 'n' }], backups: ['b'],
      failures: { verify: 'pages answer 500', rollback: 'the old build is gone' },
    });
    const planned = await port.planUpdate({ runningVersion: '1.0.0', targetVersion: '1.1.0' });
    if (planned.status !== 'planned') throw new Error('expected a plan');
    const approval = { planId: planned.plan.planId, receipt: 'r', approvedBy: 'human' } as const;
    const result = await port.applyUpdate({ plan: planned.plan, backupId: 'b', approval });
    expect(result).toMatchObject({ status: 'rollback_failed', failedStep: 'verify', runningVersion: '1.1.0' });
  });
});
