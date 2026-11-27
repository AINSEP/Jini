import assert from 'node:assert/strict';
import { sql } from 'kysely';
import { test } from 'vitest';
import type { DomainEvent } from '@jini-ai/core/contracts/events';
import { describeEachDialect, type ContentKernel } from '../../../core/__tests__/support/dialect-matrix.js';
import { FORM_DELIVERY_EVENT, type FormDeliveryPlan, type FormDeliveryQueuedJob } from '../../delivery/index.js';
import { SqlFormDeliveryRepo } from '../form-delivery-repo.js';
import { SqlFormPullLeaseRepo } from '../form-pull-lease-repo.js';
import { SqlFormSubmissionReceiptRepo } from '../form-submission-receipt-repo.js';

const tables = { plans: 'form_plans', jobs: 'form_jobs', outboxEvents: 'app_outbox' };
const pullTable = 'receiver_leases';
const receiptTable = 'remote_receipts';
const start = '2026-11-20T12:00:00.000Z';
const later = '2026-11-20T12:00:05.000Z';

async function createTables(kernel: ContentKernel) {
  await kernel.execute(sql`create table form_plans (workspace_id text not null, submission_id text not null, form_id text not null, primary key(workspace_id, submission_id))`);
  await kernel.execute(sql`create table form_jobs (job_id text primary key, workspace_id text not null, submission_id text not null, binding_id text not null, adapter_id text not null)`);
  await kernel.execute(sql`create table app_outbox (id text primary key, workspace_id text not null, event_json text not null, status text not null, attempts integer not null default 0, next_attempt_at text not null, last_error text, created_at text not null)`);
  await kernel.execute(sql`create table receiver_leases (workspace_id text not null, receiver_key text not null, lease_token text, lease_expires_at text, last_started_at text not null, primary key(workspace_id, receiver_key))`);
  await kernel.execute(sql`create table remote_receipts (workspace_id text not null, destination_key text not null, remote_id text not null, submission_id text not null, imported_at text not null, primary key(workspace_id, destination_key, remote_id))`);
}

function outboxRow(event: DomainEvent<object>) {
  return { id: event.id, workspace_id: event.workspaceId, event_json: JSON.stringify(event), status: 'pending',
    next_attempt_at: later, last_error: null, created_at: event.occurredAt };
}

function job(id: string, workspaceId: string, submissionId: string, bindingId: string,
  { reference = false, occurredAt = start, formId = 'form-1' } = {}): DomainEvent<FormDeliveryQueuedJob> {
  const form = { slug: 'visit', fields: [{ name: 'email', required: true }] };
  const binding = { bindingId, adapterId: 'spreadsheet', connectionRef: 'owner-connection', enabled: true, config: {} };
  return { id, name: FORM_DELIVERY_EVENT, workspaceId, aggregateId: submissionId, occurredAt, payload: {
    binding, idempotencyKey: `${submissionId}:${bindingId}`,
    ...(reference ? { form, submissionRef: { submissionId, formId } } :
      { snapshot: { form, submission: { id: submissionId, answers: { email: 'visitor@example.test' }, submittedAt: start } } }),
  } };
}

const identity = { workspaceId: 'west', submissionId: 'submission-1' };

function save(repo: SqlFormDeliveryRepo, plan: FormDeliveryPlan) {
  return repo.once({ workspaceId: plan.workspaceId, submissionId: plan.submissionId, build: async () => plan });
}

