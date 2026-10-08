import assert from "node:assert/strict";
import { test } from "vitest";

import { randomUUID } from "node:crypto";

import { SqlRedirectRepo } from "../sql/repo.js";
import { eachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import { createTables } from "./support/redirects-tables.fixture.js";

import { InMemoryOutbox } from "./support/events.fixture.js";
import { createVerifiedOrigin, InMemoryOriginSettingRepo, OriginRegistry } from "@jini-ai/http-kit/verified-origin";
import { REDIRECT_ENTITY_TYPE, removeEntityWithoutBlocker } from "./support/trash.fixture.js";
import { createTrashService, InMemoryTrashRepo, createRecordStoreTrashAdapter } from "../../trash/index.js";
import type { TrashAdapter } from "../../trash/index.js";
import { redirectMatcher } from "../matcher.js";
import type { RedirectDbHandle } from "../ports.internal.js";
import { InMemoryRedirectRepo } from "../repo.memory.js";
import {
  createRedirect,
  importRedirects,
  tombstoneRedirect,
  updateRedirect,
  type RedirectsWriteDeps,
} from "../redirects.js";
import {
  RedirectConflictError,
  RedirectLoopError,
  RedirectNotFoundError,
  RedirectTargetNotAllowedError,
  RedirectValidationError,
} from "../types.js";
import type { CreateRedirectInput, RedirectRecord, RedirectStatus } from "../types.js";
import { isNeverInTrash, removeVia, restoreVia } from "./remove-redirect-double.js";

/**
 * @file T008 — the write chokepoint (`redirects.ts`): validate-before-write
 * ordering, write-path open-redirect rejection (REQ-08/AC-10/11), one-hop
 * collapse (AC-16) + cycle rejection (AC-17), `matchType:'regex'` always
 * rejected (AC-27), partial-success import batch (AC-31), INV-01/04/05/07.
 */

const WORKSPACE_ID = "workspace-1";
const ACTOR_ID = "user-1";

function makeDeps(opts: { redirectAllowlist?: string[] } = {}): RedirectsWriteDeps {
  const repo = new InMemoryRedirectRepo();
  const originRepo = new InMemoryOriginSettingRepo({ seeds: [
    {
      workspaceId: WORKSPACE_ID,
      origin: createVerifiedOrigin({
        scheme: "https",
        host: "trusted.example",
        verifiedAt: "2026-07-13T00:00:00.000Z",
        source: "workspace-setting",
      }),
      redirectAllowlist: opts.redirectAllowlist ?? [],
    },
  ] });
  let clockTick = 0;
  let idTick = 0;
  return { reservedSegments: new Set(["admin", "api"]),
    repo,
    remove: removeVia(repo as unknown as Parameters<typeof removeVia>[0]),
    isInTrash: isNeverInTrash,
    restore: restoreVia(repo as unknown as Parameters<typeof removeVia>[0]),
    db: repo as unknown as RedirectDbHandle,
    transaction: async (fn) => fn(),
    matcher: redirectMatcher,
    originRegistry: new OriginRegistry({ repo: originRepo }),
    clock: { nowMs: () => Date.parse("2026-07-13T00:00:00.000Z") + 1000 * clockTick++ },
    idGen: { newId: () => `redirect-${++idTick}` },
    outbox: new InMemoryOutbox(),
  };
}

// ---------------------------------------------------------------------------
// createRedirect — validation ordering, AC-01/02/03/06/07/08/09
// ---------------------------------------------------------------------------

test("createRedirect writes a record + a same-tx revision (INV-01, AC-01)", async () => {
  const deps = makeDeps();
  const { record } = await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/old",
      toTarget: "/new",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });

  assert.equal(record.fromPattern, "/old");
  assert.equal(record.status, "active");
  assert.equal(record.version, 1);
  const repo = deps.repo as InMemoryRedirectRepo;
  const revisions = repo.listRevisionsForTests({ redirectId: record.id }, {});
  assert.equal(revisions.length, 1);
  assert.ok(revisions[0]);
  assert.equal(revisions[0].seq, 1);
  assert.deepEqual(revisions, [{ redirectId: record.id, workspaceId: WORKSPACE_ID, seq: 1,
    state: record, tombstoned: false, actorId: ACTOR_ID, pluginId: undefined, recordedAt: record.createdAt }]);
});

