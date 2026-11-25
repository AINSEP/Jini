import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { definePack } from '@jini-ai/core';
import type { RouteHostContext } from '@jini-ai/core/contracts/server';
import { createTestRouteHost } from '@jini-ai/core/contracts/server/testing';
import { createRecordingObservability, createRecordingReporter } from '@jini-ai/core/errors/testing';
import { agentRoutes, type DaemonRouteHost } from '@jini-ai/daemon/http';
import { reportRouteInternalError } from '@jini-ai/http-kit';
import { mountRoutes } from '../mount-routes.js';
import { composeJiniKernel, type JiniKernel } from '../compose-jini-kernel.js';
import { defineJiniFeature } from '../feature.js';
import { PRESET_JSON_PARSER_LIMIT_BYTES, presetRouteHost } from '../route-host.js';
import { nodeOsPorts } from './fixtures/node-os-ports.js';

const kernels: JiniKernel[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  while (kernels.length > 0) await kernels.pop()!.close();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
});

const FIRST_ID = 'ERR-0000-0000-0000-0001';
const SECOND_ID = 'ERR-0000-0000-0000-0002';

/** A route context in reporter mode over a real reporter whose records and tracker reports the test can read. */
function reporterModeContext(): { readonly context: RouteHostContext; readonly entries: ReturnType<typeof createRecordingReporter>['entries'] } {
  const { reporter, entries } = createRecordingReporter({ ids: [FIRST_ID, SECOND_ID], iso: '2026-01-01T00:00:00.000Z' });
  const { observability } = createRecordingObservability();
  return { context: { ...createTestRouteHost(), errors: { reporter, observability } }, entries };
}

async function listen(app: express.Express): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Composes a kernel with one extra feature and returns the route host that feature was given. */
async function routeHostAFeatureReceives(config: { jsonBodyParserLimitBytes?: number; installJsonBodyParser?: boolean } = {}, { adapter = createTestRouteHost() }: { adapter?: RouteHostContext } = {}) {
  const received: DaemonRouteHost[] = [];
  const probe = defineJiniFeature({
    id: 'probe.route-host',
    provides: [],
    compose: (context) => {
      received.push(context.routeHost);
      return { pack: definePack({ name: 'probe.route-host', deps: [], services: () => ({}) }, {}) };
    },
  });
  kernels.push(await composeJiniKernel({ app: express(), adapter, resolvedPortRef: { current: 4000 }, osPorts: nodeOsPorts, storage: { kind: 'memory' }, security: { mode: 'host' },
    extraFeatures: [probe], features: { 'probe.route-host': true }, ...config }));
  return { adapter, received };
}

describe('the route host a composed kernel hands its features', () => {
  it('is built once from the composition\'s own route context, with the limit of the parser the kernel installs', async () => {
    const { adapter, received } = await routeHostAFeatureReceives();
    expect(received).toHaveLength(1);
    expect(received[0]!.context).toBe(adapter);
    expect(received[0]!.jsonBodyMaxBytes).toBe(537_600);
  });

  it('uses the caller\'s parser limit when the caller says what it is', async () => {
    const { received } = await routeHostAFeatureReceives({ installJsonBodyParser: false, jsonBodyParserLimitBytes: 6_291_456 });
    expect(received[0]!.jsonBodyMaxBytes).toBe(33_030_144);
  });
});

