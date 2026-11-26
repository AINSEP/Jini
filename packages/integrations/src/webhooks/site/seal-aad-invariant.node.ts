import path from "node:path";
import type ts from "typescript";
import { findSealCallsInSource, type SealViolation } from "./seal-aad-invariant.js";

function isTestFile({ file }: { file: string }, _optional = {}): boolean {
  return /__tests__|\.test\.|\.spec\./.test(file);
}

function collectTsFiles({ dir, fs }: { dir: string; fs: Parameters<typeof findSealCallsWithoutAad>[0]["fs"] }, _optional = {}): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles({ dir: full, fs }));
    } else if (/\.tsx?$/.test(entry.name) && !isTestFile({ file: full })) {
      out.push(full);
    } else {
      // Non-source entries are outside the seal invariant.
    }
  }
  return out;
}

/** Real-repo scan: every non-test `.ts`/`.tsx` file under `scanRoot`, reported paths relative to
 * the repo root. Defaults to `apps/website/src` — the only surface `SecretSealerPort.seal()` is
 * called from today. */
export function findSealCallsWithoutAad(
  { repoRoot, scanRoot, fs, ast, isExempt }: {
    repoRoot: string; scanRoot: string;
    fs: { readdirSync(dir: string, options: { withFileTypes: true }): readonly { name: string; isDirectory(): boolean }[]; readFileSync(file: string, encoding: "utf8"): string };
    ast: typeof ts;
    isExempt: Parameters<typeof findSealCallsInSource>[0]["isExempt"];
  },
  _optional: Record<string, never> = {},
): SealViolation[] {
  const violations: SealViolation[] = [];
  for (const file of collectTsFiles({ dir: scanRoot, fs })) {
    const sourceText = fs.readFileSync(file, "utf8");
    violations.push(...findSealCallsInSource({ sourceText, displayPath: path.relative(repoRoot, file), ast, isExempt }));
  }
  return violations;
}
