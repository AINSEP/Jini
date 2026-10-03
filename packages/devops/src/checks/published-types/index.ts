import path from 'node:path';
import type { CheckLoggerPort, FilesystemPort, PackageInstallerPort, ProcessRequest, ProcessResult, ProcessRunnerPort } from '../ports.js';
export type { CheckLoggerPort, FilesystemPort, PackageInstallerPort, ProcessRequest, ProcessResult, ProcessRunnerPort } from '../ports.js';

export interface DependencyManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, unknown>;
}

interface ProjectBase { key: string; directory: string; manifestPath: string }
export interface LinksProject extends ProjectBase { mode: 'links' }
export interface CompileProject extends ProjectBase {
  mode: 'drift' | 'published';
  /** Must be a closer source ancestor than the real install; the host owns this assertion. */
  shadowAnchor: string;
  /** Existing writable scratch parent; unique temporary directories prevent run collisions. */
  scratchParent: string;
  prerequisites: readonly ProcessRequest[];
  /** Runs against the real project config; the library never substitutes tsconfig paths. */
  compiler: ProcessRequest;
}
export type PublishedTypesProject = LinksProject | CompileProject;
export type PublishedTypesStatus = 'pass' | 'skipped' | 'linked' | 'drift' | 'install-error' | 'prerequisite-error' | 'typecheck-error' | 'operation-error';
export interface PublishedTypesResult {
  projectKey: string;
  status: PublishedTypesStatus;
  versions: Readonly<Record<string, string>>;
  linkedPackages: readonly string[];
  diagnostics: readonly string[];
  baselineDiagnostics: readonly string[];
  output: string;
}
export interface PublishedTypesReport { ok: boolean; projects: readonly PublishedTypesResult[] }

function validateScope(scope: string): void {
  if (!/^@[a-z0-9][a-z0-9._-]*$/.test(scope)) throw new TypeError('scope must be an npm scope such as @example');
}

/** Select registry-resolved dependencies from the required scope; explicit local specs are exempt. */
export function registryDependencies({ manifest, scope }: { manifest: DependencyManifest; scope: string }): Record<string, string> {
  validateScope(scope);
  const dependencies: Record<string, string> = {};
  for (const [name, spec] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    if (!name.startsWith(`${scope}/`) || /^(file:|workspace:|link:)/.test(spec)) continue;
    if (!new RegExp(`^${escapeRegex(scope)}/[a-z0-9][a-z0-9._-]*$`).test(name)) throw new TypeError(`invalid dependency name: ${name}`);
    dependencies[name] = spec;
  }
  return dependencies;
}

/** Split compiler output into whole diagnostics; wrapped details stay attached to their first line. */
export function parseDiagnosticBlocks({ output }: { output: string }): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of output.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\S.*\(\d+,\d+\): error TS\d+:/.test(line) || /^error TS\d+:/.test(line)) {
      if (current.length) blocks.push(current.join('\n').trimEnd());
      current = [line];
    } else if (current.length) current.push(line);
  }
  if (current.length) blocks.push(current.join('\n').trimEnd());
  return blocks;
}

