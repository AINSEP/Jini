import type ts from 'typescript';
import type { ImportReaderPort } from './ports.js';
export interface RuntimeImportRef { specifier: string; kind: 'import' | 'require'; line: number; deferred: boolean; typeOnly?: boolean }

/** Read syntax with the host's maintained parser. No module is executed. O(source length). */
export function runtimeImportReferences(
  { compiler: c, file, source }: { compiler: typeof ts; file: string; source: string },
  _options: Record<string, never> = {},
): RuntimeImportRef[] {
  const tree = c.createSourceFile(file, source, c.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? c.ScriptKind.TSX : c.ScriptKind.TS);
  type Binding = 'require' | 'creator' | 'other';
  const scopes = new Map<ts.Node, Map<string, Binding>>();
  const found: RuntimeImportRef[] = [];
  function scopeOf(node: ts.Node): ts.Node {
    let parent = node.parent;
    while (parent && !c.isBlock(parent) && !c.isFunctionLike(parent) && !c.isSourceFile(parent)) parent = parent.parent;
    return parent ?? tree;
  }
  function lookup(node: ts.Identifier): Binding | undefined {
    let scope: ts.Node | undefined = scopeOf(node);
    while (scope) {
      const value = scopes.get(scope)?.get(node.text);
      if (value) return value;
      scope = scope === tree ? undefined : scopeOf(scope);
    }
    if (node.text === 'require') return 'require';
    return node.text === 'createRequire' ? 'creator' : undefined;
  }
  function isCreator(node: ts.Expression): boolean {
    if (c.isIdentifier(node)) return lookup(node) === 'creator';
    return c.isPropertyAccessExpression(node) && node.name.text === 'createRequire';
  }
  function bind(node: ts.Node, name: string, value: Binding): void {
    const scope = scopeOf(node);
    const values = scopes.get(scope) ?? new Map<string, Binding>();
    values.set(name, value);
    scopes.set(scope, values);
  }
  function variableBinding(node: ts.Node): void {
    if (!c.isVariableDeclaration(node) || !c.isIdentifier(node.name)) return;
    const init = node.initializer;
    const value = init && c.isCallExpression(init) && isCreator(init.expression) ? 'require' : 'other';
    bind(node, node.name.text, value);
  }
  /** A declared function or class (e.g. a factory-local `function require(capability)`) shadows the module require in its scope. */
  function declarationBinding(node: ts.Node): void {
    if ((c.isFunctionDeclaration(node) || c.isClassDeclaration(node)) && node.name) bind(node, node.name.text, 'other');
  }
  function bindings(node: ts.Node): void {
    if (c.isImportSpecifier(node) && (node.propertyName ?? node.name).text === 'createRequire') bind(node, node.name.text, 'creator');
    if (c.isParameter(node) && c.isIdentifier(node.name)) bind(node, node.name.text, 'other');
    variableBinding(node);
    declarationBinding(node);
    c.forEachChild(node, bindings);
  }
  bindings(tree);
  function isRequire(node: ts.Expression): boolean {
    if (c.isIdentifier(node)) return lookup(node) === 'require';
    return c.isCallExpression(node) && isCreator(node.expression);
  }
  function inlineTypes(clause: ts.NamedImportBindings | ts.NamedExportBindings | undefined): boolean {
    if (!clause) return false;
    if (!c.isNamedImports(clause) && !c.isNamedExports(clause)) return false;
    return clause.elements.length > 0 && clause.elements.every(e => e.isTypeOnly);
  }
  function erased(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
    if (c.isImportDeclaration(node)) {
      const clause = node.importClause;
      return Boolean(clause?.isTypeOnly || (!clause?.name && inlineTypes(clause?.namedBindings)));
    }
    return node.isTypeOnly || inlineTypes(node.exportClause);
  }
  function callReference(node: ts.CallExpression): { literal: ts.Expression | undefined; kind: 'import' | 'require' } | undefined {
    if (node.expression.kind === c.SyntaxKind.ImportKeyword) return { literal: node.arguments[0], kind: 'import' };
    const call = node.expression;
    if (isRequire(call)) return { literal: node.arguments[0], kind: 'require' };
    if (c.isPropertyAccessExpression(call) && call.name.text === 'resolve' && isRequire(call.expression)) return { literal: node.arguments[0], kind: 'require' };
    return undefined;
  }
  function reference(node: ts.Node): { literal: ts.Expression | undefined; kind: 'import' | 'require'; typeOnly?: boolean } | undefined {
    if (c.isImportDeclaration(node) || c.isExportDeclaration(node)) return { literal: node.moduleSpecifier, kind: 'import', typeOnly: erased(node) };
    if (c.isImportEqualsDeclaration(node) && c.isExternalModuleReference(node.moduleReference)) return { literal: node.moduleReference.expression, kind: 'require', typeOnly: node.isTypeOnly };
    return c.isCallExpression(node) ? callReference(node) : undefined;
  }

  function visit(node: ts.Node, deferred = false): void {
    const ref = reference(node);
    if (ref?.literal && c.isStringLiteralLike(ref.literal)) found.push({ specifier: ref.literal.text, kind: ref.kind,
      typeOnly: ref.typeOnly ?? false, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, deferred });
    const nested = deferred || c.isFunctionLike(node);
    c.forEachChild(node, child => visit(child, nested));
  }
  visit(tree);
  return found;
}

/** Bind one parser owner for static, dynamic, CommonJS and createRequire references. */
export function createTypeScriptImportReader(
  { compiler }: { compiler: typeof ts }, _options: Record<string, never> = {},
): ImportReaderPort {
  const references = ({ file, source }: { file: string; source: string }) => runtimeImportReferences({ compiler, file, source }).filter(ref => !ref.typeOnly);
  return { references, imports: required => references(required).map(ref => ref.specifier) };
}
