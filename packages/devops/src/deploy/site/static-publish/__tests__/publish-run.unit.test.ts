import assert from 'node:assert/strict';
import { expect, test, vi } from 'vitest';
import { createPublishJobStore } from '../../../index.js';
import { startPublishRun, getPublishRunSnapshot, getPublishJobSnapshot } from '../publish-run.js';
import { InMemoryPublishHistoryStore, type PublishHistoryStore } from '../publish-history.js';
import type { StaticPublishDeps, StaticPublishInput } from '../adapter.js';
import { publishFixture } from "./publish.fixture.js";

test('failed runs settle without entering durable replay history', async () => {
  const historyStore = new InMemoryPublishHistoryStore({ peerKind: "peer", resolvePublishHistoryListLimit: () => 100 });
  const deps = { publishJobs: createPublishJobStore({}), tracker: { trace: async ({ run }: { run(span: { setOutcome(): void }): Promise<unknown> }) => run({ setOutcome() {} }) } } as unknown as StaticPublishDeps;
  const input = { workspaceId: 'ws', projectName: '', config: { target: 'host' }, idGen: { newId: () => 'job' } } as StaticPublishInput;
  let settled!: () => void;
  const finished = new Promise<void>(resolve => { settled = resolve; });
  assert.equal(startPublishRun({ deps, input, clock: { nowIso: () => 'now' }, historyStore }, { onSettled: settled }).status, 'running');
  await finished;
  assert.equal(getPublishRunSnapshot(deps).status, 'errored');
  assert.deepEqual(await historyStore.listDestinationHistory({ workspaceId: 'ws' }), []);
});

const startedAtIso = '2026-11-25T01:00:00.000Z';
const clock = { nowIso: () => startedAtIso };
const newHistory = () => new InMemoryPublishHistoryStore({ peerKind: 'peer', resolvePublishHistoryListLimit: () => 100 });

test('publishing settles a scoped job only after storing the actual remote destination', async () => {
  const f = publishFixture();
  const historyStore = newHistory();
  let entered!: () => void;
  let release!: () => void;
  const writeEntered = new Promise<void>(resolve => { entered = resolve; });
  const releaseWrite = new Promise<void>(resolve => { release = resolve; });
  const recordSuccess = historyStore.recordSuccess.bind(historyStore);
  historyStore.recordSuccess = async row => {
    entered();
    await releaseWrite;
    await recordSuccess(row);
  };
  const destinationConfig = vi.fn(() => ({ bucket: 'canonical-bucket', unlisted: 'discard' }));
  f.loadDeployTargets.mockResolvedValue({ ...f.registry, get: id => id === 'host' ? { ...f.target, module: { ...f.target.module, destinationConfig } } : undefined });
  const providerMetadata = { owner: 'publisher', repo: 'docs', commitSha: 'sha-1', branch: 37 };
  f.publish.mockResolvedValueOnce({ targetId: 'host', url: f.url, status: 'ready', deploymentId: 'deploy-9', providerMetadata });
  f.resolve.mockResolvedValueOnce({ ok: true, token: 'secret-token', credentialId: 'resolved-row', basis: { id: 'resolved-row', revision: 4 } });
  const input = { ...f.input, credentialId: 'requested-row', requestId: 'req-7', productEvent: { userId: 'person', source: 'admin' as const } };
  const deps = { ...f.deps, tracker: f.tracker };
  let settle!: (status: { status: 'completed' | 'errored' }) => void;
  const done = new Promise<{ status: 'completed' | 'errored' }>(resolve => { settle = resolve; });
  expect(getPublishRunSnapshot(deps)).toEqual({ status: 'idle', startedAtIso: null, finishedAtIso: null, target: null });
  expect(startPublishRun({ deps, historyStore, clock, input }, { onSettled: settle })).toMatchObject({ status: 'running', jobId: 'run-8', requestId: 'req-7', startedAtIso });
  expect(getPublishJobSnapshot({ deps, workspaceId: 'other', jobId: 'run-8' })).toBeUndefined();
  await writeEntered;
  try {
    expect(getPublishRunSnapshot(deps).status).toBe('running');
    expect(await historyStore.getLast({ workspaceId: 'workspace-7', target: 'host' })).toBeNull();
  } finally {
    release();
  }
  expect(await done).toEqual({ status: 'completed' });
  expect(getPublishJobSnapshot({ deps, workspaceId: 'workspace-7', requestId: 'req-7' })).toMatchObject({
    status: 'completed', jobId: 'run-8', finishedAtIso: startedAtIso, progress: { url: f.url, deploymentCreated: true, deploymentId: 'deploy-9' },
  });
  expect(destinationConfig).toHaveBeenCalledExactlyOnceWith({ providerMetadata });
  expect(await historyStore.getLast({ workspaceId: 'workspace-7', target: 'host' })).toEqual({
    target: 'host', projectName: 'Studio', url: f.url, reachable: true, status: 'ready', publishedAt: startedAtIso,
    triggeredBy: 'admin_ui', owner: 'publisher', repo: 'docs', commitSha: 'sha-1', basePath: '/docs', deploymentId: 'deploy-9',
    credentialId: 'resolved-row', configFields: { bucket: 'canonical-bucket' },
  });
  expect(vi.mocked(f.tracker.capture).mock.calls).toEqual([
    [{ name: 'site_publish_started', userId: 'person' }, { properties: { operationId: 'run-8', eventId: 'publish:run-8:started', target: 'host', source: 'admin' } }],
    [{ name: 'deploy_finished', userId: 'person' }, { properties: { operationId: 'run-8', eventId: 'publish:run-8:completed', target: 'host', source: 'admin', outcome: 'completed' } }],
  ]);
});

