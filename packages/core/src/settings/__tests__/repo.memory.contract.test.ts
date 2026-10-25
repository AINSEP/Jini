import { describe, expect, it } from "vitest";
import { InMemorySettingsRepo } from "../repo.memory.js";
import type { SettingDefinitionRecord, SettingRevisionRecord, SettingValueRecord } from "../types.js";

/** L2 §4 repo.memory: seeds are honoured, multi-version lookups prefer active then newest, and every
 *  keyed lookup/upsert/delete is exercised with ≥2 neighbouring rows that differ in ONE key (AP2). */
const NOW = "2026-01-01T00:00:00.000Z";
const def = (o: Partial<SettingDefinitionRecord>): SettingDefinitionRecord => ({ settingId: "s", version: 1, workspaceId: null, namespace: "n", key: "k", ownerKind: "core", ownerId: null,
  schema: { type: "string" }, defaultValue: "d", scopes: 7, secret: false, status: "active", aliasOfNamespace: null, aliasOfKey: null, coercionTag: null, createdAt: NOW, updatedAt: NOW, ...o });
const val = (o: Partial<SettingValueRecord>): SettingValueRecord => ({ settingId: "s", scope: "workspace", workspaceId: "w1", principalId: null, valueJson: "v", state: "set", defVersion: 1, seq: 1, updatedBy: "u", updatedAt: NOW, originPluginId: null, ...o } as SettingValueRecord);
const rev = (o: Partial<SettingRevisionRecord>): SettingRevisionRecord => ({ seq: 1, entityKind: "value", settingId: "s", scope: "workspace", workspaceId: "w1", principalId: null, op: "set", beforeJson: null, afterJson: "v", defVersion: 1, actor: "u", originPluginId: null, changeSetId: null, createdAt: NOW, ...o } as SettingRevisionRecord);

