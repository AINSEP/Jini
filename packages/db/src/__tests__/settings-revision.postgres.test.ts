import assert from "node:assert/strict";
import { test } from "vitest";
import pg from "pg";
import { SettingsRevisionConflictError, set } from "@jini-ai/core/settings";

import { openPostgresKernel } from "../kernel/postgres/index.js";
import { freshPostgresDatabase } from "../testing/postgres-database.js";
import { prepareSettingsCas, settingsCasWrite, settingsRevisionContract, SqlSettingsCasFixture, type SettingsCasDb } from "./settings-revision.fixture.js";

async function openPair(_required: Record<string, never>, _optional = {}) {
  const connectionString = freshPostgresDatabase("jini_settings_cas_fixture");
  const first = openPostgresKernel<SettingsCasDb>({ pg, connectionString });
  const second = openPostgresKernel<SettingsCasDb>({ pg, connectionString });
  try {
    await prepareSettingsCas({ kernel: first });
    return { first: new SqlSettingsCasFixture({ kernel: first }), second: new SqlSettingsCasFixture({ kernel: second }), close: async () => {
      await first.close();
      await second.close();
    } };
  } catch (error) {
    await first.close();
    await second.close();
    throw error;
  }
}

settingsRevisionContract({ name: "postgres (independent pools)", open: () => openPair({}) });

test("postgres: both transactions reach append before either locks; only one can replace the snapshot", async () => {
  const pair = await openPair({});
  try {
    const firstWrite = settingsCasWrite({ repo: pair.first, scope: "workspace" });
    const secondWrite = settingsCasWrite({ repo: pair.second, scope: "workspace" });
    const snapshot = await set(firstWrite);
    let release!: () => void;
    const bothAppending = new Promise<void>(resolve => { release = resolve; });
    let arrivals = 0;
    for (const repo of [pair.first, pair.second]) {
      const append = repo.appendRevision.bind(repo);
      repo.appendRevision = async record => {
        // A guard moved to transaction entry would let BOTH readers pass before this barrier.
        if (++arrivals === 2) release();
        await bothAppending;
        return append(record);
      };
    }
    const options = { expectedRevisionSeq: snapshot.revisionSeq };
    const results = await Promise.allSettled([
      set({ ...firstWrite, input: { ...firstWrite.input, value: "a" } }, options),
      set({ ...secondWrite, input: { ...secondWrite.input, value: "b" } }, options),
    ]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const failure = results.find(r => r.status === "rejected");
    assert.ok(failure?.status === "rejected");
    assert.ok(failure.reason instanceof SettingsRevisionConflictError);
    const winner = results[0]!.status === "fulfilled" ? "a" : "b";
    const stored = await pair.first.getWorkspaceValue({ workspaceId: "workspace", settingId: "setting" });
    assert.ok(stored);
    assert.equal(stored?.valueJson, winner);
    assert.equal((await pair.first.listRevisions({ settingId: "setting" })).length, 2);
    assert.equal(await pair.first.maxRevisionSeq(), stored.seq);
  } finally {
    await pair.close();
  }
});
