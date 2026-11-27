import { describe, expect, it } from 'vitest';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import { assistantDaemonRestartRoute, type AdminAssistantDaemonDeps } from '../assistant-daemon.js';

const raw = { body: {}, query: {}, params: { workspaceId: 'ws' } };

function call(deps: AdminAssistantDaemonDeps, { deny = false }: { deny?: boolean } = {}) {
  const asked: unknown[] = [];
  const authorize = async (args: { permission: string; entityType: string }) => {
    asked.push(args);
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: 'denied' } });
  };
  const parsed = assistantDaemonRestartRoute.parse(raw);
  if (!parsed.ok) throw new Error('parse must be total');
  return { asked, result: assistantDaemonRestartRoute.handle({ input: parsed.value, deps, context: { id: 'owner' }, authorize }, {}) };
}

async function refusal(promise: unknown): Promise<RouteRefusalError['response']> {
  try { await promise; } catch (error) { if (error instanceof RouteRefusalError) return error.response; throw error; }
  throw new Error('expected a refusal');
}

describe('assistantDaemonRestartRoute', () => {
  it('keeps the method and byte-identical path', () => {
    expect(assistantDaemonRestartRoute.method).toBe('post');
    expect(assistantDaemonRestartRoute.path).toBe('/api/admin/v1/workspaces/:workspaceId/system/assistant-daemon/restart');
    expect(assistantDaemonRestartRoute.successStatus).toBeUndefined();
  });

  it('authorizes system.write on assistant-daemon, then answers an accepted restart with {ok:true}', async () => {
    let restarts = 0;
    const { asked, result } = call({ restartAssistantDaemon: () => { restarts++; return { ok: true }; } });
    expect(await result).toEqual({ ok: true, value: { ok: true } });
    expect(asked).toEqual([{ permission: 'system.write', entityType: 'assistant-daemon' }]);
    expect(restarts).toBe(1);
  });

  it('relays a refused restart verbatim as a 409 with the refusal code', async () => {
    const { result } = call({ restartAssistantDaemon: () => ({ ok: false, reason: 'shutting down' }) });
    expect(await refusal(result)).toEqual({ status: 409, body: { ok: false, reason: 'shutting down', code: 'ASSISTANT_DAEMON_RESTART_REFUSED' } });
  });

  it('never restarts when authorization refuses', async () => {
    let restarts = 0;
    const { result } = call({ restartAssistantDaemon: () => { restarts++; return { ok: true }; } }, { deny: true });
    expect(await refusal(result)).toEqual({ status: 403, body: { error: 'denied' } });
    expect(restarts).toBe(0);
  });

  it('lets an unexpected restart failure propagate to the host error port', async () => {
    const { result } = call({ restartAssistantDaemon: () => { throw new Error('boom'); } });
    await expect(result).rejects.toThrow('boom');
  });
});

it('fails closed before requesting a restart when the authorizer is unwired', async () => {
  let restarts = 0;
  await expect(assistantDaemonRestartRoute.handle({
    input: {}, deps: { restartAssistantDaemon: () => { restarts++; return { ok: true }; } }, context: { id: 'owner' },
  })).rejects.toThrow('assistant-daemon restart route has no authorizer');
  expect(restarts).toBe(0);
});
