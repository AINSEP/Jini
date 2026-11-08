/** Incremental package boundary check against an immutable original-pin declaration snapshot.
 * To reproduce XP3: build a separate clean checkout at the original --base with frozen tools,
 * core first, then the recursive build. From that checkout invoke this repaired script by its
 * absolute path with the S3 tsx loader: --base <full-original-sha> --write-baseline <absolute-dir>.
 * The writer uses cwd, not this script's checkout. Return to S3 and set
 * JINI_DECLARATION_BASELINE_DIR to that snapshot for every gate; never regenerate it at a gate.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { packageSourceFiles, parseSource, sourcePackages, type SourcePackage } from './lib/package-sources.js';
import { isMainModule } from './lib/is-main-module.js';

interface Finding { rule: string; file: string; specifier: string }
interface Change { status: string; file: string }
interface Snapshot { base: string; outputs: Record<string, string[]> }
interface Context { root: string; base: string; baselineDir?: string | undefined }

function git(required: { root: string; args: string[] }): string {
  return execFileSync('git', required.args, { cwd: required.root, encoding: 'utf8' });
}

function changes(required: Context): Change[] {
  const tokens = git({ root: required.root, args: ['diff', '--name-status', '-z', '--find-renames', required.base, '--', 'packages'] }).split('\0');
  const result: Change[] = [];
  for (let i = 0; tokens[i];) {
    const status = tokens[i++]!;
    const before = tokens[i++]!;
    const file = status.startsWith('R') ? tokens[i++]! : before;
    if (/^[AMR]/.test(status)) result.push({ status: status[0]!, file });
  }
  return result;
}

function isLiteralModuleCall(node: ts.Node): node is ts.CallExpression & { arguments: ts.NodeArray<ts.Expression> & { 0: ts.StringLiteral } } {
  return Boolean(ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
    || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    && node.arguments[0] && ts.isStringLiteral(node.arguments[0]));
}

function specifiers(required: { file: string; source: string }): Set<string> {
  const specs = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) collectImport({ node, specs });
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specs.add(node.moduleSpecifier.text);
    if (isLiteralModuleCall(node)) specs.add(node.arguments[0].text);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) specs.add(node.argument.literal.text);
    ts.forEachChild(node, visit);
  }
  visit(parseSource(required));
  return specs;
}

function collectImport({ node, specs }: { node: ts.ImportDeclaration; specs: Set<string> }): void {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return;
  if (node.importClause?.isTypeOnly) {
    specs.add(node.moduleSpecifier.text);
  } else {
    specs.add(node.moduleSpecifier.text);
  }
}

function forbidden(required: { specifier: string; owner: string }): boolean {
  const target = required.specifier.match(/^@jini-ai\/[^/]+/)?.[0];
  if (!target) return false;
  if (required.owner === '@jini-ai/core') return true;
  return target !== '@jini-ai/core' && target !== required.owner;
}

function addedEdges(required: { file: string; owner: string; current: Set<string>; before?: Set<string> }): Finding[] {
  return [...required.current].filter(specifier => forbidden({ specifier, owner: required.owner }) && !required.before?.has(specifier))
    .map(specifier => ({ rule: 'XP3', file: required.file, specifier }));
}

function ownerFor(required: { root: string; file: string; packages: SourcePackage[] }): SourcePackage | undefined {
  const absolute = resolve(required.root, required.file);
  return required.packages.filter(pkg => absolute.startsWith(pkg.directory + '/')).sort((a, b) => b.directory.length - a.directory.length)[0];
}

const parsedBuildConfigs = new WeakMap<SourcePackage, ts.ParsedCommandLine[]>();

function buildConfigs(required: { pkg: SourcePackage }): ts.ParsedCommandLine[] {
  const cached = parsedBuildConfigs.get(required.pkg);
  if (cached) return cached;
  const manifest = JSON.parse(readFileSync(join(required.pkg.directory, 'package.json'), 'utf8'));
  const configs = [...String(manifest.scripts?.build ?? '').matchAll(/\btsc\s+-p\s+([^\s&]+)/g)].map(match => match[1]!);
  const parsedConfigs = (configs.length ? configs : ['tsconfig.json']).map(config => {
    const parsed = ts.getParsedCommandLineOfConfigFile(join(required.pkg.directory, config), {}, {
      ...ts.sys, onUnRecoverableConfigFileDiagnostic: error => { throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n')); },
    });
    if (!parsed) throw new Error('missing build tsconfig');
    return parsed;
  });
  parsedBuildConfigs.set(required.pkg, parsedConfigs);
  return parsedConfigs;
}

function outputFiles(required: { pkg: SourcePackage; file: string }): string[] {
  return [...new Set(buildConfigs(required).flatMap(parsed => !parsed.options.noEmit && parsed.fileNames.includes(required.file)
    ? ts.getOutputFileNames(parsed, required.file, false).filter(file => /\.d\.[cm]?ts$/.test(file)) : []))];
}

/** Snapshot destinations cannot overwrite anything or resolve inside/above the source checkout. */
function baselineDestination(required: { root: string; destination: string }): string {
  if (!isAbsolute(required.destination)) throw new Error('baseline destination must be absolute');
  const destination = join(realpathSync(dirname(required.destination)), basename(required.destination));
  if (existsSync(destination) || destination.startsWith(required.root + '/') || required.root.startsWith(destination + '/')
    || destination === required.root) throw new Error('unsafe or existing baseline destination');
  return destination;
}

