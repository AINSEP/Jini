/** Freeze both the runtime and declaration surfaces of the 0.3.3 compatibility shim. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as core from "../db/driver/index.js";
import * as sqlite from "../db/sqlite/index.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const CORE_NAMES = ["DbOpsPort", "RestoreCapability", "RestoreCostClass", "RestoreKind", "RestorePoint", "WatermarkReader", "restorePointFilename", "sanitizeForFilename"];
const SQLITE_NAMES = ["DEFAULT_PRAGMAS", "OpenSqliteConnectionOptions", "SqliteBackupSource", "SqliteDbOpsAdapter", "SqliteDbOpsAdapterDeps", "SqliteRecoveryHook", "openSqliteConnection"];

function exportedNames(subpath: string): string[] {
  const path = `${root}src/db/${subpath === "core" ? "driver" : subpath}/index.ts`;
  const program = ts.createProgram([path], { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(path)!;
  const symbol = checker.getSymbolAtLocation(source)!;
  return checker.getExportsOfModule(symbol).map(s => s.name).sort();
}

describe("infra 0.3.3 shim surface", () => {
  it("keeps exactly the original runtime names on both entries", () => {
    expect(Object.keys(core).sort()).toEqual(["restorePointFilename", "sanitizeForFilename"]);
    expect(Object.keys(sqlite).sort()).toEqual(["DEFAULT_PRAGMAS", "SqliteDbOpsAdapter", "openSqliteConnection"]);
  });
  it("keeps exactly the original names including erased types", () => {
    expect(exportedNames("core")).toEqual(CORE_NAMES);
    expect(exportedNames("sqlite")).toEqual(SQLITE_NAMES);
  });
  it("is an ESM-only shim with an optional database peer", () => {
    const manifest = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
    expect(manifest.description).toBe("Deprecated compatibility re-exports of @jini-ai/db/core and @jini-ai/db/sqlite. Import those directly.");
    expect(manifest.deprecated).toBe("Compatibility shim: use @jini-ai/db/core and @jini-ai/db/sqlite directly.");
    // The outbox entry calls core's clock owner; the database entries still delegate to db.
    expect(manifest.dependencies).toEqual({ "@jini-ai/core": "workspace:^" });
    expect(manifest.scripts.build).toBe("tsc -p tsconfig.json");
    expect(JSON.stringify(manifest.exports)).not.toContain('"require"');
    expect(manifest.peerDependencies).toEqual({ "@jini-ai/db": "^0.6.10" });
    expect(manifest.peerDependenciesMeta).toEqual({ "@jini-ai/db": { optional: true } });
    expect(manifest.devDependencies["@jini-ai/db"]).toBe("workspace:^");
    expect(manifest.devDependencies["@jini-ai/core"]).toBe("workspace:*");
    expect(manifest.devDependencies["better-sqlite3"]).toBeUndefined();
  });
  it("re-exports working pure helpers", () => {
    expect(core.restorePointFilename({ scopeId: "a/b", watermarkAtCapture: 3, timestamp: 4 })).toBe("restore-point-a_b-wm3-4.db");
  });
});