describe('presetRouteHost', () => {
  it('hands the route context on as it was given', () => {
    const context = createTestRouteHost();
    expect(presetRouteHost({ context, parserLimitBytes: 1000 }).context).toBe(context);
  });

  it('derives the route body limit from the parser limit: 5.25 times, so a body the parser accepted is never refused after it is re-serialized', () => {
    expect(PRESET_JSON_PARSER_LIMIT_BYTES).toBe(102_400);
    expect(presetRouteHost({ context: createTestRouteHost(), parserLimitBytes: PRESET_JSON_PARSER_LIMIT_BYTES }).jsonBodyMaxBytes).toBe(537_600);
    expect(presetRouteHost({ context: createTestRouteHost(), parserLimitBytes: 6_291_456 }).jsonBodyMaxBytes).toBe(33_030_144);
  });

  it('compares equal-length bytes and says whether they are the same', () => {
    const { timingSafeEqual } = presetRouteHost({ context: createTestRouteHost(), parserLimitBytes: 1000 });
    expect(timingSafeEqual({ left: new Uint8Array([1, 2, 3]), right: new Uint8Array([1, 2, 3]) })).toBe(true);
    expect(timingSafeEqual({ left: new Uint8Array([1, 2, 3]), right: new Uint8Array([1, 2, 4]) })).toBe(false);
  });

  it('runs a scheduled callback once per interval until it is cancelled', () => {
    vi.useFakeTimers();
    const { scheduler } = presetRouteHost({ context: createTestRouteHost(), parserLimitBytes: 1000 });
    let ticks = 0;
    const handle = scheduler.every({ callback: () => { ticks += 1; }, intervalMs: 15_000 });
    vi.advanceTimersByTime(45_000);
    expect(ticks).toBe(3);
    scheduler.cancel({ handle });
    vi.advanceTimersByTime(45_000);
    expect(ticks).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a scheduled timer does not keep the process alive', () => {
    const { scheduler } = presetRouteHost({ context: createTestRouteHost(), parserLimitBytes: 1000 });
    const handle = scheduler.every({ callback: () => undefined, intervalMs: 60_000 });
    expect((handle as NodeJS.Timeout).hasRef()).toBe(false);
    scheduler.cancel({ handle });
  });

  it('reports an internal error with a request ID and without the thrown text', () => {
    const seen: unknown[] = [];
    const host = presetRouteHost({ context: createTestRouteHost(), parserLimitBytes: 1000 });
    const error = new Error('secret detail');
    const answer = host.reportInternalError({ report: { error }, logSource: 'test', message: 'the request failed' }, { onInternalError: (report) => { seen.push(report); } });
    expect(answer.code).toBe('INTERNAL_ERROR');
    expect(answer.message).toBe('the request failed');
    expect(typeof answer.requestId).toBe('string');
    expect(JSON.stringify(answer)).not.toContain('secret detail');
    expect(seen).toHaveLength(1);
    expect((seen[0] as { error: unknown; correlationId: unknown }).error).toBe(error);
    expect((seen[0] as { correlationId: unknown }).correlationId).toBe(answer.requestId);
  });

  it('the preset binds the reporter-backed internal error when errors are configured', async () => {
    const { context, entries } = reporterModeContext();
    const host = presetRouteHost({ context, parserLimitBytes: PRESET_JSON_PARSER_LIMIT_BYTES });
    const app = express();
    mountRoutes({ app, routes: agentRoutes({ deps: { listAgents: () => { throw new Error('secret detail'); } }, host }) });
    const response = await fetch(`${await listen(app)}/api/agents`);
    const text = await response.text();
    // A throwing route: the reporter's ID on the wire, one host record, and none of the thrown text.
    expect(response.status).toBe(500);
    expect(text).toContain(FIRST_ID);
    expect(text).not.toContain('secret detail');
    expect(entries.filter((entry) => entry.level === 'error')).toHaveLength(1);
    // A route that handles its own failure gets the next ID from the same reporter, never the legacy sink.
    const legacySink = vi.fn();
    const answer = host.reportInternalError({ report: { error: new Error('secret detail') }, logSource: 'test', message: 'the request failed' }, { onInternalError: legacySink });
    expect(answer).toEqual({ code: 'INTERNAL_ERROR', message: `the request failed (error ${SECOND_ID})`, requestId: SECOND_ID });
    expect(legacySink).not.toHaveBeenCalled();
    expect(entries.filter((entry) => entry.level === 'error')).toHaveLength(2);
  });

  it('without errors the preset keeps the legacy reporter', () => {
    const host = presetRouteHost({ context: createTestRouteHost(), parserLimitBytes: 1000 });
    expect(host.reportInternalError).toBe(reportRouteInternalError);
  });

  it('context identity and parser limits are preserved with errors', async () => {
    const { context } = reporterModeContext();
    const host = presetRouteHost({ context, parserLimitBytes: 6_291_456 });
    expect(host.context).toBe(context);
    expect(host.jsonBodyMaxBytes).toBe(33_030_144);
    // The composed kernel hands its features the same reporter-mode context it was given.
    const { context: adapter } = reporterModeContext();
    const { received } = await routeHostAFeatureReceives({}, { adapter });
    expect(received[0]!.context).toBe(adapter);
    expect(received[0]!.jsonBodyMaxBytes).toBe(537_600);
    expect(received[0]!.reportInternalError({ report: { error: new Error('x') }, logSource: 'test', message: 'failed' }).requestId).toBe(FIRST_ID);
  });
});
