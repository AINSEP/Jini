import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryOutbox } from "./support/events.fixture.js";
import { createVerifiedOrigin, InMemoryOriginSettingRepo, OriginRegistry } from "@jini-ai/http-kit/verified-origin";
import { redirectMatcher } from "../matcher.js";
import type { RedirectDbHandle } from "../ports.internal.js";
import { InMemoryRedirectRepo } from "../repo.memory.js";
import { createRedirect, updateRedirect, type RedirectsWriteDeps } from "../redirects.js";
import { RedirectConflictError, RedirectLoopError } from "../types.js";
import { isNeverInTrash, removeVia, restoreVia } from "./remove-redirect-double.js";

/**
 * @file S9 (fix-plan-web-medium-2026-09-24, row 26) — `resolveCollapsedTarget`'s cycle check only
 * looked one hop past the collapse, so a longer chain of existing rules (A->B, B->C, C->A) could be
 * completed by a create/update that itself collapses only once. This asserts the walk now follows
 * the whole chain and rejects with a distinct message from the direct self-loop case.
 */

const WORKSPACE_ID = "workspace-1";
const ACTOR_ID = "user-1";

function makeDeps(): RedirectsWriteDeps {
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

test("S9: creating /a->/b when /b->/c and /c->/a already exist rejects the whole-chain cycle", async () => {
  const deps = makeDeps();
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
  await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/c",
      toTarget: "/a",
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
          fromPattern: "/a",
          toTarget: "/b",
          statusCode: 301,
          actorId: ACTOR_ID,
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof RedirectLoopError);
      assert.equal(
        (err as Error).message,
        "redirect from '/a' would create a cycle via '/b' (following existing redirects leads back to '/a')"
      );
      return true;
    }
  );
});

test("S9: a pre-existing loop that does NOT pass through the new rule's fromPattern does not reject the write (it is not this write's cycle)", async () => {
  const deps = makeDeps();
  const repo = deps.repo as InMemoryRedirectRepo;
  // /x->/y exists normally; /y->/w and /w->/x are seeded straight into the repo, as data written
  // before the chain walk existed could be (the one-hop check alone never caught a 3-rule loop).
  const { record } = await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/x",
      toTarget: "/y",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });
  repo.insertRedirect({ ...record, id: "legacy-y", fromPattern: "/y", toTarget: "/w" });
  repo.insertRedirect({ ...record, id: "legacy-w", fromPattern: "/w", toTarget: "/x" });

  const { record: created } = await createRedirect({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      matchType: "exact",
      fromPattern: "/z",
      toTarget: "/x",
      statusCode: 301,
      actorId: ACTOR_ID,
    },
  });
  assert.equal(created.toTarget, "/y");
});

test("updateRedirect rejects a target completing a whole-chain cycle and a duplicate fromPattern without changing the row", async () => {
  const deps = makeDeps();
  for (const [fromPattern, toTarget] of [["/a", "/b"], ["/b", "/c"], ["/c", "/end"]] as const) {
    await createRedirect({ deps, input: { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID, matchType: "exact", statusCode: 301, fromPattern, toTarget } });
  }
  const before = await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: "redirect-3" });
  assert.ok(before);
  // The in-memory repo is the only revision reader; the write port exposes none.
  const memoryRepo = deps.repo as InMemoryRedirectRepo;
  const revisionsBefore = memoryRepo.listRevisionsForTests({ redirectId: before.id }, {});
  assert.equal(revisionsBefore.length, 1, "the create wrote exactly one revision, so an unchanged list is a real check");
  await assert.rejects(
    () => updateRedirect({ deps, input: { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID, id: before.id, toTarget: "/a" } }),
    RedirectLoopError,
  );
  assert.deepEqual(await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: before.id }), before);
  await assert.rejects(
    () => updateRedirect({ deps, input: { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID, id: before.id, fromPattern: "/a" } }),
    RedirectConflictError,
  );
  assert.deepEqual(await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: before.id }), before);
  assert.deepEqual(memoryRepo.listRevisionsForTests({ redirectId: before.id }, {}), revisionsBefore);
});
