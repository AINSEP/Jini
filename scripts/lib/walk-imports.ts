/**
 * Shared file-walk + import-specifier extraction for the guard checks. Deliberately a
 * regex-based MVP, not a full `ts.resolveModuleName` AST pass (per the 2026-07-19
 * swarm-consensus debate's convergence: "no full AST needed for v0" — see
 * ADS-memory/reports/swarm-consensus/runs/2026-07-19T1632-consensus-report.md). Good enough to
 * catch real violations; a future pass can upgrade to the TS compiler API without changing
 * either check's calling convention.
 * 2026-10-07: that upgrade is now implemented in extractImports, using the existing layer
 * guard's parser. The historical rationale above and stripComments' consumers stay intact.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { parseSource } from './package-sources.js';

export interface ImportRef {
  /** Repo-relative path of the file containing the import, forward-slashed. */
  readonly file: string;
  /** The raw module specifier as written (e.g. `'../foo.js'`, `'@jini-ai/core/composition'`). */
  readonly specifier: string;
  /** True for explicit type clauses and all-inline-type clauses; false for value imports. */
  readonly typeOnly: boolean;
}

const REPO_ROOT = new URL('../../', import.meta.url).pathname;

function isSourceEntry(entry: string, includeJavaScript = false): boolean {
  return (/\.(?:ts|tsx|mts|cts)$/.test(entry) || (includeJavaScript && /\.(?:js|jsx|mjs|cjs)$/.test(entry)))
    && !/\.d\.(?:ts|mts|cts)$/.test(entry);
}

/** Recursively lists TS source under `dir`, skipping declarations and generated/dependency trees.
 * Runtime-closure analysis also opts into build-free JavaScript source.
 */
export function listSourceFiles(dir: string, options: { includeJavaScript?: boolean } = {}): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (['node_modules', 'dist', '.git'].includes(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full, options));
    } else if (isSourceEntry(entry, options.includeJavaScript)) {
      out.push(full);
    }
  }
  return out;
}

function toRepoRelative(absPath: string): string {
  return relative(REPO_ROOT, absPath).split('\\').join('/');
}

function commentStart(c: string, next: string | undefined): 'line' | 'block' | undefined {
  if (c !== '/') return undefined;
  if (next === '/') return 'line';
  if (next === '*') return 'block';
  return undefined;
}

function blockCommentChunk(c: string, next: string | undefined): { text: string; skip: number; closed: boolean } {
  if (c === '*' && next === '/') return { text: '  ', skip: 1, closed: true };
  return { text: c === '\n' ? '\n' : ' ', skip: 0, closed: false };
}

function stringChunk(c: string, next: string | undefined, quote: string): { text: string; skip: number; closed: boolean } {
  if (c === '\\' && next !== undefined) return { text: c + next, skip: 1, closed: false };
  return { text: c, skip: 0, closed: c === quote };
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
  let i = 0;
  function consumeCode(c: string, next: string | undefined): void {
    const comment = commentStart(c, next);
    if (comment) {
      inLineComment = comment === 'line';
      inBlockComment = comment === 'block';
      out += '  ';
      i += 1;
      return;
    }
    if (['"', "'", '`'].includes(c)) {
      inString = c;
      out += c;
      return;
    }
    out += c;
  }
  function consumeCharacter(c: string, next: string | undefined): void {
    if (inLineComment) {
      out += c === '\n' ? '\n' : ' ';
      if (c === '\n') inLineComment = false;
      return;
    }
    if (inBlockComment) {
      const chunk = blockCommentChunk(c, next);
      out += chunk.text;
      i += chunk.skip;
      inBlockComment = !chunk.closed;
      return;
    }
    if (inString) {
      const chunk = stringChunk(c, next, inString);
      out += chunk.text;
      i += chunk.skip;
      if (chunk.closed) inString = null;
      return;
    }
    consumeCode(c, next);
  }
  for (;i < source.length;i += 1) consumeCharacter(source[i]!, source[i + 1]);
  return out;
}

function importClauseRef(node: ts.ImportDeclaration, file: string): ImportRef | undefined {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return undefined;
  const clause = node.importClause;
  const bindings = clause?.namedBindings;
  const inlineTypes = !clause?.name && bindings && ts.isNamedImports(bindings)
    && bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly);
  return { file, specifier: node.moduleSpecifier.text, typeOnly: Boolean(clause?.isTypeOnly || inlineTypes) };
}

function exportClauseRef(node: ts.ExportDeclaration, file: string): ImportRef | undefined {
  if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return undefined;
  const clause = node.exportClause;
  const inlineTypes = clause && ts.isNamedExports(clause) && clause.elements.length > 0
    && clause.elements.every(element => element.isTypeOnly);
  return { file, specifier: node.moduleSpecifier.text, typeOnly: Boolean(node.isTypeOnly || inlineTypes) };
}

function callImportRef(node: ts.CallExpression, file: string, requireNames: Set<string>): ImportRef | undefined {
  const imports = node.expression.kind === ts.SyntaxKind.ImportKeyword
    || (ts.isIdentifier(node.expression) && requireNames.has(node.expression.text));
  const argument = node.arguments[0];
  if (imports && argument && ts.isStringLiteralLike(argument)) return { file, specifier: argument.text, typeOnly: false };
  return undefined;
}

function nodeImportRef(node: ts.Node, file: string, requireNames: Set<string>): ImportRef | undefined {
  if (ts.isImportDeclaration(node)) return importClauseRef(node, file);
  if (ts.isExportDeclaration(node)) return exportClauseRef(node, file);
  if (ts.isCallExpression(node)) return callImportRef(node, file, requireNames);
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
    && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
    return { file, specifier: node.moduleReference.expression.text, typeOnly: node.isTypeOnly };
  }
  return undefined;
}

/** Extracts every import/export specifier from one `.ts`/`.tsx` file, repo-root-absolute or relative. */
export function extractImports(absFilePath: string): ImportRef[] {
  const source = parseSource({ file: absFilePath, source: readFileSync(absFilePath, 'utf8') });
  const file = toRepoRelative(absFilePath);
  const refs: ImportRef[] = [];
  // Source syntax is the shared owner of import discovery. Regex clauses could consume a
  // later type export after a value declaration, or match import-shaped strings; either
  // mistake changes a runtime closure. Reuse the parser already used by the layer guard.
  const requireNames = new Set(['require']);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer
        && ts.isCallExpression(declaration.initializer)
        && ts.isIdentifier(declaration.initializer.expression)
        && declaration.initializer.expression.text === 'createRequire') requireNames.add(declaration.name.text);
    }
  }
  function visit(node: ts.Node): void {
    const ref = nodeImportRef(node, file, requireNames);
    if (ref) refs.push(ref);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return refs;
}

export { REPO_ROOT };
