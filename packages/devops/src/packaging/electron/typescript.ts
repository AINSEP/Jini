import type ts from 'typescript';
import type { ImportReaderPort } from './ports.js';
/** `syntax` names the form that loads the module (`import-equals` is `import x = require()`). */
export type RuntimeImportSyntax = 'import' | 'export' | 'import-equals' | 'dynamic' | 'require';
type Reference = { literal: ts.Expression | undefined; kind: 'import' | 'require'; syntax: RuntimeImportSyntax; typeOnly?: boolean };
export interface RuntimeImportRef { specifier: string; kind: 'import' | 'require'; syntax: RuntimeImportSyntax; line: number; deferred: boolean; typeOnly?: boolean }

type Binding = 'require' | 'creator' | 'other';
/** Parser, tree and lexical bindings shared by one `runtimeImportReferences` scan. */
type Scan = { c: typeof ts; tree: ts.SourceFile; scopes: Map<ts.Node, Map<string, Binding>> };

function scopeOf({ c, tree }: Scan, node: ts.Node): ts.Node {
  let parent = node.parent;
  while (parent && !c.isBlock(parent) && !c.isFunctionLike(parent) && !c.isSourceFile(parent)) parent = parent.parent;
  return parent ?? tree;
}
function lookup(scan: Scan, node: ts.Identifier): Binding | undefined {
  let scope: ts.Node | undefined = scopeOf(scan, node);
  while (scope) {
    const value = scan.scopes.get(scope)?.get(node.text);
    if (value) return value;
    scope = scope === scan.tree ? undefined : scopeOf(scan, scope);
  }
  if (node.text === 'require') return 'require';
  return node.text === 'createRequire' ? 'creator' : undefined;
}
function isCreator(scan: Scan, node: ts.Expression): boolean {
  const { c } = scan;
  if (c.isIdentifier(node)) return lookup(scan, node) === 'creator';
  return c.isPropertyAccessExpression(node) && node.name.text === 'createRequire';
}
function bind({ scan, node, name, value }: {
  scan: Scan;
  node: ts.Node;
  name: string;
  value: Binding;
}): void {
  const scope = scopeOf(scan, node);
  const values = scan.scopes.get(scope) ?? new Map<string, Binding>();
  values.set(name, value);
  scan.scopes.set(scope, values);
}
function variableBinding(scan: Scan, node: ts.Node): void {
  const { c } = scan;
  if (!c.isVariableDeclaration(node) || !c.isIdentifier(node.name)) return;
  const init = node.initializer;
  const value = init && c.isCallExpression(init) && isCreator(scan, init.expression) ? 'require' : 'other';
  bind({ scan, node, name: node.name.text, value });
}
/** A declared function or class (e.g. a factory-local `function require(capability)`) shadows the module require in its scope. */
function declarationBinding(scan: Scan, node: ts.Node): void {
  const { c } = scan;
  if ((c.isFunctionDeclaration(node) || c.isClassDeclaration(node)) && node.name) bind({ scan, node, name: node.name.text, value: 'other' });
}
function collectBindings(scan: Scan, node: ts.Node): void {
  const { c } = scan;
  if (c.isImportSpecifier(node) && (node.propertyName ?? node.name).text === 'createRequire') bind({ scan, node, name: node.name.text, value: 'creator' });
  if (c.isParameter(node) && c.isIdentifier(node.name)) bind({ scan, node, name: node.name.text, value: 'other' });
  variableBinding(scan, node);
  declarationBinding(scan, node);
  c.forEachChild(node, child => collectBindings(scan, child));
}
function isRequire(scan: Scan, node: ts.Expression): boolean {
  const { c } = scan;
  if (c.isIdentifier(node)) return lookup(scan, node) === 'require';
  return c.isCallExpression(node) && isCreator(scan, node.expression);
}
function inlineTypes({ c }: Scan, clause: ts.NamedImportBindings | ts.NamedExportBindings | undefined): boolean {
  if (!clause) return false;
  if (!c.isNamedImports(clause) && !c.isNamedExports(clause)) return false;
  return clause.elements.length > 0 && clause.elements.every(e => e.isTypeOnly);
}
function erased({ scan, node }: {
  scan: Scan;
  node: ts.ImportDeclaration | ts.ExportDeclaration;
}): boolean {
  if (scan.c.isImportDeclaration(node)) {
    const clause = node.importClause;
    return Boolean(clause?.isTypeOnly || (!clause?.name && inlineTypes(scan, clause?.namedBindings)));
  }
  return node.isTypeOnly || inlineTypes(scan, node.exportClause);
}
function callReference(scan: Scan, node: ts.CallExpression): Reference | undefined {
  const { c } = scan;
  if (node.expression.kind === c.SyntaxKind.ImportKeyword) return { literal: node.arguments[0], kind: 'import', syntax: 'dynamic' };
  const call = node.expression;
  if (isRequire(scan, call)) return { literal: node.arguments[0], kind: 'require', syntax: 'require' };
  if (c.isPropertyAccessExpression(call) && call.name.text === 'resolve' && isRequire(scan, call.expression)) return { literal: node.arguments[0], kind: 'require', syntax: 'require' };
  return undefined;
}
function reference(scan: Scan, node: ts.Node): Reference | undefined {
  const { c } = scan;
  if (c.isImportDeclaration(node) || c.isExportDeclaration(node)) return { literal: node.moduleSpecifier, kind: 'import', syntax: c.isImportDeclaration(node) ? 'import' : 'export', typeOnly: erased({ scan, node }) };
  if (c.isImportEqualsDeclaration(node) && c.isExternalModuleReference(node.moduleReference)) return { literal: node.moduleReference.expression, kind: 'require', syntax: 'import-equals', typeOnly: node.isTypeOnly };
  return c.isCallExpression(node) ? callReference(scan, node) : undefined;
}
function visitReferences(scan: Scan, found: RuntimeImportRef[], node: ts.Node, deferred = false): void {
  const { c, tree } = scan;
  const ref = reference(scan, node);
  if (ref?.literal && c.isStringLiteralLike(ref.literal)) found.push({ specifier: ref.literal.text, kind: ref.kind, syntax: ref.syntax,
    typeOnly: ref.typeOnly ?? false, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, deferred });
  const nested = deferred || c.isFunctionLike(node);
  c.forEachChild(node, child => visitReferences(scan, found, child, nested));
}

/** Read syntax with the host's maintained parser. No module is executed. O(source length).
 * A caller that already parsed the file passes its `tree` so the source is parsed once. */
export function runtimeImportReferences(
  { compiler: c, file, source }: { compiler: typeof ts; file: string; source: string },
  { tree: parsed }: { tree?: ts.SourceFile } = {},
): RuntimeImportRef[] {
  const tree = parsed ?? c.createSourceFile(file, source, c.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? c.ScriptKind.TSX : c.ScriptKind.TS);
  const scan: Scan = { c, tree, scopes: new Map() };
  const found: RuntimeImportRef[] = [];
  collectBindings(scan, tree);
  visitReferences(scan, found, tree);
  return found;
}

/** Bind one parser owner for static, dynamic, CommonJS and createRequire references. */
export function createTypeScriptImportReader(
  { compiler }: { compiler: typeof ts }, _options: Record<string, never> = {},
): ImportReaderPort {
  const references = ({ file, source }: { file: string; source: string }) => runtimeImportReferences({ compiler, file, source }).filter(ref => !ref.typeOnly);
  return { references, imports: required => references(required).map(ref => ref.specifier) };
}
