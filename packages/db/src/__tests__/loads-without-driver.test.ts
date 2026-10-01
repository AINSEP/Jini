/**
 * The consumer smoke test for every subpath: each one imports ALONE, in an install that holds this
 * package and its one required peer (kysely) and no database driver at all.
 *
 * `pnpm guard`'s R12 proves `./kernel` never writes an import that reaches a driver. This proves
 * the stronger promise the package makes: NO subpath loads a driver — not even `./sqlite`,
 * `./pglite` or `./postgres`, because the consumer passes its own client, pool or class in. A
 * second copy of better-sqlite3 in one process can corrupt a database (two libraries, one set of
 * POSIX locks), so "the package never loads a driver" is checked by behaviour, not by reading code.
 *
 * It also proves each subpath loads only its own files plus `kernel/` (never a sibling driver's):
 * every module the import resolves is recorded through a `node:module` resolve hook.
 *
 * It is a real install fixture rather than a mock: the built `dist/` and `package.json` are copied
 * (not symlinked — a symlink would let Node walk up into this package's own `node_modules` and find
 * the drivers) into a throwaway directory whose `node_modules` holds only kysely. The positive
 * control shows the drivers genuinely cannot be resolved there.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Subpath → the dist directories its import may load, and an expression that must evaluate to
 * "ok" with the module bound as `m` (proves it works, not merely resolves). Specifiers are data and
 * interpolated below, because the guard's import extractor matches `import('<literal>')` even
 * inside a string.
 */
const SUBPATHS: Record<string, { dirs: string[]; probe: string }> = {
  kernel: {
    dirs: ["kernel"],
    probe: `m.toBool(1) === true && m.PGLITE_SOCKET_FILE === ".s.PGSQL.5432" && typeof m.buildKernel === "function"`,
  },
  sqlite: {
    dirs: ["sqlite", "kernel"],
    probe: `typeof m.sqliteKernel === "function" && typeof m.openSqliteFileKernel === "function" && typeof m.sqliteOps === "function"`,
  },
  pglite: {
    dirs: ["pglite", "kernel"],
    probe: `m.pgliteLowMemoryStartParams({ defaultStartParams: ["-x"] }).join(" ") === ["-x", ...m.PGLITE_LOW_MEMORY_SETTINGS].join(" ") && typeof m.startPgliteOwner === "function"`,
  },
  postgres: {
    dirs: ["postgres", "kernel"],
    probe: `typeof m.openPostgresKernel === "function" && typeof m.openPgliteSocketKernel === "function" && typeof m.postgresOps === "function"`,
  },
  migrate: {
    dirs: ["migrate", "kernel"],
    probe: `m.sourceChecksum("") === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" && typeof m.runMigrations === "function"`,
  },
};

const DRIVERS = ["better-sqlite3", "pg", "@electric-sql/pglite"];

let fixtureDir: string;

/** Runs an ESM snippet with the fixture as the bare-specifier resolution base. */
function runInFixture(source: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", source], {
      cwd: fixtureDir,
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
function importAlone(specifier: string, probe: string): { status: number; stderr: string; resolved: string[]; probe: string } {
  const result = runInFixture(
    [
      `import { registerHooks } from "node:module";`,
      `const resolved = [];`,
      `registerHooks({ resolve(spec, context, next) { const r = next(spec, context); resolved.push(r.url); return r; } });`,
      `const m = await import(${JSON.stringify(specifier)});`,
      `process.stdout.write(JSON.stringify({ resolved, probe: (${probe}) ? "ok" : "failed" }));`,
    ].join("\n")
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
  // The one required peer, copied from its real path (pnpm links it from the store).
  cpSync(realpathSync(join(packageRoot, "node_modules", "kysely")), join(fixtureDir, "node_modules", "kysely"), { recursive: true });
}, 180_000);

afterAll(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

describe("@jini-ai/db in an install with no database driver present", () => {
  it("POSITIVE CONTROL: no driver can be resolved in the fixture", () => {
    for (const driver of DRIVERS) {
      expect(existsSync(join(fixtureDir, "node_modules", driver))).toBe(false);
      const result = runInFixture(`await import(${JSON.stringify(driver)});`);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package/);
    }
  });

  it("exports exactly the subpaths under test (no root barrel that would load everything)", () => {
    const manifest = JSON.parse(readFileSync(join(fixtureDir, "node_modules/@jini-ai/db/package.json"), "utf8")) as { exports: Record<string, unknown> };
    const exportKeys = Object.keys(manifest.exports);
    expect(exportKeys.sort()).toEqual([...Object.keys(SUBPATHS).map((s) => `./${s}`), "./package.json"].sort());
  });

  for (const [subpath, { dirs, probe }] of Object.entries(SUBPATHS)) {
    it(`./${subpath} imports alone, works, and loads only ${dirs.join(" + ")}`, () => {
      const result = importAlone(`@jini-ai/db/${subpath}`, probe);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.probe).toBe("ok");

      const ownFiles = result.resolved.filter((url) => url.includes("/node_modules/@jini-ai/db/"));
      expect(ownFiles.length).toBeGreaterThan(0);
      for (const url of ownFiles) {
        const inDist = url.split("/node_modules/@jini-ai/db/dist/")[1] ?? "";
        expect(dirs.some((dir) => inDist.startsWith(`${dir}/`)), `${subpath} loaded ${inDist}`).toBe(true);
      }
      const packages = result.resolved.filter((url) => url.includes("/node_modules/") && !url.includes("/node_modules/@jini-ai/db/"));
      for (const url of packages) expect(url, `${subpath} loaded a package other than kysely`).toMatch(/\/node_modules\/kysely\//);
    });
  }
});
