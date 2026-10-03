import { partitionArgs } from '../../../args.js';
import { describe, expect, it } from 'vitest';

import {
  createInMemoryAsyncOperationStore,
  CREDENTIAL_IN_STATE_MESSAGE,
} from '../async-operation-store.js';

const BASE = {
  id: 'op-1',
  providerId: 'imagerouter',
  routeKey: 'video',
  ownerRef: 'run-1',
  maxAttempts: 5,
  deadlineAt: 10_000,
  nextPollAt: 0,
} as const;

describe('createInMemoryAsyncOperationStore', () => {
    it('persists a new operation as "submitted" carrying both independent bounds', async () => {
        const store = createInMemoryAsyncOperationStore();
        const row = await store.create(...partitionArgs(BASE, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]));
        expect(row.status).toBe('submitted');
        expect(row.attempts).toBe(0);
        // Two independent bounds, both required (consensus-report "Settled" #3).
        expect(row.maxAttempts).toBe(5);
        expect(row.deadlineAt).toBe(10000);
        expect(row.leaseOwner).toBeNull();
    });
    it('refuses to persist credential material in the operation state', async () => {
        const store = createInMemoryAsyncOperationStore();
        await expect(store.create(...partitionArgs({ ...BASE, state: { jobId: 'j1', apiKey: 'sk-live-123' } }, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]))).rejects.toThrow(CREDENTIAL_IN_STATE_MESSAGE);
    });
    it('refuses to smuggle credential material in on a later update', async () => {
        const store = createInMemoryAsyncOperationStore();
        await store.create(...partitionArgs(BASE, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]));
        await expect(store.update({ id: 'op-1', patch: { state: { authorization: 'Bearer sk-live-123' } } })).rejects.toThrow(CREDENTIAL_IN_STATE_MESSAGE);
    });
    it('rejects a credential-shaped key the old denylist missed (clientSecret)', async () => {
        // Regression for the concrete bypass: `CREDENTIAL_KEY_PATTERN` never matched `clientSecret` /
        // `client_secret`, so an adapter returning `{jobId, clientSecret}` cloned the secret straight
        // into durable state. The fix replaced the denylist with an allowlist of the shapes this
        // package's adapters actually emit, so this is rejected for not being `jobId` — not because
        // the key name was pattern-matched as "credential-shaped".
        const store = createInMemoryAsyncOperationStore();
        await expect(store.create(...partitionArgs({ ...BASE, state: { jobId: 'job-77', clientSecret: 'vendor-secret' } }, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]))).rejects.toThrow(CREDENTIAL_IN_STATE_MESSAGE);
    });
    it('rejects a non-allowlisted key buried past the depth bound instead of silently skipping it', async () => {
        // Regression: the walk's depth guard used to return silently once `depth > 12`, so a
        // credential-shaped key nested 13+ levels deep was never checked against the allowlist at
        // all — the object was accepted with the secret intact.
        const store = createInMemoryAsyncOperationStore();
        let buried: Record<string, unknown> = { secretApiToken: 'sk-live-buried-secret' };
        for (let i = 0; i < 13; i += 1)
            buried = { jobId: buried };
        await expect(store.create(...partitionArgs({ ...BASE, state: buried }, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]))).rejects.toThrow(CREDENTIAL_IN_STATE_MESSAGE);
    });
    it('rejects ANY key outside the resumption-handle allowlist, not just names that look like credentials', async () => {
        // Proves the mechanism is a fail-closed allowlist, not a wider denylist that would rot the
        // same way: an entirely innocuous-looking, non-credential-shaped key is rejected too, because
        // it was never registered as a legitimate resumption-handle field.
        const store = createInMemoryAsyncOperationStore();
        await expect(store.create(...partitionArgs({ ...BASE, state: { jobId: 'job-77', someBrandNewVendorField: 'anything' } }, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]))).rejects.toThrow(CREDENTIAL_IN_STATE_MESSAGE);
    });
    it('claims only operations that are due and unleased', async () => {
        const store = createInMemoryAsyncOperationStore();
        await store.create(...partitionArgs({ ...BASE, id: 'due', nextPollAt: 100 }, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]));
        await store.create(...partitionArgs({ ...BASE, id: 'not-due', nextPollAt: 900 }, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]));
        const claimed = await store.claimDue(...partitionArgs({ now: 500, leaseOwner: 'w1', leaseMs: 1000 }, ["now", "leaseOwner", "leaseMs"]));
        expect(claimed.map((r) => r.id)).toEqual(['due']);
    });
    it('leases exclusively — a second worker cannot claim the same row', async () => {
        const store = createInMemoryAsyncOperationStore();
        await store.create(...partitionArgs({ ...BASE, id: 'due', nextPollAt: 0 }, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]));
        const first = await store.claimDue(...partitionArgs({ now: 500, leaseOwner: 'w1', leaseMs: 1000 }, ["now", "leaseOwner", "leaseMs"]));
        const second = await store.claimDue(...partitionArgs({ now: 500, leaseOwner: 'w2', leaseMs: 1000 }, ["now", "leaseOwner", "leaseMs"]));
        expect(first.map((r) => r.id)).toEqual(['due']);
        expect(second).toEqual([]);
    });
    it('lets another worker reclaim a row whose lease has expired', async () => {
        const store = createInMemoryAsyncOperationStore();
        await store.create(...partitionArgs({ ...BASE, id: 'due', nextPollAt: 0 }, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]));
        await store.claimDue(...partitionArgs({ now: 500, leaseOwner: 'w1', leaseMs: 1000 }, ["now", "leaseOwner", "leaseMs"]));
        const reclaimed = await store.claimDue(...partitionArgs({ now: 2000, leaseOwner: 'w2', leaseMs: 1000 }, ["now", "leaseOwner", "leaseMs"]));
        expect(reclaimed.map((r) => r.id)).toEqual(['due']);
        expect(reclaimed[0]!.leaseOwner).toBe('w2');
    });
    it('fences lease release on ownership — a late release from the previous owner must not clear a lease another worker has since reclaimed', async () => {
        // Regression for the unfenced release: worker A takes a short lease and keeps working past
        // it; worker B legitimately reclaims the expired lease; A finishes late and releases using
        // its OWN identity. The release must be a no-op because A no longer owns the row.
        const store = createInMemoryAsyncOperationStore();
        await store.create(...partitionArgs({ ...BASE, id: 'due', nextPollAt: 0 }, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]));
        await store.claimDue(...partitionArgs({ now: 0, leaseOwner: 'worker-A', leaseMs: 10 }, ["now", "leaseOwner", "leaseMs"]));
        const reclaimed = await store.claimDue(...partitionArgs({ now: 11, leaseOwner: 'worker-B', leaseMs: 1000 }, ["now", "leaseOwner", "leaseMs"]));
        expect(reclaimed.map((r) => r.id)).toEqual(['due']);
        // A's late, stale release — using the leaseOwner it actually held, not B's.
        await store.releaseLease({ id: 'due', leaseOwner: 'worker-A' });
        const row = await store.get({ id: 'due' });
        expect(row?.leaseOwner).toBe('worker-B');
        expect(row?.leaseExpiresAt).not.toBeNull();
        // The single-worker guarantee: a third worker must not be able to claim the row while B's
        // lease, which A's stale release did not touch, is still live.
        const stolen = await store.claimDue(...partitionArgs({ now: 12, leaseOwner: 'worker-C', leaseMs: 1000 }, ["now", "leaseOwner", "leaseMs"]));
        expect(stolen).toEqual([]);
    });
    it('lets the current owner release its own lease normally', async () => {
        const store = createInMemoryAsyncOperationStore();
        await store.create(...partitionArgs({ ...BASE, id: 'due', nextPollAt: 0 }, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]));
        await store.claimDue(...partitionArgs({ now: 0, leaseOwner: 'worker-A', leaseMs: 1000 }, ["now", "leaseOwner", "leaseMs"]));
        await store.releaseLease({ id: 'due', leaseOwner: 'worker-A' });
        const row = await store.get({ id: 'due' });
        expect(row?.leaseOwner).toBeNull();
        expect(row?.leaseExpiresAt).toBeNull();
    });
    it('never claims a terminal operation', async () => {
        const store = createInMemoryAsyncOperationStore();
        await store.create(...partitionArgs({ ...BASE, id: 'done', nextPollAt: 0 }, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]));
        await store.update({ id: 'done', patch: { status: 'succeeded' } });
        expect(await store.claimDue(...partitionArgs({ now: 5000, leaseOwner: 'w1', leaseMs: 1000 }, ["now", "leaseOwner", "leaseMs"]))).toEqual([]);
    });
    it('rejects an illegal lifecycle transition with the exact table-driven message', async () => {
        const store = createInMemoryAsyncOperationStore();
        await store.create(...partitionArgs(BASE, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]));
        await store.update({ id: 'op-1', patch: { status: 'succeeded' } });
        await expect(store.update({ id: 'op-1', patch: { status: 'polling' } })).rejects.toThrow('Invalid async operation transition: "succeeded" -> "polling"');
    });
    it('releases expired leases on boot WITHOUT terminating in-flight work', async () => {
        const store = createInMemoryAsyncOperationStore();
        await store.create(...partitionArgs({ ...BASE, id: 'inflight', nextPollAt: 0 }, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]));
        await store.update({ id: 'inflight', patch: { status: 'polling' } });
        await store.claimDue(...partitionArgs({ now: 0, leaseOwner: 'dead-process', leaseMs: 1000 }, ["now", "leaseOwner", "leaseMs"]));
        const result = await store.reconcileOnBoot({ now: 9000 });
        const row = await store.get({ id: 'inflight' });
        // The whole point of the durable row: a crash must leave resumable work,
        // not work marked dead the way `MediaTaskStore.reconcileOnBoot` does.
        expect(result.leasesReleased).toBe(1);
        expect(row?.status).toBe('polling');
        expect(row?.leaseOwner).toBeNull();
    });
    it('marks an operation past its absolute deadline as unknown on boot, not succeeded', async () => {
        const store = createInMemoryAsyncOperationStore();
        await store.create(...partitionArgs({ ...BASE, id: 'expired', nextPollAt: 0, deadlineAt: 1000 }, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]));
        await store.update({ id: 'expired', patch: { status: 'polling' } });
        const result = await store.reconcileOnBoot({ now: 50000 });
        expect(result.deadlineExpired).toBe(1);
        expect((await store.get({ id: 'expired' }))?.status).toBe('unknown');
    });
    it('fences update() on lease ownership — a stale worker cannot overwrite the row a newer owner already claimed', async () => {
        // Regression: `update` previously took no ownership check at all (only `releaseLease` did),
        // so a worker whose lease was reclaimed by another worker could still clobber whatever that
        // newer owner had already written.
        const store = createInMemoryAsyncOperationStore();
        await store.create(...partitionArgs({ ...BASE, id: 'due', nextPollAt: 0 }, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]));
        await store.claimDue(...partitionArgs({ now: 0, leaseOwner: 'worker-A', leaseMs: 10 }, ["now", "leaseOwner", "leaseMs"]));
        await store.claimDue(...partitionArgs({ now: 100, leaseOwner: 'worker-B', leaseMs: 1000 }, ["now", "leaseOwner", "leaseMs"]));
        await store.update({ id: 'due', patch: { status: 'polling', attempts: 7 } }, { options: { leaseOwner: 'worker-B' } });
        // Worker A's late write, fenced on the lease it (no longer) holds, must be a no-op.
        const result = await store.update({ id: 'due', patch: { status: 'polling', attempts: 1 } }, { options: { leaseOwner: 'worker-A' } });
        const row = await store.get({ id: 'due' });
        expect(row?.attempts).toBe(7);
        expect(result?.attempts).toBe(7); // returns the current row unchanged, not an error
    });
    it('applies an update unconditionally when no leaseOwner fence is given, preserving the pre-lease write path', async () => {
        const store = createInMemoryAsyncOperationStore();
        await store.create(...partitionArgs({ ...BASE, id: 'op-1' }, ["id", "providerId", "routeKey", "ownerRef", "maxAttempts", "deadlineAt"]));
        // No lease has ever been claimed on this row (mirrors startOperation's pre-claim persistence).
        const result = await store.update({ id: 'op-1', patch: { status: 'polling', attempts: 3 } });
        expect(result?.attempts).toBe(3);
        expect((await store.get({ id: 'op-1' }))?.status).toBe('polling');
    });
});