test('registry reload failure still records an outcome-only history entry for a partial publish', async () => {
  const f = publishFixture();
  f.loadDeployTargets.mockResolvedValueOnce(f.registry).mockRejectedValueOnce(new Error('private loader detail'));
  f.publish.mockResolvedValueOnce({ targetId: 'host', url: f.url, status: 'protected' });
  const historyStore = newHistory();
  const done = new Promise<void>(resolve => {
    startPublishRun({ deps: f.deps, input: { ...f.input, credentialId: 'requested' }, clock, historyStore },
      { onSettled: () => resolve(), triggeredBy: 'agent_tool' });
  });
  await done;
  expect(getPublishRunSnapshot(f.deps)).toMatchObject({ status: 'completed', result: { ok: 'partial' } });
  expect(await historyStore.getLast({ workspaceId: 'workspace-7', target: 'host' })).toEqual({
    target: 'host', projectName: 'Studio', url: f.url, status: 'protected', reachable: false, basePath: '/docs',
    publishedAt: startedAtIso, triggeredBy: 'agent_tool', credentialId: 'requested',
  });
  expect(f.warn).toHaveBeenCalledExactlyOnceWith('[static-publish] destination registry reload failed; recording outcome only');
});

test('a failed history write cannot downgrade a successful publish', async () => {
  const f = publishFixture();
  const store = newHistory();
  const recordSuccess = vi.fn<PublishHistoryStore['recordSuccess']>().mockRejectedValue(new Error('storage unavailable'));
  const historyStore: PublishHistoryStore = {
    recordSuccess, getLast: store.getLast.bind(store), list: store.list.bind(store), listLiveUrls: store.listLiveUrls.bind(store),
    listDestinationHistory: store.listDestinationHistory.bind(store),
  };
  await new Promise<void>(resolve => { startPublishRun({ deps: f.deps, input: f.input, clock, historyStore }, { onSettled: () => resolve() }); });
  expect(getPublishRunSnapshot(f.deps)).toMatchObject({ status: 'completed', result: { ok: true, url: f.url } });
  expect(f.warn.mock.calls.map(([message]) => message)).toEqual(['[static-publish] destination history write failed after publish']);
  expect(await historyStore.list({ workspaceId: f.input.workspaceId })).toEqual([]);
});

test('unexpected publish rejection is sanitized in the job and not recorded as published', async () => {
  const f = publishFixture();
  const historyStore = newHistory();
  const redactSecretShapes = vi.fn(() => ({ text: 'provider returned [redacted]' }));
  const deps = { ...f.deps, redactSecretShapes, tracker: { ...f.tracker, trace: async () => { throw 'provider returned private-value'; } } };
  await new Promise<void>(resolve => { startPublishRun({ deps, input: f.input, clock, historyStore }, { onSettled: () => resolve() }); });
  expect(getPublishRunSnapshot(deps)).toMatchObject({ status: 'errored', error: 'provider returned [redacted]', finishedAtIso: startedAtIso });
  expect(redactSecretShapes).toHaveBeenCalledExactlyOnceWith({ text: 'provider returned private-value' });
  expect(await historyStore.list({ workspaceId: f.input.workspaceId })).toEqual([]);
});
