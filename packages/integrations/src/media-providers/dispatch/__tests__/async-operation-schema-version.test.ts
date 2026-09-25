import { describe, expect, it } from 'vitest';

import {
  ASYNC_OPERATION_SCHEMA_VERSION,
  createInMemoryAsyncOperationStore,
  hydrateAsyncOperationRecord,
} from '../async-operation-store.js';

const BASE = {
  id: 'op-1',
  providerId: 'imagerouter',
  routeKey: 'video',
  ownerRef: 'run-1',
  maxAttempts: 5,
  deadlineAt: 10_000,
} as const;

describe('async operation schema versioning', () => {
  it('stamps every persisted row with the current schema version', async () => {
    const store = createInMemoryAsyncOperationStore();
    const row = await store.create(BASE);

    expect(row.schemaVersion).toBe(ASYNC_OPERATION_SCHEMA_VERSION);
    expect(ASYNC_OPERATION_SCHEMA_VERSION).toBe(1);
  });

  it('keeps the stamped version stable across updates', async () => {
    const store = createInMemoryAsyncOperationStore();
    await store.create(BASE);
    const updated = await store.update('op-1', { status: 'polling' });

    expect(updated?.schemaVersion).toBe(ASYNC_OPERATION_SCHEMA_VERSION);
  });

  it('hydrates a row written at the current version', () => {
    const row = hydrateAsyncOperationRecord({ ...BASE, schemaVersion: 1, status: 'polling', attempts: 2 });

    expect(row.status).toBe('polling');
    expect(row.attempts).toBe(2);
    expect(row.schemaVersion).toBe(1);
  });

  it('treats a row with no version as v0 legacy and upgrades it on read, never discarding it', () => {
    // The pre-versioning shape: exactly what a row written before this discriminator existed
    // looks like. A later shape change must be a branching read, not a data rescue.
    const row = hydrateAsyncOperationRecord({ ...BASE, status: 'polling', attempts: 2 });

    expect(row.schemaVersion).toBe(ASYNC_OPERATION_SCHEMA_VERSION);
    expect(row.status).toBe('polling');
  });

  it('refuses to silently misread a row written by a NEWER version', () => {
    expect(() => hydrateAsyncOperationRecord({ ...BASE, schemaVersion: 99, status: 'polling' })).toThrow(
      'async operation row was written at schema version 99, newer than this build understands (1) — upgrade rather than risk misreading it',
    );
  });
});
