/**
 * @module manifest
 *
 * Create, serialize, parse, and infer the sidecar `ArtifactManifest` a
 * generated file carries. See `./types.js` for the manifest shape itself.
 */
import type { ArtifactExportKind, ArtifactKind, ArtifactManifest, ArtifactRendererId, ArtifactStatus } from './types.js';

const MANIFEST_VERSION = 1;
const ALLOWED_KINDS: ReadonlySet<ArtifactKind> = new Set([
  'html',
  'deck',
  'react-component',
  'markdown-document',
  'svg',
  'diagram',
  'code-snippet',
  'mini-app',
  'design-system',
]);
const ALLOWED_RENDERERS: ReadonlySet<ArtifactRendererId> = new Set([
  'html',
  'deck-html',
  'react-component',
  'markdown',
  'svg',
  'diagram',
  'code',
  'mini-app',
  'design-system',
]);
const ALLOWED_EXPORTS: ReadonlySet<ArtifactExportKind> = new Set(['html', 'pdf', 'zip', 'jsx', 'md', 'svg', 'txt']);
const ALLOWED_STATUS: ReadonlySet<ArtifactStatus> = new Set(['streaming', 'complete', 'error']);

function normalizeExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

// The exact finite subset of `ArtifactKind` this function can actually
// return — narrower than `ArtifactKind` itself (which also has `deck`,
// `diagram`, `mini-app`, `design-system`, none reachable from a bare file
// extension) so callers get a statically provable exhaustiveness check
// instead of having to defend against kinds this function never produces.
type LegacyInferredKind = 'html' | 'svg' | 'markdown-document' | 'react-component' | 'code-snippet';

function inferKindFromEntry(entry: string): LegacyInferredKind | null {
  const ext = normalizeExt(entry);
  if (['.html', '.htm'].includes(ext)) return 'html';
  if (ext === '.svg') return 'svg';
  if (ext === '.md') return 'markdown-document';
  if (['.jsx', '.tsx'].includes(ext)) return 'react-component';
  if (['.js', '.ts', '.json', '.css'].includes(ext)) return 'code-snippet';
  return null;
}

function exportsForKind(kind: ArtifactKind): ArtifactExportKind[] {
  if (kind === 'deck') return ['html', 'pdf', 'zip'];
  if (kind === 'react-component') return ['jsx', 'html', 'zip'];
  if (kind === 'markdown-document') return ['md', 'html', 'pdf', 'zip'];
  if (kind === 'svg' || kind === 'diagram') return ['svg', 'zip'];
  if (kind === 'code-snippet') return ['txt', 'zip'];
  return ['html', 'pdf', 'zip'];
}

/** The manifest sidecar file name convention for a given artifact entry file name. */
export function artifactManifestNameFor(entry: string): string {
  return `${entry}.artifact.json`;
}

/** Build a fresh, complete manifest for a newly-persisted HTML artifact. */
export function createHtmlArtifactManifest(input: {
  entry: string;
  title: string;
  metadata?: Record<string, unknown>;
  sourceSkillId?: string;
  designSystemId?: string | null;
}): ArtifactManifest {
  const now = new Date().toISOString();
  return {
    version: MANIFEST_VERSION,
    kind: 'html',
    title: input.title,
    entry: input.entry,
    renderer: 'html',
    status: 'complete',
    exports: ['html', 'pdf', 'zip'],
    primary: true,
    createdAt: now,
    updatedAt: now,
    sourceSkillId: input.sourceSkillId,
    designSystemId: input.designSystemId,
    metadata: input.metadata,
  };
}

export function serializeArtifactManifest(manifest: ArtifactManifest): string {
  return JSON.stringify(manifest, null, 2);
}

/**
 * Parse and validate a manifest JSON string, rejecting anything that isn't a
 * well-formed, currently-supported manifest (wrong version, missing
 * required fields, or a `kind`/`renderer`/`status`/`exports` value outside
 * the known sets).
 *
 * @returns The validated manifest, or `null` on any parse/shape failure.
 * @complexity O(k) in the manifest's own field/array count — no I/O.
 */
export function parseArtifactManifest(raw: string): ArtifactManifest | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ArtifactManifest>;
    if (parsed?.version !== MANIFEST_VERSION) return null;
    if (typeof parsed.entry !== 'string' || !parsed.entry) return null;
    if (typeof parsed.title !== 'string' || !parsed.title) return null;
    if (!Array.isArray(parsed.exports)) return null;
    if (typeof parsed.kind !== 'string' || typeof parsed.renderer !== 'string') {
      return null;
    }
    if (!ALLOWED_KINDS.has(parsed.kind as ArtifactKind)) return null;
    if (!ALLOWED_RENDERERS.has(parsed.renderer as ArtifactRendererId)) return null;
    if (parsed.status !== undefined && !ALLOWED_STATUS.has(parsed.status as ArtifactStatus)) {
      return null;
    }
    if (parsed.exports.length === 0) return null;
    if (parsed.exports.some((value) => !ALLOWED_EXPORTS.has(value as ArtifactExportKind))) return null;
    return {
      version: MANIFEST_VERSION,
      kind: parsed.kind as ArtifactKind,
      title: parsed.title,
      entry: parsed.entry,
      renderer: parsed.renderer as ArtifactRendererId,
      status: ALLOWED_STATUS.has(parsed.status as ArtifactStatus) ? (parsed.status as ArtifactStatus) : 'complete',
      exports: parsed.exports as ArtifactExportKind[],
      primary: parsed.primary === true || typeof parsed.primary === 'string' ? parsed.primary : undefined,
      supportingFiles: Array.isArray(parsed.supportingFiles) ? parsed.supportingFiles.filter((x): x is string => typeof x === 'string') : undefined,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
      sourceSkillId: typeof parsed.sourceSkillId === 'string' ? parsed.sourceSkillId : undefined,
      designSystemId: typeof parsed.designSystemId === 'string' || parsed.designSystemId === null ? parsed.designSystemId : undefined,
      metadata: parsed.metadata && typeof parsed.metadata === 'object' && !Array.isArray(parsed.metadata) ? parsed.metadata : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Infer a manifest for a legacy artifact file that predates manifest
 * sidecars, from its entry file name alone (extension → kind → renderer).
 * @returns `null` when the extension isn't a recognized artifact kind.
 */
export function inferLegacyManifest(input: { entry: string; title?: string; metadata?: Record<string, unknown> }): ArtifactManifest | null {
  const kind = inferKindFromEntry(input.entry);
  if (!kind) return null;
  const lowerEntry = input.entry.toLowerCase();
  const isDeck = kind === 'html' && (lowerEntry.includes('deck') || lowerEntry.includes('slides') || lowerEntry.includes('pitch'));
  const renderer: ArtifactRendererId = isDeck
    ? 'deck-html'
    : kind === 'html'
      ? 'html'
      : kind === 'markdown-document'
        ? 'markdown'
        : kind === 'react-component'
          ? 'react-component'
          : kind === 'code-snippet'
            ? 'code'
            : kind; // only 'svg' remains — a valid ArtifactRendererId as-is
  const resolvedKind = isDeck ? 'deck' : kind;
  return {
    version: MANIFEST_VERSION,
    kind: resolvedKind,
    title: input.title || input.entry,
    entry: input.entry,
    renderer,
    status: 'complete',
    exports: exportsForKind(resolvedKind),
    primary: resolvedKind === 'html' || resolvedKind === 'deck' ? true : undefined,
    metadata: input.metadata,
  };
}
