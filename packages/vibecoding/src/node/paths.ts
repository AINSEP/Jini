import type { ProjectFilesystemPort } from '../core/project-filesystem.js';
import { ProjectError, type ProjectLimits } from '../core/project.js';

export interface FileTreePolicy {
  /** Host authority intersects mandatory exclusions, including for external captures. */
  allows(input: { readonly relativePath: string }): boolean;
}
export const DEFAULT_PROJECT_LIMITS: ProjectLimits = {
  maxFiles: 2_000, maxFileBytes: 2 * 1024 * 1024, maxTreeBytes: 64 * 1024 * 1024,
  maxDepth: 32, maxChanges: 100, validationTimeoutMs: 30_000,
};
const EXCLUDED: ReadonlySet<string> = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.angular', '.vite', '.cache', '.turbo']);
const DEVICE = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
// Platform's atomic writer stages `.<name>.<pid>.<uuid>.tmp` beside the destination. A crash
// mid-materialize leaves one in the app root; never capture that debris as a managed file.
const ATOMIC_TEMP = /^\..+\.\d+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i;

/** Portable comparison also catches APFS case folding aliases such as the Kelvin sign. */
export function portablePathKey({ path }: { path: string }, _options = {}): string {
  return path.normalize('NFC').toLowerCase().toUpperCase().toLowerCase();
}
/** Resolve positive integer bounds once; no silent clamping or partial tree captures.
 * @complexity O(number of limits) time and space.
 */
export function projectLimits(input: { limits?: Partial<ProjectLimits> }, _options = {}): ProjectLimits {
  const limits = { ...DEFAULT_PROJECT_LIMITS, ...input.limits };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('project limits must be positive safe integers');
  }
  return limits;
}
/** Names must already be canonical: never normalize a traversal into an authorized filename.
 * @throws ProjectError INVALID_PATH for nonportable or noncanonical names.
 * @complexity O(path length) time and space; relative names are capped at 200 code units.
 */
export function canonicalPath({ relativePath, maxDepth }: { relativePath: string; maxDepth: number }, _options = {}): string {
  if (!relativePath || relativePath.length > 200 || relativePath.includes('\\')) {
    throw new ProjectError({ code: 'INVALID_PATH', message: 'use a relative slash-separated path of at most 200 characters' });
  }
  const segments = relativePath.split('/');
  if (segments.length > maxDepth) throw new ProjectError({ code: 'LIMIT', message: 'path exceeds depth limit' });
  for (const segment of segments) assertSegment({ segment });
  return relativePath;
}
/** Each segment must survive Windows parsing without aliases, streams or device semantics. */
function assertSegment({ segment }: { segment: string }): void {
  const reservedName = !segment || segment === '.' || segment === '..';
  if (reservedName || /[<>:"|?*\x00-\x1f\x7f]/.test(segment) || /[. ]$/.test(segment) || DEVICE.test(segment)) {
    throw new ProjectError({ code: 'INVALID_PATH', message: `nonportable path segment: ${segment}` });
  }
}
/** Validate all candidate file AND directory spellings; a delete/create case-only rename passes.
 * @complexity O(total prefix lengths) time and space; no pairwise path comparisons.
 */
export function assertCandidatePaths({ paths }: { paths: readonly string[] }, _options = {}): void {
  const spellings = new Map<string, string>();
  const files = new Set(paths.map(path => portablePathKey({ path })));
  for (const path of paths) {
    const segments = path.split('/');
    for (let end = 1; end <= segments.length; end += 1) {
      const prefix = segments.slice(0, end).join('/');
      const key = portablePathKey({ path: prefix });
      const prior = spellings.get(key);
      if ((prior !== undefined && prior !== prefix) || (end < segments.length && files.has(key))) {
        throw new ProjectError({ code: 'INVALID_PATH', message: `candidate path collision: ${prefix}` });
      }
      spellings.set(key, prefix);
    }
  }
}
/** The injected reader owns physical containment and bounded traversal; this adapter adds project policy.
 * @complexity Construction O(1); path checks O(depth), listing bounded by configured limits.
 */
export function createProjectPaths({ root, policy, limits, filesystem }: {
  root: string; policy: FileTreePolicy; limits: ProjectLimits; filesystem: ProjectFilesystemPort;
}, _options = {}) {
  const reader = filesystem.createReader({ rootPath: root,
    denyRules: { segments: EXCLUDED, filenamePatterns: [/^\.env/i, ATOMIC_TEMP] },
    limits: { maxFileBytes: limits.maxFileBytes, binarySniffBytes: 1024,
      maxListedFiles: limits.maxFiles + 1, maxWalkDepth: limits.maxDepth, maxWalkEntries: limits.maxFiles * (limits.maxDepth + 1) },
  }, { excludedListingDirs: EXCLUDED });

  function check({ relativePath }: { relativePath: string }): string {
    const canonical = canonicalPath({ relativePath, maxDepth: limits.maxDepth });
    for (const segment of canonical.split('/')) {
      if (reader.isDeniedPathSegment({ segmentName: segment }) || reader.isDeniedFileName({ fileName: segment })) {
        throw new ProjectError({ code: 'INVALID_PATH', message: `excluded path: ${relativePath}` });
      }
    }
    if (!policy.allows({ relativePath: canonical })) throw new ProjectError({ code: 'INVALID_PATH', message: `host policy refuses ${canonical}` });
    return canonical;
  }
  return { reader, check, allows: ({ relativePath }: { relativePath: string }) =>
    relativePath.split('/').every(segment => !reader.isDeniedPathSegment({ segmentName: segment }) && !reader.isDeniedFileName({ fileName: segment }))
      && policy.allows({ relativePath }) };
}
export type ProjectPaths = ReturnType<typeof createProjectPaths>;
