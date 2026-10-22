import assert from "node:assert/strict";
import { test } from "vitest";

import { type DatabaseContextEnvelope, resolveDeepLinkContext } from "../../recovery/deep-link.js";

/** @file INV-04: an envelope's ids are display continuity only; every id is re-looked-up server-side. */

function envelope(restorePointId: string | null): DatabaseContextEnvelope {
  return {
    v: 1,
    correlationId: "corr-1",
    siteId: "site",
    ledgerEventId: null,
    restorePointId,
    drift: "none",
    intent: "view",
    issuedAt: "2026-10-01T00:00:00.000Z",
  };
}

function lookup(points: Record<string, string>) {
  const asked: string[] = [];
  return {
    asked,
    port: {
      findRestorePointById: async (id: string) => {
        asked.push(id);
        const capturedAt = points[id];
        return capturedAt === undefined ? null : { restorePointId: id, capturedAt };
      },
    },
  };
}

const input = (env: DatabaseContextEnvelope) => ({ principalId: "user-1", principalKind: "user" as const, envelope: env });

test("an envelope with no restore point resolves to not-found without a lookup", async () => {
  for (const restorePointId of [null, ""]) {
    const { asked, port } = lookup({ rp1: "2026-09-01T00:00:00.000Z" });
    assert.deepEqual(await resolveDeepLinkContext({ deps: { lookup: port }, input: input(envelope(restorePointId)) }), {
      found: false,
      restorePoint: null,
    });
    assert.deepEqual(asked, []);
  }
});

test("a forged or pruned restore point id resolves to not-found, never to the envelope's claim", async () => {
  const { asked, port } = lookup({ rp1: "2026-09-01T00:00:00.000Z" });
  const forged = envelope("01HZZZZZZZZZZZZZZZZZZZZZZZ");

  assert.deepEqual(await resolveDeepLinkContext({ deps: { lookup: port }, input: input(forged) }), { found: false, restorePoint: null });
  assert.deepEqual(asked, ["01HZZZZZZZZZZZZZZZZZZZZZZZ"]);
});

test("a known restore point resolves to the server's own record, and the envelope is left untouched", async () => {
  const { port } = lookup({ rp1: "2026-09-01T00:00:00.000Z" });
  const env = envelope("rp1");
  const before = structuredClone(env);

  const resolved = await resolveDeepLinkContext({ deps: { lookup: port }, input: input(env) }, {});

  assert.deepEqual(resolved, { found: true, restorePoint: { restorePointId: "rp1", capturedAt: "2026-09-01T00:00:00.000Z" } });
  assert.deepEqual(env, before);
});
