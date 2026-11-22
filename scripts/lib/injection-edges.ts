/** L5: the base rule. A Jini package imports only itself, `@jini-ai/core` and `@jini-ai/protocol`;
 * everything else reaches it through the host's composition root. Host presets (`server`, `cli`)
 * are wiring-only and may import anything, but nothing may import them.
 * Covers production source, manifests (dependencies and peers), and plugin payload scripts. */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { importSites } from './import-sites.js';
import { packageSourceFiles, packageTestFiles, payloadSourceFiles, type SourcePackage } from './package-sources.js';
import { specMatches, type Finding, type InjectionException } from './injection-debt.js';
import type { SpecResolver } from './spec-aliases.js';

const BASE_PACKAGES = new Set(['core', 'protocol']);
/** Owner decision 2026-11-15 (Q1): wiring-only packages the host may use as a standard preset.
 * A manifest says so with `jini.kind: "host-preset"`; `server` and `cli` are also named here so a
 * manifest edit alone can never lose the rule. */
const NAMED_HOST_PRESETS = ['server', 'cli'];

export function hostPresets(required: { packages: readonly SourcePackage[] }, _optional: Record<string, never> = {}): Set<string> {
  const declared = required.packages.filter(pkg => (pkg.manifest as { jini?: { kind?: string } }).jini?.kind === 'host-preset').map(ownerOf);
  return new Set([...NAMED_HOST_PRESETS, ...declared]);
}

/** Owner decision OD-3 (2026-11-16): Node bindings of ports live in `runtime-adapter` packages. Such a package
 * may import `platform` and may name a domain's port TYPES; it never runs a domain's code and never assembles
 * a service. Only a host or a host preset may import it. */
export function runtimeAdapters(required: { packages: readonly SourcePackage[] }, _optional: Record<string, never> = {}): Set<string> {
  return new Set(required.packages.filter(pkg => (pkg.manifest as { jini?: { kind?: string } }).jini?.kind === 'runtime-adapter').map(ownerOf));
}
const SCOPE = '@jini-ai/';

/** `spec` is what the import resolves to; `written` is the alias it was written as, when different. */
export interface Edge { owner: string; target: string; spec: string; kind: string; file: string; written?: string }
/** Edges of one package; `resolve` applies that package's aliases (see spec-aliases.ts). */
export interface EdgeScope { root: string; pkg: SourcePackage; resolve: SpecResolver }

export const ownerOf = (pkg: SourcePackage): string => pkg.manifest.name.slice(SCOPE.length);
const posix = (path: string): string => path.split('\\').join('/');

function edgesOf(required: { owner: string; spec: string; kind: string; file: string; resolve: SpecResolver }): Edge[] {
  const { resolve, ...site } = required;
  return resolve(site.spec).flatMap(spec => {
    if (!spec.startsWith(SCOPE)) return [];
    const target = spec.slice(SCOPE.length).split('/')[0]!;
    if (target === site.owner) return [];
    return [{ ...site, spec, target, ...(spec === site.spec ? {} : { written: site.spec }) }];
  });
}

function fileEdges(required: { owner: string; files: readonly string[]; root: string; resolve: SpecResolver }, { jsdoc = false }: { jsdoc?: boolean } = {}): Edge[] {
  const edges: Edge[] = [];
  for (const filename of required.files) {
    const file = posix(relative(required.root, filename));
    for (const site of importSites({ file: filename, source: readFileSync(filename, 'utf8') }, { jsdoc })) {
      edges.push(...edgesOf({ owner: required.owner, spec: site.spec, kind: site.kind, file, resolve: required.resolve }));
    }
  }
  return edges;
}

export function productionEdges(required: EdgeScope, _optional: Record<string, never> = {}): Edge[] {
  const files = packageSourceFiles({ directory: required.pkg.directory }).filter(file => !file.endsWith('.css'));
  return fileEdges({ owner: ownerOf(required.pkg), files, root: required.root, resolve: required.resolve });
}

