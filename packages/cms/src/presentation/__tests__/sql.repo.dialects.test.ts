import assert from "node:assert/strict";
import { test } from "vitest";

import { type ContentKernel, describeEachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import type { PresentationSettingsRecord } from "../presentation.js";
import { SqlPresentationSettingsRepo } from "../sql/index.js";
import { PRESENTATION_TABLES, createTables } from "./support/presentation-tables.fixture.js";

/**
 * @file The presentation-settings SQL repo on every dialect through the kernel's matrix: one query body serves SQLite
 * and PGlite. Covers every public method: hit, miss, upsert, other-workspace isolation and rollback.
 */

const T0 = "2026-09-28T00:00:00.000Z";
const T1 = "2026-09-28T01:00:00.000Z";

function settings(workspaceId: string, activeThemeId: string, updatedAt = T0): PresentationSettingsRecord {
  return { workspaceId, activeThemeId, updatedAt } as PresentationSettingsRecord;
}

interface Bundle { kernel: ContentKernel; repo: SqlPresentationSettingsRepo }

function bundleFor(kernel: ContentKernel): Bundle {
  return { kernel, repo: new SqlPresentationSettingsRepo({ kernel, tables: PRESENTATION_TABLES }, {}) };
}

describeEachDialect<Bundle>({ title: "presentation settings repo", options: { tables: ["presentation_settings"], createTables, make: bundleFor }, body: (make) => {
  test("save then findByWorkspaceId round-trips; unknown workspace misses", async () => {
    const { repo } = make();
    await repo.save(settings("ws-1", "paper"));
    assert.deepEqual(await repo.findByWorkspaceId({ workspaceId: "ws-1" }), settings("ws-1", "paper"));
    assert.equal(await repo.findByWorkspaceId({ workspaceId: "ws-none" }), null);
  });

  test("save upserts on workspace_id and leaves other workspaces alone", async () => {
    const { repo } = make();
    await repo.save(settings("ws-1", "paper"));
    await repo.save(settings("ws-2", "ink"));
    await repo.save(settings("ws-1", "ink", T1));
    assert.deepEqual(await repo.findByWorkspaceId({ workspaceId: "ws-1" }), settings("ws-1", "ink", T1));
    assert.deepEqual(await repo.findByWorkspaceId({ workspaceId: "ws-2" }), settings("ws-2", "ink"));
    assert.deepEqual((await repo.listAll()).map((row) => row.workspaceId).sort(), ["ws-1", "ws-2"]);
  });

  test("a read returns only the asked workspace's row, whichever row was written first", async () => {
    const { repo } = make();
    await repo.save(settings("ws-1", "paper"));
    await repo.save(settings("ws-2", "ink", T1));
    assert.deepEqual(await repo.findByWorkspaceId({ workspaceId: "ws-2" }), settings("ws-2", "ink", T1));
  });

  test("listAll is empty on a fresh database", async () => {
    const { repo } = make();
    assert.deepEqual(await repo.listAll(), []);
  });

  test("a save inside a failed transaction rolls back", async () => {
    const { kernel, repo } = make();
    await repo.save(settings("ws-1", "paper"));
    await assert.rejects(
      kernel.transaction(async () => {
        await repo.save(settings("ws-1", "ink", T1));
        await repo.save(settings("ws-2", "ink"));
        throw new Error("boom");
      }),
      /boom/
    );
    assert.deepEqual(await repo.listAll(), [settings("ws-1", "paper")]);
  });
} });
