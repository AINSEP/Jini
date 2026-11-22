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

function parse({ c, file, source }: { c: typeof ts; file: string; source: string }): ts.SourceFile {
  const tree = c.createSourceFile(file, source, c.ScriptTarget.Latest, true, scriptKind({ c, file }));
  const failure = syntaxError({ tree, file });
  if (failure) throw failure;
  return tree;
}

function scriptKind({ c, file }: { c: typeof ts; file: string }): ts.ScriptKind {
  if (/\.[jt]sx$/.test(file)) return c.ScriptKind.TSX;
  return /\.[cm]?js$/.test(file) ? c.ScriptKind.JS : c.ScriptKind.TS;
}

function member({ c, node, name }: { c: typeof ts; node: ts.Node; name: string }): boolean {
  if (c.isPropertyAccessExpression(node)) return node.name.text === name;
  return c.isElementAccessExpression(node) && c.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === name;
}

function env(c: typeof ts, node: ts.Node): boolean {
  return member({ c, node, name: 'env' }) && 'expression' in node && c.isIdentifier(node.expression as ts.Node) &&
    (node.expression as ts.Identifier).text === 'process';
}

function envKey(c: typeof ts, node: ts.Node): string | undefined {
  if (c.isPropertyAccessExpression(node) && env(c, node.expression)) return node.name.text;
  if (c.isElementAccessExpression(node) && env(c, node.expression) && c.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  return undefined;
}

function erasedImport(node: ts.ImportDeclaration): boolean {
  // `import { type X }` can emit `import {}` under verbatimModuleSyntax: still a load.
  return node.importClause?.isTypeOnly === true;
}

function kept({ literal, typeOnly, includeTypeOnly }: {
  literal: ts.Node;
  typeOnly: boolean;
  includeTypeOnly: boolean;
}): ts.Node | undefined {
  return includeTypeOnly || !typeOnly ? literal : undefined;
}

function declarationLiteral({ c, node, includeTypeOnly }: {
  c: typeof ts;
  node: ts.Node;
  includeTypeOnly: boolean;
}): ts.Node | undefined {
  if (c.isImportDeclaration(node)) return kept({ literal: node.moduleSpecifier, typeOnly: erasedImport(node), includeTypeOnly });
  if (c.isExportDeclaration(node) && node.moduleSpecifier) return kept({ literal: node.moduleSpecifier, typeOnly: node.isTypeOnly, includeTypeOnly });
  if (c.isImportEqualsDeclaration(node) && c.isExternalModuleReference(node.moduleReference)) return kept({ literal: node.moduleReference.expression, typeOnly: node.isTypeOnly, includeTypeOnly });
  return undefined;
}

function loadCallLiteral(c: typeof ts, node: ts.Node): ts.Node | undefined {
  if (!c.isCallExpression(node)) return undefined;
  const load = node.expression.kind === c.SyntaxKind.ImportKeyword || (c.isIdentifier(node.expression) && node.expression.text === 'require');
  return load ? node.arguments[0] : undefined;
}

function importLiteral({ c, node, includeTypeOnly }: {
  c: typeof ts;
  node: ts.Node;
  includeTypeOnly: boolean;
}): ts.Node | undefined {
  return loadCallLiteral(c, node) ?? declarationLiteral({ c, node, includeTypeOnly });
}

function imports({ c, tree }: { c: typeof ts; tree: ts.SourceFile }, { includeTypeOnly = false }: { includeTypeOnly?: boolean } = {}): RuntimeImport[] {
  const found: RuntimeImport[] = [];
  function visit(node: ts.Node): void {
    const literal = importLiteral({ c, node, includeTypeOnly });
    if (literal && c.isStringLiteralLike(literal)) found.push({ specifier: literal.text, node });
    c.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}

function declaredFunctions(c: typeof ts, statement: ts.Statement): { name: string; node: ts.Node }[] {
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

function exportedFunctions({ c, tree }: { c: typeof ts; tree: ts.SourceFile }): { name: string; node: ts.Node }[] {
  const locals = new Map<string, ts.Node>();
  const found: { name: string; node: ts.Node }[] = [];
  for (const statement of tree.statements) {
    const exported = c.canHaveModifiers(statement) && c.getModifiers(statement)?.some((m) => m.kind === c.SyntaxKind.ExportKeyword);
    for (const item of declaredFunctions(c, statement)) {
      locals.set(item.name, item.node);
      if (exported) found.push(item);
    }
  }
  for (const statement of tree.statements) found.push(...exportedAliases({ c, statement, locals }));
  return found;
}

function exportedAliases({ c, statement, locals }: {
  c: typeof ts;
  statement: ts.Statement;
  locals: ReadonlyMap<string, ts.Node>;
}): { name: string; node: ts.Node }[] {
  if (!c.isExportDeclaration(statement) || statement.moduleSpecifier || statement.isTypeOnly) return [];
  if (!statement.exportClause || !c.isNamedExports(statement.exportClause)) return [];
  return statement.exportClause.elements.flatMap((item) => {
    const node = locals.get((item.propertyName ?? item.name).text);
    return node && !item.isTypeOnly ? [{ name: item.name.text, node }] : [];
  });
}

function violation({ tree, node, rule, reason, identity }: {
  tree: ts.SourceFile;
  node: ts.Node;
  rule: string;
  reason: string;
  identity: string;
}): HardwiringViolation {
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

function moduleScope(c: typeof ts, node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (c.isFunctionLike(parent) || c.isClassLike(parent) || c.isModuleDeclaration(parent)) return false;
  }
  return true;
}

/** BindingName is Identifier | ObjectBindingPattern | ArrayBindingPattern; array holes are OmittedExpressions. */
function binds({ c, name, id }: { c: typeof ts; name: ts.BindingName; id: string }): boolean {
  if (c.isIdentifier(name)) return name.text === id;
  return name.elements.some((e) => c.isBindingElement(e) && binds({ c, name: e.name, id }));
}

function scopeBinds({ c, scope, id }: { c: typeof ts; scope: ts.Node; id: string }): boolean {
  if (c.isFunctionLike(scope)) return scope.parameters.some((p) => binds({ c, name: p.name, id }));
  if (c.isCatchClause(scope)) return Boolean(scope.variableDeclaration && binds({ c, name: scope.variableDeclaration.name, id }));
  if (c.isBlock(scope) || c.isSourceFile(scope)) return scope.statements.some((statement) => statementBinds({ c, statement, id }));
  return false;
}

/** A lexical binding of `id` (parameter, destructured name, local, import) shadows the global of that name. */
function hasLocalBinding({ c, node, id }: { c: typeof ts; node: ts.Node; id: string }): boolean {
  for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) if (scopeBinds({ c, scope, id })) return true;
  return false;
}

function isGlobalThisMember({ c, value, id }: {
  c: typeof ts;
  value: ts.Expression | undefined;
  id: string;
}): boolean {
  if (!value || !member({ c, node: value, name: id }) || !('expression' in value)) return false;
  const target = value.expression as ts.Node;
  return c.isIdentifier(target) && target.text === 'globalThis';
}

function statementBinds({ c, statement, id }: {
  c: typeof ts;
  statement: ts.Statement;
  id: string;
}): boolean {
  // Renaming the global to a local of the same name is still a global call, not an injected port.
  if (c.isVariableStatement(statement)) return statement.declarationList.declarations.some((d) =>
    binds({ c, name: d.name, id }) && !isGlobalThisMember({ c, value: d.initializer, id }));
  if (c.isFunctionDeclaration(statement)) return statement.name?.text === id;
  if (!c.isImportDeclaration(statement) || !statement.importClause) return false;
  const clause = statement.importClause;
  if (clause.name?.text === id) return true;
  return Boolean(clause.namedBindings && c.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.some((e) => e.name.text === id));
}

function isEnvDefault(c: typeof ts, node: ts.Node): boolean {
  let expression = node;
  while (c.isParenthesizedExpression(expression.parent)) expression = expression.parent;
  const parent = expression.parent;
  if (c.isBinaryExpression(parent)) return parent.operatorToken.kind === c.SyntaxKind.QuestionQuestionToken && parent.right === expression;
  return (c.isParameter(parent) || c.isBindingElement(parent)) && parent.initializer === expression;
}

/** Binding defaults and initializers are implementation; debt identity is only the declared names.
 * Array holes retain their slots so moving a name changes its positional identity. */
function declarationIdentity(c: typeof ts, name: ts.BindingName): string {
  if (c.isIdentifier(name)) return name.text;
  return name.elements.map(element => c.isBindingElement(element) ? declarationIdentity(c, element.name) : '').join(',');
}

function mutableModuleState({ c, node, tree }: {
  c: typeof ts;
  node: ts.Node;
  tree: ts.SourceFile;
}): boolean {
  if (!c.isVariableDeclaration(node) || !moduleScope(c, node) || !c.isVariableDeclarationList(node.parent)) return false;
  // A flag test, not a boolean `&&`: the Const bit marks `const` (and `await using`) lists.
  const constBinding = (node.parent.flags & c.NodeFlags.Const) !== 0;
  if (!constBinding) return true;
  if (!node.initializer || !c.isNewExpression(node.initializer) || !c.isIdentifier(node.initializer.expression)) return false;
  if (!['Map', 'Set'].includes(node.initializer.expression.text)) return false;
  // Readonly<Map> only freezes properties; it still exposes .set/.delete.
  return !node.type || !/^Readonly(?:Map|Set)\s*</.test(node.type.getText(tree));
}

function globalFetchCall(c: typeof ts, node: ts.Node): boolean {
  if (!c.isCallExpression(node)) return false;
  if (c.isIdentifier(node.expression)) return node.expression.text === 'fetch' && !hasLocalBinding({ c, node, id: 'fetch' });
  if (!member({ c, node: node.expression, name: 'fetch' }) || !('expression' in node.expression)) return false;
  const object = node.expression.expression as ts.Node;
  return c.isIdentifier(object) && object.text === 'globalThis';
}

function uncoveredDefault({ c, node, covered }: {
  c: typeof ts;
  node: ts.Node;
  covered: ReadonlySet<string> | undefined;
}): boolean {
  if (!c.isBinaryExpression(node) || node.operatorToken.kind !== c.SyntaxKind.QuestionQuestionToken) return false;
  const fallback = node.right;
  const insecure = (c.isStringLiteralLike(fallback) && fallback.text.startsWith('dev-only-insecure-')) ||
    (c.isIdentifier(fallback) && /^DEFAULT_.*PASSWORD$/.test(fallback.text));
  if (!insecure) return false;
  const key = envKey(c, node.left);
  return !key || !covered?.has(key);
}

function apiUrl(c: typeof ts, node: ts.Node): boolean {
  if (!c.isStringLiteralLike(node) && !c.isTemplateHead(node) && !c.isTemplateMiddle(node) && !c.isTemplateTail(node)) return false;
  return /https:\/\/api\./i.test(node.text);
}

/** Resolution runs for every edge, even without a plugin identity: a host resolver may fail closed on unresolved code. */
function targetPlugin({ input, specifier }: { input: HardwiringSource; specifier: string }): string | undefined {
  const target = input.resolveImport?.(specifier, input.file);
  return target ? input.pluginIdentity?.(target) : undefined;
}

function inspectImports({ input, tree, refs }: {
  input: HardwiringSource;
  tree: ts.SourceFile;
  refs: readonly RuntimeImport[];
}): HardwiringViolation[] {
  const found: HardwiringViolation[] = [];
  const plugin = input.pluginIdentity?.(input.file);
  const vendorOwner = adapter(input.file);
  for (const ref of refs) {
    if (!vendorOwner && vendor(ref.specifier)) found.push(violation({
      tree,
      node: ref.node,
      rule: 'HW2-vendor-adapter',
      reason: 'Driver/vendor dependency belongs in an adapter, kernel or provider.',
      identity: ref.specifier,
    }));
    const other = targetPlugin({ input, specifier: ref.specifier });
    if (plugin && other && other !== plugin) found.push(violation({
      tree,
      node: ref.node,
      rule: 'HW9-plugin-import',
      reason: `Import crosses ${plugin} → ${other}; plugins must communicate through host ports.`,
      identity: ref.specifier,
    }));
  }
  return found;
}

/** Analyze authored source; host policies supply export ownership, refusal coverage and import resolution. */
function inspect({ c, input }: { c: typeof ts; input: HardwiringSource }): HardwiringViolation[] {
  const tree = parse({ c, ...input });
  const refs = imports({ c, tree }, { includeTypeOnly: true });
  const found = inspectImports({ input, tree, refs });
  const report = ({ node, rule, reason, identity }: {
  node: ts.Node;
  rule: string;
  reason: string;
  identity: string;
}) => found.push(violation({ tree, node, rule, reason, identity }));
  const jini = input.mode === 'jini';
  const envExempt = /(?:^|\/)(?:bin|cli|testing)[/.]/.test(input.file);
  const ownsUrls = urlOwner(input.file);
  if (!jini && !refs.some((ref) => ref.specifier.startsWith('@jini-ai/'))) {
    for (const item of exportedFunctions({ c, tree })) if (input.jiniExports?.has(item.name)) report({
      node: item.node,
      rule: 'HW5-jini-export',
      reason: `Export ${item.name} duplicates a Jini function without using its owner.`,
      identity: item.name,
    });
  }
  function visit(node: ts.Node): void {
    if (jini) visitJini(node, { c, input, tree }, { envExempt, report });
    if (uncoveredDefault({ c, node, covered: input.bootCoveredEnv })) report({
      node,
      rule: 'HW6-boot-default',
      reason: 'Unsafe development default has no matching environment check in the production refusal gate.',
      identity: envKey(c, (node as ts.BinaryExpression).left) ?? (node as ts.BinaryExpression).left.getText(tree),
    });
    if (!ownsUrls && apiUrl(c, node)) report({
      node,
      rule: 'HW8-provider-url',
      reason: 'Vendor API URL belongs in a provider, adapter or catalog.',
      identity: (node as ts.StringLiteralLike).text,
    });
    c.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}

function visitJini(node: ts.Node, { c, input, tree }: { c: typeof ts; input: HardwiringSource; tree: ts.SourceFile },
  { envExempt, report }: { envExempt: boolean; report: (item: Omit<Parameters<typeof violation>[0], 'tree'>) => void }): void {
  if (!envExempt && env(c, node) && !isEnvDefault(c, node)) report({
    node,
    rule: 'HW1-env-default',
    reason: 'process.env is allowed only as an injected environment default (?? process.env or env = process.env).',
    identity: envKey(c, node.parent) ?? 'process.env',
  });
  if (mutableModuleState({ c, node, tree })) report({
    node,
    rule: 'HW3-module-state',
    reason: 'Module state must be instance-owned; readonly collections or explicitly reviewed path-keyed locks may be retained.',
    identity: declarationIdentity(c, (node as ts.VariableDeclaration).name),
  });
  if (input.server && globalFetchCall(c, node)) report({
    node,
    rule: 'HW4-injected-fetch',
    reason: 'Call an injected fetch port; the global fetch may only supply its default.',
    identity: (node as ts.CallExpression).expression.getText(tree),
  });
}

function firstJsx(c: typeof ts, tree: ts.SourceFile): ts.Node | undefined {
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

function implicitReact({ c, tree, file, displayFile }: {
  c: typeof ts;
  tree: ts.SourceFile;
  file: string;
  displayFile: (file: string) => string;
}): HardwiringViolation | undefined {
  // Vite's automatic JSX runtime adds an import even when source imports only erased types.
  if (file.includes('/node_modules/')) return undefined;
  const jsx = firstJsx(c, tree);
  if (!jsx) return undefined;
  return { ...violation({ tree, node: jsx, rule: 'HW7-public-react', reason: 'Automatic JSX runtime imports React into the public-site bundle.', identity: 'jsx' }), file: displayFile(file) };
}

/** Traverse every runtime edge, including dynamic imports, barrels and CommonJS requires.
 * O(V + E) visits with a set: cycles and diamond imports never rescan a module.
 * Host resolver supplies browser/package-export conditions and fails on unresolved code edges.
 */
function inspectPublicGraph({ c, entries, readSource, resolveImport, displayFile }: {
  c: typeof ts;
  entries: readonly string[];
  readSource: (file: string) => string;
  resolveImport: (specifier: string, file: string) => string | undefined;
  displayFile: (file: string) => string;
}): HardwiringViolation[] {
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
    const tree = parse({ c, file, source: readSource(file) });
    for (const ref of imports({ c, tree })) {
      if (reactSpecifier(ref.specifier)) {
        reportGraph({ ...violation({ tree, node: ref.node, rule: 'HW7-public-react', reason: 'Public-site runtime graph must not load React or React DOM.', identity: ref.specifier }), file: displayFile(file) });
        continue;
      }
      const resolved = resolveImport(ref.specifier, file);
      if (resolved) pending.push(resolved);
    }
    const implicit = implicitReact({ c, tree, file, displayFile });
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

/** Bind the installed compiler, keeping this optional parser out of the runtime dependency graph.
 * Inspection is O(n) AST nodes, plus lexical-scope scans for bare fetch calls; no external I/O.
 * Only the rule-identifying value is hashed for debt identity and never included in diagnostics (it may contain secrets).
 */
export function createHardwiringInspector({ compiler: c }: { compiler: typeof ts }, _options: Record<string, never> = {}) {
  return {
    inspect: (input: HardwiringSource, _options: Record<string, never> = {}) => inspect({ c, input }),
    inspectPublicGraph: (required: Omit<Parameters<typeof inspectPublicGraph>[0], 'c'>, _options: Record<string, never> = {}) => inspectPublicGraph({ c, ...required }),
    parse: (required: { file: string; source: string }, _options: Record<string, never> = {}) => parse({ c, ...required }),
    imports: ({ tree, includeTypeOnly }: { tree: ts.SourceFile; includeTypeOnly?: boolean }, _options: Record<string, never> = {}) =>
      imports({ c, tree }, includeTypeOnly === undefined ? {} : { includeTypeOnly }),
    exportedFunctions: (required: { tree: ts.SourceFile }, _options: Record<string, never> = {}) => exportedFunctions({ c, ...required }),
    envKey: ({ node }: { node: ts.Node }, _options: Record<string, never> = {}) => envKey(c, node),
    hasLocalBinding: ({ node, name }: { node: ts.Node; name: string }, _options: Record<string, never> = {}) => hasLocalBinding({ c, node, id: name }),
    // Shared with the env-access rules (env-access.ts), so both audits agree on what `process.env` and module scope mean.
    isProcessEnv: ({ node }: { node: ts.Node }, _options: Record<string, never> = {}) => env(c, node),
    isModuleScope: ({ node }: { node: ts.Node }, _options: Record<string, never> = {}) => moduleScope(c, node),
    violation: (required: { tree: ts.SourceFile; node: ts.Node; rule: string; reason: string; identity: string }, _options: Record<string, never> = {}) =>
      violation({
        tree: required.tree,
        node: required.node,
        rule: required.rule,
        reason: required.reason,
        identity: required.identity,
      }),
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
