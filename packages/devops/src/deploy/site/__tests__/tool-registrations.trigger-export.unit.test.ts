import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { ToolExecutionContext } from '@jini-ai/core';
import { buildDeploymentsRegistrations, type DeploymentsToolDeps } from '../tool-registrations.js';

test('export receives only declared options from the engine call', async () => {
  const seen: unknown[] = [];
  const deps = { workspaceId: 'ws', clock: { nowMs: () => 0 }, exportOutputRootDir: '/out',
    authorize: async () => ({ allowed: true }), requireToolPermission: async () => {},
    exportSiteBound: async (options: unknown) => { seen.push(options); return { routes: { succeeded: [], failed: [] }, assets: { succeeded: [], failed: [] } }; },
    assertExportNotRunning: () => {},
    startExportRun: async ({ routeDeps, runExportSite, clean }: { routeDeps: DeploymentsToolDeps; runExportSite: (options: unknown) => Promise<unknown>; clean: boolean }, { basePath }: { basePath?: string }) => runExportSite({ routeDeps, outputDir: '/out/run', clean, basePath }),
  } as unknown as DeploymentsToolDeps;
  const tool = buildDeploymentsRegistrations(deps).find(item => item.descriptor.id === 'deployment_trigger_export')!;
  const ctx: ToolExecutionContext = { executionId: 'exec', principal: { id: 'person' }, run: { id: 'run' },
    input: { clean: true, basePath: '/base' }, signal: new AbortController().signal };
  await tool.handler(ctx);
  assert.deepEqual(seen, [{ outputDir: '/out/run', clean: true, basePath: '/base' }]);
});
