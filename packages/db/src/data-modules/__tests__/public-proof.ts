import { expect } from "vitest";
import { listTables } from "@jini-ai/db/kernel";
import {
  advanceJournalPhase, beginJournalEntry, checkNamespaceAdoption, declareDataModule,
  ensureMigrationJournal, findIncompleteJournalEntries, getPluginIdentity, isIncompletePhase,
  type PluginKernel, type JournalPhase,
} from "@jini-ai/db/data-modules";

export async function exerciseDataModules({ store }: { store: PluginKernel }): Promise<void> {
  const provenance = { sourceUrl: "builtin://example", publisher: "example-core" };
  const decl = {
    pluginId: "example", pluginTier: "tier-2" as const, provenance,
    tables: [{ name: "records", columns: [{ name: "id", type: "TEXT" as const, primaryKey: true }] }],
  };
  expect(await declareDataModule({ db: store, dbPath: ":memory:", decl }, {})).toEqual({
    ok: true, created: ["p_example__records"], altered: [], snapshotPath: null,
  });
  expect(await listTables(store)).toEqual(expect.arrayContaining(["p_example__records", "_plugin_identity", "_plugin_migrations"]));
  expect((await store.run(db => db.selectFrom("_plugin_migrations").selectAll().execute()))[0]?.table_name).toBe("p_example__records");
  expect((await store.run(db => db.selectFrom("_plugin_identity").selectAll().execute()))[0]).toMatchObject({
    plugin_id: "example", source_url: "builtin://example", publisher: "example-core",
  });
  expect((await getPluginIdentity({ db: store, pluginId: "example" }, {}))?.provenance).toEqual(provenance);
  for (const changed of [{ ...provenance, publisher: "other" }, { ...provenance, sourceUrl: "builtin://other" }]) {
    expect(await checkNamespaceAdoption({ db: store, pluginId: "example", provenance: changed }, {})).toMatchObject({
      allowed: false, track: "consent-required",
    });
  }
  expect((await getPluginIdentity({ db: store, pluginId: "example" }, {}))?.provenance).toEqual(provenance);
  expect(await declareDataModule({ db: store, dbPath: ":memory:", decl }, {})).toEqual({
    ok: true, created: [], altered: [], snapshotPath: null,
  });
  await ensureMigrationJournal({ store }, {});
  expect(await listTables(store)).toContain("_plugin_migration_journal");
  const id = await beginJournalEntry({ db: store, pluginId: "example", snapshotPath: "fixture.snapshot" }, {});
  const phases: JournalPhase[] = ["PREPARED_SNAPSHOT", "DDL_IN_PROGRESS", "VERIFYING", "COMMITTED", "ROLLED_BACK"];
  for (const phase of phases) {
    await advanceJournalPhase({ db: store, id, phase }, {});
    const saved = await store.run(db => db.selectFrom("_plugin_migration_journal").selectAll().where("id", "=", id).executeTakeFirstOrThrow());
    expect(saved.phase).toBe(phase);
    expect(isIncompletePhase({ phase }, {})).toBe(!["COMMITTED", "ROLLED_BACK"].includes(phase));
  }
  expect(await findIncompleteJournalEntries({ store }, {})).toEqual([]);
}
