import type { Kysely } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type {
  SettingDefinitionRecord,
  SettingRevisionRecord,
  SettingValueRecord,
  SettingsRepoPort,
} from "@jini-ai/core/settings";
import {
  toDefinitionRecord,
  toDefinitionRow,
  toDefinitionUpdate,
  toRevisionRecord,
  toValueRecord,
  valueColumns,
  type SettingDefinitionsTable,
  type SettingRevisionsTable,
  type SettingValuesGlobalTable,
  type SettingValuesUserTable,
  type SettingValuesWorkspaceTable,
} from "./repo.rows.js";

/**
 * @file THE `SettingsRepoPort` adapter (SPEC-007, rule-of-two #2): one Kysely query body for every dialect
 * the storage kernel drives (storage plan §4, ADR-066). Satisfies the same port as `@jini-ai/core/settings`'
 * `InMemorySettingsRepo`; `repo.sqlite.ts` is the thin subclass the call sites build from the content db handle.
 *
 * `transaction` is the kernel's: `write-service.ts`'s chokepoint callback awaits repo calls inside it, which
 * the kernel allows (ADR-028 §4's "`BEGIN IMMEDIATE` -> ... -> COMMIT" on SQLite).
 */

/** Host-owned table names. No schema or product table defaults live in the adapter. */
export interface SettingsTables {
  definitions: string;
  valuesGlobal: string;
  valuesWorkspace: string;
  valuesUser: string;
  revisions: string;
}
export interface SettingsSqlRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: SettingsTables;
}

type Db = Kysely<unknown>;
// Host-owned table names need an explicit column schema per table, as in the redirects adapter.
const definitionsOf = (db: Db, tables: SettingsTables) =>
  db.withTables<Record<string, SettingDefinitionsTable>>().selectFrom(tables.definitions);
const revisionsOf = (db: Db, tables: SettingsTables) =>
  db.withTables<Record<string, SettingRevisionsTable>>().selectFrom(tables.revisions);
const globalOf = (db: Db, tables: SettingsTables) =>
  db.withTables<Record<string, SettingValuesGlobalTable>>().selectFrom(tables.valuesGlobal);
const workspaceOf = (db: Db, tables: SettingsTables) =>
  db.withTables<Record<string, SettingValuesWorkspaceTable>>().selectFrom(tables.valuesWorkspace);
const userOf = (db: Db, tables: SettingsTables) =>
  db.withTables<Record<string, SettingValuesUserTable>>().selectFrom(tables.valuesUser);

