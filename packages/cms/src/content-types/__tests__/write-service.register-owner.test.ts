import assert from "node:assert/strict";
import { test } from "vitest";

import { InvalidKeyGrammarError } from "../errors.js";
import type { ContentTypeRecord } from "../types.js";
import { registerContentType } from "../write-service.js";

/**
 * @file `registerContentType`'s optional `owner` — the `fieldsJson.ext.<owner>` namespace that
 * `entries/write-service.ts` now reads off the owning type instead of taking from each caller
 * (see `entries/__tests__/write-service.owner.test.ts` for the entry side).
 */

const clock = { nowMs: () => Date.parse("2026-07-15T00:00:00.000Z") };
let idCounter = 0;
const ids = { newId: () => `ct-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const outbox = { enqueue: async () => undefined };
const indexProvisioner = { provisionIndexesForNewContentType: async () => undefined, applyFieldIndexTransitions: async () => undefined };

function fakeRepo() {
  const rows: ContentTypeRecord[] = [];
  return {
    rows,
    save: async (row: ContentTypeRecord) => { rows.push(row); },
    appendRevision: async () => undefined,
    findByKey: async () => null,
    transaction: async <T>({ fn }: { fn: () => Promise<T> }) => fn(),
  };
}

const FIELDS = [{ name: "payload", kind: "text" as const, required: true, queryable: false }];

test("an owner given at registration is stored on the content-type record", async () => {
  const repo = fakeRepo();
  const result = await registerContentType({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner, outbox },
    input: { workspaceId: "ws-1", actorId: "system", key: "widget", label: "Widget", fields: FIELDS, owner: "widget" },
  });

  assert.equal(result.ok, true);
  assert.equal(repo.rows[0]?.owner, "widget");
});

test("a type registered without an owner carries no owner key at all (byte-identical to before owner existed)", async () => {
  const repo = fakeRepo();
  const result = await registerContentType({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner, outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", label: "Recipe", fields: FIELDS },
  });

  assert.equal(result.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(repo.rows[0], "owner"), false);
});

test("an owner that fails the identifier grammar is rejected before anything is written", async () => {
  const repo = fakeRepo();
  const result = await registerContentType({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner, outbox },
    input: { workspaceId: "ws-1", actorId: "system", key: "widget", label: "Widget", fields: FIELDS, owner: "Not An Id" },
  });

  assert.ok(!result.ok && result.error instanceof InvalidKeyGrammarError);
  assert.equal(result.ok ? "" : result.error.message, "content-type owner 'Not An Id' fails the identifier grammar gate ^[a-z][a-z0-9_]{0,63}$");
  assert.equal(repo.rows.length, 0);
});
