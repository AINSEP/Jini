import { createHash } from 'node:crypto';
import type ts from 'typescript';

export interface HardwiringViolation {
  rule: string;
  file: string;
  line: number;
  reason: string;
  fingerprint: string;
}

export interface RuntimeImport { specifier: string; node: ts.Node }
export interface HardwiringSource {
  file: string;
  source: string;
  mode: 'jini' | 'consumer';
  server?: boolean;
  jiniExports?: ReadonlySet<string>;
  /** Host verifies these env keys against the production refusal gate, not comments. */
  bootCoveredEnv?: ReadonlySet<string>;
  /** Host-owned plugin identities, including separately installed plugins. */
  pluginIdentity?: (file: string) => string | undefined;
  resolveImport?: (specifier: string, file: string) => string | undefined;
}

/** Parse diagnostics can quote source literals; location is sufficient and does not expose secrets. */
export function syntaxError({ tree, file }: { tree: ts.SourceFile; file: string }, _options: Record<string, never> = {}): Error | undefined {
  const [first] = (tree as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (!first) return undefined;
  const line = tree.getLineAndCharacterOfPosition(first.start ?? 0).line + 1;
  return new Error(`Cannot parse ${file}: syntax error at line ${line}.`);
}

export const HARDWIRING_RULES = [
  'HW1-env-default', 'HW2-vendor-adapter', 'HW3-module-state', 'HW4-injected-fetch',
  'HW5-jini-export', 'HW6-boot-default', 'HW7-public-react', 'HW8-provider-url', 'HW9-plugin-import',
] as const;

/** Vendor SDK packages matched by exact name (or a subpath of it). Scoped vendors are in VENDOR_SCOPES. */
const VENDOR_PACKAGES: ReadonlySet<string> = new Set([
  'better-sqlite3', 'pg', 'postgres', 'mysql', 'mysql2', 'sqlite3', '@electric-sql/pglite', 'openai', '@anthropic-ai/sdk',
  '@google/genai', '@google/generative-ai', '@supabase/supabase-js', '@libsql/client', 'composio-core', 'resend', 'stripe',
  'replicate', '@fal-ai/client', 'sharp', 'undici', 'node-pty', 'playwright', 'playwright-core', 'puppeteer', 'puppeteer-core',
]);
const VENDOR_SCOPES = /^@(?:aws-sdk|azure|google-cloud|ai-sdk|tavily|composio|e2b)\//;

/** The package a bare specifier names: its first segment, or first two for a scoped package. */
function packageName(specifier: string): string {
  return specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
}

/** Bind the installed compiler, keeping this optional parser out of the runtime dependency graph.
 * Inspection is O(n) AST nodes, plus lexical-scope scans for bare fetch calls; no external I/O.
 * Only the rule-identifying value is hashed for debt identity and never included in diagnostics (it may contain secrets).
 */
export function createHardwiringInspector({ compiler: c }: { compiler: typeof ts }, _options: Record<string, never> = {}) {
  function parse({ file, source }: { file: string; source: string }, _options: Record<string, never> = {}): ts.SourceFile {
    const tree = c.createSourceFile(file, source, c.ScriptTarget.Latest, true, scriptKind(file));
    const failure = syntaxError({ tree, file });
    if (failure) throw failure;
    return tree;
  }

  function scriptKind(file: string): ts.ScriptKind {
    if (/\.[jt]sx$/.test(file)) return c.ScriptKind.TSX;
    return /\.[cm]?js$/.test(file) ? c.ScriptKind.JS : c.ScriptKind.TS;
  }

  function member(node: ts.Node, name: string): boolean {
    if (c.isPropertyAccessExpression(node)) return node.name.text === name;
    return c.isElementAccessExpression(node) && c.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === name;
  }

  function env(node: ts.Node): boolean {
    return member(node, 'env') && 'expression' in node && c.isIdentifier(node.expression as ts.Node) &&
      (node.expression as ts.Identifier).text === 'process';
  }

  function envKey(node: ts.Node): string | undefined {
    if (c.isPropertyAccessExpression(node) && env(node.expression)) return node.name.text;
    if (c.isElementAccessExpression(node) && env(node.expression) && c.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
    return undefined;
  }

  function erasedImport(node: ts.ImportDeclaration): boolean {
    // `import { type X }` can emit `import {}` under verbatimModuleSyntax: still a load.
    return node.importClause?.isTypeOnly === true;
  }

  function kept(literal: ts.Node, typeOnly: boolean, includeTypeOnly: boolean): ts.Node | undefined {
    return includeTypeOnly || !typeOnly ? literal : undefined;
  }

  function declarationLiteral(node: ts.Node, includeTypeOnly: boolean): ts.Node | undefined {
    if (c.isImportDeclaration(node)) return kept(node.moduleSpecifier, erasedImport(node), includeTypeOnly);
    if (c.isExportDeclaration(node) && node.moduleSpecifier) return kept(node.moduleSpecifier, node.isTypeOnly, includeTypeOnly);
    if (c.isImportEqualsDeclaration(node) && c.isExternalModuleReference(node.moduleReference)) return kept(node.moduleReference.expression, node.isTypeOnly, includeTypeOnly);
    return undefined;
  }

  function loadCallLiteral(node: ts.Node): ts.Node | undefined {
    if (!c.isCallExpression(node)) return undefined;
    const load = node.expression.kind === c.SyntaxKind.ImportKeyword || (c.isIdentifier(node.expression) && node.expression.text === 'require');
    return load ? node.arguments[0] : undefined;
  }

  function importLiteral(node: ts.Node, includeTypeOnly: boolean): ts.Node | undefined {
    return loadCallLiteral(node) ?? declarationLiteral(node, includeTypeOnly);
  }

  function imports({ tree, includeTypeOnly = false }: { tree: ts.SourceFile; includeTypeOnly?: boolean }, _options: Record<string, never> = {}): RuntimeImport[] {
    const found: RuntimeImport[] = [];
    function visit(node: ts.Node): void {
      const literal = importLiteral(node, includeTypeOnly);
      if (literal && c.isStringLiteralLike(literal)) found.push({ specifier: literal.text, node });
      c.forEachChild(node, visit);
    }
    visit(tree);
    return found;
  }

  function declaredFunctions(statement: ts.Statement): { name: string; node: ts.Node }[] {
    if (c.isFunctionDeclaration(statement) && statement.name) return [{ name: statement.name.text, node: statement }];
    if (!c.isVariableStatement(statement)) return [];
    return statement.declarationList.declarations.flatMap((decl) => {
      if (!c.isIdentifier(decl.name)) return [];
      const implemented = decl.initializer && (c.isArrowFunction(decl.initializer) || c.isFunctionExpression(decl.initializer));
      // Published .d.ts files retain arrow exports as function-type declarations, without bodies.
      const declared = decl.type && c.isFunctionTypeNode(decl.type);
      if (!implemented && !declared) return [];
      return [{ name: decl.name.text, node: decl }];
    });
  }

  function exportedFunctions({ tree }: { tree: ts.SourceFile }, _options: Record<string, never> = {}): { name: string; node: ts.Node }[] {
    const locals = new Map<string, ts.Node>();
    const found: { name: string; node: ts.Node }[] = [];
    for (const statement of tree.statements) {
      const exported = c.canHaveModifiers(statement) && c.getModifiers(statement)?.some((m) => m.kind === c.SyntaxKind.ExportKeyword);
      for (const item of declaredFunctions(statement)) {
        locals.set(item.name, item.node);
        if (exported) found.push(item);
      }
    }
    for (const statement of tree.statements) found.push(...exportedAliases(statement, locals));
    return found;
  }

  function exportedAliases(statement: ts.Statement, locals: ReadonlyMap<string, ts.Node>): { name: string; node: ts.Node }[] {
    if (!c.isExportDeclaration(statement) || statement.moduleSpecifier || statement.isTypeOnly) return [];
    if (!statement.exportClause || !c.isNamedExports(statement.exportClause)) return [];
    return statement.exportClause.elements.flatMap((item) => {
      const node = locals.get((item.propertyName ?? item.name).text);
      return node && !item.isTypeOnly ? [{ name: item.name.text, node }] : [];
    });
  }

  function violation(tree: ts.SourceFile, node: ts.Node, rule: string, reason: string, identity: string): HardwiringViolation {
    const fingerprint = createHash('sha256').update(identity).digest('hex');
    return { rule, file: tree.fileName, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, reason, fingerprint };
  }

  // `provider-plugins/` holds provider plugin sources: each is a vendor adapter by definition.
  function adapter(file: string): boolean {
    return /(?:^|\/)(?:adapters?|kernel|providers?|provider-plugins)[/.]/.test(file) || /\.adapter\.[^.]+$/.test(file);
  }

  function urlOwner(file: string): boolean {
    return adapter(file) || /(?:^|\/)catalogs?[/.]/.test(file);
  }

  function vendor(specifier: string): boolean {
    // A vendor scope matches any of its packages; the named packages match themselves and their subpaths.
    return VENDOR_PACKAGES.has(packageName(specifier)) || VENDOR_SCOPES.test(specifier) ||
      /^(?:@[^/]+\/(?:sdk|[^/]+-sdk)|[^@/]+-sdk)(?:$|\/)/.test(specifier);
  }

  function moduleScope(node: ts.Node): boolean {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (c.isFunctionLike(parent) || c.isClassLike(parent) || c.isModuleDeclaration(parent)) return false;
    }
    return true;
  }

  /** BindingName is Identifier | ObjectBindingPattern | ArrayBindingPattern; array holes are OmittedExpressions. */
  function bindsFetch(name: ts.BindingName): boolean {
    if (c.isIdentifier(name)) return name.text === 'fetch';
    return name.elements.some((e) => c.isBindingElement(e) && bindsFetch(e.name));
  }

  function scopeBindsFetch(scope: ts.Node): boolean {
    if (c.isFunctionLike(scope)) return scope.parameters.some((p) => bindsFetch(p.name));
    if (c.isCatchClause(scope)) return Boolean(scope.variableDeclaration && bindsFetch(scope.variableDeclaration.name));
    if (c.isBlock(scope) || c.isSourceFile(scope)) return scope.statements.some(statementBindsFetch);
    return false;
  }

  function hasLocalFetch(node: ts.Node): boolean {
    for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) if (scopeBindsFetch(scope)) return true;
    return false;
  }

  function isGlobalThisFetch(value: ts.Expression | undefined): boolean {
    if (!value || !member(value, 'fetch') || !('expression' in value)) return false;
    const target = value.expression as ts.Node;
    return c.isIdentifier(target) && target.text === 'globalThis';
  }

  function statementBindsFetch(statement: ts.Statement): boolean {
    if (c.isVariableStatement(statement)) return statement.declarationList.declarations.some((d) => {
      // Renaming the global to a local `fetch` is still a global call, not an injected port.
      return bindsFetch(d.name) && !isGlobalThisFetch(d.initializer);
    });
    if (c.isFunctionDeclaration(statement)) return statement.name?.text === 'fetch';
    if (!c.isImportDeclaration(statement) || !statement.importClause) return false;
    const clause = statement.importClause;
    if (clause.name?.text === 'fetch') return true;
    return Boolean(clause.namedBindings && c.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.some((e) => e.name.text === 'fetch'));
  }

  function isEnvDefault(node: ts.Node): boolean {
    let expression = node;
    while (c.isParenthesizedExpression(expression.parent)) expression = expression.parent;
    const parent = expression.parent;
    if (c.isBinaryExpression(parent)) return parent.operatorToken.kind === c.SyntaxKind.QuestionQuestionToken && parent.right === expression;
    return (c.isParameter(parent) || c.isBindingElement(parent)) && parent.initializer === expression;
  }

  /** Binding defaults and initializers are implementation; debt identity is only the declared names.
   * Array holes retain their slots so moving a name changes its positional identity. */
  function declarationIdentity(name: ts.BindingName): string {
    if (c.isIdentifier(name)) return name.text;
    return name.elements.map(element => c.isBindingElement(element) ? declarationIdentity(element.name) : '').join(',');
  }

  function mutableModuleState(node: ts.Node, tree: ts.SourceFile): boolean {
    if (!c.isVariableDeclaration(node) || !moduleScope(node) || !c.isVariableDeclarationList(node.parent)) return false;
    // A flag test, not a boolean `&&`: the Const bit marks `const` (and `await using`) lists.
    const constBinding = (node.parent.flags & c.NodeFlags.Const) !== 0;
    if (!constBinding) return true;
    if (!node.initializer || !c.isNewExpression(node.initializer) || !c.isIdentifier(node.initializer.expression)) return false;
    if (!['Map', 'Set'].includes(node.initializer.expression.text)) return false;
    // Readonly<Map> only freezes properties; it still exposes .set/.delete.
    return !node.type || !/^Readonly(?:Map|Set)\s*</.test(node.type.getText(tree));
  }

  function globalFetchCall(node: ts.Node): boolean {
    if (!c.isCallExpression(node)) return false;
    if (c.isIdentifier(node.expression)) return node.expression.text === 'fetch' && !hasLocalFetch(node);
    if (!member(node.expression, 'fetch') || !('expression' in node.expression)) return false;
    const object = node.expression.expression as ts.Node;
    return c.isIdentifier(object) && object.text === 'globalThis';
  }

  function uncoveredDefault(node: ts.Node, covered: ReadonlySet<string> | undefined): boolean {
    if (!c.isBinaryExpression(node) || node.operatorToken.kind !== c.SyntaxKind.QuestionQuestionToken) return false;
    const fallback = node.right;
    const insecure = (c.isStringLiteralLike(fallback) && fallback.text.startsWith('dev-only-insecure-')) ||
      (c.isIdentifier(fallback) && /^DEFAULT_.*PASSWORD$/.test(fallback.text));
    if (!insecure) return false;
    const key = envKey(node.left);
    return !key || !covered?.has(key);
  }

  function apiUrl(node: ts.Node): boolean {
    if (!c.isStringLiteralLike(node) && !c.isTemplateHead(node) && !c.isTemplateMiddle(node) && !c.isTemplateTail(node)) return false;
    return /https:\/\/api\./i.test(node.text);
  }

  /** Resolution runs for every edge, even without a plugin identity: a host resolver may fail closed on unresolved code. */
  function targetPlugin(input: HardwiringSource, specifier: string): string | undefined {
    const target = input.resolveImport?.(specifier, input.file);
    return target ? input.pluginIdentity?.(target) : undefined;
  }

  function inspectImports(input: HardwiringSource, tree: ts.SourceFile, refs: readonly RuntimeImport[]): HardwiringViolation[] {
    const found: HardwiringViolation[] = [];
    const plugin = input.pluginIdentity?.(input.file);
    const vendorOwner = adapter(input.file);
    for (const ref of refs) {
      if (!vendorOwner && vendor(ref.specifier)) found.push(violation(tree, ref.node, 'HW2-vendor-adapter', 'Driver/vendor dependency belongs in an adapter, kernel or provider.', ref.specifier));
      const other = targetPlugin(input, ref.specifier);
      if (plugin && other && other !== plugin) found.push(violation(tree, ref.node, 'HW9-plugin-import', `Import crosses ${plugin} → ${other}; plugins must communicate through host ports.`, ref.specifier));
    }
    return found;
  }

  /** Analyze authored source; host policies supply export ownership, refusal coverage and import resolution. */
  function inspect(input: HardwiringSource, _options: Record<string, never> = {}): HardwiringViolation[] {
    const tree = parse(input);
    const refs = imports({ tree, includeTypeOnly: true });
    const found = inspectImports(input, tree, refs);
    const report = (node: ts.Node, rule: string, reason: string, identity: string) => found.push(violation(tree, node, rule, reason, identity));
    const jini = input.mode === 'jini';
    const envExempt = /(?:^|\/)(?:bin|cli|testing)[/.]/.test(input.file);
    const ownsUrls = urlOwner(input.file);
    if (!jini && !refs.some((ref) => ref.specifier.startsWith('@jini-ai/'))) {
      for (const item of exportedFunctions({ tree })) if (input.jiniExports?.has(item.name)) report(item.node, 'HW5-jini-export', `Export ${item.name} duplicates a Jini function without using its owner.`, item.name);
    }
    function visitJini(node: ts.Node): void {
      if (!envExempt && env(node) && !isEnvDefault(node)) report(node, 'HW1-env-default', 'process.env is allowed only as an injected environment default (?? process.env or env = process.env).', envKey(node.parent) ?? 'process.env');
      if (mutableModuleState(node, tree)) report(node, 'HW3-module-state', 'Module state must be instance-owned; readonly collections or explicitly reviewed path-keyed locks may be retained.', declarationIdentity((node as ts.VariableDeclaration).name));
      if (input.server && globalFetchCall(node)) report(node, 'HW4-injected-fetch', 'Call an injected fetch port; the global fetch may only supply its default.', (node as ts.CallExpression).expression.getText(tree));
    }
    function visit(node: ts.Node): void {
      if (jini) visitJini(node);
      if (uncoveredDefault(node, input.bootCoveredEnv)) report(node, 'HW6-boot-default', 'Unsafe development default has no matching environment check in the production refusal gate.', envKey((node as ts.BinaryExpression).left) ?? (node as ts.BinaryExpression).left.getText(tree));
      if (!ownsUrls && apiUrl(node)) report(node, 'HW8-provider-url', 'Vendor API URL belongs in a provider, adapter or catalog.', (node as ts.StringLiteralLike).text);
      c.forEachChild(node, visit);
    }
    visit(tree);
    return found;
  }

  function firstJsx(tree: ts.SourceFile): ts.Node | undefined {
    let jsx: ts.Node | undefined;
    function visit(node: ts.Node): void {
      if (jsx) return;
      if (c.isJsxElement(node) || c.isJsxSelfClosingElement(node) || c.isJsxFragment(node)) jsx = node;
      if (!jsx) c.forEachChild(node, visit);
    }
    visit(tree);
    return jsx;
  }

  function reactSpecifier(specifier: string): boolean {
    return /^react(?:-dom)?(?:\/|$)/.test(specifier) || /(?:^|\/)node_modules\/react(?:-dom)?(?:\/|$)/.test(specifier);
  }

  function implicitReact(tree: ts.SourceFile, file: string, displayFile: (file: string) => string): HardwiringViolation | undefined {
    // Vite's automatic JSX runtime adds an import even when source imports only erased types.
    if (file.includes('/node_modules/')) return undefined;
    const jsx = firstJsx(tree);
    if (!jsx) return undefined;
    return { ...violation(tree, jsx, 'HW7-public-react', 'Automatic JSX runtime imports React into the public-site bundle.', 'jsx'), file: displayFile(file) };
  }

  /** Traverse every runtime edge, including dynamic imports, barrels and CommonJS requires.
   * O(V + E) visits with a set: cycles and diamond imports never rescan a module.
   * Host resolver supplies browser/package-export conditions and fails on unresolved code edges.
   */
  function inspectPublicGraph({ entries, readSource, resolveImport, displayFile }: {
    entries: readonly string[];
    readSource: (file: string) => string;
    resolveImport: (specifier: string, file: string) => string | undefined;
    displayFile: (file: string) => string;
  }, _options: Record<string, never> = {}): HardwiringViolation[] {
    const seen = new Set<string>();
    const pending = [...entries];
    const found: HardwiringViolation[] = [];
    const reportedPackages = new Set<string>();
    function reportGraph(item: HardwiringViolation): void {
      if (item.file.startsWith('node_modules/')) {
        if (reportedPackages.has(item.file)) return;
        reportedPackages.add(item.file);
        found.push({ ...item, line: 1, reason: 'Public-site dependency package loads React or React DOM.',
          fingerprint: createHash('sha256').update(item.file).digest('hex') });
      } else found.push(item);
    }
    function scanModule(file: string): void {
      const tree = parse({ file, source: readSource(file) });
      for (const ref of imports({ tree })) {
        if (reactSpecifier(ref.specifier)) {
          reportGraph({ ...violation(tree, ref.node, 'HW7-public-react', 'Public-site runtime graph must not load React or React DOM.', ref.specifier), file: displayFile(file) });
          continue;
        }
        const resolved = resolveImport(ref.specifier, file);
        if (resolved) pending.push(resolved);
      }
      const implicit = implicitReact(tree, file, displayFile);
      if (implicit) reportGraph(implicit);
    }
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const file = pending[cursor]!;
      if (seen.has(file)) continue;
      seen.add(file);
      scanModule(file);
    }
    return found;
  }

  return { inspect, inspectPublicGraph, parse, imports, exportedFunctions,
    envKey: ({ node }: { node: ts.Node }, _options: Record<string, never> = {}) => envKey(node),
  };
}

/** Occurrence-based debt ratchet: adding a duplicate in an already listed file still fails.
 * Line shifts and body edits do not create debt; new identifying values cannot inherit waivers. O(n) time/space.
 */
export function diffHardwiringDebt({ baseline, current }: {
  baseline: readonly HardwiringViolation[]; current: readonly HardwiringViolation[];
}, _options: Record<string, never> = {}) {
  const key = (v: HardwiringViolation) => JSON.stringify([v.rule, v.file, v.fingerprint]);
  function surplus(left: readonly HardwiringViolation[], right: readonly HardwiringViolation[]) {
    const counts = new Map<string, number>();
    for (const item of right) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
    return left.filter((item) => {
      const count = counts.get(key(item)) ?? 0;
      if (!count) return true;
      counts.set(key(item), count - 1);
      return false;
    });
  }
  return { added: surplus(current, baseline), removed: surplus(baseline, current) };
}