test("createRedirect defaults override:false and priority:0 (behavior.spec.md §3)", async () => {
  const deps = makeDeps();
  const { record } = await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/old",
      toTarget: "/new",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });
  assert.equal(record.override, false);
  assert.equal(record.priority, 0);
  assert.equal(record.source, "manual");
});

test("AC-27/INV-05: matchType 'regex' is always rejected with REDIRECT_VALIDATION_ERROR, even before any other check", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      createRedirect({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          matchType: "regex",
          fromPattern: "/a.*",
          toTarget: "/b",
          statusCode: 301,
          actorId: ACTOR_ID,
        },
      }),
    RedirectValidationError
  );
  assert.deepEqual(await deps.repo.list({ workspaceId: WORKSPACE_ID }), []);
});

test("createRedirect rejects a fromPattern outside the 1-2048 length bound", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      createRedirect({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          matchType: "exact",
          fromPattern: "/" + "a".repeat(2048),
          toTarget: "/b",
          statusCode: 301,
          actorId: ACTOR_ID,
        },
      }),
    RedirectValidationError
  );
  assert.deepEqual(await deps.repo.list({ workspaceId: WORKSPACE_ID }), []);
});

test("createRedirect rejects a priority outside 0-1000 (not silently clamped)", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      createRedirect({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          matchType: "exact",
          fromPattern: "/a",
          toTarget: "/b",
          statusCode: 301,
          priority: 1001,
          actorId: ACTOR_ID,
        },
      }),
    RedirectValidationError
  );
  assert.deepEqual(await deps.repo.list({ workspaceId: WORKSPACE_ID }), []);
});

test("createRedirect accepts priority exactly 1000", async () => {
  const deps = makeDeps();
  const { record } = await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/a",
      toTarget: "/b",
      statusCode: 301,
      priority: 1000,
      actorId: ACTOR_ID,
    },
  });
  assert.equal(record.priority, 1000);
});

// ---------------------------------------------------------------------------
// createRedirect — write-path open-redirect rejection (REQ-08, AC-10/AC-11)
// ---------------------------------------------------------------------------

test("AC-10: an absolute toTarget NOT on the redirect allowlist is rejected with RedirectTargetNotAllowedError", async () => {
  const deps = makeDeps(); // empty allowlist
  await assert.rejects(
    () =>
      createRedirect({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          matchType: "exact",
          fromPattern: "/a",
          toTarget: "https://evil.example/phish",
          statusCode: 301,
          actorId: ACTOR_ID,
        },
      }),
    RedirectTargetNotAllowedError
  );
});

test("AC-11: an absolute toTarget matching the workspace's own verified origin is allowed", async () => {
  const deps = makeDeps();
  const { record } = await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/a",
      toTarget: "https://trusted.example/b",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });
  assert.equal(record.toTarget, "https://trusted.example/b");
});

test("an allowlisted absolute cross-origin toTarget is allowed", async () => {
  const deps = makeDeps({ redirectAllowlist: ["partner.example"] });
  const { record } = await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/a",
      toTarget: "https://partner.example/deal",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });
  assert.equal(record.toTarget, "https://partner.example/deal");
});

test("a relative toTarget never needs the allowlist", async () => {
  const deps = makeDeps(); // empty allowlist
  const { record } = await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/a",
      toTarget: "/relative-target",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });
  assert.equal(record.toTarget, "/relative-target");
});

// ---------------------------------------------------------------------------
// createRedirect — dedup / conflict (behavior.spec.md §5.1, AC-09)
// ---------------------------------------------------------------------------

test("AC-09: a duplicate active exact fromPattern is rejected with RedirectConflictError", async () => {
  const deps = makeDeps();
  await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/dup",
      toTarget: "/first",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });

  await assert.rejects(
    () =>
      createRedirect({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          matchType: "exact",
          fromPattern: "/dup",
          toTarget: "/second",
          statusCode: 301,
          actorId: ACTOR_ID,
        },
      }),
    RedirectConflictError
  );
});

test("an exact and a prefix rule may share the same fromPattern (not a duplicate, different bands)", async () => {
  const deps = makeDeps();
  await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/shared",
      toTarget: "/exact-target",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });

  const { record } = await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "prefix",
      fromPattern: "/shared",
      toTarget: "/prefix-target",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });
  assert.equal(record.matchType, "prefix");
});

