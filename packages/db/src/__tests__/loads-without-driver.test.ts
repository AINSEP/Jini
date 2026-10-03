/**
 * Imports each built subpath alone in a real copied install, preventing Node from finding peers
 * in the workspace through a symlink. Kernel/migrate entries get a fixture containing only
 * Kysely and core; core/connection/transfer/tools entries get a second fixture containing only
 * core, with no database peers at all.
 *
 * Probes exercise public behavior and a resolve hook records the actual module closure. Missing
 * drivers and missing Kysely are positive controls. The independent export-map expectation must
 * cover every declared subpath, so a new untested barrel cannot silently enter the package.
 */
import { execFileSync } from "node:child_process";
// Driver isolation is a runtime promise, even for the driver-specific entries: hosts inject
// their own clients. Loading a second SQLite library can corrupt a database because both
// copies share the process's POSIX locks; an import-closure probe checks more than types can.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Subpath → the dist directories its import may load, and an expression that must evaluate to
 * "ok" with the module bound as `m` (proves it works, not merely resolves). Specifiers are data and
 * interpolated below, because the guard's import extractor matches `import('<literal>')` even
 * inside a string.
 */
const SUBPATHS: Record<string, { dirs: string[]; probe: string; kernel?: boolean }> = {
  core: {
    dirs: ["core"],
    probe: `m.restorePointFilename({ scopeId: "a/b", watermarkAtCapture: 3, timestamp: 4 }) === "restore-point-a_b-wm3-4.db" && m.sanitizeForFilename("a/b") === "a_b" && m.PGLITE_SOCKET_FILE === ".s.PGSQL.5432"`,
  },
  sqlite: {
    dirs: ["sqlite", "core"],
    probe: `(() => {
      const pragmas = [];
      const calls = [];
      const handle = { pragma: p => pragmas.push(p) };
      const returned = m.openSqliteConnection({ filePath: "fake.db", open: (p, o) => { calls.push([p, o]); return handle; } });
      return returned === handle && JSON.stringify(calls) === '[["fake.db",{}]]' && JSON.stringify(pragmas) === '["journal_mode = WAL","foreign_keys = ON","busy_timeout = 5000"]';
    })()`,
  },
  pglite: {
    dirs: ["pglite", "core"],
    probe: `m.pgliteLowMemoryStartParams({ defaultStartParams: ["-x"] }).join(" ") === ["-x", ...m.PGLITE_LOW_MEMORY_SETTINGS].join(" ") && typeof m.startPgliteOwner === "function"`,
  },
  postgres: {
    dirs: ["postgres", "core"],
    probe: `m.pgTypesFor({ types: { getTypeParser: () => x => x } }, { 20: x => Number(x) }).getTypeParser(20)("42") === 42`,
  },
  kernel: {
    dirs: ["kernel", "core"], kernel: true,
    probe: `m.toBool(1) === true && typeof m.buildKernel === "function"`,
  },
  "kernel/sqlite": {
    dirs: ["kernel", "kernel/sqlite", "core", "sqlite"], kernel: true,
    probe: `typeof m.sqliteKernel === "function" && typeof m.openSqliteFileKernel === "function" && typeof m.sqliteOps === "function"`,
  },
  "kernel/pglite": {
    dirs: ["kernel", "kernel/pglite", "core", "pglite"], kernel: true,
    probe: `typeof m.openPgliteKernel === "function" && typeof m.PgliteDialect === "function" && typeof m.pgliteOps === "function"`,
  },
  "kernel/postgres": {
    dirs: ["kernel", "kernel/postgres", "core", "postgres"], kernel: true,
    probe: `typeof m.openPostgresKernel === "function" && typeof m.openPgliteSocketKernel === "function" && typeof m.postgresOps === "function"`,
  },
  transfer: {
    dirs: ["transfer", "core"],
    probe: `m.siteSchemaName({ site: "My Site", naming: { defaultSchema: "app", markerTable: "_app_copy", unvalidatedTable: "pg_temp._app_unvalidated", schemaPrefix: "app_" } }) === "app_my_site" && typeof m.planTransfer === "function"`,
  },
  tools: {
    dirs: ["tools", "transfer", "core"],
    probe: `m.getDatabaseAgentToolCatalog().length === 9 && m.databaseTransferAgentToolCatalog.length === 4 && typeof m.createDatabaseReadTools === "function" && typeof m.createDatabaseTransferTools === "function"`,
  },
  "kernel/store-copy": {
    dirs: ["kernel"], kernel: true,
    probe: `m.BATCH_ROWS === 500 && typeof m.copyPgStore === "function" && typeof m.assertLedgersAgree === "function"`,
  },
  migrate: {
    dirs: ["migrate", "kernel", "core"], kernel: true,
    probe: `m.sourceChecksum("") === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" && typeof m.runMigrations === "function"`,
  },
};

