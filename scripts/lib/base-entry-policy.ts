/** Gate C1 (`L5-resolved`): the coverage the old `L5-injected-edge` rule did not have, kept under its
 * own rule id so the old keys stay stable and no physical occurrence is reported by both rules.
 *
 * - Imports of the base packages (`@jini-ai/core`, `@jini-ai/protocol`) must use a public entry (a manifest
 *   `exports` key), and every value they bind must be an approved `<entry>#<exported name>` pair. Type-only
 *   imports of a public entry pass. Namespace, wildcard, bare side-effect, dynamic and `require` loads of a
 *   base package are opaque: they name nothing an approval could authorize, so they are findings.
 * - A sibling-relative import (`../../platform/src/fs.js`) is resolved back to the package that owns the
 *   file; reaching another package that way is a cross-package edge like any other (and, into a base
 *   package, a private entry).
 * Host presets are wiring-only and may import anything (owner Q1), so their sources are not checked here.
 */
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { bindingSites, type BindingSite } from './base-entry-sites.js';
import { importSites } from './import-sites.js';
import type { Finding } from './injection-debt.js';
import { ownerOf } from './injection-edges.js';
import { packageSourceFiles, payloadSourceFiles, type SourcePackage } from './package-sources.js';
import { publicEntries } from './public-exports.js';
import { createSpecResolver, type SpecResolver } from './spec-aliases.js';

const RULE = 'L5-resolved';
const SCOPE = '@jini-ai/';
export const BASE_PACKAGE_NAMES: readonly string[] = ['@jini-ai/core', '@jini-ai/protocol'];

interface PolicyContext { root: string; pkg: SourcePackage; packages: readonly SourcePackage[]; resolve: SpecResolver; publicSpecs: ReadonlySet<string>; approved: ReadonlySet<string> }
interface FileContext extends PolicyContext { filename: string; file: string }

const posix = (path: string): string => path.split(sep).join('/');
const packageNameOf = (spec: string): string => spec.split('/').slice(0, 2).join('/');
const finding = (required: { context: FileContext; spec: string; kind: string; why: string }): Finding =>
  ({ rule: RULE, file: required.context.file, spec: required.spec, kind: required.kind, reason: `${ownerOf(required.context.pkg)} → ${required.spec}: ${required.why}` });

/** The package that owns a relative import's target, when that is not the importing package. */
function siblingOwner(required: { context: FileContext; spec: string }): SourcePackage | undefined {
  const target = resolve(dirname(required.context.filename), required.spec);
  const owner = [...required.context.packages].sort((a, b) => b.directory.length - a.directory.length)
    .find(candidate => target === candidate.directory || target.startsWith(candidate.directory + sep));
  return owner && owner !== required.context.pkg ? owner : undefined;
}

/** Base-package specs a written specifier resolves to (aliases applied), excluding the importer itself. */
function baseTargets(required: { context: FileContext; spec: string }): string[] {
  const { context, spec } = required;
  if (spec.startsWith('.')) return [];
  const own = context.pkg.manifest.name;
  return [...new Set(context.resolve(spec))].filter(target => BASE_PACKAGE_NAMES.includes(packageNameOf(target)) && packageNameOf(target) !== own);
}

/** One value-relevant load of a base package: private entry, opaque load, or unapproved names. */
function valueFindings(required: { context: FileContext; site: BindingSite; entry: string }): Finding[] {
  const { context, site, entry } = required;
  if (!context.publicSpecs.has(entry)) return [];
  if (site.form !== 'named') return [finding({ context, spec: entry, kind: `opaque-${site.form}`, why: 'a namespace, wildcard, side-effect, dynamic or require load of a base package names no approved runtime export' })];
  const unapproved = site.values.filter(name => !context.approved.has(`${entry}#${name}`));
  return unapproved.map(name => finding({ context, spec: `${entry}#${name}`, kind: 'unapproved-value', why: 'not in metadata.approvedRuntime; add the approval only in the change that adds the public runtime export' }));
}

/** Every syntax occurrence that names a private entry of a base package, or reaches a sibling by path. */
function entryFindings(context: FileContext): Finding[] {
  const found: Finding[] = [];
  for (const site of importSites({ file: context.filename, source: readFileSync(context.filename, 'utf8') }, { jsdoc: context.filename.endsWith('.mjs') })) {
    if (site.spec.startsWith('.')) {
      const owner = siblingOwner({ context, spec: site.spec });
      if (owner) found.push(finding({ context, spec: owner.manifest.name, kind: `sibling-relative-${site.kind}`, why: `written as ${site.spec}; a relative path into another package is still a cross-package edge` }));
      continue;
    }
    for (const entry of baseTargets({ context, spec: site.spec })) {
      if (!context.publicSpecs.has(entry)) found.push(finding({ context, spec: entry, kind: `private-entry-${site.kind}`, why: 'not a public entry (manifest exports key) of a base package' }));
    }
  }
  return found;
}

function fileFindings(context: FileContext): Finding[] {
  const values = bindingSites({ file: context.filename, source: readFileSync(context.filename, 'utf8') })
    .flatMap(site => baseTargets({ context, spec: site.spec }).flatMap(entry => valueFindings({ context, site, entry })));
  return [...entryFindings(context), ...values];
}

/**
 * Every `L5-resolved` finding in the workspace's production sources (and the plugin payloads).
 * @param required.approved The `metadata.approvedRuntime` pairs.
 * @param required.presets Host-preset package short names, which are not checked.
 * @complexity O(files × sites); each file is parsed twice (load sites and binding sites).
 */
export function resolvedFindings(required: { root: string; packages: readonly SourcePackage[]; approved: readonly string[]; presets: ReadonlySet<string> }, _optional: Record<string, never> = {}): Finding[] {
  const { root, packages } = required;
  const publicSpecs = new Set(packages.filter(pkg => BASE_PACKAGE_NAMES.includes(pkg.manifest.name))
    .flatMap(pkg => [...publicEntries({ manifest: pkg.manifest, directory: '.' }).keys()]));
  const approved = new Set(required.approved);
  return packages.filter(pkg => !required.presets.has(ownerOf(pkg)) && pkg.manifest.name.startsWith(SCOPE)).flatMap(pkg => {
    const base: PolicyContext = { root, pkg, packages, resolve: createSpecResolver({ pkg, packages }), publicSpecs, approved };
    const payload = ownerOf(pkg) === 'agent-plugins' ? payloadSourceFiles({ directory: pkg.directory }) : [];
    const files = [...packageSourceFiles({ directory: pkg.directory }).filter(file => !file.endsWith('.css')), ...payload];
    return files.flatMap(filename => fileFindings({ ...base, filename, file: posix(relative(root, filename)) }));
  });
}
