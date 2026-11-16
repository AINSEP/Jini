import { vi } from 'vitest';
import type { DeployOpsModule, DeployOpsRegistry, LoadedDeployOps } from '../ops-contracts.js';
import type { DeployOpsRuntime } from '../ops-tool-contracts.js';

export const HOST = 'api.host.example';
export const ORIGIN = `https://${HOST}`;

export function fullModule(over: Partial<DeployOpsModule> = {}): DeployOpsModule {
  return {
    status: vi.fn(async (_c, i) => ({ platform: 'p', target: i.target, state: 'healthy' as const, summary: 'ok', items: [], checkedAt: 'now' })),
    logs: vi.fn(async (_c, i) => ({ platform: 'p', target: i.target, lines: [{ message: 'hello' }], truncated: false })),
    listTargets: vi.fn(async () => ({ platform: 'p', targets: [{ id: 'a', name: 'A' }] })),
    deploy: vi.fn(async () => ({ platform: 'p', target: 't', started: false, summary: 'refused' })),
    secretCapabilities: { appliesOn: 'next-deploy', supportsStaging: true },
    listSecrets: vi.fn(async () => ({ secrets: [{ name: 'A', digest: 'd' }] })),
    setSecret: vi.fn(async () => ({})),
    unsetSecret: vi.fn(async () => ({})),
    readSecret: vi.fn(async () => ({ absent: true as const })),
    ...over,
  };
}

export function platformOf(module: DeployOpsModule, id = 'p'): LoadedDeployOps {
  return { descriptor: { id, label: id, module: 'm.mjs', hosts: [HOST] }, pluginId: 'plug', module };
}
export const registryOf = (...ps: LoadedDeployOps[]): DeployOpsRegistry => ({ get: id => ps.find(p => p.descriptor.id === id), list: () => ps, refusals: [] });

export const TOOL_IDS = { status: 'ops_status', logs: 'ops_logs', wait: 'ops_wait', listTargets: 'ops_targets', deploy: 'ops_deploy', listSecrets: 'ops_list_secrets', setSecret: 'ops_set_secret', unsetSecret: 'ops_unset', credentialVerify: 'cred_verify' };

export function makeRuntime(module: DeployOpsModule = fullModule(), over: Partial<DeployOpsRuntime> = {}) {
  const request = vi.fn(async () => ({ status: 200, bodyText: '{}', bodyTruncated: false }));
  const deps = {
    workspaceId: 'ws1',
    clock: { nowMs: () => Date.parse('2026-03-04T05:06:07.000Z') },
    loadDeployOps: vi.fn(async () => registryOf(platformOf(module))),
    credentials: {
      available: true,
      list: vi.fn(async () => [{ label: 'main', allowedOrigins: [ORIGIN] }]),
      resolveTarget: vi.fn(async () => undefined),
      classifyError: () => ({ category: 'other' }),
      request,
    },
    recovery: { setupRequired: ({ label }: { label: string }) => ({ message: `setup ${label}`, credentialSetup: { hint: `hint-${label}` } }) },
    toolIds: TOOL_IDS,
    messages: { noUsableSiteKey: 'NO SITE KEY', severalCredentials: () => 'several', noSavedCredential: () => 'none' },
    siteKey: { read: vi.fn(() => 'site-key-value' as string | undefined), fingerprint: vi.fn(({ value }: { value: string }) => ({ fingerprint: `len${value.length}`, fingerprintKind: 'sha256' as const })) },
    ...over,
  } as unknown as DeployOpsRuntime;
  return { deps, request, module };
}

export const catchErr = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected rejection'); };