test("a duplicate fromPattern against a tombstoned (disabled) rule is allowed (not a duplicate)", async () => {
  const deps = makeDeps();
  const { record: first } = await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/reused",
      toTarget: "/first",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });
  await tombstoneRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: first.id, actorId: ACTOR_ID } });

  const { record: second } = await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/reused",
      toTarget: "/second",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });
  assert.equal(second.toTarget, "/second");
});

// ---------------------------------------------------------------------------
// createRedirect — one-hop collapse (AC-16) + cycle rejection (AC-17), INV-04
// ---------------------------------------------------------------------------

test("AC-16: creating X->B collapses its target to C when B->C already exists", async () => {
  const deps = makeDeps();
  await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/a",
      toTarget: "/b",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });

  // Creating B->C: since a hop A->B already exists pointing at B, and now B->C is
  // introduced, per REQ-13's "resolution follows AT MOST ONE hop" guarantee this
  // create itself (fromPattern=B) is unaffected — the collapse this AC/REQ-13
  // describes is verified by asserting a THIRD create whose toTarget is the
  // just-created B (i.e., creating X->B collapses to X->C once B->C exists).
  await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/b",
      toTarget: "/c",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });

  const { record: collapsed } = await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/x",
      toTarget: "/b",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });

  assert.equal(collapsed.toTarget, "/c", "X->B collapses to X->C since B->C already exists");
});

test("AC-17: creating B->A when A->B already exists is rejected as a cycle", async () => {
  const deps = makeDeps();
  await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/a",
      toTarget: "/b",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });

  await assert.rejects(
    () =>
      createRedirect({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          matchType: "exact",
          fromPattern: "/b",
          toTarget: "/a",
          statusCode: 301,
          actorId: ACTOR_ID,
        },
      }),
    RedirectLoopError
  );
});

// ---------------------------------------------------------------------------
// AC-08 / INV-01 — a mid-write failure leaves no orphan row
// ---------------------------------------------------------------------------

test("AC-08: a failure inside the transaction wrapper leaves neither the record nor the revision persisted", async () => {
  const repo = new InMemoryRedirectRepo();
  const originRepo = new InMemoryOriginSettingRepo({ seeds: [
    {
      workspaceId: WORKSPACE_ID,
      origin: createVerifiedOrigin({
        scheme: "https",
        host: "trusted.example",
        verifiedAt: "2026-07-13T00:00:00.000Z",
        source: "workspace-setting",
      }),
    },
  ] });
  const deps: RedirectsWriteDeps = { reservedSegments: new Set(["admin", "api"]),
    repo,
    remove: removeVia(repo as unknown as Parameters<typeof removeVia>[0]),
    isInTrash: isNeverInTrash,
    restore: restoreVia(repo as unknown as Parameters<typeof removeVia>[0]),
    db: repo as unknown as RedirectDbHandle,
    transaction: async () => {
      throw new Error("simulated mid-transaction failure");
    },
    matcher: redirectMatcher,
    originRegistry: new OriginRegistry({ repo: originRepo }),
    clock: { nowMs: () => Date.parse("2026-07-13T00:00:00.000Z") },
    idGen: { newId: () => "redirect-x" },
    outbox: new InMemoryOutbox(),
  };

  await assert.rejects(
    () =>
      createRedirect({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          matchType: "exact",
          fromPattern: "/a",
          toTarget: "/b",
          statusCode: 301,
          actorId: ACTOR_ID,
        },
      }),
    /simulated mid-transaction failure/
  );

  assert.equal(await repo.findById({ workspaceId: WORKSPACE_ID, id: "redirect-x" }), null);
  assert.equal(repo.listRevisionsForTests({ redirectId: "redirect-x" }, {}).length, 0);
});

// ---------------------------------------------------------------------------
// updateRedirect — AC-06
// ---------------------------------------------------------------------------

