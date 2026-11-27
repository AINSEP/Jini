import assert from "node:assert/strict";
import { afterAll, describe, test } from "vitest";
import { sql } from "kysely";
import type { SettingDefinitionRecord, SettingRevisionRecord, SettingValueRecord } from "@jini-ai/core/settings";
import { SqlSettingsRepo } from "../repo.sql.js";
import { openSettingsKernel, TABLES, type OpenKernel } from "./support/settings-tables.fixture.js";

/**
 * @file The settings SQL repo on every embedded dialect: one query body serves SQLite and PGlite. Value writes
 * are unconditional last-write-wins upserts (no expected-revision contract); the revision ledger orders rows by
 * `seq` under one stream lock.
 */

const NOW = "2026-11-18T00:00:00.000Z";
const value = (over: Partial<SettingValueRecord> = {}): SettingValueRecord => ({
  settingId: "s-1", scope: "global", workspaceId: null, principalId: null, valueJson: "x", state: "set",
  defVersion: 1, seq: 1, updatedBy: "actor-1", updatedAt: NOW, originPluginId: null, ...over,
});
const definition = (over: Partial<SettingDefinitionRecord> = {}): SettingDefinitionRecord => ({
  settingId: "def-1", version: 1, workspaceId: null, namespace: "core.t", key: "k", ownerKind: "core", ownerId: null,
  schema: { type: "string" }, defaultValue: "d", scopes: 7, secret: false, status: "active", aliasOfNamespace: null,
  aliasOfKey: null, coercionTag: null, createdAt: NOW, updatedAt: NOW, ...over,
});
const revision = (over: Partial<Omit<SettingRevisionRecord, "seq">> = {}): Omit<SettingRevisionRecord, "seq"> => ({
  entityKind: "value", settingId: "s-1", scope: "global", workspaceId: null, principalId: null, op: "set",
  beforeJson: null, afterJson: "x", defVersion: 1, actor: "actor-1", originPluginId: null, changeSetId: null,
  createdAt: NOW, ...over,
});

const opened: OpenKernel[] = [];
afterAll(async () => { for (const each of opened) await each.close(); });