describe("InMemorySettingsRepo", () => {
  it("honours every seed array and continues seq after the highest seeded revision", async () => {
    const repo = new InMemorySettingsRepo({
      definitions: [def({})], globalValues: [val({ scope: "global", workspaceId: null })], workspaceValues: [val({})],
      userValues: [val({ scope: "user", principalId: "p" })], revisions: [rev({ seq: 7 }), rev({ seq: 3 })],
    });
    expect(await repo.findActiveDefinition({ namespace: "n", key: "k", workspaceId: null })).toMatchObject({ settingId: "s" });
    expect(await repo.getGlobalValue("s")).toMatchObject({ scope: "global" });
    expect(await repo.getWorkspaceValue({ workspaceId: "w1", settingId: "s" })).toMatchObject({ scope: "workspace" });
    expect(await repo.getUserValue({ workspaceId: "w1", principalId: "p", settingId: "s" })).toMatchObject({ scope: "user" });
    expect(await repo.maxRevisionSeq()).toBe(7);
    expect(await repo.appendRevision(rev({}))).toBe(8);
    expect(await new InMemorySettingsRepo().appendRevision(rev({}))).toBe(1);
  });

  it("findActiveDefinition matches namespace, key, workspace and current statuses; never deprecated", async () => {
    const repo = new InMemorySettingsRepo({ definitions: [
      def({ settingId: "dep", status: "deprecated" }), def({ settingId: "other-ns", namespace: "m" }), def({ settingId: "other-key", key: "j" }),
      def({ settingId: "ws", workspaceId: "w1" }), def({ settingId: "alias", key: "a", status: "alias" }), def({ settingId: "tomb", key: "t", status: "tombstone" }),
    ] });
    expect((await repo.findActiveDefinition({ namespace: "n", key: "k", workspaceId: null }))).toBeNull();
    expect((await repo.findActiveDefinition({ namespace: "n", key: "k", workspaceId: "w1" }))?.settingId).toBe("ws");
    expect((await repo.findActiveDefinition({ namespace: "n", key: "a", workspaceId: null }))?.settingId).toBe("alias");
    expect((await repo.findActiveDefinition({ namespace: "n", key: "t", workspaceId: null }))?.settingId).toBe("tomb");
    expect((await repo.findActiveDefinition({ namespace: "m", key: "k", workspaceId: null }))?.settingId).toBe("other-ns");
    expect((await repo.listActiveDefinitions({ workspaceId: null })).map(d => d.settingId).sort()).toEqual(["alias", "other-key", "other-ns"]);
  });

  it("findDefinitionBySettingId: exact version, else active, else the NEWEST version", async () => {
    const repo = new InMemorySettingsRepo({ definitions: [def({ version: 1, status: "deprecated" }), def({ version: 3, status: "deprecated" }), def({ version: 2, status: "deprecated" }), def({ settingId: "x", version: 9 })] });
    expect((await repo.findDefinitionBySettingId({ settingId: "s" }))?.version).toBe(3);
    expect((await repo.findDefinitionBySettingId({ settingId: "s", version: 2 }))?.version).toBe(2);
    expect(await repo.findDefinitionBySettingId({ settingId: "s", version: 4 })).toBeNull();
    expect(await repo.findDefinitionBySettingId({ settingId: "none" })).toBeNull();
    await repo.saveDefinition(def({ version: 1, status: "active" }));
    expect((await repo.findDefinitionBySettingId({ settingId: "s" }))?.version).toBe(1);
    await repo.saveDefinition(def({ version: 4, status: "deprecated" }));
    expect((await repo.findDefinitionBySettingId({ settingId: "s", version: 4 }))?.version).toBe(4);
  });

  it("value upserts replace only the row matching every key, and deletes remove only that row", async () => {
    const repo = new InMemorySettingsRepo();
    await repo.saveGlobalValue(val({ settingId: "a", scope: "global", workspaceId: null, valueJson: 1 }));
    await repo.saveGlobalValue(val({ settingId: "b", scope: "global", workspaceId: null, valueJson: 2 }));
    await repo.saveGlobalValue(val({ settingId: "a", scope: "global", workspaceId: null, valueJson: 3 }));
    expect((await repo.getGlobalValue("a"))?.valueJson).toBe(3);
    expect((await repo.getGlobalValue("b"))?.valueJson).toBe(2);
    for (const [w, s, v] of [["w1", "a", 1], ["w2", "a", 2], ["w1", "b", 3], ["w1", "a", 4]] as const) await repo.saveWorkspaceValue(val({ workspaceId: w, settingId: s, valueJson: v }));
    expect((await repo.listWorkspaceValues({ workspaceId: "w1" })).map(r => [r.settingId, r.valueJson])).toEqual([["a", 4], ["b", 3]]);
    await repo.deleteWorkspaceValue({ workspaceId: "w1", settingId: "a" });
    expect((await repo.listWorkspaceValues({ workspaceId: "w1" })).map(r => r.settingId)).toEqual(["b"]);
    expect(await repo.getWorkspaceValue({ workspaceId: "w2", settingId: "a" })).not.toBeNull();
    for (const [w, p, s, v] of [["w1", "p1", "a", 1], ["w1", "p2", "a", 2], ["w2", "p1", "a", 3], ["w1", "p1", "b", 4], ["w1", "p1", "a", 5]] as const) await repo.saveUserValue(val({ scope: "user", workspaceId: w, principalId: p, settingId: s, valueJson: v }));
    expect((await repo.listUserValues({ workspaceId: "w1", principalId: "p1" })).map(r => [r.settingId, r.valueJson])).toEqual([["a", 5], ["b", 4]]);
    expect(await repo.listUserValuesByWorkspace({ workspaceId: "w1" })).toHaveLength(3);
    await repo.deleteUserValue({ workspaceId: "w1", principalId: "p1", settingId: "a" });
    expect(await repo.getUserValue({ workspaceId: "w1", principalId: "p1", settingId: "a" })).toBeNull();
    expect((await repo.getUserValue({ workspaceId: "w1", principalId: "p2", settingId: "a" }))?.valueJson).toBe(2);
    expect((await repo.getUserValue({ workspaceId: "w2", principalId: "p1", settingId: "a" }))?.valueJson).toBe(3);
  });

  it("revision listing sorts by seq, filters by setting, and pages since a seq including global rows", async () => {
    const repo = new InMemorySettingsRepo({ revisions: [rev({ seq: 5 }), rev({ seq: 2, workspaceId: null }), rev({ seq: 4, settingId: "other" }), rev({ seq: 3, workspaceId: "w2" }), rev({ seq: 1 })] });
    expect((await repo.listRevisions({ settingId: "s" })).map(r => r.seq)).toEqual([1, 2, 3, 5]);
    expect((await repo.listRevisionsSince({ sinceSeq: 1, limit: 10, workspaceId: "w1" })).map(r => r.seq)).toEqual([2, 4, 5]);
    expect((await repo.listRevisionsSince({ sinceSeq: 1, limit: 2, workspaceId: "w1" })).map(r => r.seq)).toEqual([2, 4]);
    expect((await repo.listRevisionsSince({ sinceSeq: 5, limit: 10, workspaceId: "w1" }))).toEqual([]);
  });

  it("transaction rolls back every collection and seq on failure, and refuses re-entry", async () => {
    const repo = new InMemorySettingsRepo({ revisions: [rev({ seq: 1 })] });
    await expect(repo.transaction(async () => {
      await repo.saveDefinition(def({}));
      await repo.saveGlobalValue(val({ scope: "global", workspaceId: null }));
      await repo.saveWorkspaceValue(val({}));
      await repo.saveUserValue(val({ scope: "user", principalId: "p" }));
      await repo.appendRevision(rev({}));
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await repo.findDefinitionBySettingId({ settingId: "s" })).toBeNull();
    expect(await repo.getGlobalValue("s")).toBeNull();
    expect(await repo.listWorkspaceValues({ workspaceId: "w1" })).toEqual([]);
    expect(await repo.listUserValuesByWorkspace({ workspaceId: "w1" })).toEqual([]);
    expect(await repo.appendRevision(rev({}))).toBe(2);
    await expect(repo.transaction(() => repo.transaction(async () => 1))).rejects.toThrow(/not reentrant/);
    await expect(repo.transaction(async () => 42)).resolves.toBe(42);
  });
});