const DRIVERS = ["better-sqlite3", "pg", "@electric-sql/pglite"];

let fixtureDir: string;
let emptyFixtureDir: string;

/** Runs an ESM snippet with the fixture as the bare-specifier resolution base. */
function runInFixture(source: string, cwd = fixtureDir): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", source], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/** Imports `specifier` alone, recording every URL resolved on the way, then evaluates `probe`. */
function importAlone(specifier: string, probe: string, cwd = fixtureDir): { status: number; stderr: string; resolved: string[]; probe: string } {
  const result = runInFixture(
    [
      `import { registerHooks } from "node:module";`,
      `const resolved = [];`,
      `registerHooks({ resolve(spec, context, next) { const r = next(spec, context); resolved.push(r.url); return r; } });`,
      `const m = await import(${JSON.stringify(specifier)});`,
      `process.stdout.write(JSON.stringify({ resolved, probe: (${probe}) ? "ok" : "failed" }));`,
    ].join("\n"), cwd
  );
  const parsed = result.status === 0 ? (JSON.parse(result.stdout) as { resolved: string[]; probe: string }) : { resolved: [], probe: "" };
  return { status: result.status, stderr: result.stderr, ...parsed };
}

beforeAll(() => {
  execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"], { cwd: packageRoot, stdio: "pipe" });

  fixtureDir = mkdtempSync(join(tmpdir(), "jini-db-nodriver-"));
  const installedAt = join(fixtureDir, "node_modules", "@jini-ai", "db");
  mkdirSync(installedAt, { recursive: true });
  cpSync(join(packageRoot, "dist"), join(installedAt, "dist"), { recursive: true });
  cpSync(join(packageRoot, "package.json"), join(installedAt, "package.json"));
  emptyFixtureDir = mkdtempSync(join(tmpdir(), "jini-db-nopeers-"));
  const emptyInstalledAt = join(emptyFixtureDir, "node_modules", "@jini-ai", "db");
  mkdirSync(emptyInstalledAt, { recursive: true });
  cpSync(join(packageRoot, "dist"), join(emptyInstalledAt, "dist"), { recursive: true });
  cpSync(join(packageRoot, "package.json"), join(emptyInstalledAt, "package.json"));
  // Tools use only the zero-dependency core peer; keep Kysely absent in the empty fixture.
  for (const dir of [fixtureDir, emptyFixtureDir]) {
    const installedCore = join(dir, "node_modules", "@jini-ai", "core");
    mkdirSync(installedCore, { recursive: true });
    const coreRoot = fileURLToPath(new URL("../../../core/", import.meta.url));
    cpSync(join(coreRoot, "dist"), join(installedCore, "dist"), { recursive: true });
    cpSync(join(coreRoot, "package.json"), join(installedCore, "package.json"));
  }
  // The optional peer for kernel consumers, copied from its real path (pnpm links it from the store).
  cpSync(realpathSync(join(packageRoot, "node_modules", "kysely")), join(fixtureDir, "node_modules", "kysely"), { recursive: true });
}, 180_000);