describe.each(["sqlite", "postgres"] as const)("settings sql repo [%s]", (dialect) => {
  async function make(): Promise<SqlSettingsRepo> {
    const each = await openSettingsKernel({ dialect });
    opened.push(each);
    return new SqlSettingsRepo({ kernel: each.kernel, tables: TABLES }, {});
  }

  test("definition round-trips, including a retyped coercion tag, secret flag and null default", async () => {
    const repo = await make();
    await repo.saveDefinition(definition({ coercionTag: "identity", secret: true, defaultValue: null }));
    assert.deepEqual(await repo.findDefinitionBySettingId({ settingId: "def-1", version: 1 }), definition({ coercionTag: "identity", secret: true, defaultValue: null }));
    await repo.saveDefinition(definition({ coercionTag: "identity", secret: true, defaultValue: null, key: "renamed", createdAt: "ignored" }));
    const updated = await repo.findDefinitionBySettingId({ settingId: "def-1" });
    assert.equal(updated?.key, "renamed");
    assert.equal(updated?.createdAt, NOW);
  });

  test("definition lookup separates platform (workspaceId null) from workspace definitions and skips retired ones", async () => {
    const repo = await make();
    await repo.saveDefinition(definition({ settingId: "platform" }));
    await repo.saveDefinition(definition({ settingId: "scoped", workspaceId: "ws-a", key: "k2" }));
    await repo.saveDefinition(definition({ settingId: "gone", key: "k3", status: "retired" as SettingDefinitionRecord["status"] }));
    assert.equal((await repo.findActiveDefinition({ namespace: "core.t", key: "k", workspaceId: null }))?.settingId, "platform");
    assert.equal(await repo.findActiveDefinition({ namespace: "core.t", key: "k", workspaceId: "ws-a" }), null);
    assert.equal((await repo.findActiveDefinition({ namespace: "core.t", key: "k2", workspaceId: "ws-a" }))?.settingId, "scoped");
    assert.equal(await repo.findActiveDefinition({ namespace: "core.t", key: "k3", workspaceId: null }), null);
    assert.deepEqual((await repo.listActiveDefinitions({ workspaceId: null })).map((d) => d.settingId), ["platform"]);
  });

  test("two writes of one setting at one scope: the second wins and one row remains", async () => {
    const repo = await make();
    const ws = { scope: "workspace" as const, workspaceId: "ws-a" };
    const user = { scope: "user" as const, workspaceId: "ws-a", principalId: "p-1" };
    for (const [save, over] of [[repo.saveGlobalValue, {}], [repo.saveWorkspaceValue, ws], [repo.saveUserValue, user]] as const) {
      await save.call(repo, value({ ...over, valueJson: "first" }));
      await save.call(repo, value({ ...over, valueJson: "second", seq: 2 }));
    }
    assert.equal((await repo.getGlobalValue("s-1"))?.valueJson, "second");
    assert.equal((await repo.getWorkspaceValue({ workspaceId: "ws-a", settingId: "s-1" }))?.seq, 2);
    assert.equal((await repo.listUserValues({ workspaceId: "ws-a", principalId: "p-1" })).length, 1);
    assert.equal((await repo.listWorkspaceValues({ workspaceId: "ws-a" })).length, 1);
  });

  test("a cleared value stores SQL NULL while a set JSON null is kept distinct", async () => {
    const repo = await make();
    await repo.saveGlobalValue(value({ settingId: "cleared", state: "cleared", valueJson: null }));
    await repo.saveGlobalValue(value({ settingId: "null-set", valueJson: null }));
    assert.equal((await repo.getGlobalValue("cleared"))?.state, "cleared");
    assert.equal((await repo.getGlobalValue("null-set"))?.valueJson, null);
    assert.equal((await repo.getGlobalValue("null-set"))?.state, "set");
  });

  test("workspace and user rows never leak across workspaces or principals; scoped writes need their ids", async () => {
    const repo = await make();
    await repo.saveWorkspaceValue(value({ scope: "workspace", workspaceId: "ws-a" }));
    await repo.saveUserValue(value({ scope: "user", workspaceId: "ws-a", principalId: "p-1" }));
    assert.equal(await repo.getWorkspaceValue({ workspaceId: "ws-b", settingId: "s-1" }), null);
    assert.equal(await repo.getUserValue({ workspaceId: "ws-a", principalId: "p-2", settingId: "s-1" }), null);
    assert.deepEqual(await repo.listUserValuesByWorkspace({ workspaceId: "ws-b" }), []);
    assert.equal((await repo.listUserValuesByWorkspace({ workspaceId: "ws-a" }))[0]?.principalId, "p-1");
    await assert.rejects(repo.saveWorkspaceValue(value()), /requires workspaceId/);
    await assert.rejects(repo.saveUserValue(value({ workspaceId: "ws-a" })), /requires workspaceId and principalId/);
  });

  test("deleteUserValue and deleteWorkspaceValue remove exactly their row and leave the ledger", async () => {
    const repo = await make();
    await repo.saveGlobalValue(value());
    for (const workspaceId of ["ws-a", "ws-b"]) await repo.saveWorkspaceValue(value({ scope: "workspace", workspaceId }));
    for (const principalId of ["p-1", "p-2"]) await repo.saveUserValue(value({ scope: "user", workspaceId: "ws-a", principalId }));
    await repo.appendRevision(revision());
    await repo.deleteUserValue({ workspaceId: "ws-a", principalId: "p-1", settingId: "s-1" });
    await repo.deleteWorkspaceValue({ workspaceId: "ws-a", settingId: "s-1" });
    assert.equal(await repo.getUserValue({ workspaceId: "ws-a", principalId: "p-1", settingId: "s-1" }), null);
    assert.notEqual(await repo.getUserValue({ workspaceId: "ws-a", principalId: "p-2", settingId: "s-1" }), null);
    assert.equal(await repo.getWorkspaceValue({ workspaceId: "ws-a", settingId: "s-1" }), null);
    assert.notEqual(await repo.getWorkspaceValue({ workspaceId: "ws-b", settingId: "s-1" }), null);
    assert.notEqual(await repo.getGlobalValue("s-1"), null);
    assert.equal((await repo.listRevisions({ settingId: "s-1" })).length, 1);
  });

  test("revisions: seq ascends, listRevisionsSince honours cursor, limit and workspace visibility", async () => {
    const repo = await make();
    const seqs: number[] = [];
    for (let n = 1; n <= 5; n += 1) seqs.push(await repo.appendRevision(revision({ workspaceId: n === 4 ? "ws-b" : "ws-a", scope: "workspace", afterJson: n })));
    assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
    const page = async (sinceSeq: number, limit: number) => (await repo.listRevisionsSince({ sinceSeq, limit, workspaceId: "ws-a" })).map((r) => r.seq);
    assert.deepEqual(await page(2, 10), [3, 5]);
    assert.deepEqual(await page(0, 2), [1, 2]);
    assert.equal(await repo.maxRevisionSeq(), 5);
    assert.deepEqual((await repo.listRevisions({ settingId: "s-1" })).map((r) => r.afterJson), [1, 2, 3, 4, 5]);
  });

  test("a platform-wide revision (null workspace) reaches every workspace", async () => {
    const repo = await make();
    await repo.appendRevision(revision());
    await repo.appendRevision(revision({ workspaceId: "ws-b", scope: "workspace" }));
    assert.deepEqual((await repo.listRevisionsSince({ sinceSeq: 0, limit: 10, workspaceId: "ws-a" })).map((r) => r.seq), [1]);
  });

  test("an empty ledger reports max seq 0; a transaction commits on success and rolls every write back on failure", async () => {
    const repo = await make();
    assert.equal(await repo.maxRevisionSeq(), 0);
    assert.equal(await repo.transaction(async () => { await repo.saveGlobalValue(value()); return "done"; }), "done");
    await assert.rejects(repo.transaction(async () => { await repo.saveGlobalValue(value({ settingId: "s-2" })); throw new Error("abort"); }), /abort/);
    assert.notEqual(await repo.getGlobalValue("s-1"), null);
    assert.equal(await repo.getGlobalValue("s-2"), null);
  });
});