/** A declaration must be a real, emitted file contained in the checkout's configured build output. */
function baselineDeclaration(required: { root: string; file: string }): { file: string; bytes: Buffer } {
  const resolved = realpathSync(required.file);
  const file = relative(required.root, resolved);
  if (file.startsWith('../') || isAbsolute(file) || resolved !== resolve(required.file)) throw new Error('unsafe declaration output');
  return { file, bytes: readFileSync(resolved) };
}

/** Reuse the checker's build mapping; excluded/unemitted source is never given an invented mapping. */
function baselineEntries(required: { root: string }): { source: string; declarations: { file: string; bytes: Buffer }[] }[] {
  return sourcePackages({ packagesDir: join(required.root, 'packages') }).flatMap(pkg =>
    packageSourceFiles({ directory: pkg.directory }).filter(file => /\.[cm]?tsx?$/.test(file)).flatMap(file => {
      const declarations = outputFiles({ pkg, file }).map(file => baselineDeclaration({ ...required, file }));
      return declarations.length ? [{ source: relative(required.root, file), declarations }] : [];
    }));
}

/** Refuse wrong provenance, dirty tracked files, missing emit and overwrite before writing a snapshot. */
function writeDeclarationBaseline(required: Context & { destination: string }, _optional: Record<string, never> = {}): void {
  const root = realpathSync(required.root);
  const base = git({ root, args: ['rev-parse', required.base] }).trim();
  if (git({ root, args: ['rev-parse', 'HEAD'] }).trim() !== base) throw new Error('baseline HEAD must equal the pinned base');
  if (git({ root, args: ['status', '--porcelain', '--untracked-files=no'] }).trim()) throw new Error('baseline tracked source must be clean');
  const destination = baselineDestination({ root, destination: required.destination });
  const entries = baselineEntries({ root });
  if (!entries.length) throw new Error('no emitted declaration mappings');
  const outputs: Snapshot['outputs'] = {};
  mkdirSync(destination);
  for (const entry of entries) {
    outputs[entry.source] = entry.declarations.map(declaration => declaration.file);
    for (const declaration of entry.declarations) {
      const target = join(destination, declaration.file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, declaration.bytes);
    }
  }
  writeFileSync(join(destination, 'manifest.json'), JSON.stringify({ base, outputs }, null, 2) + '\n');
  console.log(`declaration baseline: ${base}; ${entries.length} source mappings; ${destination}`);
}

function declarationBefore(required: Context & { file: string }): Set<string> {
  if (!required.baselineDir || !isAbsolute(required.baselineDir)) throw new Error('absolute JINI_DECLARATION_BASELINE_DIR required');
  const manifest = JSON.parse(readFileSync(join(required.baselineDir, 'manifest.json'), 'utf8')) as Snapshot;
  const base = git({ root: required.root, args: ['rev-parse', required.base] }).trim();
  if (manifest.base !== base) throw new Error('declaration snapshot is not from the pinned base');
  const outputs = manifest.outputs[required.file];
  if (!outputs?.length) throw new Error('missing baseline declaration mapping');
  return new Set(outputs.flatMap(file => [...specifiers({ file, source: readFileSync(join(required.baselineDir!, file), 'utf8') })]));
}

function checkDeclarations(required: Context & { change: Change; pkg: SourcePackage }): Finding[] {
  const file = required.change.file;
  try {
    const outputs = outputFiles({ pkg: required.pkg, file: resolve(required.root, file) });
    if (!outputs.length) throw new Error('missing current declaration mapping');
    const current = new Set(outputs.flatMap(output => [...specifiers({ file: output, source: readFileSync(output, 'utf8') })]));
    const before = required.change.status === 'M' ? declarationBefore({ ...required, file }) : undefined;
    return addedEdges({ file, owner: required.pkg.manifest.name, current, ...(before ? { before } : {}) });
  } catch (error) {
    return [{ rule: 'XP3', file, specifier: String(error) }];
  }
}

function sourceChange(required: Context & { change: Change; pkg: SourcePackage }): Finding[] {
  const { file, status } = required.change;
  const current = specifiers({ file, source: readFileSync(resolve(required.root, file), 'utf8') });
  const before = status === 'M' ? specifiers({ file, source: git({ root: required.root, args: ['show', `${required.base}:${file}`] }) }) : undefined;
  const rule = status === 'M' ? 'XP2' : 'XP1';
  return [...addedEdges({ file, owner: required.pkg.manifest.name, current, ...(before ? { before } : {}) }).map(finding => ({ ...finding, rule })),
    ...checkDeclarations(required)];
}