export class SqlSettingsRepo implements SettingsRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: SettingsTables;
  constructor({ kernel, tables }: SettingsSqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
  }

  async findActiveDefinition(required: {
    namespace: string;
    key: string;
    workspaceId: string | null;
  }): Promise<SettingDefinitionRecord | null> {
    const row = await this.kernel.run((db) =>
      definitionsOf(db, this.tables)
        .selectAll()
        .where("namespace", "=", required.namespace)
        .where("key", "=", required.key)
        .where("workspace_id", required.workspaceId === null ? "is" : "=", required.workspaceId)
        .where("status", "in", ["active", "alias", "tombstone"])
        .orderBy("version")
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toDefinitionRecord(row) : null;
  }

  async findDefinitionBySettingId(required: {
    settingId: string;
    version?: number;
  }): Promise<SettingDefinitionRecord | null> {
    const rows = await this.kernel.run((db) =>
      definitionsOf(db, this.tables).selectAll().where("setting_id", "=", required.settingId).execute()
    );
    if (required.version != null) {
      const row = rows.find((r) => r.version === required.version);
      return row ? toDefinitionRecord(row) : null;
    }
    const active = rows.find((r) => r.status === "active");
    if (active) return toDefinitionRecord(active);
    const latest = rows.sort((a, b) => b.version - a.version)[0];
    return latest ? toDefinitionRecord(latest) : null;
  }

  async listActiveDefinitions(required: { workspaceId: string | null }): Promise<SettingDefinitionRecord[]> {
    const rows = await this.kernel.run((db) =>
      definitionsOf(db, this.tables)
        .selectAll()
        .where("workspace_id", required.workspaceId === null ? "is" : "=", required.workspaceId)
        .where("status", "in", ["active", "alias"])
        .orderBy("setting_id")
        .orderBy("version")
        .execute()
    );
    return rows.map(toDefinitionRecord);
  }

  async saveDefinition(record: SettingDefinitionRecord): Promise<void> {
    const row = toDefinitionRow({ record });
    const updatable = toDefinitionUpdate({ record });
    await this.kernel.run((db) =>
      db
        .withTables<Record<string, SettingDefinitionsTable>>()
        .insertInto(this.tables.definitions)
        .values(row)
        .onConflict((oc) => oc.columns(["setting_id", "version"]).doUpdateSet(updatable))
        .execute()
    );
  }

  async getGlobalValue(settingId: string): Promise<SettingValueRecord | null> {
    const row = await this.kernel.run((db) =>
      globalOf(db, this.tables).selectAll().where("setting_id", "=", settingId).limit(1).executeTakeFirst()
    );
    return row ? toValueRecord({ row, scope: "global", workspaceId: null, principalId: null }) : null;
  }

  async getWorkspaceValue(required: { workspaceId: string; settingId: string }): Promise<SettingValueRecord | null> {
    const row = await this.kernel.run((db) =>
      workspaceOf(db, this.tables)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("setting_id", "=", required.settingId)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toValueRecord({ row, scope: "workspace", workspaceId: required.workspaceId, principalId: null }) : null;
  }

  async getUserValue(required: {
    workspaceId: string;
    principalId: string;
    settingId: string;
  }): Promise<SettingValueRecord | null> {
    const row = await this.kernel.run((db) =>
      userOf(db, this.tables)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("principal_id", "=", required.principalId)
        .where("setting_id", "=", required.settingId)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toValueRecord({ row, scope: "user", workspaceId: required.workspaceId, principalId: required.principalId }) : null;
  }

  async saveGlobalValue(record: SettingValueRecord): Promise<void> {
    const columns = valueColumns({ record });
    await this.kernel.run((db) =>
      db
        .withTables<Record<string, SettingValuesGlobalTable>>()
        .insertInto(this.tables.valuesGlobal)
        .values({ setting_id: record.settingId, ...columns })
        .onConflict((oc) => oc.column("setting_id").doUpdateSet(columns))
        .execute()
    );
  }

  async saveWorkspaceValue(record: SettingValueRecord): Promise<void> {
    const workspaceId = record.workspaceId;
    if (workspaceId == null) throw new Error("saveWorkspaceValue requires workspaceId");
    const columns = valueColumns({ record });
    await this.kernel.run((db) =>
      db
        .withTables<Record<string, SettingValuesWorkspaceTable>>()
        .insertInto(this.tables.valuesWorkspace)
        .values({ setting_id: record.settingId, workspace_id: workspaceId, ...columns })
        .onConflict((oc) => oc.columns(["workspace_id", "setting_id"]).doUpdateSet(columns))
        .execute()
    );
  }

  async saveUserValue(record: SettingValueRecord): Promise<void> {
    const { workspaceId, principalId } = record;
    if (workspaceId == null || principalId == null) {
      throw new Error("saveUserValue requires workspaceId and principalId");
    }
    const columns = valueColumns({ record });
    await this.kernel.run((db) =>
      db
        .withTables<Record<string, SettingValuesUserTable>>()
        .insertInto(this.tables.valuesUser)
        .values({ setting_id: record.settingId, workspace_id: workspaceId, principal_id: principalId, ...columns })
        .onConflict((oc) => oc.columns(["workspace_id", "principal_id", "setting_id"]).doUpdateSet(columns))
        .execute()
    );
  }

  async listWorkspaceValues(required: { workspaceId: string }): Promise<SettingValueRecord[]> {
    const rows = await this.kernel.run((db) =>
      workspaceOf(db, this.tables).selectAll().where("workspace_id", "=", required.workspaceId).execute()
    );
    return rows.map((r) => toValueRecord({ row: r, scope: "workspace", workspaceId: required.workspaceId, principalId: null }));
  }

  async listUserValues(required: { workspaceId: string; principalId: string }): Promise<SettingValueRecord[]> {
    const rows = await this.kernel.run((db) =>
      userOf(db, this.tables)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("principal_id", "=", required.principalId)
        .execute()
    );
    return rows.map((r) => toValueRecord({ row: r, scope: "user", workspaceId: required.workspaceId, principalId: required.principalId }));
  }

  async listUserValuesByWorkspace(required: { workspaceId: string }): Promise<SettingValueRecord[]> {
    const rows = await this.kernel.run((db) =>
      userOf(db, this.tables).selectAll().where("workspace_id", "=", required.workspaceId).execute()
    );
    return rows.map((r) => toValueRecord({ row: r, scope: "user", workspaceId: required.workspaceId, principalId: r.principal_id }));
  }

  // The two deletes below remove an override row (the value falls back to its default); they are the
  // adapter's only deletes and the settings ledger (`revisions`) is never touched by them.
  async deleteWorkspaceValue(required: { workspaceId: string; settingId: string }): Promise<void> {
    await this.kernel.run((db) =>
      db
        .withTables<Record<string, SettingValuesWorkspaceTable>>()
        .deleteFrom(this.tables.valuesWorkspace)
        .where("workspace_id", "=", required.workspaceId)
        .where("setting_id", "=", required.settingId)
        .execute()
    );
  }

  async deleteUserValue(required: { workspaceId: string; principalId: string; settingId: string }): Promise<void> {
    await this.kernel.run((db) =>
      db
        .withTables<Record<string, SettingValuesUserTable>>()
        .deleteFrom(this.tables.valuesUser)
        .where("workspace_id", "=", required.workspaceId)
        .where("principal_id", "=", required.principalId)
        .where("setting_id", "=", required.settingId)
        .execute()
    );
  }

  /**
   * Appends one revision and returns its `seq`. Takes `lockKey` on the revision stream inside the
   * caller's transaction (or its own): `listRevisionsSince` subscribers page by `seq`, so a lower
   * `seq` must never commit after a higher one — on Postgres, sequence values are handed out before
   * commit, and without the lock two writers could commit out of order and a subscriber would skip
   * the late one. SQLite's `BEGIN IMMEDIATE` already serializes writers.
   */
  async appendRevision(record: Omit<SettingRevisionRecord, "seq">): Promise<number> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey("setting_revisions");
      const inserted = await this.kernel.run((db) =>
        db
          .withTables<Record<string, SettingRevisionsTable>>()
          .insertInto(this.tables.revisions)
          .values({
            entity_kind: record.entityKind,
            setting_id: record.settingId,
            scope: record.scope,
            workspace_id: record.workspaceId,
            principal_id: record.principalId,
            op: record.op,
            before_json: record.beforeJson == null ? null : JSON.stringify(record.beforeJson),
            after_json: record.afterJson == null ? null : JSON.stringify(record.afterJson),
            def_version: record.defVersion,
            actor: record.actor,
            origin_plugin_id: record.originPluginId,
            change_set_id: record.changeSetId,
            created_at: record.createdAt,
          })
          .returning("seq")
          .executeTakeFirstOrThrow()
      );
      return Number(inserted.seq);
    });
  }

  async listRevisions(required: { settingId: string }): Promise<SettingRevisionRecord[]> {
    const rows = await this.kernel.run((db) =>
      revisionsOf(db, this.tables).selectAll().where("setting_id", "=", required.settingId).orderBy("seq").execute()
    );
    return rows.map(toRevisionRecord);
  }

  async listRevisionsSince(required: {
    sinceSeq: number;
    limit: number;
    workspaceId: string;
  }): Promise<SettingRevisionRecord[]> {
    const rows = await this.kernel.run((db) =>
      revisionsOf(db, this.tables)
        .selectAll()
        .where("seq", ">", required.sinceSeq)
        // A NULL `workspace_id` is a platform definition or a `global`-scope value — resolved by
        // every workspace, so every workspace must hear about it. Everything else belongs to one
        // tenant. See the port's doc for why this is a page-sizing predicate rather than the
        // disclosure check: it must stay a superset of `isRevisionVisibleTo`, which remains the
        // only thing deciding what a subscriber is actually told.
        .where((eb) => eb.or([eb("workspace_id", "is", null), eb("workspace_id", "=", required.workspaceId)]))
        .orderBy("seq")
        .limit(required.limit)
        .execute()
    );
    return rows.map(toRevisionRecord);
  }

  async maxRevisionSeq(): Promise<number> {
    // `seq` is the auto-assigned primary key, so this is an index lookup rather than a scan.
    const row = await this.kernel.run((db) =>
      revisionsOf(db, this.tables).select("seq").orderBy("seq", "desc").limit(1).executeTakeFirst()
    );
    return row ? Number(row.seq) : 0;
  }

  /**
   * Runs `fn` inside one kernel transaction. A call nested in the same async context joins the
   * outer one; an unrelated caller (another request) waits its turn instead of landing inside it —
   * the kernel tracks this per async context, so two independent root calls never merge (the defect
   * an instance-level depth counter once had). A caller that needs several writes to commit together
   * opens ONE transaction around them — see `resetNamespace`.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.kernel.transaction(fn);
  }
}
