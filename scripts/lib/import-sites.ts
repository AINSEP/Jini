/** Every module reference in one file, with its syntax kind. Shared by the layer gate's injection
 * rules so a value import, a type import, a re-export, a dynamic import, a `require` and an
 * `import('…')` type can never be told apart by accident (the base rule counts them all alike).
 * Load forms (static, dynamic, template-literal, `require`, `createRequire` bindings and
 * `import x = require()`) come from the one parser owner, `runtimeImportReferences`; this file adds
 * only what the injection rules need beyond loads: `import('…')` types and JSDoc type imports.
 */
import ts from 'typescript';
import { syntaxError } from '../../packages/devops/src/checks/hardwiring.js';
import { runtimeImportReferences, type RuntimeImportRef } from '../../packages/devops/src/packaging/electron/typescript.js';
import { parseSource } from './package-sources.js';

export type SiteKind = 'import' | 'type-import' | 'export-from' | 'dynamic' | 'require' | 'import-type' | 'jsdoc-import';
export interface ImportSite { spec: string; kind: SiteKind; line: number }

function kindOf(ref: RuntimeImportRef): SiteKind {
  if (ref.syntax === 'import') return ref.typeOnly ? 'type-import' : 'import';
  if (ref.syntax === 'export') return ref.typeOnly ? 'type-import' : 'export-from';
  return ref.syntax === 'dynamic' ? 'dynamic' : 'require';
}

/** `type T = import('…').T` is a type edge the load reader skips: it never runs. */
function importTypeSites(ast: ts.SourceFile): ImportSite[] {
  const sites: ImportSite[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      sites.push({ spec: node.argument.literal.text, kind: 'import-type', line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return sites;
}

/** A `.mjs` payload types itself with JSDoc `import("…")`: invisible to the parser, but a real type edge. */
function jsdocSites(required: { source: string; known: readonly ImportSite[] }): ImportSite[] {
  const found: ImportSite[] = [];
  required.source.split('\n').forEach((text, index) => {
    for (const match of text.matchAll(/\bimport\(\s*(["'])([^"']+)\1\s*\)/g)) {
      const line = index + 1;
      if (!required.known.some(site => site.line === line && site.spec === match[2])) found.push({ spec: match[2]!, kind: 'jsdoc-import', line });
    }
  });
  return found;
}

/** Fails closed: a file the parser cannot read throws instead of reporting no imports. */
export function importSites(required: { file: string; source: string }, { jsdoc = false }: { jsdoc?: boolean } = {}): ImportSite[] {
  const ast = parseSource(required);
  const failure = syntaxError({ tree: ast, file: required.file });
  if (failure) throw failure;
  const loads = runtimeImportReferences({ compiler: ts, ...required }, { tree: ast })
    .map(ref => ({ spec: ref.specifier, kind: kindOf(ref), line: ref.line }));
  const sites = [...loads, ...importTypeSites(ast)].sort((a, b) => a.line - b.line);
  return jsdoc ? [...sites, ...jsdocSites({ source: required.source, known: sites })] : sites;
}
