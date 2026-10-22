import { widgetHostFixture } from "../support/host.fixture.js";
import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import { ContentTypeAlreadyExistsError, InMemoryContentTypeRepo } from "../../../content-types/index.js";
import type { ContentTypeRecord } from "../../../content-types/index.js";
import { ensureWidgetContentTypesRegistered } from "../support/compat/entry-payload.js";
import { InMemoryOutbox } from "../support/host.fixture.js";

/**
 * S9 (web-high fix plan, 2026-09-24): two concurrent first-widget creates both see `findByKey`
 * return null in `ensureOneContentTypeRegistered`, and the loser's `registerContentType` now
 * refuses with `ContentTypeAlreadyExistsError`. The loser must treat a live row as success, and
 * only a tombstoned key as a failure.
 */
function repoWhereTheSeedCheckLosesTheRace(status: ContentTypeRecord["status"]) {
  const repo = new InMemoryContentTypeRepo();
  const seen = new Set<string>();
  const realFindByKey = repo.findByKey.bind(repo);
  // The first lookup per key is the seed's own check, taken before the winner committed.
  repo.findByKey = async (params) => {
    if (!seen.has(params.key)) {
      seen.add(params.key);
      return null;
    }
    return realFindByKey(params);
  };
  const seedWinner = async (key: string) =>
    repo.save({
      workspaceId: "ws-1",
      key,
      label: key,
      fields: [],
      version: 1,
      status,
      tombstonedAt: status === "tombstone" ? "2026-09-24T00:00:00.000Z" : null,
    } as ContentTypeRecord);
  return { repo, seedWinner };
}

function seedDeps(contentTypeRepo: InMemoryContentTypeRepo) {
  let n = 0;
  return {
    host: widgetHostFixture,
    contentTypeRepo,
    clock: { nowMs: () => Date.parse("2026-09-24T00:00:00.000Z") },
    ids: { newId: () => `id-${++n}` },
    outbox: new InMemoryOutbox(),
  };
}

test("ensureWidgetContentTypesRegistered: losing the first-create race to a live row is success", async () => {
  const { repo, seedWinner } = repoWhereTheSeedCheckLosesTheRace("active");
  await seedWinner("widget");
  await seedWinner("widget_area");

  await ensureWidgetContentTypesRegistered({ deps: seedDeps(repo), workspaceId: "ws-1" });
  for (const key of ["widget", "widget_area"]) {
    const row = await repo.findByKey({ workspaceId: "ws-1", key });
    assert.ok(row);
    assert.equal(row.status, "active");
    assert.equal(row.key, key);
  }
});

test("ensureWidgetContentTypesRegistered: a tombstoned key is still a failure", async () => {
  const { repo, seedWinner } = repoWhereTheSeedCheckLosesTheRace("tombstone");
  await seedWinner("widget");

  await assert.rejects(
    () => ensureWidgetContentTypesRegistered({ deps: seedDeps(repo), workspaceId: "ws-1" }),
    (err: unknown) => {
      assert.ok(err instanceof ContentTypeAlreadyExistsError);
      assert.equal(err.message, "content type 'widget' was permanently deleted; its key can't be reused");
      return true;
    }
  );
});
