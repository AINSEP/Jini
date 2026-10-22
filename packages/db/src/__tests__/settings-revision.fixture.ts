import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "vitest";
import { sql, type Generated } from "kysely";
import {
  InMemorySettingsRepo, SettingsRevisionConflictError, clear, set,
  type SettingDefinitionRecord, type SettingRevisionRecord, type SettingScope,
  type SettingValueRecord, type SettingsWriteServiceDeps,
} from "@jini-ai/core/settings";

import type { StorageKernel } from "../kernel/port.js";

export interface SettingsCasDb {
  cas_values: { id: string; record: string };
  cas_revisions: { seq: Generated<number>; record: string };
}

const NOW = "2026-10-22T00:00:00.000Z";
const definition: SettingDefinitionRecord = {
  settingId: "setting", version: 1, workspaceId: null, namespace: "core.cas", key: "choice",
  ownerKind: "core", ownerId: null, schema: { type: "string" }, defaultValue: "default",
  scopes: 7, secret: false, status: "active", aliasOfNamespace: null, aliasOfKey: null,
  coercionTag: null, createdAt: NOW, updatedAt: NOW,
};

/**
 * A test-only SettingsRepoPort seam: static definitions use memory; scoped values and revisions
 * use real SQL. This is not the host-owned settings adapter or its schema. It exercises the
 * settings service against the kernel's actual transaction/lock/rollback behavior on each driver.
 */
export class SqlSettingsCasFixture extends InMemorySettingsRepo {
  readonly kernel: StorageKernel<SettingsCasDb>;

  constructor(required: { kernel: StorageKernel<SettingsCasDb> }, _optional = {}) {
    super({ definitions: [definition] });
    this.kernel = required.kernel;
  }

  private async readValue(required: { scope: SettingScope; settingId: string; workspaceId?: string; principalId?: string }, _optional = {}) {
    const id = JSON.stringify([required.scope, required.workspaceId ?? null, required.principalId ?? null, required.settingId]);
    const row = await this.kernel.run(db => db.selectFrom("cas_values").select("record").where("id", "=", id).executeTakeFirst());
    return row ? JSON.parse(row.record) as SettingValueRecord : null;
  }

  override getGlobalValue(settingId: string) { return this.readValue({ scope: "global", settingId }); }
  override getWorkspaceValue(required: { workspaceId: string; settingId: string }) {
    return this.readValue({ ...required, scope: "workspace" });
  }
  override getUserValue(required: { workspaceId: string; principalId: string; settingId: string }) {
    return this.readValue({ ...required, scope: "user" });
  }

  private async saveValue(record: SettingValueRecord, _optional = {}) {
    const id = JSON.stringify([record.scope, record.workspaceId, record.principalId, record.settingId]);
    const value = { id, record: JSON.stringify(record) };
    await this.kernel.run(db => db.insertInto("cas_values").values(value)
      .onConflict(oc => oc.column("id").doUpdateSet({ record: value.record })).execute());
  }

  override saveGlobalValue(record: SettingValueRecord) { return this.saveValue(record); }
  override saveWorkspaceValue(record: SettingValueRecord) { return this.saveValue(record); }
  override saveUserValue(record: SettingValueRecord) { return this.saveValue(record); }

  /** Reuse the kernel lock, held by the outer service transaction through comparison and save. */
  override async appendRevision(record: Omit<SettingRevisionRecord, "seq">): Promise<number> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey("setting_revisions");
      const row = await this.kernel.run(db => db.insertInto("cas_revisions")
        .values({ record: JSON.stringify(record) }).returning("seq").executeTakeFirstOrThrow());
      return Number(row.seq);
    });
  }

  override async listRevisions(required: { settingId: string }): Promise<SettingRevisionRecord[]> {
    const rows = await this.kernel.run(db => db.selectFrom("cas_revisions").selectAll().orderBy("seq").execute());
    return rows.map(row => ({ ...JSON.parse(row.record) as Omit<SettingRevisionRecord, "seq">, seq: Number(row.seq) }))
      .filter(row => row.settingId === required.settingId);
  }

  override async maxRevisionSeq(): Promise<number> {
    const row = await this.kernel.run(db => db.selectFrom("cas_revisions").select("seq").orderBy("seq", "desc").limit(1).executeTakeFirst());
    return Number(row?.seq ?? 0);
  }

  override transaction<T>(fn: () => Promise<T>): Promise<T> { return this.kernel.transaction(fn); }
}

/** Portable probe schema; Postgres sequence gaps after rollback are allowed. */
export async function prepareSettingsCas(required: { kernel: StorageKernel<SettingsCasDb> }, _optional = {}) {
  await required.kernel.execute(sql`CREATE TABLE cas_values (id text PRIMARY KEY, record text NOT NULL)`);
  const seq = required.kernel.dialect === "sqlite" ? sql`INTEGER PRIMARY KEY AUTOINCREMENT` : sql`BIGSERIAL PRIMARY KEY`;
  await required.kernel.execute(sql`CREATE TABLE cas_revisions (seq ${seq}, record text NOT NULL)`);
}