function insideCore(required: { file: string; specifier: string; core: string }): boolean {
  return required.specifier.startsWith('.') && resolve(dirname(required.file), required.specifier).startsWith(resolve(required.core, 'src') + '/');
}

function validContractStatement(node: ts.Statement): boolean {
  if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) return false;
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return true;
  if (ts.isImportDeclaration(node)) return node.importClause?.isTypeOnly === true;
  return ts.isExportDeclaration(node) && node.isTypeOnly;
}

function checkContract(required: { root: string; file: string; core: string }): Finding[] {
  const ast = parseSource({ file: required.file, source: readFileSync(required.file, 'utf8') });
  const findings: Finding[] = [];
  const file = relative(required.root, required.file);
  for (const statement of ast.statements) {
    if (!validContractStatement(statement)) findings.push({ rule: 'XP4', file, specifier: ts.SyntaxKind[statement.kind] });
  }
  for (const specifier of specifiers({ file, source: ast.text })) {
    if (!insideCore({ ...required, specifier })) findings.push({ rule: 'XP4', file, specifier });
  }
  return findings;
}

function checkContractJavaScript(required: { root: string; file: string; pkg: SourcePackage }): Finding[] {
  const file = relative(required.root, required.file);
  try {
    const declarations = outputFiles(required);
    if (!declarations.length) throw new Error('missing contract emit mapping');
    for (const declaration of declarations) {
      const js = declaration.replace(/\.d\.(ts|mts|cts)$/, (_, extension: string) => ({ ts: '.js', mts: '.mjs', cts: '.cjs' })[extension]!);
      const ast = parseSource({ file: js, source: readFileSync(js, 'utf8') });
      const empty = ast.statements.length === 1 && ast.statements.every(node => ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause
        && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length === 0);
      if (!empty) throw new Error('contract JavaScript contains runtime statements');
    }
    return [];
  } catch (error) {
    return [{ rule: 'XP4', file, specifier: String(error) }];
  }
}

function checkManifests(required: Context & { packages: SourcePackage[] }): Finding[] {
  return required.packages.flatMap(pkg => {
    const file = relative(required.root, join(pkg.directory, 'package.json'));
    const old = git({ root: required.root, args: ['ls-tree', required.base, '--', file] });
    const before = old ? JSON.parse(git({ root: required.root, args: ['show', `${required.base}:${file}`] })) : {};
    return (['dependencies', 'peerDependencies'] as const).flatMap(section =>
      Object.keys(pkg.manifest[section] ?? {}).filter(specifier => specifier.startsWith('@jini-ai/') && specifier !== '@jini-ai/core' && !before[section]?.[specifier])
        .map(specifier => ({ rule: 'XP5', file, specifier })));
  });
}

export function checkNoCrossPackage(required: Context, _optional: Record<string, never> = {}): Finding[] {
  const packages = sourcePackages({ packagesDir: join(required.root, 'packages') });
  const findings: Finding[] = [];
  for (const change of changes(required)) {
    const pkg = ownerFor({ ...required, file: change.file, packages });
    if (!pkg || !change.file.includes('/src/') || /(?:^|\/)(?:__tests__|tests|fixtures)\/|\.(?:test|spec)\./.test(change.file)) continue;
    if (/\.[cm]?[jt]sx?$/.test(change.file)) findings.push(...sourceChange({ ...required, change, pkg }));
  }
  const core = packages.find(pkg => pkg.manifest.name === '@jini-ai/core');
  if (core) {
    for (const file of ts.sys.readDirectory(join(core.directory, 'src/contracts'), ['.ts'], undefined, ['**/*.ts'])) {
      findings.push(...checkContract({ ...required, file, core: core.directory }), ...checkContractJavaScript({ ...required, file, pkg: core }));
    }
  }
  return [...findings, ...checkManifests({ ...required, packages })];
}

if (isMainModule({ moduleUrl: import.meta.url, entryPath: process.argv[1] })) {
  const base = process.argv[process.argv.indexOf('--base') + 1];
  if (!process.argv.includes('--base') || !base) throw new Error('Usage: check-no-cross-package.ts --base <pinned commit>');
  const writeIndex = process.argv.indexOf('--write-baseline');
  if (writeIndex !== -1) {
    const destination = process.argv[writeIndex + 1];
    if (!destination) throw new Error('--write-baseline requires a destination');
    writeDeclarationBaseline({ root: process.cwd(), base, destination });
  } else {
  const findings = checkNoCrossPackage({ root: process.cwd(), base, baselineDir: process.env.JINI_DECLARATION_BASELINE_DIR });
  for (const finding of findings) console.error(`${finding.rule} ${finding.file}: ${finding.specifier}`);
  if (findings.length) process.exitCode = 1;
  else console.log('check:cross-package: XP1–XP5 clean');
  }
}