test("updateRedirect applies a partial change and appends a new revision", async () => {
  const deps = makeDeps();
  const { record } = await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/a",
      toTarget: "/b",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });

  const { record: updated } = await updateRedirect({
    deps,
    input: { workspaceId: WORKSPACE_ID, id: record.id, toTarget: "/c", actorId: "updating-user", pluginId: "updating-plugin" },
  });

  assert.equal(updated.toTarget, "/c");
  assert.equal(updated.version, 2);
  const repo = deps.repo as InMemoryRedirectRepo;
  assert.equal(repo.listRevisionsForTests({ redirectId: record.id }, {}).length, 2);
  assert.deepEqual(repo.listRevisionsForTests({ redirectId: record.id }, {}), [
    { redirectId: record.id, workspaceId: WORKSPACE_ID, seq: 1, state: record, tombstoned: false,
      actorId: ACTOR_ID, pluginId: undefined, recordedAt: record.createdAt },
    { redirectId: record.id, workspaceId: WORKSPACE_ID, seq: 2, state: updated, tombstoned: false,
      actorId: "updating-user", pluginId: "updating-plugin", recordedAt: updated.updatedAt },
  ]);
});

test("updateRedirect on a nonexistent id throws RedirectNotFoundError", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () => updateRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: "nope", actorId: ACTOR_ID } }),
    RedirectNotFoundError
  );
});

// ---------------------------------------------------------------------------
// updateRedirect — status validation. `RedirectStatus` is a two-value union but
// TypeScript doesn't enforce that at the HTTP boundary: the admin PATCH route casts
// an arbitrary `body.status` string straight into `UpdateRedirectInput`, so runtime
// validation here is what actually protects this field.
// ---------------------------------------------------------------------------

const INVALID_STATUSES = ["Disabled", "ACTIVE", "deleted", ""];

for (const status of INVALID_STATUSES) {
  test(`updateRedirect rejects a non-canonical status value ${JSON.stringify(status)} instead of storing it`, async () => {
    const deps = makeDeps();
    const { record } = await createRedirect({
      deps,
      input: {
        workspaceId: WORKSPACE_ID,
        matchType: "exact",
        fromPattern: "/a",
        toTarget: "/b",
        statusCode: 301,
        actorId: ACTOR_ID,
      },
    });

    await assert.rejects(
      () =>
        updateRedirect({
          deps,
          input: {
            workspaceId: WORKSPACE_ID,
            id: record.id,
            status: status as unknown as RedirectStatus,
            actorId: ACTOR_ID,
          },
        }),
      RedirectValidationError
    );

    const stored = await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: record.id });
    assert.equal(stored?.status, "active");
  });
}

test("updateRedirect rejects a non-canonical status on an otherwise disable-only PATCH, rather than missing isDisableOnlyUpdate's exact-string fast path and falling through to store it (4c2f6fc5 interaction)", async () => {
  const deps = makeDeps();
  const { record: planted } = await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/legacy-garbage-status",
      toTarget: "/safe-target",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });

  // "Disabled" (wrong case) does not match isDisableOnlyUpdate's exact "disabled" comparison, so
  // this PATCH misses the disable-only fast path and falls through to full field validation —
  // which must now reject the garbage status instead of silently storing it as unservable garbage.
  await assert.rejects(
    () =>
      updateRedirect({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          id: planted.id,
          status: "Disabled" as unknown as RedirectStatus,
          actorId: ACTOR_ID,
        },
      }),
    RedirectValidationError
  );

  const stored = await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: planted.id });
  assert.equal(stored?.status, "active");
});

// ---------------------------------------------------------------------------
// tombstoneRedirect — AC-07
// ---------------------------------------------------------------------------

test("AC-07: tombstoneRedirect flips status to disabled; the rule is still listable but no longer matched", async () => {
  const deps = makeDeps();
  const { record } = await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/a",
      toTarget: "/b",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });

  const { record: tombstoned } = await tombstoneRedirect({
    deps,
    input: { workspaceId: WORKSPACE_ID, id: record.id, actorId: ACTOR_ID },
  });

  assert.equal(tombstoned.status, "disabled");
  const listed = await deps.repo.list({ workspaceId: WORKSPACE_ID });
  assert.equal(listed.length, 1);
  const matched = await deps.repo.lookupExact({ workspaceId: WORKSPACE_ID, path: "/a", includeOverrideOnly: false });
  assert.equal(matched, null);
});

test("tombstoneRedirect on a nonexistent id throws RedirectNotFoundError", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () => tombstoneRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: "nope", actorId: ACTOR_ID } }),
    RedirectNotFoundError
  );
});

