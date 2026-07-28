/**
 * Shared file-walk + import-specifier extraction for the guard checks. Deliberately a
 * regex-based MVP, not a full `ts.resolveModuleName` AST pass (per the 2026-07-19
 * swarm-consensus debate's convergence: "no full AST needed for v0" — see
 * ADS-memory/reports/swarm-consensus/runs/2026-07-19T1632-consensus-report.md). Good enough to
 * catch real violations; a future pass can upgrade to the TS compiler API without changing
 * either check's calling convention.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface ImportRef {
  /** Repo-relative path of the file containing the import, forward-slashed. */
  readonly file: string;
  /** The raw module specifier as written (e.g. `'../foo.js'`, `'@injini/core/internal'`). */
  readonly specifier: string;
  /** True for `import type ... from` / `export type ... from`; false for value imports. */
  readonly typeOnly: boolean;
}

const REPO_ROOT = new URL('../../', import.meta.url).pathname;

/** `import`/`export ... from '<spec>'`, optionally `type`-qualified, across a multi-line clause. */
const FROM_IMPORT_RE = /\b(import|export)\s+(type\s+)?[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g;
/** Bare side-effect import: `import '<spec>';` with no `from`. */
const BARE_IMPORT_RE = /\bimport\s+['"]([^'"]+)['"]/g;
/** Dynamic `import('<spec>')`. */
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]/g;

/** Recursively lists every `.ts`/`.tsx` file under `dir` (repo-absolute), skipping declarations, `dist`, and `node_modules`. */
export function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function toRepoRelative(absPath: string): string {
  return relative(REPO_ROOT, absPath).split('\\').join('/');
}

/**
 * Replaces `//line` and `/* block *\/` comment bodies (including JSDoc) with spaces,
 * preserving line/column count and everything inside string/template literals verbatim.
 * Exists because this codebase's own convention is to cite the *original* OD import path or
 * env-var name inside a module-doc comment as porting provenance (e.g. "the `OD_DATA_DIR` env
 * var name... was removed") — a naive content scan flags that documentation as a live
 * violation. Without this, both the import extractor and the R5 product-identity scan produced
 * false positives on every single file that documents what it de-branded (found empirically:
 * the first real `pnpm guard` run below flagged 7 files, all 7 comment-only).
 */
export function stripComments(source: string): string {
  let out = '';
  let inLineComment = false;
  let inBlockComment = false;
  let inString: string | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]!;
    const next = source[i + 1];
    if (inLineComment) {
      out += c === '\n' ? '\n' : ' ';
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        out += '  ';
        i += 1;
        inBlockComment = false;
      } else {
        out += c === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === '\\' && next !== undefined) {
        out += next;
        i += 1;
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '/' && next === '/') {
      inLineComment = true;
      out += '  ';
      i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      out += '  ';
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c;
      out += c;
      continue;
    }
    out += c;
  }
  return out;
}

/** Extracts every import/export specifier from one `.ts`/`.tsx` file, repo-root-absolute or relative. */
export function extractImports(absFilePath: string): ImportRef[] {
  const content = stripComments(readFileSync(absFilePath, 'utf8'));
  const file = toRepoRelative(absFilePath);
  const refs: ImportRef[] = [];

  for (const m of content.matchAll(FROM_IMPORT_RE)) {
    // Groups 1 and 3 are required (non-optional) captures — always defined when the overall
    // match succeeds. Group 2 (`type `) is genuinely optional, hence `Boolean(m[2])`.
    refs.push({ file, specifier: m[3]!, typeOnly: Boolean(m[2]) });
  }
  for (const m of content.matchAll(BARE_IMPORT_RE)) {
    refs.push({ file, specifier: m[1]!, typeOnly: false });
  }
  for (const m of content.matchAll(DYNAMIC_IMPORT_RE)) {
    refs.push({ file, specifier: m[1]!, typeOnly: false });
  }
  return refs;
}

/** Every import/export ref across every `.ts`/`.tsx` file under `dir` (repo-absolute). */
export function walkImports(dir: string): ImportRef[] {
  return listSourceFiles(dir).flatMap(extractImports);
}

export { REPO_ROOT };
