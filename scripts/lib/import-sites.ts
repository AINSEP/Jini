/** Every module reference in one file, with its syntax kind. Shared by the layer gate's injection
 * rules so a value import, a type import, a re-export, a dynamic import, a `require` and an
 * `import('…')` type can never be told apart by accident (the base rule counts them all alike).
 */
import ts from 'typescript';
import { parseSource } from './package-sources.js';

export type SiteKind = 'import' | 'type-import' | 'export-from' | 'dynamic' | 'require' | 'import-type' | 'jsdoc-import';
export interface ImportSite { spec: string; kind: SiteKind; line: number }

function literalCallKind(node: ts.Node): SiteKind | undefined {
  if (!ts.isCallExpression(node) || !node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) return undefined;
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return 'dynamic';
  return ts.isIdentifier(node.expression) && node.expression.text === 'require' ? 'require' : undefined;
}

function declarationKind(node: ts.Node): SiteKind | undefined {
  if (ts.isImportDeclaration(node)) return node.importClause?.isTypeOnly ? 'type-import' : 'import';
  if (ts.isExportDeclaration(node) && node.moduleSpecifier) return node.isTypeOnly ? 'type-import' : 'export-from';
  return undefined;
}

function siteOf(node: ts.Node): { spec: string; kind: SiteKind } | undefined {
  const kind = declarationKind(node);
  const specifier = (node as ts.ImportDeclaration).moduleSpecifier;
  if (kind && specifier && ts.isStringLiteral(specifier)) return { spec: specifier.text, kind };
  const callKind = literalCallKind(node);
  if (callKind) return { spec: ((node as ts.CallExpression).arguments[0] as ts.StringLiteral).text, kind: callKind };
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
    return { spec: node.argument.literal.text, kind: 'import-type' };
  }
  return undefined;
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

export function importSites(required: { file: string; source: string }, { jsdoc = false }: { jsdoc?: boolean } = {}): ImportSite[] {
  const ast = parseSource(required);
  const sites: ImportSite[] = [];
  function visit(node: ts.Node): void {
    const site = siteOf(node);
    if (site) sites.push({ ...site, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return jsdoc ? [...sites, ...jsdocSites({ source: required.source, known: sites })] : sites;
}
