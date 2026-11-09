/**
 * @file The smallest port implementations the cms services need. Clock, ids, the content-type
 * repo, the change-set repo, the entry-outbox wrapper and the rate limiter come from Jini; everything marked
 * `// GAP:` is hand-written here because no public in-memory/no-op version exists.
 */
import { createRandomUuidGenerator, createSystemClock } from '@jini-ai/core/primitives';
import { createMemoryCounterStore, createRateLimiter } from '@jini-ai/http-kit/rate-limit';
import { InMemoryContentTypeRepo } from '@jini-ai/cms/content-types';
import { InMemoryChangeSetRepo } from '@jini-ai/cms/core/commands';
import { toEntryOutbox, type AuthorizeFn } from '@jini-ai/cms/entries';
import type { DomainEvent } from '@jini-ai/cms/core';
import type { FormOutboxPort, OutboxDispatcherPort } from '@jini-ai/cms/forms';

export const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
export const OWNER_ID = 'local-owner';
export const NOTE_TYPE = 'note';

// GAP: no allow-all / single-owner AuthorizationPort. The app has one local owner and no login.
export const authorize: AuthorizeFn = async ({ principalId }) =>
  principalId === OWNER_ID ? { allowed: true, reason: 'local owner' } : { allowed: false, reason: 'not the local owner' };

// GAP: no in-memory outbox that keeps DomainEvents; events are kept for this process only.
export function createMemoryOutbox(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const events: DomainEvent[] = [];
  const outbox: FormOutboxPort = { enqueue: async (event) => { events.push(event); } };
  return { outbox, events };
}

// GAP: no no-op OutboxDispatcherPort. Nothing consumes events in this app.
export const noopDispatcher: OutboxDispatcherPort = { dispatch: async () => {} };

export async function createAppPorts(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const clock = createSystemClock();
  const idGen = createRandomUuidGenerator();
  const { outbox, events } = createMemoryOutbox();

  // Content types are app configuration, registered at every boot (no persisted content-type repo needed).
  const contentTypeRepo = new InMemoryContentTypeRepo();
  await contentTypeRepo.save({ workspaceId: WORKSPACE_ID, key: NOTE_TYPE, label: 'Note', fields: [], status: 'active', version: 1 });

  return {
    clock,
    idGen,
    outbox,
    events,
    contentTypeRepo,
    // In memory: change sets are an undo log for the form-definition command; not needed across restarts here.
    changeSets: new InMemoryChangeSetRepo(),
    entryOutbox: toEntryOutbox({ outbox, clock, idGen, workspaceId: WORKSPACE_ID }),
    // http-kit's limiter is framework-free and sweeps expired keys, so the map cannot grow without bound.
    rateLimiter: createRateLimiter({ profile: { windowSeconds: 60, max: 30, burst: 0 }, clock, store: createMemoryCounterStore({}) }),
    dispatcher: noopDispatcher,
    logger: { warn: (...args: unknown[]) => console.warn('[notes-app]', ...args) },
  };
}