// ---------------------------------------------------------------------------
// importRedirects — AC-31, EC-08
// ---------------------------------------------------------------------------

test("AC-31: importRedirects processes each item independently; one invalid item does not abort the batch", async () => {
  const deps = makeDeps();
  const { created, failed } = await importRedirects({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      rules: [
        { workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/import-1", toTarget: "/t1", statusCode: 302, priority: 17, override: true, actorId: ACTOR_ID },
        { workspaceId: WORKSPACE_ID, matchType: "regex", fromPattern: "/bad", toTarget: "/t2", statusCode: 301, actorId: ACTOR_ID },
        { workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/import-2", toTarget: "/t3", statusCode: 308, priority: 29, override: false, actorId: ACTOR_ID },
      ],
    },
  });

  assert.equal(created.length, 2);
  assert.equal(failed.length, 1);
  assert.ok(failed[0]);
  assert.equal(failed[0].index, 1);
  assert.equal(failed[0].code, "REDIRECT_VALIDATION_ERROR");
  assert.deepEqual(created.map(({ fromPattern, toTarget, statusCode, priority, override, source, workspaceId, createdByPrincipal }) =>
    ({ fromPattern, toTarget, statusCode, priority, override, source, workspaceId, createdByPrincipal })), [
    { fromPattern: "/import-1", toTarget: "/t1", statusCode: 302, priority: 17, override: true, source: "import", workspaceId: WORKSPACE_ID, createdByPrincipal: ACTOR_ID },
    { fromPattern: "/import-2", toTarget: "/t3", statusCode: 308, priority: 29, override: false, source: "import", workspaceId: WORKSPACE_ID, createdByPrincipal: ACTOR_ID },
  ]);
  assert.deepEqual(await deps.repo.list({ workspaceId: WORKSPACE_ID }), created);
});

test("EC-08: two items in the same batch with the same exact fromPattern — first succeeds, second fails with REDIRECT_CONFLICT", async () => {
  const deps = makeDeps();
  const { created, failed } = await importRedirects({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      rules: [
        { workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/dup-in-batch", toTarget: "/t1", statusCode: 301, actorId: ACTOR_ID },
        { workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/dup-in-batch", toTarget: "/t2", statusCode: 301, actorId: ACTOR_ID },
      ],
    },
  });

  assert.equal(created.length, 1);
  assert.equal(failed.length, 1);
  assert.ok(failed[0]);
  assert.equal(failed[0].index, 1);
  assert.equal(failed[0].code, "REDIRECT_CONFLICT");
  assert.ok(created[0]);
  assert.equal(created[0].fromPattern, "/dup-in-batch");
  assert.equal(created[0].toTarget, "/t1");
  assert.deepEqual(await deps.repo.list({ workspaceId: WORKSPACE_ID }), created);
});

// ---------------------------------------------------------------------------
// S7 (web-high fix plan, 2026-09-24) — updateRedirect must refuse a rule that has a real Trash
// index row, and restore one instead on a pure `status: "active"` PATCH. Built over a REAL
// `createTrashService` + `InMemoryTrashRepo`, wired to `REDIRECT_ENTITY_TYPE` the same way
// `server/runtime/composition/app.ts` wires it — not the simplified `removeVia`/`restoreVia` double,
// which has no Trash index at all (see that file's own header). `isDisableOnlyUpdate`'s "disabled"
// toggle stays disjoint from the Trash: a rule can be disabled with no Trash row (unchanged today).
// ---------------------------------------------------------------------------

/** A `RedirectsWriteDeps` whose `remove`/`isInTrash`/`restore` are all bound to ONE real
 *  `TrashService` (real index insert/delete), so `tombstoneRedirect` genuinely creates a Trash row
 *  and `isInTrash`/`restore` genuinely see it — the property S7's tests need and the lightweight
 *  double cannot provide. */
function makeDepsWithRealTrash(): RedirectsWriteDeps {
  const repo = new InMemoryRedirectRepo();
  const originRepo = new InMemoryOriginSettingRepo({ seeds: [
    {
      workspaceId: WORKSPACE_ID,
      origin: createVerifiedOrigin({
        scheme: "https",
        host: "trusted.example",
        verifiedAt: "2026-07-13T00:00:00.000Z",
        source: "workspace-setting",
      }),
      redirectAllowlist: [],
    },
  ] });
  const trashRepo = new InMemoryTrashRepo({});
  const redirectTrashAdapter: TrashAdapter = createRecordStoreTrashAdapter<RedirectRecord>({
    entityType: REDIRECT_ENTITY_TYPE,
    store: {
      findById: (required) => repo.findById(required),
      save: async ({ record }) => {
        await repo.insertRedirect(record);
      }
    },
    isHidden: ({ record }) => record.status === "disabled",
    hidden: ({ record, at }) => ({
      ...record,
      status: "disabled",
      updatedAt: at
    }),
    shown: ({ record, at }) => ({
      ...record,
      status: "active",
      updatedAt: at
    })
  });
  const trash = createTrashService({
    repo: trashRepo,
    adapters: new Map([[REDIRECT_ENTITY_TYPE, redirectTrashAdapter]]),
    idGen: { newId: () => randomUUID() },
    transaction: ({ work }) => ((fn) => fn())(work),
    entityPolicy: ({ entityType }) => (new Map([[REDIRECT_ENTITY_TYPE, redirectTrashAdapter]])).has(entityType)
  }, { onError: ({ error }) => console.error("[trash] onChanged hook failed; the trash/restore/purge it followed already committed", error) });

  let clockTick = 0;
  let idTick = 0;
  return { reservedSegments: new Set(["admin", "api"]),
    repo,
    remove: removeEntityWithoutBlocker({
      remove: (required: Parameters<RedirectsWriteDeps["remove"]>[0]) => trash.trash({
        workspaceId: required.workspaceId,
        entityType: REDIRECT_ENTITY_TYPE,
        entityId: required.id,
        actor: required.actor,
        display: required.display,
        at: required.at,
        expectedVersion: required.expectedVersion,
      }),
    }),
    isInTrash: async (required) =>
      (await trashRepo.findByEntity({ workspaceId: required.workspaceId, entityType: REDIRECT_ENTITY_TYPE, entityId: required.id })) !== null,
    restore: (required) =>
      trash.restore({
        workspaceId: required.workspaceId,
        entityType: REDIRECT_ENTITY_TYPE,
        entityId: required.id,
        at: required.at      }, {
        actor: required.actor      }),
    db: repo as unknown as RedirectDbHandle,
    transaction: async (fn) => fn(),
    matcher: redirectMatcher,
    originRegistry: new OriginRegistry({ repo: originRepo }),
    clock: { nowMs: () => Date.parse("2026-09-24T00:00:00.000Z") + 1000 * clockTick++ },
    idGen: { newId: () => `redirect-${++idTick}` },
    outbox: new InMemoryOutbox(),
  };
}

test("S7(a): updateRedirect on a tombstoned rule rejects with the entity-liveness message, version unchanged", async () => {
  const deps = makeDepsWithRealTrash();
  const { record } = await createRedirect({
    deps,
    input: { workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/old", toTarget: "/new", statusCode: 301, actorId: ACTOR_ID },
  });
  await tombstoneRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: record.id, actorId: ACTOR_ID } });

  await assert.rejects(
    () => updateRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: record.id, toTarget: "/elsewhere", actorId: ACTOR_ID } }),
    { message: `ENTITY_IN_TRASH: redirect '${record.id}' is in the Trash. Restore it from the Trash before changing it.` }
  );

  const after = await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: record.id });
  assert.equal(after?.version, 2, "the tombstone's own version bump (1 -> 2) must be the last one; the refused update must not bump it again");
});