describeEachDialect({
  title: 'form delivery persistence',
  options: {
    tables: [...Object.values(tables), pullTable, receiptTable], createTables,
    make: (kernel: ContentKernel) => ({
      kernel,
      delivery: new SqlFormDeliveryRepo({ kernel, tables, outboxRow }),
      lease: new SqlFormPullLeaseRepo({ kernel, table: pullTable }),
      receipts: new SqlFormSubmissionReceiptRepo({ kernel, table: receiptTable }),
    }),
  },
  body(make) {
    test('replay returns the original plan and child events in job-id order without rebuilding', async () => {
      const { delivery } = make();
      const first = job('job-a', 'west', 'submission-1', 'last');
      const second = job('job-z', 'west', 'submission-1', 'first', { reference: true });
      const plan = { ...identity, formId: 'form-1', jobs: [second, first] };
      assert.deepEqual(await save(delivery, plan), plan);
      assert.deepEqual(await delivery.once({ ...identity, build: async () => { throw new Error('replay must not rebuild'); } }),
        { ...identity, formId: 'form-1', jobs: [first, second] });
      const empty = { ...identity, workspaceId: 'east', formId: 'other-form', jobs: [] };
      assert.deepEqual(await save(delivery, empty), empty);
      assert.deepEqual(await delivery.once({ workspaceId: 'east', submissionId: identity.submissionId,
        build: async () => { throw new Error('empty plans are durable too'); } }), empty);
    });

    test('rejects wrong plan and child identities and can retry after a partial insert fails', async () => {
      const { delivery, kernel } = make();
      const child = job('job-valid', 'west', 'submission-1', 'target');
      const invoke = (plan: FormDeliveryPlan) => delivery.once({ ...identity, build: async () => plan });
      await assert.rejects(invoke({ ...identity, workspaceId: 'east', formId: 'form-1', jobs: [] }), /built plan is for workspace east, submission submission-1, not workspace west, submission submission-1/);
      await assert.rejects(invoke({ ...identity, formId: 'form-1', jobs: [child, job('job-wrong', 'west', 'submission-2', 'target')] }), /child job job-wrong is for workspace west, submission submission-2, not workspace west, submission submission-1/);
      const plan = { ...identity, formId: 'form-1', jobs: [child] };
      await assert.rejects(invoke({ ...plan, jobs: [child, child] }), /unique|duplicate key/i);
      const remaining = await kernel.query<{ id: string }>(sql`select id from app_outbox`);
      assert.deepEqual(remaining, []);
      assert.deepEqual(await invoke(plan), plan);
      assert.deepEqual((await delivery.forSubmission(identity)).map(row => row.bindingId), ['target']);
    });

    test('status reads project only the right workspace and order unfinished jobs by time then id', async () => {
      const { delivery, kernel } = make();
      await save(delivery, { ...identity, formId: 'form-1', jobs: [
        job('job-z', 'west', 'submission-1', 'beta', { occurredAt: later }),
        job('job-a', 'west', 'submission-1', 'alpha'),
        job('job-y', 'west', 'submission-1', 'gamma', { occurredAt: later }),
      ] });
      await save(delivery, { ...identity, workspaceId: 'east', formId: 'east-form', jobs: [job('job-other', 'east', 'submission-1', 'east-binding', { occurredAt: later })] });
      await save(delivery, { ...identity, submissionId: 'submission-2', formId: 'form-2', jobs: [job('job-b', 'west', 'submission-2', 'older')] });
      await kernel.execute(sql`update app_outbox set status = 'delivered', attempts = 1 where id = 'job-a'`);
      await kernel.execute(sql`update app_outbox set attempts = 2, last_error = 'rate-limited' where id = 'job-z'`);
      assert.deepEqual(await delivery.forSubmission(identity), [
        { bindingId: 'alpha', adapterId: 'spreadsheet', formId: 'form-1', submissionId: 'submission-1', status: 'completed', attempts: 1, nextRetryAt: null, errorCode: null },
        { bindingId: 'beta', adapterId: 'spreadsheet', formId: 'form-1', submissionId: 'submission-1', status: 'retrying', attempts: 2, nextRetryAt: later, errorCode: 'rate-limited' },
        { bindingId: 'gamma', adapterId: 'spreadsheet', formId: 'form-1', submissionId: 'submission-1', status: 'pending', attempts: 0, nextRetryAt: null, errorCode: null },
      ]);
      assert.deepEqual((await delivery.recentUnfinished({ workspaceId: 'west' })).map(row => row.bindingId), ['beta', 'gamma', 'older']);
      assert.deepEqual((await delivery.recentUnfinished({ workspaceId: 'west' }, { limit: 1 })).map(row => row.bindingId), ['beta']);
    });

    test('purge scrubs legacy answers and fails only unfinished jobs for the scoped submission or form', async () => {
      const { delivery, kernel } = make();
      await save(delivery, { ...identity, formId: 'form-1', jobs: [
        job('job-pending', 'west', 'submission-1', 'pending'),
        job('job-processing', 'west', 'submission-1', 'processing', { reference: true }),
        job('job-delivered', 'west', 'submission-1', 'delivered'),
        job('job-failed', 'west', 'submission-1', 'failed'),
      ] });
      await save(delivery, { ...identity, submissionId: 'sibling', formId: 'form-1', jobs: [job('job-sibling', 'west', 'sibling', 'sibling')] });
      await save(delivery, { ...identity, workspaceId: 'east', formId: 'form-1', jobs: [job('job-east', 'east', 'submission-1', 'east')] });
      await kernel.execute(sql`update app_outbox set status = 'processing' where id = 'job-processing'`);
      await kernel.execute(sql`update app_outbox set status = 'delivered' where id = 'job-delivered'`);
      await kernel.execute(sql`update app_outbox set status = 'failed', last_error = 'rate-limited' where id = 'job-failed'`);
      async function read() {
        const rows = await kernel.query<{ id: string; status: string; last_error: string | null; event_json: string }>(
          sql`select id, status, last_error, event_json from app_outbox`);
        return Object.fromEntries(rows.map(row => {
          const { payload } = JSON.parse(row.event_json) as DomainEvent<FormDeliveryQueuedJob>;
          return [row.id, [row.status, row.last_error, 'snapshot' in payload ? payload.snapshot.submission.answers : payload.submissionRef]];
        }));
      }
      await delivery.scrubPurged({ workspaceId: 'west', purged: { submissionId: 'submission-1' } });
      const expected = {
        'job-pending': ['failed', 'delivery-failed', {}],
        'job-processing': ['failed', 'delivery-failed', { submissionId: 'submission-1', formId: 'form-1' }],
        'job-delivered': ['delivered', null, {}],
        'job-failed': ['failed', 'rate-limited', {}],
        'job-sibling': ['pending', null, { email: 'visitor@example.test' }],
        'job-east': ['pending', null, { email: 'visitor@example.test' }],
      };
      assert.deepEqual(await read(), expected);
      await delivery.scrubPurged({ workspaceId: 'west', purged: { formId: 'form-1' } });
      assert.deepEqual(await read(), { ...expected, 'job-sibling': ['failed', 'delivery-failed', {}] });
    });

    test('notification summary counts only the selected submission notification ids and workspace', async () => {
      const { delivery, kernel } = make();
      assert.deepEqual(await delivery.notificationSummary(identity), { failed: 0, pending: 0 });
      const rows = [
        ['forms:notify:submission-1:a', 'west', 'pending'], ['forms:notify:submission-1:b', 'west', 'processing'],
        ['forms:notify:submission-1:c', 'west', 'failed'], ['forms:notify:submission-1:d', 'west', 'failed'],
        ['forms:notify:submission-1:e', 'west', 'delivered'], ['forms:notify:submission-1:f', 'east', 'failed'],
        ['forms:notify:submission-11:a', 'west', 'pending'], ['unrelated:submission-1:a', 'west', 'failed'],
      ] as const;
      for (const [id, ws, status] of rows) {
        await kernel.execute(sql`insert into app_outbox (id, workspace_id, event_json, status, created_at, next_attempt_at)
          values (${id}, ${ws}, '{}', ${status}, ${start}, ${later})`);
      }
      assert.deepEqual(await delivery.notificationSummary(identity), { failed: 2, pending: 2 });
    });

    test('lease validation refuses bad clocks or durations before recording a start', async () => {
      const { lease, kernel } = make();
      const args = { workspaceId: 'west', receiverKey: 'receiver-A', token: 'first', nowIso: start, recentMs: 5000, leaseMs: 2000 };
      for (const invalid of [{ nowIso: 'not-a-time' }, { leaseMs: Infinity }, { leaseMs: NaN }, { leaseMs: 0 }, { leaseMs: -1 }]) {
        await assert.rejects(lease.claim({ ...args, ...invalid }), { name: 'RangeError', message: /nowIso must be an ISO time and leaseMs a positive finite number/ });
      }
      assert.deepEqual(await kernel.query(sql`select receiver_key from receiver_leases`), []);
      assert.deepEqual(await lease.claim(args), { claimed: true });
    });

    test('lease priority, exact expiry, manual pulls and stale token release preserve receiver ownership', async () => {
      const { lease } = make();
      const key = { workspaceId: 'west', receiverKey: 'receiver-A' };
      const request = { ...key, token: 'first', nowIso: start, recentMs: 5000, leaseMs: 2000 };
      assert.deepEqual(await lease.claim(request), { claimed: true });
      assert.deepEqual(await lease.claim({ ...request, token: 'second', nowIso: '2026-11-20T12:00:01.999Z' }), { claimed: false, reason: 'already-running' });
      const atExpiry = { ...request, token: 'second', nowIso: '2026-11-20T12:00:02.000Z' };
      assert.deepEqual(await lease.claim(atExpiry), { claimed: false, reason: 'recent' });
      assert.deepEqual(await lease.claim({ ...atExpiry, recentMs: 0 }), { claimed: true });
      assert.deepEqual(await lease.claim({ ...request, workspaceId: 'east' }), { claimed: true });
      assert.deepEqual(await lease.claim({ ...request, receiverKey: 'receiver-B' }), { claimed: true });
      await lease.release({ ...key, token: 'first' });
      assert.deepEqual(await lease.claim({ ...atExpiry, token: 'third', recentMs: 0 }), { claimed: false, reason: 'already-running' });
      await lease.release({ ...key, token: 'second' });
      assert.deepEqual(await lease.claim({ ...atExpiry, token: 'third' }), { claimed: false, reason: 'recent' });
      assert.deepEqual(await lease.claim({ ...atExpiry, token: 'third', nowIso: '2026-11-20T12:00:07.000Z' }), { claimed: true });
    });

    test('receipts dedupe by workspace, destination and remote id without replacing the first receipt', async () => {
      const { receipts, kernel } = make();
      const first = { workspaceId: 'west', destinationKey: 'primary', remoteId: 'remote-7', submissionId: 'local-1', importedAt: start };
      assert.equal(await receipts.claim(first), true);
      assert.equal(await receipts.claim({ ...first, submissionId: 'local-replacement', importedAt: later }), false);
      assert.equal(await receipts.claim({ ...first, workspaceId: 'east', submissionId: 'local-east' }), true);
      assert.equal(await receipts.claim({ ...first, destinationKey: 'secondary', submissionId: 'local-secondary' }), true);
      assert.equal(await receipts.claim({ ...first, remoteId: 'remote-8', submissionId: 'local-new' }), true);
      assert.deepEqual(await kernel.query(sql`select submission_id, imported_at from remote_receipts
        where workspace_id = 'west' and destination_key = 'primary' and remote_id = 'remote-7'`),
        [{ submission_id: 'local-1', imported_at: start }]);
    });

    test('a failed ambient import transaction leaves the remote row eligible for another import', async () => {
      const { receipts, kernel } = make();
      const input = { workspaceId: 'west', destinationKey: 'primary', remoteId: 'remote-7', submissionId: 'retry', importedAt: start };
      const failure = new Error('submission insert failed');
      await assert.rejects(kernel.transaction(async () => {
        assert.equal(await receipts.claim(input), true);
        throw failure;
      }), error => error === failure);
      assert.equal(await receipts.claim({ ...input, importedAt: later }), true);
      assert.deepEqual(await kernel.query(sql`select submission_id, imported_at from remote_receipts`),
        [{ submission_id: 'retry', imported_at: later }]);
    });
  },
});
