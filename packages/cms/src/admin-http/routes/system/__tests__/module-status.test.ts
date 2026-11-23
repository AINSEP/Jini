import { describe, expect, it } from 'vitest';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import { moduleStatusRoute, type AdminModuleStatusRouteDeps } from '../module-status.js';

function call(deps: AdminModuleStatusRouteDeps, { deny = false }: { deny?: boolean } = {}) {
  const asked: unknown[] = [];
  const authorize = async (args: { permission: string; entityType: string }) => {
    asked.push(args);
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: 'denied' } });
  };
  const parsed = moduleStatusRoute.parse({ body: {}, query: {}, params: { workspaceId: 'ws' } });
  if (!parsed.ok) throw new Error('parse must be total');
  return { asked, result: moduleStatusRoute.handle({ input: parsed.value, deps, context: { id: 'owner' }, authorize }, {}) };
}

describe('moduleStatusRoute', () => {
  it('keeps the method and byte-identical path', () => {
    expect(moduleStatusRoute.method).toBe('get');
    expect(moduleStatusRoute.path).toBe('/api/admin/v1/workspaces/:workspaceId/system/module-status');
  });

  it('authorizes system.read on boot-module and answers a healthy snapshot with 200', async () => {
    const snapshot = { ok: true, modules: [{ name: 'a', status: 'started' }] };
    const { asked, result } = call({ getReadinessSnapshot: () => snapshot });
    expect(await result).toEqual({ ok: true, value: snapshot });
    expect(asked).toEqual([{ permission: 'system.read', entityType: 'boot-module' }]);
  });

  it('answers a failed critical module with 503 and the unchanged snapshot body', async () => {
    const snapshot = { ok: false, modules: [{ name: 'a', status: 'failed' }] };
    const { result } = call({ getReadinessSnapshot: () => snapshot });
    const error = await Promise.resolve(result).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(RouteRefusalError);
    expect((error as RouteRefusalError).response).toEqual({ status: 503, body: snapshot });
  });

  it('never reads the snapshot when authorization refuses', async () => {
    let reads = 0;
    const { result } = call({ getReadinessSnapshot: () => { reads++; return { ok: true }; } }, { deny: true });
    await expect(result).rejects.toBeInstanceOf(RouteRefusalError);
    expect(reads).toBe(0);
  });
});