test("S7(b): updateRedirect({status:'active'}) on a tombstoned rule restores it — no orphan Trash row", async () => {
  const deps = makeDepsWithRealTrash();
  const { record } = await createRedirect({
    deps,
    input: { workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/old-b", toTarget: "/new-b", statusCode: 301, actorId: ACTOR_ID },
  });
  await tombstoneRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: record.id, actorId: ACTOR_ID } });

  const { record: restored } = await updateRedirect({
    deps,
    input: { workspaceId: WORKSPACE_ID, id: record.id, status: "active", actorId: ACTOR_ID },
  });

  assert.equal(restored.status, "active");
  assert.equal(await deps.isInTrash({ workspaceId: WORKSPACE_ID, id: record.id }), false, "no orphan Trash row after the restore");
});

test("S7(c): a rule merely toggled off (status:'disabled', no Trash row) stays fully updatable — unchanged behavior", async () => {
  const deps = makeDepsWithRealTrash();
  const { record } = await createRedirect({
    deps,
    input: { workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/old-c", toTarget: "/new-c", statusCode: 301, actorId: ACTOR_ID },
  });
  await updateRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: record.id, status: "disabled", actorId: ACTOR_ID } });

  const { record: updated } = await updateRedirect({
    deps,
    input: { workspaceId: WORKSPACE_ID, id: record.id, toTarget: "/x", actorId: ACTOR_ID },
  });
  assert.equal(updated.toTarget, "/x");
});


