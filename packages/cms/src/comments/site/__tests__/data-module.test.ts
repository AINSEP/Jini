import { expect, test, vi } from "vitest";

import { installCommentsDataModule, type DeclareCommentsDataModule } from "../data-module-install.js";
import { commentsDataModule } from "../types.js";

/** @file The comments data-module declaration carries the host's provenance and the two plugin tables. */

test("commentsDataModule stamps the host-supplied provenance and declares the comments + moderation tables", () => {
  const provenance = { sourceUrl: "builtin://comments", publisher: "host-core" };
  const decl = commentsDataModule({ provenance });
  expect(decl.provenance).toBe(provenance);
  expect(decl.pluginId).toBe("comments");
  expect(decl.pluginTier).toBe("tier-2");
  expect(decl.tables.map((table) => table.name)).toHaveLength(2);
});

test("installs both private comment tables using the supplied store, database path, and provenance", async () => {
  const db = { identity: "workspace-store" };
  const provenance = { sourceUrl: "builtin://comments", publisher: "host-core" };
  const declareDataModule = vi.fn<DeclareCommentsDataModule<typeof db>>(async () => ({ ok: true }));
  await installCommentsDataModule({ db, dbPath: "/fixtures/site/data.db", provenance, declareDataModule });
  expect(declareDataModule).toHaveBeenCalledTimes(1);
  const [{ decl, db: installedDb, dbPath }] = declareDataModule.mock.calls[0]!;
  expect(installedDb).toBe(db);
  expect(dbPath).toBe("/fixtures/site/data.db");
  expect({ pluginId: decl.pluginId, pluginTier: decl.pluginTier, provenance: decl.provenance }).toEqual({
    pluginId: "comments", pluginTier: "tier-2", provenance,
  });
  expect(Object.fromEntries(decl.tables.map((table) => [table.name, table.portability]))).toEqual({
    comments: { kind: "private" }, moderation_log: { kind: "private" },
  });
});

test("stops boot with the store's typed declaration failure", async () => {
  await expect(installCommentsDataModule({
    db: { identity: "workspace-store" }, dbPath: "/fixtures/site/data.db", provenance: { sourceUrl: "builtin://comments", publisher: "host-core" },
    declareDataModule: async () => ({ ok: false, error: { code: "READ_ONLY", message: "The store cannot create tables." } }),
  })).rejects.toThrow("comments dataModule declaration failed: READ_ONLY — The store cannot create tables.");
});

test("a failed declaration with only an error code still stops boot", async () => {
  await expect(installCommentsDataModule({
    db: { identity: "workspace-store" }, dbPath: "/fixtures/site/data.db", provenance: { sourceUrl: "builtin://comments", publisher: "host-core" },
    declareDataModule: async () => ({ ok: false, error: { code: "INCOMPLETE" } }),
  })).rejects.toThrow("comments dataModule declaration failed: INCOMPLETE");
});
