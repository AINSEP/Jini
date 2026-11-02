/** Import policy for authored agent plugin content (`packages/agent-plugins/<id>/**\/*.mjs`).
 * Package source guards scan only `src`, so plugin helpers need this targeted check instead of a
 * blanket hardwiring exemption. A plugin helper may import only `node:*` built-ins, relative files
 * inside its own plugin folder, and `@jini-ai/*` contracts; never another plugin (a sibling folder, its
 * `@jini-ai/agent-plugins/<name>` subpath, a `@jini-ai/plugin-*` package or provider-plugins) or a
 * host path. `__tests__/` folders are not published and may import test tooling (jsdom, fast-check).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { isMainModule } from './lib/is-main-module.js';
import { AGENT_PLUGINS_PACKAGE, agentPluginPackages } from './lib/agent-plugin-packages.js';

export interface AgentPluginContentViolation { rule: string; file: string; reason: string }

const rule = 'P2-agent-plugin-content';
// Tests are never published (the package's files carry `!**/__tests__/**`).
const skippedDirectories = new Set(['node_modules', 'dist', '.git', '__tests__']);
const otherPlugin = /^@jini-ai\/(?:plugin-[a-z0-9-]+|provider-plugins)(?:$|\/)/;
// JSDoc type imports are module references too: `@type {import('../x.mjs').T}`.
const commentImport = /\bimport\(\s*(['"])([^'"]+)\1\s*\)/g;

/** Plugin folders: children of the agent-plugins package that hold a `plugin.json`. */
function pluginFolders(required: { root: string }): string[] {
  if (!existsSync(required.root)) return [];
  return readdirSync(required.root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(required.root, entry.name, 'plugin.json')))
    .map(entry => join(required.root, entry.name)).sort();
}

function moduleFiles(required: { directory: string }): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(required.directory, { withFileTypes: true })) {
    if (skippedDirectories.has(entry.name)) continue;
    const child = join(required.directory, entry.name);
    if (entry.isDirectory()) files.push(...moduleFiles({ directory: child }));
    else if (entry.name.endsWith('.mjs')) files.push(child);
  }
  return files.sort();
}

function isLiteralModuleCall(node: ts.Node): node is ts.CallExpression & { arguments: ts.NodeArray<ts.Expression> & { 0: ts.StringLiteralLike } } {
  return Boolean(ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
    || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]));
}

function declarationSpecifier(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
    && ts.isStringLiteral(node.moduleSpecifier)) return node.moduleSpecifier.text;
  return isLiteralModuleCall(node) ? node.arguments[0].text : undefined;
}

/** Every module specifier in one file: static and dynamic imports, re-exports, `require`, and
 * `import()` inside comments (JSDoc types). Comments are read from each node's leading trivia. */
export function moduleSpecifiers(required: { file: string; source: string }, _optional: Record<string, never> = {}): string[] {
  const ast = ts.createSourceFile(required.file, required.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const specifiers = new Set<string>();
  const comments = new Map<number, string>();
  const visit = (node: ts.Node): void => {
    const specifier = declarationSpecifier(node);
    if (specifier !== undefined) specifiers.add(specifier);
    for (const range of ts.getLeadingCommentRanges(required.source, node.pos) ?? []) comments.set(range.pos, required.source.slice(range.pos, range.end));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  visit(ast.endOfFileToken);
  for (const text of comments.values()) for (const [, , specifier = ''] of text.matchAll(commentImport)) specifiers.add(specifier);
  return [...specifiers];
}

/** Whether a specifier names another plugin's subpath of the agent-plugins package. */
function siblingSubpath(required: { specifier: string; pluginRoot: string; pluginNames: ReadonlySet<string> }): boolean {
  if (!required.specifier.startsWith(`${AGENT_PLUGINS_PACKAGE}/`)) return false;
  const name = required.specifier.slice(AGENT_PLUGINS_PACKAGE.length + 1).split('/')[0]!;
  return required.pluginNames.has(name) && name !== basename(required.pluginRoot);
}

/** Why a specifier is refused, or undefined when it is allowed for a file inside `pluginRoot`.
 * @param optional `pluginNames`: the agent plugin subpath names (default: the reviewed layout table). */
export function refusedSpecifier(
  required: { specifier: string; file: string; pluginRoot: string },
  optional: { pluginNames?: ReadonlySet<string> } = {},
): string | undefined {
  const { specifier, file, pluginRoot } = required;
  if (specifier.startsWith('node:')) return undefined;
  const pluginNames = optional.pluginNames ?? new Set(agentPluginPackages.map(row => row.name));
  if (otherPlugin.test(specifier) || siblingSubpath({ specifier, pluginRoot, pluginNames })) return 'imports another plugin';
  if (specifier.startsWith('@jini-ai/')) return undefined;
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return 'imports a module that is neither node:*, @jini-ai/* nor relative';
  const target = resolve(dirname(file), specifier);
  return target.startsWith(pluginRoot + sep) ? undefined : 'imports a path outside its own plugin folder';
}

function fileViolations(required: { file: string; pluginRoot: string; repoRoot: string; pluginNames: ReadonlySet<string> }): AgentPluginContentViolation[] {
  const name = relative(required.repoRoot, required.file).split(sep).join('/');
  return moduleSpecifiers({ file: required.file, source: readFileSync(required.file, 'utf8') }).flatMap(specifier => {
    const reason = refusedSpecifier({ specifier, file: required.file, pluginRoot: required.pluginRoot }, { pluginNames: required.pluginNames });
    return reason ? [{ rule, file: name, reason: `${reason}: ${specifier}` }] : [];
  });
}

/** Check every plugin folder under `packages/agent-plugins`.
 * @param required Repository root.
 * @returns One violation per refused specifier; an empty list when the content is self-contained.
 * @complexity O(F × S) for F module files of S bytes; reads files, imports nothing. */
export function checkAgentPluginContent(required: { repoRoot: string }, _optional: Record<string, never> = {}): AgentPluginContentViolation[] {
  const folders = pluginFolders({ root: join(required.repoRoot, 'packages/agent-plugins') });
  // Every folder on disk counts as a sibling, listed in the table or not.
  const pluginNames = new Set(folders.map(folder => basename(folder)));
  return folders.flatMap(pluginRoot =>
    moduleFiles({ directory: pluginRoot }).flatMap(file => fileViolations({ file, pluginRoot, repoRoot: required.repoRoot, pluginNames })));
}

if (isMainModule({ moduleUrl: import.meta.url, entryPath: process.argv[1] })) {
  const violations = checkAgentPluginContent({ repoRoot: fileURLToPath(new URL('..', import.meta.url)) });
  for (const violation of violations) console.error(`${violation.rule} ${violation.file}: ${violation.reason}`);
  if (violations.length) process.exitCode = 1;
}