export function settingsCasWrite(required: { repo: SqlSettingsCasFixture; scope: SettingScope }, _optional = {}) {
  const deps: SettingsWriteServiceDeps = {
    repo: required.repo, clock: { nowMs: () => Date.parse(NOW) }, ids: { newId: () => "unused" },
    authorize: async () => ({ allowed: true, reason: "test" }),
    principals: { findActiveById: async ({ id }) => ({ id }) },
  };
  return { deps, input: { namespace: definition.namespace, key: definition.key, scope: required.scope,
    workspaceId: "workspace", callerPrincipalId: "actor", value: "first" } };
}

export interface SettingsCasPair {
  first: SqlSettingsCasFixture;
  second: SqlSettingsCasFixture;
  close(): Promise<void>;
}

function readScopedValue(required: { repo: SqlSettingsCasFixture; scope: SettingScope }, _optional = {}) {
  if (required.scope === "global") return required.repo.getGlobalValue("setting");
  const target = { workspaceId: "workspace", settingId: "setting" };
  if (required.scope === "workspace") return required.repo.getWorkspaceValue(target);
  return required.repo.getUserValue({ ...target, principalId: "actor" });
}

/** Same service assertions on each SQL driver; the fixture supplies only physical storage. */
export function settingsRevisionContract(required: { name: string; open: () => Promise<SettingsCasPair> }, _optional = {}) {
  describe(`${required.name}: settings revision check`, () => {
    let pair: SettingsCasPair;
    beforeEach(async () => { pair = await required.open(); });
    afterEach(async () => { await pair?.close(); });

    for (const scope of ["global", "workspace", "user"] as const) {
      test(`${scope}: guarded set/clear and stale rollback preserve value and ledger`, async () => {
        const write = settingsCasWrite({ repo: pair.first, scope });
        const first = await set(write, { expectedRevisionSeq: 0 });
        const before = await pair.first.listRevisions({ settingId: "setting" });
        const valueBefore = await readScopedValue({ repo: pair.first, scope });
        await assert.rejects(() => set(write, { expectedRevisionSeq: 0 }), SettingsRevisionConflictError);
        await assert.rejects(() => clear(write, { expectedRevisionSeq: 0 }), SettingsRevisionConflictError);
        assert.deepEqual(await pair.first.listRevisions({ settingId: "setting" }), before);
        assert.deepEqual(await readScopedValue({ repo: pair.first, scope }), valueBefore);
        assert.equal(await pair.first.maxRevisionSeq(), first.revisionSeq);
        const cleared = await clear(write, { expectedRevisionSeq: first.revisionSeq });
        await assert.rejects(() => set(write, { expectedRevisionSeq: first.revisionSeq }), SettingsRevisionConflictError);
        const next = await set(write, { expectedRevisionSeq: cleared.revisionSeq });
        await clear(write);
        await set(write);
        const read = await readScopedValue({ repo: pair.first, scope });
        assert.ok(read);
        assert.equal(read?.valueJson, "first");
        assert.equal(read?.state, "set");
        assert.ok(read.seq > next.revisionSeq);
        assert.deepEqual((await pair.first.listRevisions({ settingId: "setting" })).map(r => r.op), ["set", "clear", "set", "clear", "set"]);
      });
    }

    for (const winner of [set, clear]) {
      for (const loser of [set, clear]) {
        test(`concurrent ${winner.name}/${loser.name}: exactly one snapshot writer commits`, async () => {
          const firstWrite = settingsCasWrite({ repo: pair.first, scope: "workspace" });
          const secondWrite = settingsCasWrite({ repo: pair.second, scope: "workspace" });
          const first = await set(firstWrite);
          const options = { expectedRevisionSeq: first.revisionSeq };
          const settled = await Promise.allSettled([winner(firstWrite, options), loser(secondWrite, options)]);
          assert.equal(settled.filter(r => r.status === "fulfilled").length, 1);
          const refusal = settled.find(r => r.status === "rejected");
          assert.ok(refusal?.status === "rejected");
          assert.ok(refusal.reason instanceof SettingsRevisionConflictError);
          assert.equal(refusal.reason.expectedRevisionSeq, first.revisionSeq);
          const revisions = await pair.first.listRevisions({ settingId: "setting" });
          assert.equal(revisions.length, 2);
          const stored = await pair.first.getWorkspaceValue({ workspaceId: "workspace", settingId: "setting" });
          assert.ok(stored);
          assert.equal(stored?.seq, revisions[1]!.seq);
          assert.equal(stored?.state, revisions[1]!.op === "clear" ? "cleared" : "set");
          assert.equal(refusal.reason.actualRevisionSeq, stored.seq);
        });
      }
    }
  });
}
