import assert from "node:assert/strict";
import { test } from "vitest";

import { createVerifiedOrigin, InMemoryOriginSettingRepo, OriginRegistry } from "@jini-ai/core/contracts/server/verified-origin";
import { createRepoPublishHandler } from "../../../publish/content/repo-handler.js";
import type { PublishContentHandler } from "../../../publish/content/type-registry.js";
import { PublishContentApplyRowError } from "../../../publish/transfer/index.js";
import { InMemoryOutbox } from "../../__tests__/support/events.fixture.js";
import { redirectMatcher } from "../../matcher.js";
import { InMemoryRedirectRepo } from "../../repo.memory.js";
import type { RedirectsWriteDeps } from "../../redirects.js";
import type { RedirectRecord } from "../../types.js";
import { contributeRedirectPublish } from "../publish-content.js";

/**
 * @file The redirect contribution through the REAL repo-backed publish handler: a destination rule
 * that sits in the Trash is refused by `updateRedirect`'s own liveness guard, and that refusal comes
 * out of the handler as a `blocked` row (not an aborted run, not a restore), so the rows after it
 * still apply.
 */

const WORKSPACE_ID = "workspace-1";

function seed(overrides: Partial<RedirectRecord>): RedirectRecord {
  return { id: "seed", workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/seed", toTarget: "/seed-target", statusCode: 301,
    status: "active", override: false, priority: 0, source: "manual", createdByPrincipal: "u",
    createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z", version: 1, ...overrides };
}

function makeDeps(
  { repo, trashedIds, restoreCalls }: { repo: InMemoryRedirectRepo; trashedIds: ReadonlySet<string>; restoreCalls: string[] },
): RedirectsWriteDeps {
  const originRepo = new InMemoryOriginSettingRepo({ seeds: [{
    workspaceId: WORKSPACE_ID,
    origin: createVerifiedOrigin({ scheme: "https", host: "trusted.example", verifiedAt: "2026-07-13T00:00:00.000Z", source: "workspace-setting" }),
    redirectAllowlist: [],
  }] });
  return {
    reservedSegments: new Set(["admin", "api"]),
    repo,
    remove: async () => ({ ok: true, version: null }),
    isInTrash: async ({ id }) => trashedIds.has(id),
    restore: async ({ id }) => { restoreCalls.push(id); return "restored"; },
    db: repo,
    transaction: async (fn) => fn(),
    matcher: redirectMatcher,
    originRegistry: new OriginRegistry({ repo: originRepo }),
    clock: { nowMs: () => Date.parse("2026-07-14T00:00:00.000Z") },
    idGen: { newId: () => "unused" },
    outbox: new InMemoryOutbox(),
  };
}

function buildHandler(deps: RedirectsWriteDeps): PublishContentHandler {
  const contributor = contributeRedirectPublish({
    // The host passes its own factory; the engine's real one stands in for it here.
    createRepoPublishHandler: (config) => createRepoPublishHandler(config as unknown as Parameters<typeof createRepoPublishHandler>[0]),
    redirectsTable: "site_redirects",
  });
  return contributor.build({
    workspaceId: WORKSPACE_ID,
    clock: deps.clock,
    idGen: { newId: () => "cs" },
    ports: { redirect: deps },
  } as never);
}

const packed = (fromPattern: string, toTarget: string) => ({
  entityType: "redirect",
  id: `exact:${fromPattern}`,
  schemaVersion: 1,
  contentHash: "h",
  hashVersion: 1,
  requiredBlobs: [],
  state: { matchType: "exact", fromPattern, toTarget, statusCode: 301, status: "active", override: false, priority: 0 },
});

test("a trashed destination redirect is blocked and the next publish row still applies", async () => {
  const repo = new InMemoryRedirectRepo();
  await repo.insertRedirect(seed({ id: "trashed-rule", fromPattern: "/gone", toTarget: "/was", status: "disabled", version: 3 }));
  await repo.insertRedirect(seed({ id: "live-rule", fromPattern: "/live", toTarget: "/old", version: 1 }));
  const restoreCalls: string[] = [];
  const deps = makeDeps({ repo, trashedIds: new Set(["trashed-rule"]), restoreCalls });
  const handler = buildHandler(deps);

  const blocked = await handler.apply({ entity: packed("/gone", "/incoming") as never, expectedVersion: 3, principalId: "u", idempotencyKey: "k1" })
    .then(() => null, (err: unknown) => err);
  assert.ok(blocked instanceof PublishContentApplyRowError, `expected a mapped row outcome, got ${String(blocked)}`);
  assert.equal(blocked.rowOutcome, "blocked");
  assert.match(blocked.message, /redirect 'trashed-rule' is in the Trash/);
  // Publish never restores a trashed rule, and the trashed row is left exactly as it was.
  assert.deepEqual(restoreCalls, []);
  const untouched = await repo.findById({ workspaceId: WORKSPACE_ID, id: "trashed-rule" });
  assert.equal(untouched?.toTarget, "/was");
  assert.equal(untouched?.version, 3);
  assert.deepEqual(repo.listRevisionsForTests({ redirectId: "trashed-rule" }), []);

  const next = await handler.apply({ entity: packed("/live", "/new") as never, expectedVersion: 1, principalId: "u", idempotencyKey: "k2" });
  assert.equal(next.changeSetId, "live-rule");
  const applied = await repo.findById({ workspaceId: WORKSPACE_ID, id: "live-rule" });
  assert.equal(applied?.toTarget, "/new");
  assert.equal(applied?.version, 2);
});
