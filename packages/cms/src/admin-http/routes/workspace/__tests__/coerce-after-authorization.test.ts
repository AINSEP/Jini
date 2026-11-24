import { describe, expect, it } from 'vitest';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';

import { InMemoryWorkspaceRepo } from '../../../../workspace/index.js';
import { workspaceCreateRoute, type WorkspaceCreateRouteDeps } from '../create.js';
import { workspaceUpdateRoute } from '../update.js';

/** A JSON-reachable body field whose string coercion throws (`String({ toString: 1 })` is a
 *  TypeError): if coercion ran in `parse`, a denied caller would reach the failure mapper before
 *  the permission gate ever answered. */
const HOSTILE = { toString: 1 };

function deps(): WorkspaceCreateRouteDeps {
  return {
    workspaceId: 'ws-1',
    workspaceRepo: new InMemoryWorkspaceRepo({}, { initialRows: [] }),
    idGen: { newId: () => 'id-1' },
    clock: { nowMs: () => 0 },
    outbox: { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} },
    flushOutbox: async () => {},
  };
}

async function deniedAnswer(route: typeof workspaceCreateRoute | typeof workspaceUpdateRoute, body: unknown): Promise<{ answer: unknown; calls: unknown[] }> {
  const calls: unknown[] = [];
  const authorize = async (args: { permission: string; entityType: string }) => {
    calls.push(args);
    throw new RouteRefusalError({ status: 403, body: { error: 'denied' } });
  };
  const spec = route as unknown as { parse: (raw: unknown) => { ok: boolean; value?: unknown }; handle: (args: unknown) => Promise<unknown> };
  const answer = await (async () => {
    const parsed = spec.parse({ body, query: {}, params: { workspaceId: 'ws-1' } });
    if (!parsed.ok) throw new Error('parse must be total');
    return spec.handle({ input: parsed.value, deps: deps(), context: { id: 'p-1' }, authorize });
  })().then(() => undefined, (error: unknown) => (error instanceof RouteRefusalError ? error.response : error));
  return { answer, calls };
}

describe('workspace write routes coerce the body only after authorization', () => {
  for (const [label, route] of [['create', workspaceCreateRoute], ['update', workspaceUpdateRoute]] as const) {
    it(`${label}: a denied caller with an uncoercible field gets the 403, not a coercion failure`, async () => {
      for (const body of [{ name: HOSTILE }, { slug: HOSTILE }]) {
        const { answer, calls } = await deniedAnswer(route, body);
        expect(answer).toEqual({ status: 403, body: { error: 'denied' } });
        expect(calls).toEqual([{ permission: 'workspace.manage', entityType: 'workspace' }]);
      }
    });
  }
});