export function payloadEdges(required: EdgeScope, _optional: Record<string, never> = {}): Edge[] {
  return fileEdges({ owner: ownerOf(required.pkg), files: payloadSourceFiles({ directory: required.pkg.directory }), root: required.root, resolve: required.resolve }, { jsdoc: true });
}

export function testEdges(required: EdgeScope, _optional: Record<string, never> = {}): Edge[] {
  return fileEdges({ owner: ownerOf(required.pkg), files: packageTestFiles({ directory: required.pkg.directory }), root: required.root, resolve: required.resolve });
}

export function manifestEdges(required: EdgeScope, _optional: Record<string, never> = {}): Edge[] {
  const file = posix(relative(required.root, join(required.pkg.directory, 'package.json')));
  const owner = ownerOf(required.pkg);
  const sections = [['manifest-dependencies', required.pkg.manifest.dependencies], ['manifest-peer', required.pkg.manifest.peerDependencies]] as const;
  return sections.flatMap(([kind, deps]) => Object.keys(deps ?? {})
    .flatMap(spec => edgesOf({ owner, spec, kind, file, resolve: required.resolve })));
}

/** A type-only site, or a manifest peer: neither runs the target's code. */
const TYPE_ONLY_KINDS: ReadonlySet<string> = new Set(['type-import', 'import-type', 'jsdoc-import', 'manifest-peer']);

function adapterReason(required: { edge: Edge; presets: ReadonlySet<string>; adapters: ReadonlySet<string> }): string | undefined | null {
  const { edge, presets, adapters } = required;
  if (adapters.has(edge.target) && !presets.has(edge.owner)) return 'only a host or a host preset may import a runtime-adapter package';
  if (!adapters.has(edge.owner)) return null;
  return edge.target === 'platform' || TYPE_ONLY_KINDS.has(edge.kind) ? undefined : null;
}

function l5Reason(required: { edge: Edge; exceptions: readonly InjectionException[]; presets: ReadonlySet<string>; adapters: ReadonlySet<string> }): string | undefined {
  const { edge, exceptions, presets, adapters } = required;
  if (BASE_PACKAGES.has(edge.target)) return undefined;
  if (presets.has(edge.target)) return 'nothing may import a host-preset package';
  if (presets.has(edge.owner)) return undefined;
  const adapter = adapterReason({ edge, presets, adapters });
  if (adapter !== null) return adapter;
  const excused = exceptions.some(item => item.owner === edge.owner && item.target === edge.target
    && specMatches({ glob: item.specGlob, spec: edge.spec }));
  return excused ? undefined : 'only @jini-ai/core and @jini-ai/protocol may be imported; inject the rest from the host';
}

export function injectedEdgeFindings(required: { edges: readonly Edge[]; exceptions: readonly InjectionException[]; presets: ReadonlySet<string>; adapters: ReadonlySet<string> }, _optional: Record<string, never> = {}): Finding[] {
  return required.edges.flatMap(edge => {
    const why = l5Reason({ edge, exceptions: required.exceptions, presets: required.presets, adapters: required.adapters });
    return why ? [{ rule: 'L5-injected-edge', file: edge.file, spec: edge.spec, kind: edge.kind, reason: `${edge.owner} → ${edge.spec}${edge.written ? ` (written as ${edge.written})` : ''}: ${why}` }] : [];
  });
}

/** Test-only imports of another package's `/testing` or `/conformance` entry are allowed (owner Q5).
 * The rest is reported, not failing, until the cross-package tests move to their own workspace. */
export function advisoryTestEdges(required: { edges: readonly Edge[]; presets: ReadonlySet<string> }, _optional: Record<string, never> = {}): Edge[] {
  return required.edges.filter(edge => !BASE_PACKAGES.has(edge.target) && !required.presets.has(edge.owner)
    && !/\/(?:testing|conformance)(?:\/|$)/.test(edge.spec));
}
