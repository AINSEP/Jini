import { describe, expect, it } from 'vitest';
import type { AuthorizeFn } from '@jini-ai/core/contracts/events';
import { createNoopObservabilityPort, type ObservabilityPort } from '@jini-ai/core/contracts/observability';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import {
  observabilityStatusRoute, observabilityTestErrorRoute,
  type AdminObservabilityStatusRouteDeps, type AdminObservabilityTestErrorRouteDeps,
} from '../observability-status.js';

const RAW = { body: {}, query: {}, params: { workspaceId: 'ws' } };
const configured = {} as ObservabilityPort;

function statusDeps(overrides: Partial<AdminObservabilityStatusRouteDeps> = {}): AdminObservabilityStatusRouteDeps {
  return { workspaceId: 'ws', authorize: async () => ({ allowed: true, reason: 'owner' }), observability: configured, serviceName: 'svc', ...overrides };
}

async function refusal(promise: unknown): Promise<RouteRefusalError> {
  const error = await Promise.resolve(promise).then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(RouteRefusalError);
  return error as RouteRefusalError;
}

function getStatus(deps: AdminObservabilityStatusRouteDeps, { deny = false }: { deny?: boolean } = {}) {
  const asked: unknown[] = [];
  const authorize = async (args: { permission: string; entityType: string }) => {
    asked.push(args);
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: 'denied' } });
  };
  const parsed = observabilityStatusRoute.parse(RAW);
  if (!parsed.ok) throw new Error('parse must be total');
  return { asked, result: observabilityStatusRoute.handle({ input: parsed.value, deps, context: { id: 'owner' }, authorize }, {}) };
}

function postTestError(deps: AdminObservabilityTestErrorRouteDeps) {
  const parsed = observabilityTestErrorRoute.parse(RAW);
  if (!parsed.ok) throw new Error('parse must be total');
  return observabilityTestErrorRoute.handle({ input: parsed.value, deps, context: { id: 'owner' } }, {});
}

describe('observabilityStatusRoute', () => {
  it('keeps the methods and byte-identical paths', () => {
    expect([observabilityStatusRoute.method, observabilityStatusRoute.path]).toEqual(['get', '/api/admin/v1/workspaces/:workspaceId/system/observability-status']);
    expect([observabilityTestErrorRoute.method, observabilityTestErrorRoute.path]).toEqual(['post', '/api/admin/v1/workspaces/:workspaceId/system/observability/test-error']);
  });

  it('authorizes system.read and reports a configured port under the injected service name', async () => {
    const { asked, result } = getStatus(statusDeps());
    expect(await result).toEqual({ ok: true, value: { enabled: true, serviceName: 'svc' } });
    expect(asked).toEqual([{ permission: 'system.read', entityType: 'observability' }]);
  });

  it('reports the no-op port as disabled with a null service name', async () => {
    const { result } = getStatus(statusDeps({ observability: createNoopObservabilityPort({}) }));
    expect(await result).toEqual({ ok: true, value: { enabled: false, serviceName: null } });
  });

  it('prefers the bound enabled probe and adds provider status and the test-error permission', async () => {
    const raw: Parameters<AuthorizeFn>[0][] = [];
    const { result } = getStatus(statusDeps({
      observability: createNoopObservabilityPort({}), observabilityEnabled: () => true,
      telemetryStatus: () => [{ id: 'p' }], sendTelemetryTest: async () => { throw new Error('a read never sends'); },
      authorize: async (args) => { raw.push(args); return { allowed: false, reason: 'read-only' }; },
    }));
    expect(await result).toEqual({ ok: true, value: { enabled: true, serviceName: 'svc', providers: [{ id: 'p' }], canSendTestError: false } });
    expect(raw).toEqual([{ principalId: 'owner', permission: 'system.write', workspaceId: 'ws', entityType: 'observability' }]);
  });

  it('never reads the provider state when system.read is refused', async () => {
    let reads = 0;
    const { result } = getStatus(statusDeps({ observabilityEnabled: () => { reads++; return true; } }), { deny: true });
    await refusal(result);
    expect(reads).toBe(0);
  });
});

describe('observabilityTestErrorRoute', () => {
  it('answers its own 403 copy when system.write is refused, before any send', async () => {
    let sends = 0;
    const error = await refusal(postTestError({ workspaceId: 'ws', authorize: async () => ({ allowed: false, reason: 'no' }), sendTelemetryTest: async () => { sends++; return {}; } }));
    expect(error.response).toEqual({ status: 403, body: { error: 'not authorized to send a test error', code: 'FORBIDDEN' } });
    expect(sends).toBe(0);
  });

  it('answers 503 when no sender is bound', async () => {
    const error = await refusal(postTestError({ workspaceId: 'ws', authorize: async () => ({ allowed: true, reason: 'owner' }) }));
    expect(error.response).toEqual({ status: 503, body: { error: 'telemetry test is unavailable' } });
  });

  it('relays the bound sender result with an empty request', async () => {
    const calls: unknown[] = [];
    const result = await postTestError({ workspaceId: 'ws', authorize: async () => ({ allowed: true, reason: 'owner' }),
      sendTelemetryTest: async (args) => { calls.push(args); return { delivered: 1 }; } });
    expect(result).toEqual({ ok: true, value: { delivered: 1 } });
    expect(calls).toEqual([{}]);
  });
});
