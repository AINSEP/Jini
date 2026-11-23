import { describe, expect, it } from 'vitest';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import {
  deploymentOverviewRoute, type DeploymentOverviewRouteDeps, type DeploymentOverviewSnapshot,
} from '../deployment-overview.js';

const SNAPSHOT: DeploymentOverviewSnapshot = {
  mode: 'local', productionReadinessGate: { applicable: false, passed: false }, defaultOwnerPasswordUnsafe: false,
  daemonKnownFailed: false, dbPath: '/db', uploadsDir: '/up', envVars: [{ name: 'A', set: true }],
};

function makeDeps(overrides: Partial<DeploymentOverviewRouteDeps> = {}) {
  const log: string[] = [];
  const deps: DeploymentOverviewRouteDeps = {
    workspaceId: 'ws',
    identityReady: Promise.resolve(),
    ownerPrincipalId: Promise.resolve('owner-p'),
    defaultOwnerPassword: 'the-default',
    userRepo: { findByPrincipalId: async (args) => { log.push(`find:${args.workspaceId}:${args.principalId}`); return { passwordHash: 'h1' }; } },
    passwordHasher: { verify: async ({ hash, password }) => { log.push(`verify:${hash}:${password}`); return true; } },
    buildSnapshot: ({ defaultOwnerPasswordUnsafe }) => { log.push(`snapshot:${defaultOwnerPasswordUnsafe}`); return { ...SNAPSHOT, defaultOwnerPasswordUnsafe }; },
    ...overrides,
  };
  return { deps, log };
}

function call(deps: DeploymentOverviewRouteDeps, { deny = false, noAuthorizer = false }: { deny?: boolean; noAuthorizer?: boolean } = {}) {
  const asked: unknown[] = [];
  const authorize = async (...args: unknown[]) => {
    asked.push(args);
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: 'denied' } });
  };
  const parsed = deploymentOverviewRoute.parse({ body: {}, query: {}, params: { workspaceId: 'ws' } });
  if (!parsed.ok) throw new Error('parse must be total');
  const result = deploymentOverviewRoute.handle({ input: parsed.value, deps, context: { id: 'p1' }, ...(noAuthorizer ? {} : { authorize }) }, {});
  return { asked, result };
}

describe('deploymentOverviewRoute', () => {
  it('pins method, path, success status and no body cap', () => {
    expect(deploymentOverviewRoute.method).toBe('get');
    expect(deploymentOverviewRoute.path).toBe('/api/admin/v1/workspaces/:workspaceId/system/deployment-overview');
    expect(deploymentOverviewRoute.successStatus).toBeUndefined();
    expect(deploymentOverviewRoute.maxBodyBytes).toBeUndefined();
  });

  it('authorizes system.read on deployment-status with no entity scope', async () => {
    const { deps } = makeDeps();
    const { asked, result } = call(deps);
    await result;
    expect(asked).toEqual([[{ permission: 'system.read', entityType: 'deployment-status' }]]);
  });

  it('checks the owner stored hash against the injected default password, then builds the snapshot', async () => {
    const { deps, log } = makeDeps();
    const { result } = call(deps);
    expect(await result).toEqual({ ok: true, value: { ...SNAPSHOT, defaultOwnerPasswordUnsafe: true } });
    expect(log).toEqual(['find:ws:owner-p', 'verify:h1:the-default', 'snapshot:true']);
  });

  it('reports a changed password as safe', async () => {
    const { deps } = makeDeps({ passwordHasher: { verify: async () => false } });
    expect(await call(deps).result).toEqual({ ok: true, value: { ...SNAPSHOT, defaultOwnerPasswordUnsafe: false } });
  });

  it('reports no owner row as safe without verifying anything', async () => {
    const { deps, log } = makeDeps({ userRepo: { findByPrincipalId: async () => null } });
    expect(await call(deps).result).toEqual({ ok: true, value: { ...SNAPSHOT, defaultOwnerPasswordUnsafe: false } });
    expect(log.some((line) => line.startsWith('verify'))).toBe(false);
  });

  it('waits for identity readiness before reading the owner', async () => {
    let release!: () => void;
    const identityReady = new Promise<void>((resolve) => { release = resolve; });
    const { deps, log } = makeDeps({ identityReady });
    const { result } = call(deps);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(log).toEqual([]);
    release();
    await result;
    expect(log[0]).toBe('find:ws:owner-p');
  });

  it('a refused authorization reads nothing', async () => {
    const { deps, log } = makeDeps();
    await expect(call(deps, { deny: true }).result).rejects.toBeInstanceOf(RouteRefusalError);
    expect(log).toEqual([]);
  });

  it('rethrows an unexpected failure unchanged (the host 500)', async () => {
    const { deps } = makeDeps({ userRepo: { findByPrincipalId: async () => { throw new Error('db gone'); } } });
    await expect(call(deps).result).rejects.toThrow('db gone');
  });

  it('fails closed without an authorizer', async () => {
    const { deps, log } = makeDeps();
    await expect(call(deps, { noAuthorizer: true }).result).rejects.toThrow(/no authorizer/);
    expect(log).toEqual([]);
  });
});
