import { expect, it } from 'vitest';
import { getPublishContentRunStatus, InMemoryPublishContentRunRepo, type PublishContentRunRecord } from '../run-repo.js';

const startedAt = '2026-01-02T00:00:00Z';
const base: PublishContentRunRecord = {
  id: 'run-8', workspaceId: 'west', direction: 'import', peerPrincipalId: 'peer-3', peerLabel: 'Preview',
  phase: 'applying', restorePointId: null, changeSetIdsJson: null, actorId: 'operator-2',
  startedAt, finishedAt: null, reportJson: null, itemsJson: null,
};
const input = { workspaceId: 'west', runId: 'run-8' };
const initialStatus = { id: 'run-8', workspaceId: 'west', direction: 'import', phase: 'applying',
  restorePointId: null, actorId: 'operator-2', startedAt, finishedAt: null, changeSetIds: [],
  retiredChangeSetIds: [], report: null, items: [] };

it('projects the latest run snapshot without exposing peer fields or another workspace’s run', async () => {
  const repo = new InMemoryPublishContentRunRepo();
  expect(await getPublishContentRunStatus({ repo, input })).toBeNull();
  await repo.save({ record: base });
  expect(await getPublishContentRunStatus({ repo, input })).toEqual(initialStatus);
  const items = [
    { entityType: 'page', entityId: 'p-5', idempotencyKey: 'item-5', phase: 'completed', outcome: 'forced',
      writes: true, reason: null, changeSetId: 'written-5', retiredChangeSetId: 'retired-4', errorSummary: null, updatedAt: startedAt },
    { entityType: 'page', entityId: 'p-7', idempotencyKey: 'item-7', phase: 'completed', outcome: 'applied',
      writes: true, reason: null, changeSetId: 'written-7', retiredChangeSetId: null, errorSummary: null, updatedAt: startedAt },
  ];
  const report = { refused: false, refusalReason: null, rows: [], applyOrder: ['page'] };
  const finishedAt = '2026-01-02T00:00:04Z';
  await repo.save({ record: { ...base, phase: 'applied', restorePointId: 'restore-3', finishedAt,
    itemsJson: JSON.stringify(items), reportJson: JSON.stringify(report), changeSetIdsJson: '["written-5",null,7,"written-7"]' } });
  expect(await getPublishContentRunStatus({ repo, input })).toEqual({
    ...initialStatus, phase: 'applied', restorePointId: 'restore-3', finishedAt, items, report,
    changeSetIds: ['written-5', 'written-7'], retiredChangeSetIds: ['retired-4'],
  });
  expect(await getPublishContentRunStatus({ repo, input: { ...input, workspaceId: 'east' } })).toBeNull();
});

it('ignores legacy non-array change-set and item payloads instead of treating them as lists', async () => {
  const repo = new InMemoryPublishContentRunRepo();
  await repo.save({ record: { ...base, changeSetIdsJson: '{"id":"not-a-list"}', itemsJson: 'null' } });
  expect(await getPublishContentRunStatus({ repo, input })).toEqual(initialStatus);
});