afterAll(() => {
  if (emptyFixtureDir) rmSync(emptyFixtureDir, { recursive: true, force: true });
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

describe("@jini-ai/db in an install with no database driver present", () => {
  it("POSITIVE CONTROL: no driver can be resolved in the fixture", () => {
    for (const driver of DRIVERS) {
      expect(existsSync(join(fixtureDir, "node_modules", driver))).toBe(false);
      const result = runInFixture(`await import(${JSON.stringify(driver)});`, emptyFixtureDir);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package/);
    }
  });

  it("built both fixtures without drivers or an ORM", () => {
    for (const dir of [fixtureDir, emptyFixtureDir]) {
      expect(existsSync(join(dir, "node_modules/@jini-ai/db/dist/core/index.js"))).toBe(true);
      for (const driver of [...DRIVERS, "drizzle-orm"]) {
        expect(existsSync(join(dir, "node_modules", driver))).toBe(false);
        const missing = runInFixture(`await import(${JSON.stringify(driver)});`, dir);
        expect(missing.status).not.toBe(0);
        expect(missing.stderr).toContain("ERR_MODULE_NOT_FOUND");
      }
    }
  });

  for (const [subpath, { kernel }] of Object.entries(SUBPATHS)) {
    if (!kernel) continue;
    it(`POSITIVE CONTROL: ./${subpath} requires kysely in the empty fixture`, () => {
      const result = runInFixture(`await import(${JSON.stringify(`@jini-ai/db/${subpath}`)});`, emptyFixtureDir);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("ERR_MODULE_NOT_FOUND");
      expect(result.stderr).toContain("Cannot find package 'kysely'");
    });
  }

  it("exports exactly the subpaths under test (no root barrel that would load everything)", () => {
    const manifest = JSON.parse(readFileSync(join(fixtureDir, "node_modules/@jini-ai/db/package.json"), "utf8")) as { exports: Record<string, unknown>; typesVersions: { "*": Record<string, string[]> } };
    expect(Object.keys(manifest.typesVersions["*"]).sort()).toEqual([...Object.keys(SUBPATHS), "package.json"].sort());
    const exportKeys = Object.keys(manifest.exports);
    expect(exportKeys.sort()).toEqual([...Object.keys(SUBPATHS).map((s) => `./${s}`), "./package.json"].sort());
  });

  for (const [subpath, { dirs, probe }] of Object.entries(SUBPATHS)) {
    it(`./${subpath} imports alone, works, and loads only ${dirs.join(" + ")}`, () => {
      const result = importAlone(`@jini-ai/db/${subpath}`, probe, SUBPATHS[subpath]!.kernel ? fixtureDir : emptyFixtureDir);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.probe).toBe("ok");

      const ownFiles = result.resolved.filter((url) => url.includes("/node_modules/@jini-ai/db/"));
      expect(ownFiles.length).toBeGreaterThan(0);
      for (const url of ownFiles) {
        const inDist = url.split("/node_modules/@jini-ai/db/dist/")[1] ?? "";
        expect(dirs.includes(dirname(inDist)), `${subpath} loaded ${inDist}`).toBe(true);
      }
      const packages = result.resolved.filter((url) => url.includes("/node_modules/") && !url.includes("/node_modules/@jini-ai/db/"));
      if (subpath === "tools") {
        expect(packages.length).toBeGreaterThan(0);
        for (const url of packages) expect(url, `tools loaded an optional peer other than core`).toMatch(/\/node_modules\/@jini-ai\/core\//);
      } else if (!SUBPATHS[subpath]!.kernel) expect(packages).toEqual([]);
      else for (const url of packages) expect(url, `${subpath} loaded a package other than kysely`).toMatch(/\/node_modules\/kysely\//);
    });
  }
});
