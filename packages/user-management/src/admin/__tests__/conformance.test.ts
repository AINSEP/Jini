import { expect, it } from 'vitest';
import { createMemoryRolesApi } from '../adapters/memory.js';
import { runRolesApiConformance } from '../conformance/index.js';
it('memory satisfies the roles port conformance contract', async () => {
    const result = await runRolesApiConformance({ api: createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['role.manage', 'content.read'] }) });
    expect(result.failed).toEqual([]);
    expect(result.passed.length).toBeGreaterThanOrEqual(12);
});