for (const [label, overrides] of [
  ["status 200", { statusCode: 200 }], ["status 303", { statusCode: 303 }], ["status 404", { statusCode: 404 }],
  ["empty target", { toTarget: "" }], ["oversized target", { toTarget: "/" + "x".repeat(2048) }],
  ["negative priority", { priority: -1 }], ["fractional priority", { priority: 0.5 }],
  ["empty pattern", { fromPattern: "" }],
] as const) {
  test(`createRedirect rejects ${label} before persisting anything`, async () => {
    const deps = makeDeps();
    const valid: CreateRedirectInput = {
      workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/invalid", toTarget: "/target",
      statusCode: 301, actorId: ACTOR_ID,
    };
    await assert.rejects(() => createRedirect({ deps, input: { ...valid, ...overrides } as CreateRedirectInput }), RedirectValidationError);
    assert.deepEqual(await deps.repo.list({ workspaceId: WORKSPACE_ID }), []);
    assert.deepEqual(await deps.outbox.claimPending({ batchSize: 10, nowIso: "2099-01-01T00:00:00.000Z" }), []);
  });
}

test("AC-08: createRedirect rolls back the SQL row when revision insertion fails after the row write", async () => {
  const repo = eachDialect({
    tables: ["redirects", "redirect_revisions"], createTables,
    make: (kernel) => new SqlRedirectRepo({ kernel, tables: { redirects: "redirects", revisions: "redirect_revisions" } }, {}),
  }, {})[0]!.make();
  const deps: RedirectsWriteDeps = { ...makeDeps(), repo, db: repo, transaction: <T>(fn: () => Promise<T>) => repo.transaction(fn) };
  let revisionReached = false;
  deps.db = {
    insertRedirect: (record) => repo.insertRedirect(record),
    insertRevision: async (revision) => {
      assert.ok(await repo.findById({ workspaceId: WORKSPACE_ID, id: revision.redirectId }), "the row write must precede the failure");
      revisionReached = true;
      throw new Error("revision insert failed");
    },
  };
  await assert.rejects(() => createRedirect({ deps, input: {
    workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/atomic", toTarget: "/target", statusCode: 301, actorId: ACTOR_ID,
  } }), /revision insert failed/);
  assert.equal(revisionReached, true);
  assert.deepEqual(await repo.list({ workspaceId: WORKSPACE_ID }), []);
  assert.deepEqual(await repo.listRevisionsForTests({ redirectId: "redirect-1" }, {}), []);
  assert.deepEqual(await deps.outbox.claimPending({ batchSize: 10, nowIso: "2099-01-01T00:00:00.000Z" }), []);
});

test("importRedirects rejects a 501-item batch before writing any rule", async () => {
  const deps = makeDeps();
  const rules = Array.from({ length: 501 }, (_, i): CreateRedirectInput => ({
    workspaceId: WORKSPACE_ID, actorId: ACTOR_ID, matchType: "exact", fromPattern: `/batch-${i}`, toTarget: "/target", statusCode: 301,
  }));
  await assert.rejects(() => importRedirects({ deps, input: { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID, rules } }), RedirectValidationError);
  assert.deepEqual(await deps.repo.list({ workspaceId: WORKSPACE_ID }), []);
  assert.deepEqual(await deps.outbox.claimPending({ batchSize: 10, nowIso: "2099-01-01T00:00:00.000Z" }), []);
});

