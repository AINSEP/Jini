import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { getRouteRegistrationInventory, installRouteRegistrationGuard } from '@jini-ai/http-kit';
import { type RouteHostContext } from '@jini-ai/core/contracts/server';
import { createTestRouteHost } from '@jini-ai/core/contracts/server/testing';
import type { DetectedAgent } from '@jini-ai/agent-runtime';
import { composeJiniKernel, type JiniKernel } from '../compose-jini-kernel.js';
import { nodeOsPorts } from './fixtures/node-os-ports.js';
import { ANONYMOUS_DELEGATED_PRINCIPAL, LOCAL_DAEMON_PRINCIPAL, projectDetectedAgent } from '../builtin-features.js';

/** L9 §4 builtin-features: the egress families actually REGISTER their routes when activated (a
 *  feature whose `http` hook silently registered nothing used to pass), principals are pinned,
 *  and the agent projection omits absent optional fields. */
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

/** Host-bound ports the egress features require; the preset ships no implementation of its own. */
const egressPorts = {
  modelProxy: { toolTurns: { anthropic: vi.fn(), openai: vi.fn(), azure: vi.fn(), google: vi.fn(), ollama: vi.fn() }, providers: [] },
  research: { baseUrlGuard: { validate: vi.fn(() => null) } },
};

async function routesFor(features: Record<string, true>, storage: 'memory' | 'sqlite' = 'memory', featureOptions: object = egressPorts): Promise<string[]> {
  const app = express();
  installRouteRegistrationGuard({ app });
  const adapter: RouteHostContext = createTestRouteHost();
  const resolvedPortRef = { current: 0 };
  let dataDir: string | undefined;
  if (storage === 'sqlite') { dataDir = mkdtempSync(join(tmpdir(), 'jini-mounts-')); cleanups.push(() => rmSync(dataDir!, { recursive: true, force: true })); }
  const kernel: JiniKernel = await composeJiniKernel({ app, adapter, resolvedPortRef, security: { mode: 'host' }, profile: 'agent-core-v1', osPorts: nodeOsPorts,
    storage: storage === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', open: (file: string) => new Database(file) as never, dataDir: dataDir! },
    capabilities: { 'net:egress': true }, features, featureOptions } as never);
  cleanups.push(() => kernel.close());
  expect(kernel.activation.active.map(r => r.id)).toEqual(expect.arrayContaining(Object.keys(features)));
  return getRouteRegistrationInventory({ app }).map(r => `${r.method.toUpperCase()} ${r.path}`);
}

describe('egress feature mounts', () => {
  it('connectors registers its auth and storage routes', async () => {
    const routes = await routesFor({ connectors: true });
    expect(routes).toEqual(expect.arrayContaining(['POST /api/connectors/auth/signin', 'GET /api/connectors/storage/:key']));
  });
  it('research registers its search route', async () => {
    expect(await routesFor({ research: true })).toContain('POST /api/research/search');
  });
  it('model proxy registers its routes with the host-bound tool turns', async () => {
    expect((await routesFor({ modelProxy: true })).some((route) => route.includes('/api/proxy'))).toBe(true);
  });
  // REGRESSION: the preset must not fall back to its own provider/guard implementations.
  it.each([['modelProxy', 'featureOptions.modelProxy'], ['research', 'featureOptions.research']])(
    '%s refuses to activate without its host-bound port', async (feature, optionPath) => {
      await expect(routesFor({ [feature]: true }, 'memory', {})).rejects.toThrow(`"${optionPath}" was not supplied`);
    });
  it('xai registers its OAuth routes', async () => {
    expect(await routesFor({ xai: true }, 'sqlite')).toEqual(expect.arrayContaining(['POST /api/xai/oauth/start', 'POST /api/xai/oauth/complete']));
  });
});

describe('principals and agent projection', () => {
  it('pins the two built-in principals', () => {
    expect(LOCAL_DAEMON_PRINCIPAL).toEqual({ id: 'local-daemon' });
    expect(ANONYMOUS_DELEGATED_PRINCIPAL).toEqual({ id: 'anonymous-delegated' });
  });
  it('omits absent optional fields and keeps present ones (including false)', () => {
    const minimal = { id: 'x', name: 'X', available: true, models: [{ id: 'm', label: 'M' }], modelsSource: 'static' } as unknown as DetectedAgent;
    expect(projectDetectedAgent(minimal)).toStrictEqual({ id: 'x', name: 'X', available: true, models: [{ id: 'm', label: 'M' }], modelsSource: 'static' });
    const full = { ...minimal, version: '1.2', authStatus: 'ok', supportsConcreteModelSelection: false, supportsCustomModel: false,
      models: [{ id: 'm', label: 'M', identityKind: 'alias', resolvedId: 'm-1', extra: 'dropped' }], modelCatalog: { a: 1 }, defaultModelResolution: { b: 2 },
      reasoningOptions: [{ id: 'r', label: 'R', hidden: true }], diagnostics: [{ message: 'needs login' }] } as unknown as DetectedAgent;
    expect(projectDetectedAgent(full)).toStrictEqual({ id: 'x', name: 'X', available: true, version: '1.2', authStatus: 'ok',
      models: [{ id: 'm', label: 'M', identityKind: 'alias', resolvedId: 'm-1' }], modelCatalog: { a: 1 }, defaultModelResolution: { b: 2 },
      supportsConcreteModelSelection: false, reasoningOptions: [{ id: 'r', label: 'R' }], modelsSource: 'static', supportsCustomModel: false, diagnostic: 'needs login' });
  });
});
