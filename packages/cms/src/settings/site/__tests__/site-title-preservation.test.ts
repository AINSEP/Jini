import assert from "node:assert/strict";
import { sql } from "kysely";
import { test } from "vitest";

import { describeEachDialect, heldUntil } from "../../../core/__tests__/support/dialect-matrix.js";
import { SqlSiteTitlePreservationStore, type SiteTitlePreservationStorePort } from "../site-title-preservation.js";

/**
 * @file SPEC-050 (NC-3 = A): the SQL `SiteTitlePreservationStorePort` adapter on SQLite and PGlite
 * through the kernel matrix. Recorded workspaces are inserted the raw way the host's marker
 * migration does; the table name is injected, as the host does.
 */

const TABLE = "site_title_preexisting_workspaces";
const tables = { preexistingWorkspaces: TABLE };

type Make = (recorded: string[]) => SiteTitlePreservationStorePort;

describeEachDialect<Make>({
  title: "SqlSiteTitlePreservationStore",
  options: {
    tables: [TABLE],
    createTables: async (kernel) => {
      await kernel.run((db) =>
        sql`CREATE TABLE ${sql.table(TABLE)} (workspace_id TEXT PRIMARY KEY, preserved_at TEXT)`.execute(db)
      );
    },
    make: (kernel) => (recorded) => {
      const seeded = (async () => {
        for (const workspaceId of recorded) {
          await kernel.run((db) =>
            db.withTables<Record<string, { workspace_id: string; preserved_at: string | null }>>()
              .insertInto(TABLE)
              .values({ workspace_id: workspaceId, preserved_at: null })
              .execute()
          );
        }
      })();
      return new SqlSiteTitlePreservationStore({ kernel: heldUntil({ kernel, pending: seeded }, {}), tables });
    },
  },
  body: (make) => {
    const makeStore: Make = (recorded) => make()(recorded);
    test("lists every recorded, unresolved workspace, sorted by id", async () => {
      const store = makeStore(["ws-b", "ws-a"]);
      assert.deepEqual(await store.listPendingWorkspaceIds(), ["ws-a", "ws-b"]);
    });

    test("lists nothing when nothing is recorded", async () => {
      assert.deepEqual(await (makeStore([])).listPendingWorkspaceIds(), []);
    });

    test("isPending is true only for a recorded, unresolved workspace", async () => {
      const store = makeStore(["ws-a"]);
      assert.equal(await store.isPending({ workspaceId: "ws-a" }), true);
      assert.equal(await store.isPending({ workspaceId: "ws-never-recorded" }), false);
    });

    test("markPreserved resolves one workspace, leaves the rest pending, and is a no-op when repeated or unrecorded", async () => {
      const store = makeStore(["ws-a", "ws-b"]);

      await store.markPreserved({ workspaceId: "ws-a", preservedAt: "2026-09-12T00:00:00.000Z" });
      await store.markPreserved({ workspaceId: "ws-a", preservedAt: "2026-09-13T00:00:00.000Z" });
      await store.markPreserved({ workspaceId: "ws-never-recorded", preservedAt: "2026-09-12T00:00:00.000Z" });

      assert.equal(await store.isPending({ workspaceId: "ws-a" }), false);
      assert.equal(await store.isPending({ workspaceId: "ws-b" }), true);
      assert.equal(await store.isPending({ workspaceId: "ws-never-recorded" }), false, "marking an unrecorded id must not record it");
      assert.deepEqual(await store.listPendingWorkspaceIds(), ["ws-b"]);
    });
  },
}, {});
