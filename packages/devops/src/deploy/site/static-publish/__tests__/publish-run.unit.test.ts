import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createPublishJobStore } from '../../../index.js';
import { startPublishRun, getPublishRunSnapshot } from '../publish-run.js';
import { InMemoryPublishHistoryStore } from '../publish-history.js';
import type { StaticPublishDeps, StaticPublishInput } from '../adapter.js';

test('failed runs settle without entering durable replay history', async () => {
  const historyStore = new InMemoryPublishHistoryStore({ resolvePublishHistoryListLimit: () => 100 });
  const deps = { publishJobs: createPublishJobStore({}), tracker: { trace: async ({ run }: { run(span: { setOutcome(): void }): Promise<unknown> }) => run({ setOutcome() {} }) } } as unknown as StaticPublishDeps;
  const input = { workspaceId: 'ws', projectName: '', config: { target: 'host' }, idGen: { newId: () => 'job' } } as StaticPublishInput;
  let settled!: () => void;
  const finished = new Promise<void>(resolve => { settled = resolve; });
  assert.equal(startPublishRun({ deps, input, clock: { nowIso: () => 'now' }, historyStore }, { onSettled: settled }).status, 'running');
  await finished;
  assert.equal(getPublishRunSnapshot(deps).status, 'errored');
  assert.deepEqual(await historyStore.listDestinationHistory({ workspaceId: 'ws' }), []);
});
