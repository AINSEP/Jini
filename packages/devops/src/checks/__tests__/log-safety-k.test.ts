import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { providerRejected, providerUnknown } from '@jini-ai/core/provider-registry';
import { runHardwiring } from '../hardwiring-node.js';
import { checkDelegation } from '../../dns/delegation.js';
import { fakeResolver } from '../../dns/__tests__/fakes.js';
import { runDeploy } from '../../deploy/ops-runner.js';
import type { DeployOpsRuntime } from '../../deploy/ops-tool-contracts.js';
import type { LoadedDeployOps } from '../../deploy/ops-contracts.js';

it('keeps debt occurrences, counts and authored reasons through the typed report', async () => {
  const root = mkdtempSync(join(tmpdir(), 'log-safety-k-'));
  const debtPath = join(root, 'debt.json');
  const current = [{ rule: 'HW3-module-state', file: 'owner.ts', line: 2, reason: 'mutable shared state', fingerprint: 'fixture' }];
  const info = vi.fn();
  const error = vi.fn();
  try {
    writeFileSync(debtPath, JSON.stringify({ violations: [] }));
    expect(await runHardwiring({ debtPath, baselineComment: 'fixture', collect: () => current, report: { info, error } })).toEqual(current);
    expect(info).toHaveBeenCalledWith({ message: '[hardwiring] HW3-module-state: 1 total; 1 new' });
    expect(error).toHaveBeenCalledWith({ message: '[hardwiring] HW3-module-state owner.ts:2: mutable shared state' });
    expect(JSON.parse(readFileSync(debtPath, 'utf8'))).toEqual({ violations: [] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.each(['unknown', 'rejected'] as const)('keeps %s DNS lookup failures unknown without provider text', async status => {
  const resolver = fakeResolver({});
  resolver.queryNs = async () => status === 'unknown'
    ? providerUnknown({ code: 'network', message: 'PRIVATE_PROVIDER_SENTINEL' })
    : providerRejected({ code: 'forbidden', message: 'PRIVATE_PROVIDER_SENTINEL' });
  const result = await checkDelegation({ zone: 'example.test', resolver });
  expect(result).toEqual({ zone: 'example.test', nameservers: [], missing: [], unexpected: [], state: 'unknown', reason: 'The delegation of example.test could not be read: DNS lookup failed.' });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_SENTINEL');
});

it('reports a history failure without repeating or rejecting an accepted deployment', async () => {
  const failure = new Error('PRIVATE_HISTORY_SENTINEL');
  failure.stack = 'PRIVATE_HISTORY_STACK_SENTINEL';
  const accepted = { platform: 'host', target: 'site', started: true, summary: 'accepted' };
  const deploy = vi.fn(async () => accepted);
  const platform: LoadedDeployOps = { descriptor: { id: 'host', label: 'Host', module: 'fixture', hosts: ['example.test'] }, pluginId: 'fixture', module: {
    deploy, status: vi.fn(), logs: vi.fn(),
  } };
  const warn = vi.fn();
  const deps: DeployOpsRuntime = {
    workspaceId: 'workspace', clock: { nowMs: () => 0 },
    loadDeployOps: async () => ({ get: () => platform, list: () => [platform], refusals: [] }),
    credentials: { available: true, list: async () => [{ label: 'saved', allowedOrigins: ['https://example.test'] }], request: vi.fn(), resolveTarget: vi.fn(), classifyError: vi.fn() },
    siteKey: { read: () => undefined, fingerprint: vi.fn() },
    recovery: { setupRequired: vi.fn() }, toolIds: {} as DeployOpsRuntime['toolIds'], messages: { noUsableSiteKey: '', noSavedCredential: vi.fn(), severalCredentials: vi.fn() },
    publishHistoryStore: { recordSuccess: vi.fn(async () => { throw failure; }) }, report: { warn },
  };
  expect(await runDeploy({ deps, input: { platform: 'host', target: 'site' } })).toEqual(accepted);
  expect(deploy).toHaveBeenCalledTimes(1);
  expect(deps.publishHistoryStore!.recordSuccess).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledOnce(); expect(warn).toHaveBeenCalledWith({ message: '[deploy-ops] destination history write failed after accepted deploy' }, { error: failure });
});
