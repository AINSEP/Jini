import assert from 'node:assert/strict';
import { test } from 'vitest';
import { publishStaticSite, type StaticPublishDeps, type StaticPublishInput } from '../adapter.js';

test('a credential changed since domain review cannot reach export or publication', async () => {
  let writes = 0;
  const target = { descriptor: { id: 'host', configFields: [] }, module: { validateConfig: () => null, basePath: () => undefined } };
  const deps = { credentialSource: { resolve: async () => ({ ok: true, token: 'new-token' }) },
    loadDeployTargets: async () => ({ get: () => target, refusals: [] }),
    tracker: { trace: async ({ run }: { run(span: { setOutcome(): void }): Promise<unknown> }) => run({ setOutcome() {} }) },
    buildTarget: () => { writes++; throw new Error('unreviewed publication'); },
  } as unknown as StaticPublishDeps;
  const input = { workspaceId: 'ws', projectName: 'Site', config: { target: 'host' },
    domainApproval: { credentialBinding: 'old-binding' }, exportSiteBound: async () => { writes++; },
  } as unknown as StaticPublishInput;
  assert.deepEqual(await publishStaticSite(deps, input), { ok: false, code: 'INVALID_CONFIG', message: 'CREDENTIAL_CHANGED: The connection changed after domain review. Preview and confirm again before publishing.' });
  assert.equal(writes, 0);
});
