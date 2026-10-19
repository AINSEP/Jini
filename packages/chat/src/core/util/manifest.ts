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

const LEGACY_KIND_BY_EXT: ReadonlyMap<string, LegacyInferredKind> = new Map([
  ['.html', 'html'],
  ['.htm', 'html'],
  ['.svg', 'svg'],
  ['.md', 'markdown-document'],
  ['.jsx', 'react-component'],
  ['.tsx', 'react-component'],
  ['.js', 'code-snippet'],
  ['.ts', 'code-snippet'],
  ['.json', 'code-snippet'],
  ['.css', 'code-snippet'],
]);

/** Renderer and export set for every kind `inferLegacyManifest` can resolve to (the inferred kinds plus the deck-name heuristic's `deck`). */
const LEGACY_KIND_INFO: Readonly<Record<LegacyInferredKind | 'deck', { renderer: ArtifactRendererId; exports: readonly ArtifactExportKind[] }>> = {
  html: { renderer: 'html', exports: ['html', 'pdf', 'zip'] },
  deck: { renderer: 'deck-html', exports: ['html', 'pdf', 'zip'] },
  'markdown-document': { renderer: 'markdown', exports: ['md', 'html', 'pdf', 'zip'] },
  'react-component': { renderer: 'react-component', exports: ['jsx', 'html', 'zip'] },
  'code-snippet': { renderer: 'code', exports: ['txt', 'zip'] },
  svg: { renderer: 'svg', exports: ['svg', 'zip'] }, // 'svg' is a valid ArtifactRendererId as-is
};

/** The manifest sidecar file name convention for a given artifact entry file name. */
export function artifactManifestNameFor({ entry }: { entry: string }): string {
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

export function serializeArtifactManifest({ manifest }: { manifest: ArtifactManifest }): string {
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
export function parseArtifactManifest({ raw }: { raw: string }): ArtifactManifest | null {
  let parsed: Partial<ArtifactManifest> | null;
  try {
    parsed = JSON.parse(raw) as Partial<ArtifactManifest> | null;
  } catch {
    return null;
  }
  if (!hasRequiredManifestFields(parsed) || !hasKnownManifestValues(parsed)) return null;
  return {
    version: MANIFEST_VERSION,
    kind: parsed.kind,
    title: parsed.title,
    entry: parsed.entry,
    renderer: parsed.renderer,
    status: parsed.status ?? 'complete',
    exports: parsed.exports,
    ...optionalManifestFields(parsed),
  };
}

/** The optional manifest fields, each kept only when it has its documented type (anything else is dropped, not rejected). */
function optionalManifestFields(parsed: Partial<ArtifactManifest>): Partial<ArtifactManifest> {
  return {
    primary: parsed.primary === true || typeof parsed.primary === 'string' ? parsed.primary : undefined,
    supportingFiles: Array.isArray(parsed.supportingFiles) ? parsed.supportingFiles.filter(isString) : undefined,
    createdAt: stringOrUndefined(parsed.createdAt),
    updatedAt: stringOrUndefined(parsed.updatedAt),
    sourceSkillId: stringOrUndefined(parsed.sourceSkillId),
    designSystemId: parsed.designSystemId === null ? null : stringOrUndefined(parsed.designSystemId),
    metadata: parsed.metadata && typeof parsed.metadata === 'object' && !Array.isArray(parsed.metadata) ? parsed.metadata : undefined,
  };
}

type RequiredManifestFields = Partial<ArtifactManifest> & { entry: string; title: string; kind: string; renderer: string; exports: unknown[] };

function hasRequiredManifestFields(parsed: Partial<ArtifactManifest> | null): parsed is RequiredManifestFields {
  if (parsed?.version !== MANIFEST_VERSION) return false;
  if (!isNonEmptyString(parsed.entry) || !isNonEmptyString(parsed.title)) return false;
  return Array.isArray(parsed.exports) && isString(parsed.kind) && isString(parsed.renderer);
}

function hasKnownManifestValues(
  parsed: RequiredManifestFields,
): parsed is RequiredManifestFields & { kind: ArtifactKind; renderer: ArtifactRendererId; status?: ArtifactStatus; exports: ArtifactExportKind[] } {
  if (!ALLOWED_KINDS.has(parsed.kind as ArtifactKind)) return false;
  if (!ALLOWED_RENDERERS.has(parsed.renderer as ArtifactRendererId)) return false;
  if (parsed.status !== undefined && !ALLOWED_STATUS.has(parsed.status)) return false;
  return parsed.exports.length > 0 && parsed.exports.every((value) => ALLOWED_EXPORTS.has(value as ArtifactExportKind));
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value !== '';
}

function stringOrUndefined(value: unknown): string | undefined {
  return isString(value) ? value : undefined;
}

/**
 * Infer a manifest for a legacy artifact file that predates manifest
 * sidecars, from its entry file name alone (extension → kind → renderer).
 * @returns `null` when the extension isn't a recognized artifact kind.
 */
export function inferLegacyManifest(input: { entry: string; title?: string; metadata?: Record<string, unknown> }): ArtifactManifest | null {
  const kind = LEGACY_KIND_BY_EXT.get(normalizeExt(input.entry));
  if (!kind) return null;
  const isDeck = kind === 'html' && /deck|slides|pitch/.test(input.entry.toLowerCase());
  const resolvedKind = isDeck ? 'deck' : kind;
  const info = LEGACY_KIND_INFO[resolvedKind];
  return {
    version: MANIFEST_VERSION,
    kind: resolvedKind,
    title: input.title || input.entry,
    entry: input.entry,
    renderer: info.renderer,
    status: 'complete',
    exports: [...info.exports],
    primary: resolvedKind === 'html' || resolvedKind === 'deck' ? true : undefined,
    metadata: input.metadata,
  };
}
