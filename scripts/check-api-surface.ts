/**
 * `pnpm api:check` — compare every published @jini-ai/* package's public API surface to the
 * committed baseline in `api-baseline/`. `pnpm api:update` rewrites the baselines.
 *
 * RULE: exit 1 iff a package REMOVED an `exports` subpath or an exported symbol (a rename is a
 * removal + an addition) AND no pending `.changeset/*.md` bumps that package `major` or `minor`.
 * Added / changed signatures are printed (report-only) and never fail the run.
 * Requires built `dist/` (run `pnpm -r build` first).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  baselineFileName, buildPackageSurface, coveredByChangeset, diffSurface, isBreaking,
  type PackageSurface,
} from "./lib/api-surface.js";
import { duplicateManifestExportKeys } from "./lib/package-sources.js";

const root = join(import.meta.dirname, "..");
const baseDir = join(root, "api-baseline");
const update = process.argv.includes("--update");

const changesets = existsSync(join(root, ".changeset"))
  ? readdirSync(join(root, ".changeset")).filter((f) => f.endsWith(".md") && f !== "README.md")
      .map((f) => readFileSync(join(root, ".changeset", f), "utf8"))
  : [];

let failed = false;
let pkgCount = 0, entryCount = 0, symCount = 0;
if (update) mkdirSync(baseDir, { recursive: true });
for (const dir of readdirSync(join(root, "packages")).sort()) {
  const pkgDir = join(root, "packages", dir);
  const pj = join(pkgDir, "package.json");
  if (!existsSync(pj)) continue;
  const source = readFileSync(pj, "utf8");
  const duplicates = duplicateManifestExportKeys({ file: pj, source });
  if (duplicates.length) {
    for (const diagnostic of duplicates) console.error(`[api] ${diagnostic}`);
    failed = true;
    continue;
  }
  const json = JSON.parse(source);
  if (json.private || !json.exports) continue;
  const cur = buildPackageSurface({ pkgDir, exportsField: json.exports });
  pkgCount++; entryCount += Object.keys(cur).length;
  symCount += Object.values(cur).reduce((n, e) => n + Object.keys(e.symbols).length, 0);
  const file = join(baseDir, baselineFileName({ pkgName: json.name }));
  if (update) { writeFileSync(file, JSON.stringify(cur, null, 1) + "\n"); continue; }
  if (!existsSync(file)) { console.log(`[api] ${json.name}: no baseline (run pnpm api:update)`); continue; }
  const d = diffSurface({ base: JSON.parse(readFileSync(file, "utf8")) as PackageSurface, cur });
  const lines = [
    ...d.removedSubpaths.map((x) => `  REMOVED subpath ${x}`),
    ...d.removedSymbols.map((x) => `  REMOVED export  ${x}`),
    ...d.changedSymbols.map((x) => `  changed export  ${x}`),
    ...d.addedSubpaths.map((x) => `  added subpath   ${x}`),
    ...d.addedSymbols.map((x) => `  added export    ${x}`),
  ];
  if (!lines.length) continue;
  const covered = coveredByChangeset({ pkgName: json.name, changesets });
  const breaking = isBreaking({ diff: d });
  console.log(`[api] ${json.name}${breaking ? (covered ? " (breaking, covered by changeset)" : " (BREAKING, NO major/minor changeset)") : ""}`);
  console.log(lines.join("\n"));
  if (breaking && !covered) failed = true;
}
console.log(`[api] ${update ? "wrote" : "checked"} ${pkgCount} packages, ${entryCount} entries, ${symCount} symbols`);
if (failed) { console.error("[api] FAIL: duplicate manifest keys or removed export(s) without a major/minor changeset. Remove duplicate keys, add a changeset (pnpm changeset), or restore the export."); process.exit(1); }