test("create/update/tombstone enqueue their mutation envelopes once; repeated tombstone is a no-op", async () => {
  const deps = makeDeps();
  const { record } = await createRedirect({ deps, input: {
    workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/events", toTarget: "/target", statusCode: 301, actorId: ACTOR_ID,
  } });
  await updateRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: record.id, toTarget: "/updated", actorId: ACTOR_ID } });
  const { record: disabled } = await tombstoneRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: record.id, actorId: ACTOR_ID } });
  const repo = deps.repo as InMemoryRedirectRepo;
  const before = repo.listRevisionsForTests({ redirectId: record.id }, {});
  assert.deepEqual(await tombstoneRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: record.id, actorId: ACTOR_ID } }), { record: disabled });
  assert.deepEqual(await repo.findById({ workspaceId: WORKSPACE_ID, id: record.id }), disabled);
  assert.deepEqual(repo.listRevisionsForTests({ redirectId: record.id }, {}), before);
  const events = (await deps.outbox.claimPending({ batchSize: 10, nowIso: "2099-01-01T00:00:00.000Z" })).map((row) => row.event);
  assert.deepEqual(events, ["created", "updated", "tombstoned"].map((change, index) => ({
    id: `redirect-${index + 2}`, name: `redirect.${change}`, occurredAt: `2026-07-13T00:00:0${index * 2 + 1}.000Z`,
    aggregateId: record.id, workspaceId: WORKSPACE_ID, actorId: ACTOR_ID,
    payload: { workspaceId: WORKSPACE_ID, redirectId: record.id, change },
  })));
});

for (const reason of ["not-found", "version-changed"] as const) {
  test(`tombstoneRedirect preserves state when remove returns ${reason}`, async () => {
    const deps = makeDeps();
    const { record } = await createRedirect({ deps, input: {
      workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/failed-remove", toTarget: "/target", statusCode: 301, actorId: ACTOR_ID,
    } });
    const repo = deps.repo as InMemoryRedirectRepo;
    const before = repo.listRevisionsForTests({ redirectId: record.id }, {});
    deps.remove = async () => ({ ok: false, reason });
    await assert.rejects(() => tombstoneRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: record.id, actorId: ACTOR_ID } }),
      reason === "not-found" ? RedirectNotFoundError : RedirectConflictError);
    assert.deepEqual(await repo.findById({ workspaceId: WORKSPACE_ID, id: record.id }), record);
    assert.deepEqual(repo.listRevisionsForTests({ redirectId: record.id }, {}), before);
    assert.deepEqual((await deps.outbox.claimPending({ batchSize: 10, nowIso: "2099-01-01T00:00:00.000Z" })).map((row) => row.event.name), ["redirect.created"]);
  });
}

for (const outcome of ["not-found", "version-changed", "adapter-unavailable"] as const) {
  test(`updateRedirect preserves the trashed rule when restore returns ${outcome}`, async () => {
    const deps = makeDepsWithRealTrash();
    const { record } = await createRedirect({ deps, input: {
      workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/failed-restore", toTarget: "/target", statusCode: 301, actorId: ACTOR_ID,
    } });
    await tombstoneRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: record.id, actorId: ACTOR_ID } });
    const repo = deps.repo as InMemoryRedirectRepo;
    const beforeRow = await repo.findById({ workspaceId: WORKSPACE_ID, id: record.id });
    const beforeRevisions = repo.listRevisionsForTests({ redirectId: record.id }, {});
    deps.restore = async () => outcome;
    await assert.rejects(() => updateRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: record.id, status: "active", actorId: ACTOR_ID } }),
      outcome === "not-found" ? RedirectNotFoundError : outcome === "version-changed" ? RedirectConflictError : /no Trash adapter/);
    assert.deepEqual(await repo.findById({ workspaceId: WORKSPACE_ID, id: record.id }), beforeRow);
    assert.deepEqual(repo.listRevisionsForTests({ redirectId: record.id }, {}), beforeRevisions);
    assert.equal(await deps.isInTrash({ workspaceId: WORKSPACE_ID, id: record.id }), true);
    assert.deepEqual((await deps.outbox.claimPending({ batchSize: 10, nowIso: "2099-01-01T00:00:00.000Z" })).map((row) => row.event.name), ["redirect.created", "redirect.tombstoned"]);
  });
}
