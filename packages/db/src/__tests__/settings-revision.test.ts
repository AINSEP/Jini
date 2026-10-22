import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";

import { openPgliteKernel } from "../kernel/pglite/index.js";
import { openSqliteFileKernel } from "../kernel/sqlite/index.js";
import { prepareSettingsCas, settingsRevisionContract, SqlSettingsCasFixture, type SettingsCasDb } from "./settings-revision.fixture.js";

settingsRevisionContract({ name: "sqlite (two file connections)", open: async () => {
  const dir = await mkdtemp(join(tmpdir(), "settings-cas-"));
  const file = join(dir, "settings.sqlite");
  const open = (path: string, options: Database.Options) => new Database(path, options);
  const first = openSqliteFileKernel<SettingsCasDb>({ filePath: file, open });
  const second = openSqliteFileKernel<SettingsCasDb>({ filePath: file, open });
  try {
    await prepareSettingsCas({ kernel: first });
    return { first: new SqlSettingsCasFixture({ kernel: first }), second: new SqlSettingsCasFixture({ kernel: second }), close: async () => {
      await first.close();
      await second.close();
      await rm(dir, { recursive: true, force: true });
    } };
  } catch (error) {
    await first.close();
    await second.close();
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
} });

settingsRevisionContract({ name: "pglite", open: async () => {
  const kernel = openPgliteKernel<SettingsCasDb>({ PGlite });
  try {
    await prepareSettingsCas({ kernel });
    return { first: new SqlSettingsCasFixture({ kernel }), second: new SqlSettingsCasFixture({ kernel }), close: () => kernel.close() };
  } catch (error) {
    await kernel.close();
    throw error;
  }
} });