test("SQLite definitions prefer an active version, fall back to the latest deprecated version, and read legacy coercion tags", async () => {
  const each = await openSettingsKernel({ dialect: "sqlite" });
  opened.push(each);
  const repo = new SqlSettingsRepo({ kernel: each.kernel, tables: TABLES }, {});
  const find = (version?: number) => repo.findDefinitionBySettingId({ settingId: "def-1", ...(version === undefined ? {} : { version }) });
  const retired = "deprecated" as const;
  await repo.saveDefinition(definition({ status: retired, version: 4, coercionTag: "legacy-coercer" }));
  await repo.saveDefinition(definition({ version: 2, coercionTag: "still-active" }));
  await repo.saveDefinition(definition({ status: retired, version: 3, coercionTag: "older" }));
  await each.kernel.execute(sql`UPDATE setting_definitions SET coercion_json = 'legacy-coercer' WHERE setting_id = 'def-1' AND version = 4`);
  assert.deepEqual(await find(), definition({ version: 2, coercionTag: "still-active" }));
  assert.deepEqual(await find(4), definition({ status: retired, version: 4, coercionTag: "legacy-coercer" }));
  assert.equal(await find(99), null);
  await repo.saveDefinition(definition({ status: retired, version: 2 }));
  assert.deepEqual(await find(), definition({ status: retired, version: 4, coercionTag: "legacy-coercer" }));
  await each.kernel.execute(sql`UPDATE setting_definitions SET coercion_json = '17' WHERE setting_id = 'def-1' AND version = 4`);
  assert.deepEqual(await find(), definition({ status: retired, version: 4, coercionTag: "17" }));
  assert.equal(await repo.findDefinitionBySettingId({ settingId: "missing" }), null);
});
