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
    const result = await port.rollback({ to: '0.0.1' });
    expect(result).toMatchObject({ status: 'refused', errorId: 'ERR-ABCD-0000-0000-0001' });
    if (result.status === 'refused') expect(result.message).toMatch(ERR_MESSAGE);
  });

  it('mints distinct default error ids without any global source', async () => {
    const port = createFakeSiteUpdatePort({ runningVersion: '1.0.0', releases: [], backups: [] });
    const first = await port.rollback({ to: 'a' });
    const second = await port.rollback({ to: 'b' });
    expect(first.status === 'refused' && second.status === 'refused' && first.errorId !== second.errorId).toBe(true);
  });
});