function emptyResult(projectKey: string, status: PublishedTypesStatus, output = ''): PublishedTypesResult {
  return { projectKey, status, output, versions: {}, linkedPackages: [], diagnostics: [], baselineDiagnostics: [] };
}
function combined(result: ProcessResult): string { return `${result.stdout}${result.stderr}`; }
function escapeRegex(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function checkLinks(project: LinksProject, deps: Record<string, string>, fs: FilesystemPort): PublishedTypesResult {
  const linkedPackages = Object.keys(deps).filter((name) => {
    const location = path.join(project.directory, 'node_modules', name);
    // lstat also sees broken symlinks; exists() alone does not.
    try { return fs.isSymbolicLink({ path: location }); }
    catch (error) {
      if (isMissingPath(error)) return false;
      throw error;
    }
  });
  return { ...emptyResult(project.key, linkedPackages.length ? 'linked' : 'pass'), linkedPackages };
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/** Acquire ownership before copying. Existing scope directories are never removed or replaced. */
function createShadow(project: CompileProject, source: string, scope: string, fs: FilesystemPort): () => void {
  const nodeModules = path.join(project.shadowAnchor, 'node_modules');
  const scopeDir = path.join(nodeModules, scope);
  const parentExisted = fs.exists({ path: nodeModules });
  if (parentExisted && fs.isSymbolicLink({ path: nodeModules })) throw new Error('shadow node_modules must not be a symlink');
  if (!parentExisted) fs.createDirectory({ path: nodeModules });
  let scopeOwned = false;
  const cleanup = () => {
    if (scopeOwned) fs.removeDirectory({ path: scopeDir });
    // Preserve any entries another process added while the compiler ran.
    if (!parentExisted && fs.readDirectory({ path: nodeModules }).length === 0) fs.removeDirectory({ path: nodeModules });
  };
  try {
    fs.createDirectory({ path: scopeDir });
    scopeOwned = true;
    fs.copyDirectory({ source, destination: scopeDir });
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function evaluateCompile(project: CompileProject, registry: ProcessResult, baseline: ProcessResult, versions: Record<string, string>): PublishedTypesResult {
  const output = combined(registry);
  const baselineDiagnostics = parseDiagnosticBlocks({ output: combined(baseline) });
  const diagnostics = parseDiagnosticBlocks({ output });
  const base = { ...emptyResult(project.key, 'pass', output), versions, diagnostics, baselineDiagnostics };
  if (registry.exitCode === 0) return base;
  if (project.mode === 'published' || registry.exitCode === null || diagnostics.length === 0) return { ...base, status: 'typecheck-error' };
  // A broken baseline is not valid evidence for suppressing registry failures.
  if (baseline.exitCode === null || (baseline.exitCode !== 0 && baselineDiagnostics.length === 0)) return { ...base, status: 'typecheck-error' };
  const known = new Set(baselineDiagnostics);
  const drift = diagnostics.filter((block) => !known.has(block));
  return { ...base, status: drift.length ? 'drift' : 'pass', diagnostics: drift };
}

async function checkCompile(project: CompileProject, manifest: DependencyManifest, deps: Record<string, string>, scope: string, fs: FilesystemPort, runner: ProcessRunnerPort, installer: PackageInstallerPort): Promise<PublishedTypesResult> {
  if (Object.keys(deps).length === 0) return emptyResult(project.key, 'skipped', 'no registry-resolved scoped dependencies');
  for (const command of project.prerequisites) {
    const result = await runner.run(command);
    if (result.exitCode !== 0) return emptyResult(project.key, 'prerequisite-error', combined(result));
  }
  const scratch = fs.createTempDirectory({ parent: project.scratchParent, prefix: 'published-types-' });
  try {
    const overrides = Object.fromEntries(Object.entries(manifest.overrides ?? {}).filter(([name]) => name.startsWith(`${scope}/`)));
    fs.writeText({ path: path.join(scratch, 'package.json'), text: JSON.stringify({ name: 'published-types-scratch', private: true, dependencies: deps, overrides }, null, 2) });
    const installed = await installer.install({ directory: scratch });
    if (installed.exitCode !== 0) return emptyResult(project.key, 'install-error', combined(installed));
    const source = path.join(scratch, 'node_modules', scope);
    if (fs.isSymbolicLink({ path: source })) throw new Error('installed scope must not be linked');
    for (const entry of fs.readDirectory({ path: source })) {
      if (fs.isSymbolicLink({ path: path.join(source, entry) })) throw new Error(`installed scoped package is linked: ${entry}`);
    }
    const versions: Record<string, string> = {};
    for (const name of Object.keys(deps)) {
      const pkg = JSON.parse(fs.readText({ path: path.join(scratch, 'node_modules', name, 'package.json') })) as { version: string };
      versions[name] = pkg.version;
    }
    const baseline = project.mode === 'drift' ? await runner.run(project.compiler) : { exitCode: 0, stdout: '', stderr: '' };
    // Copy the entire installed scope, including hoisted transitive packages.
    const cleanup = createShadow(project, source, scope, fs);
    let registry: ProcessResult;
    try { registry = await runner.run(project.compiler); }
    finally { cleanup(); }
    return evaluateCompile(project, registry, baseline, versions);
  } finally {
    fs.removeDirectory({ path: scratch });
  }
}

/**
 * Check projects sequentially so overlapping source trees cannot see each other's shadows.
 * Ports never exit the host process. Operational failures remain failures, including cleanup errors.
 */
export async function check({ projects, scope, fs, runner, installer }: {
  projects: readonly PublishedTypesProject[]; scope: string; fs: FilesystemPort; runner: ProcessRunnerPort; installer: PackageInstallerPort;
}, { logger }: { logger?: CheckLoggerPort } = {}): Promise<PublishedTypesReport> {
  validateScope(scope);
  if (projects.length === 0) throw new TypeError('at least one project is required');
  const results: PublishedTypesResult[] = [];
  for (const project of projects) {
    let result: PublishedTypesResult;
    try {
      const manifest = JSON.parse(fs.readText({ path: project.manifestPath })) as DependencyManifest;
      const deps = registryDependencies({ manifest, scope });
      result = project.mode === 'links' ? checkLinks(project, deps, fs) : await checkCompile(project, manifest, deps, scope, fs, runner, installer);
    } catch (error) {
      result = emptyResult(project.key, 'operation-error', error instanceof Error ? error.message : String(error));
    }
    results.push(result);
    logger?.log({ projectKey: project.key, status: result.status, message: result.output });
  }
  return { ok: results.every((result) => result.status === 'pass' || result.status === 'skipped'), projects: results };
}

export interface TypecheckLog extends ProcessResult { projectKey: string }
export interface TypecheckDiagnosis { ok: boolean; failures: readonly (TypecheckLog & { hits: readonly string[] })[] }

/** Diagnose captured CI results for the supplied scope without reading files or running commands. */
export function diagnosePublishedTypes({ scope, logs }: { scope: string; logs: readonly TypecheckLog[] }): TypecheckDiagnosis {
  validateScope(scope);
  const escapedScope = escapeRegex(scope);
  const missingExport = new RegExp(`Module ["']{1,2}${escapedScope}/[^"']+["']{1,2} has no exported member ["']([^"']+)["']`, 'g');
  const missingModule = new RegExp(`Cannot find module ["']{1,2}(${escapedScope}/[^"']+)["']{1,2} or its corresponding type declarations`, 'g');
  const failures = logs.filter((log) => log.exitCode !== 0).map((log) => {
    const text = combined(log);
    const hits = [
      ...[...text.matchAll(missingExport)].map((match) => `missing export '${match[1]}'`),
      ...[...text.matchAll(missingModule)].map((match) => `missing module '${match[1]}'`),
    ];
    return { ...log, hits };
  });
  return { ok: failures.length === 0, failures };
}
