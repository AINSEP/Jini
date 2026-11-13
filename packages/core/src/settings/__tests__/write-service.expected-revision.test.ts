import assert from "node:assert/strict";
import { test } from "vitest";
import { RecordVersionConflictError } from "../../optimistic-concurrency.js";
import { ensureSettingDefinitions } from "../ensure-definitions.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { getEffective } from "../settings.js";
import { SCOPE_BIT } from "../types.js";
import { set } from "../write-service.js";
import { InMemorySettingsPrincipalLookup } from "./principal.fixture.js";

/** Two editors read the same settings value; the second save must be refused, not overwrite. */
async function fixture() {
  let nextId = 0;
  const repo = new InMemorySettingsRepo();
  const base = { settingsRepo: repo, clock: { nowMs: () => Date.parse("2026-11-13T00:00:00Z") }, ids: { newId: () => `id-${++nextId}` }, principals: new InMemorySettingsPrincipalLookup([]) };
  await ensureSettingDefinitions(base, {
    namespace: "site.seo", definitions: [{ key: "title", schema: { type: "string" }, defaultValue: "", scopes: SCOPE_BIT.workspace | SCOPE_BIT.user }],
    systemPrincipalId: "boot", ownerKind: "site", workspaceId: "ws",
  });
  const deps = { repo, clock: base.clock, ids: base.ids, principals: base.principals, authorize: async () => ({ allowed: true, reason: "matched" }) };
  const write = (value: string, optional: { expectedRevisionSeq?: number; scope?: "workspace" | "user" } = {}) =>
    set({ deps, input: { namespace: "site.seo", key: "title", scope: optional.scope ?? "workspace", value, workspaceId: "ws", authWorkspaceId: "ws", callerPrincipalId: "editor" } },
      optional.expectedRevisionSeq === undefined ? {} : { expectedRevisionSeq: optional.expectedRevisionSeq });
  const read = async () => (await getEffective({ repo }, { namespace: "site.seo", key: "title", scopeContext: { workspaceId: "ws" } }))?.value;
  return { repo, write, read };
}

test("an unset value is revision 0, and a matching basis saves and returns the new revision", async () => {
  const { write, read } = await fixture();
  const first = await write("A", { expectedRevisionSeq: 0 });
  const second = await write("B", { expectedRevisionSeq: first.revisionSeq });
  assert.equal(await read(), "B");
  assert.ok(second.revisionSeq > first.revisionSeq);
});

test("a stale basis is refused with the live revision and leaves value and ledger untouched", async () => {
  const { repo, write, read } = await fixture();
  const opened = await write("A", { expectedRevisionSeq: 0 });
  await write("Theirs", { expectedRevisionSeq: opened.revisionSeq });
  const ledgerBefore = await repo.maxRevisionSeq();
  await assert.rejects(write("Mine", { expectedRevisionSeq: opened.revisionSeq }), (error: unknown) => {
    assert.ok(error instanceof RecordVersionConflictError);
    assert.equal(error.recordId, "site.seo.title");
    assert.equal(error.expectedVersion, opened.revisionSeq);
    assert.equal(error.currentVersion, ledgerBefore);
    return true;
  });
  assert.equal(await read(), "Theirs");
  assert.equal(await repo.maxRevisionSeq(), ledgerBefore);
});

test("a create that expects an unset value is refused once someone else set it", async () => {
  const { write } = await fixture();
  await write("Theirs");
  await assert.rejects(write("Mine", { expectedRevisionSeq: 0 }), RecordVersionConflictError);
});

test("the user scope compares the caller's own row", async () => {
  const { write } = await fixture();
  const mine = await write("Mine", { scope: "user", expectedRevisionSeq: 0 });
  await write("Workspace", { expectedRevisionSeq: 0 });
  await write("Mine 2", { scope: "user", expectedRevisionSeq: mine.revisionSeq });
});

test("no basis keeps last-write-wins for existing callers", async () => {
  const { write, read } = await fixture();
  await write("A");
  await write("B");
  assert.equal(await read(), "B");
});
