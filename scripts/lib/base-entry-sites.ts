/** Load sites with their bindings, for the Gate C1 check of imports of the two base packages
 * (`@jini-ai/core`, `@jini-ai/protocol`). The shared `import-sites` reader tells a value load from a type
 * load; this one adds what the approved-runtime policy needs on top: which exported names a value load
 * binds (by their ORIGINAL exported name, so `import { x as y }` is checked as `x`), and whether the load
 * is opaque (namespace, wildcard re-export, bare side effect, dynamic, `require`) and so names nothing
 * the approval list could authorize.
 */
import ts from 'typescript';
import { parseSource } from './package-sources.js';

export type LoadForm = 'named' | 'namespace' | 'side-effect' | 'export-star' | 'dynamic' | 'require';
export interface BindingSite { spec: string; line: number; form: LoadForm; values: string[] }

const lineOf = (ast: ts.SourceFile, node: ts.Node): number => ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
const literal = (node: ts.Node | undefined): string | undefined => node && ts.isStringLiteralLike(node) ? node.text : undefined;

/** `import …` statements. `retainsTypeLists`: under `verbatimModuleSyntax` (tsconfig.base.json) an
 * `import { type A }` with no value binding still emits `import {} from '…'`, which loads the module. */
function importDeclarationSite(required: { ast: ts.SourceFile; node: ts.ImportDeclaration; retainsTypeLists: boolean }): BindingSite | undefined {
  const { ast, node } = required;
  const spec = literal(node.moduleSpecifier)!;
  const line = lineOf(ast, node);
  const clause = node.importClause;
  if (!clause) return { spec, line, form: 'side-effect', values: [] };
  if (clause.isTypeOnly) return undefined;
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) return { spec, line, form: 'namespace', values: [] };
  const named = clause.namedBindings?.elements.filter(element => !element.isTypeOnly) ?? [];
  const values = [...(clause.name ? ['default'] : []), ...named.map(element => (element.propertyName ?? element.name).text)];
  if (values.length > 0) return { spec, line, form: 'named', values };
  return required.retainsTypeLists ? { spec, line, form: 'side-effect', values: [] } : undefined;
}

/** `export … from '…'`: a type-only list is erased; `export *` and `export * as ns` are opaque. */
function exportDeclarationSite(required: { ast: ts.SourceFile; node: ts.ExportDeclaration }): BindingSite | undefined {
  const { ast, node } = required;
  const spec = literal(node.moduleSpecifier);
  if (!spec || node.isTypeOnly) return undefined;
  const line = lineOf(ast, node);
  if (!node.exportClause) return { spec, line, form: 'export-star', values: [] };
  if (ts.isNamespaceExport(node.exportClause)) return { spec, line, form: 'namespace', values: [] };
  const values = node.exportClause.elements.filter(element => !element.isTypeOnly).map(element => (element.propertyName ?? element.name).text);
  return values.length > 0 ? { spec, line, form: 'named', values } : undefined;
}

function callSite(required: { ast: ts.SourceFile; node: ts.CallExpression }): BindingSite | undefined {
  const { ast, node } = required;
  const spec = literal(node.arguments[0]);
  if (!spec) return undefined;
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return { spec, line: lineOf(ast, node), form: 'dynamic', values: [] };
  return ts.isIdentifier(node.expression) && node.expression.text === 'require' ? { spec, line: lineOf(ast, node), form: 'require', values: [] } : undefined;
}

function siteOf(required: { ast: ts.SourceFile; node: ts.Node; retainsTypeLists: boolean }): BindingSite | undefined {
  const { ast, node } = required;
  if (ts.isImportDeclaration(node)) return importDeclarationSite({ ast, node, retainsTypeLists: required.retainsTypeLists });
  if (ts.isExportDeclaration(node)) return exportDeclarationSite({ ast, node });
  if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
    const spec = literal(node.moduleReference.expression);
    return spec ? { spec, line: lineOf(ast, node), form: 'require', values: [] } : undefined;
  }
  return ts.isCallExpression(node) ? callSite({ ast, node }) : undefined;
}

/**
 * Every value-relevant load site in one file, one per syntax occurrence.
 * @param required.file Path (for the parser's script kind) and `source` text.
 * @param optional.retainsTypeLists Whether inline type lists still emit a load (default true: Jini compiles
 *   with `verbatimModuleSyntax`).
 * @complexity O(n) in AST nodes.
 */
export function bindingSites(required: { file: string; source: string }, { retainsTypeLists = true }: { retainsTypeLists?: boolean } = {}): BindingSite[] {
  const ast = parseSource(required);
  const sites: BindingSite[] = [];
  const visit = (node: ts.Node): void => {
    const site = siteOf({ ast, node, retainsTypeLists });
    if (site) sites.push(site);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return sites;
}
