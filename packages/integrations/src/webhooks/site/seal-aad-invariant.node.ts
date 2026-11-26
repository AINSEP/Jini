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
 * the repo root. Defaults to `the host website app/src` — the only surface `SecretSealerPort.seal()` is
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

/** The host's exact exemption: one path AND one whitespace-collapsed call text, never the text alone. */
export function createNonSecretSealCallPredicate({ exemptions }: { exemptions: Readonly<Record<string, string>> }, _optional = {}) {
  return ({ displayPath, text }: { displayPath: string; text: string }): boolean => exemptions[displayPath] === text;
}

export function runSealAadCheck({ repoRoot, scanRoot, fs, ast, exemptions, stdout, stderr, copy }: {
  repoRoot: string; scanRoot: string;
  fs: Parameters<typeof findSealCallsWithoutAad>[0]["fs"];
  ast: typeof ts;
  exemptions: Readonly<Record<string, string>>;
  stdout: (text: string) => void; stderr: (text: string) => void;
  copy: { clean: string; findings: (count: number) => string; guidance: string };
}, _optional = {}): 0 | 1 {
  const violations = findSealCallsWithoutAad({ repoRoot, scanRoot, fs, ast, isExempt: createNonSecretSealCallPredicate({ exemptions }) });
  if (violations.length === 0) {
    stdout(copy.clean);
    return 0;
  }
  stderr(copy.findings(violations.length));
  for (const v of violations) {
    stderr(`  - ${v.file}:${v.line} [${v.reason}] ${v.text}`);
  }
  stderr(copy.guidance);
  return 1;
}
