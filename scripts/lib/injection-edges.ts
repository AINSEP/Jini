/** L5: the base rule. A Jini package imports only itself, `@jini-ai/core` and `@jini-ai/protocol`;
 * everything else reaches it through the host's composition root. Host presets (`server`, `cli`)
 * are wiring-only and may import anything, but nothing may import them.
 * Covers production source, manifests (dependencies and peers), and plugin payload scripts. */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { importSites } from './import-sites.js';
import { packageSourceFiles, packageTestFiles, payloadSourceFiles, type SourcePackage } from './package-sources.js';
import { specMatches, type Finding, type InjectionException } from './injection-debt.js';

const BASE_PACKAGES = new Set(['core', 'protocol']);
/** Owner decision 2026-11-15 (Q1): wiring-only packages the host may use as a standard preset.
 * A manifest says so with `jini.kind: "host-preset"`; `server` and `cli` are also named here so a
 * manifest edit alone can never lose the rule. */
const NAMED_HOST_PRESETS = ['server', 'cli'];

export function hostPresets(required: { packages: readonly SourcePackage[] }, _optional: Record<string, never> = {}): Set<string> {
  const declared = required.packages.filter(pkg => (pkg.manifest as { jini?: { kind?: string } }).jini?.kind === 'host-preset').map(ownerOf);
  return new Set([...NAMED_HOST_PRESETS, ...declared]);
}
const SCOPE = '@jini-ai/';

export interface Edge { owner: string; target: string; spec: string; kind: string; file: string }

export const ownerOf = (pkg: SourcePackage): string => pkg.manifest.name.slice(SCOPE.length);
const posix = (path: string): string => path.split('\\').join('/');

function edgeOf(required: { owner: string; spec: string; kind: string; file: string }): Edge | undefined {
  if (!required.spec.startsWith(SCOPE)) return undefined;
  const target = required.spec.slice(SCOPE.length).split('/')[0]!;
  return target === required.owner ? undefined : { ...required, target };
}

function fileEdges(required: { owner: string; files: readonly string[]; root: string }, { jsdoc = false }: { jsdoc?: boolean } = {}): Edge[] {
  const edges: Edge[] = [];
  for (const filename of required.files) {
    const file = posix(relative(required.root, filename));
    for (const site of importSites({ file: filename, source: readFileSync(filename, 'utf8') }, { jsdoc })) {
      const edge = edgeOf({ owner: required.owner, spec: site.spec, kind: site.kind, file });
      if (edge) edges.push(edge);
    }
  }
  return edges;
}

export function productionEdges(required: { root: string; pkg: SourcePackage }, _optional: Record<string, never> = {}): Edge[] {
  const files = packageSourceFiles({ directory: required.pkg.directory }).filter(file => !file.endsWith('.css'));
  return fileEdges({ owner: ownerOf(required.pkg), files, root: required.root });
}

export function payloadEdges(required: { root: string; pkg: SourcePackage }, _optional: Record<string, never> = {}): Edge[] {
  return fileEdges({ owner: ownerOf(required.pkg), files: payloadSourceFiles({ directory: required.pkg.directory }), root: required.root }, { jsdoc: true });
}

export function testEdges(required: { root: string; pkg: SourcePackage }, _optional: Record<string, never> = {}): Edge[] {
  return fileEdges({ owner: ownerOf(required.pkg), files: packageTestFiles({ directory: required.pkg.directory }), root: required.root });
}

export function manifestEdges(required: { root: string; pkg: SourcePackage }, _optional: Record<string, never> = {}): Edge[] {
  const file = posix(relative(required.root, join(required.pkg.directory, 'package.json')));
  const owner = ownerOf(required.pkg);
  const sections = [['manifest-dependencies', required.pkg.manifest.dependencies], ['manifest-peer', required.pkg.manifest.peerDependencies]] as const;
  return sections.flatMap(([kind, deps]) => Object.keys(deps ?? {})
    .flatMap(spec => edgeOf({ owner, spec, kind, file }) ?? []));
}

function l5Reason(required: { edge: Edge; exceptions: readonly InjectionException[]; presets: ReadonlySet<string> }): string | undefined {
  const { edge, exceptions, presets } = required;
  if (BASE_PACKAGES.has(edge.target)) return undefined;
  if (presets.has(edge.target)) return 'nothing may import a host-preset package';
  if (presets.has(edge.owner)) return undefined;
  const excused = exceptions.some(item => item.owner === edge.owner && item.target === edge.target
    && specMatches({ glob: item.specGlob, spec: edge.spec }));
  return excused ? undefined : 'only @jini-ai/core and @jini-ai/protocol may be imported; inject the rest from the host';
}

export function injectedEdgeFindings(required: { edges: readonly Edge[]; exceptions: readonly InjectionException[]; presets: ReadonlySet<string> }, _optional: Record<string, never> = {}): Finding[] {
  return required.edges.flatMap(edge => {
    const why = l5Reason({ edge, exceptions: required.exceptions, presets: required.presets });
    return why ? [{ rule: 'L5-injected-edge', file: edge.file, spec: edge.spec, kind: edge.kind, reason: `${edge.owner} → ${edge.spec}: ${why}` }] : [];
  });
}

/** Test-only imports of another package's `/testing` or `/conformance` entry are allowed (owner Q5).
 * The rest is reported, not failing, until the cross-package tests move to their own workspace. */
export function advisoryTestEdges(required: { edges: readonly Edge[]; presets: ReadonlySet<string> }, _optional: Record<string, never> = {}): Edge[] {
  return required.edges.filter(edge => !BASE_PACKAGES.has(edge.target) && !required.presets.has(edge.owner)
    && !/\/(?:testing|conformance)(?:\/|$)/.test(edge.spec));
}
