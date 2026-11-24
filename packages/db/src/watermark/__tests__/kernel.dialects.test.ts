import assert from "node:assert/strict";
import { afterAll, afterEach, describe, test, vi } from "vitest";
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "kysely";
import { sqliteKernel } from "../../kernel/sqlite/index.js";
import { openPgliteKernel } from "../../kernel/pglite/index.js";
import type { KyselyKernel } from "../../kernel/port.js";
import { kernelStampWatermark, readKernelWatermark, reconcileMirror, type WriteWatermarkMirror } from "../kernel.js";

/**
 * @file The write watermark on a host-chosen (non-default) table name, on SQLite and PGlite: the stamp
 * advances by exactly 1 and records the stamp time, it commits or rolls back with the transaction it
 * joins, a missing singleton row reads 0, and mirror reconciliation overwrites (or, with no database,
 * marks unrefreshable). The host's own dialect suite stays the parity proof against its real migration.
 */

const tables = { watermark: "app_write_watermark" };
const opened: KyselyKernel<unknown>[] = [];
afterAll(async () => { for (const kernel of opened) await kernel.close(); });
afterEach(() => { vi.useRealTimers(); });

async function openKernel(dialect: "sqlite" | "pglite", { seed = true } = {}): Promise<KyselyKernel<unknown>> {
  const kernel: KyselyKernel<unknown> = dialect === "sqlite" ? sqliteKernel<unknown>({ source: new Database(":memory:") }) : openPgliteKernel({ PGlite });
  opened.push(kernel);
  await kernel.execute(sql`CREATE TABLE app_write_watermark (id integer PRIMARY KEY NOT NULL, value integer NOT NULL DEFAULT 0, last_stamped_at text)`);
  if (seed) await kernel.execute(sql`INSERT INTO app_write_watermark (id, value) VALUES (1, 0)`);
  return kernel;
}

function fakeMirror(initial: { value: number; staleness: "fresh" | "unrefreshable" }): WriteWatermarkMirror & { value: number; staleness: string } {
  return {
    ...initial,
    async set(value: number) { this.value = value; this.staleness = "fresh"; },
    async markUnrefreshable() { this.staleness = "unrefreshable"; },
  };
}

for (const dialect of ["sqlite", "pglite"] as const) {
  describe(`write watermark [${dialect}]`, { timeout: 20_000 }, () => {
    test("N stamps leave initial + N and record the stamp time", async () => {
      const kernel = await openKernel(dialect);
      vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-10-04T12:34:56.789Z") });
      const stamp = kernelStampWatermark({ kernel, tables }, {});
      const observed = [await readKernelWatermark({ kernel, tables })];
      for (let i = 0; i < 3; i += 1) {
        await stamp();
        observed.push(await readKernelWatermark({ kernel, tables }));
      }
      assert.deepEqual(observed, [0, 1, 2, 3]);
      const [row] = await kernel.query<{ last_stamped_at: string }>(sql`SELECT last_stamped_at FROM app_write_watermark WHERE id = 1`);
      assert.equal(row?.last_stamped_at, "2026-10-04T12:34:56.789Z");
    });

    test("a stamp joins the open transaction: it rolls back with it", async () => {
      const kernel = await openKernel(dialect);
      const stamp = kernelStampWatermark({ kernel, tables });
      await assert.rejects(kernel.transaction(async () => { await stamp(); throw new Error("the gated write failed"); }), /the gated write failed/);
      assert.equal(await readKernelWatermark({ kernel, tables }), 0);
      await kernel.transaction(async () => { await stamp(); });
      assert.equal(await readKernelWatermark({ kernel, tables }), 1);
    });

    test("a store without the singleton row reads 0", async () => {
      assert.equal(await readKernelWatermark({ kernel: await openKernel(dialect, { seed: false }), tables }), 0);
    });

    test("reconcileMirror overwrites the mirror from the authoritative value", async () => {
      const kernel = await openKernel(dialect);
      await kernelStampWatermark({ kernel, tables })();
      await kernelStampWatermark({ kernel, tables })();
      const mirror = fakeMirror({ value: 999, staleness: "fresh" });
      await reconcileMirror({ kernel, tables, mirror });
      assert.equal(mirror.value, 2, "never the stale prior value");
      assert.equal(mirror.staleness, "fresh");
    });
  });
}

test("no database leaves the mirror's value and marks it 'unrefreshable'", async () => {
  const mirror = fakeMirror({ value: 42, staleness: "fresh" });
  await reconcileMirror({ kernel: null, tables, mirror });
  assert.equal(mirror.value, 42);
  assert.equal(mirror.staleness, "unrefreshable");
});
