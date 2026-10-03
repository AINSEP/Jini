/**
 * @module artifacts/manifest
 *
 * Generic artifact-manifest validation: bounded-length string checks, path-
 * traversal rejection on `entry`/`primary`/`supportingFiles`, a JSON-size
 * cap on `metadata`, and version/timestamp stamping. Ported from OD's
 * `apps/daemon/src/artifacts/manifest.ts`.
 *
 * De-branded: the origin's `kind`/`renderer` fields were validated against
 * hardcoded `ALLOWED_KINDS`/`ALLOWED_RENDERERS` sets that bake in OD's own
 * artifact taxonomy — including a literal `'design-system'` kind, OD's own
 * product concept, not a generic engine noun. Both sets are now a
 * caller-supplied {@link ArtifactManifestTaxonomy} instead of module
 * constants — a host (like an OD adapter) supplies its own kind/renderer/
 * export vocabulary; the validation *mechanism* (bounded strings, traversal
 * rejection, size caps, version stamping) is what this module owns. `status`
 * (`'streaming' | 'complete' | 'error'`) is kept as a fixed literal union —
 * that's a generic artifact-lifecycle concept, not a product taxonomy.
 */

const MANIFEST_VERSION = 1;
const MAX_TITLE_LENGTH = 200;
const MAX_SOURCE_CONTEXT_ID_LENGTH = 128;
const MAX_SUPPORTING_FILE_LENGTH = 260;
const MAX_SUPPORTING_FILES = 128;
const MAX_METADATA_BYTES = 16 * 1024;

export type ArtifactStatus = 'streaming' | 'complete' | 'error';

const ALLOWED_STATUS = new Set<ArtifactStatus>(['streaming', 'complete', 'error']);

/**
 * A host's own artifact-kind/renderer/export vocabulary. The engine treats
 * every value as an opaque string it only bounds-checks and validates
 * membership against — it assigns no meaning to any particular kind name.
 */
export interface ArtifactManifestTaxonomy {
  readonly allowedKinds: ReadonlySet<string>;
  readonly allowedRenderers: ReadonlySet<string>;
  readonly allowedExports: ReadonlySet<string>;
}

/** A taxonomy that accepts nothing — forces a host to supply its own before any manifest can validate. */
export const emptyArtifactManifestTaxonomy: ArtifactManifestTaxonomy = {
  allowedKinds: new Set(),
  allowedRenderers: new Set(),
  allowedExports: new Set(),
};

export interface ArtifactManifest {
  readonly version: number;
  readonly kind: string;
  readonly title: string;
  readonly entry: string;
  readonly renderer: string;
  readonly status: ArtifactStatus;
  readonly exports: readonly string[];
  readonly primary?: string | true;
  readonly supportingFiles?: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Generic "what produced or relates to this artifact" reference (OD: a skill id). Opaque to the engine. */
  readonly sourceContextId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

type JsonRecord = Record<string, unknown>;

type ValidationResult =
  | { ok: true; value: ArtifactManifest | null }
  | { ok: false; error: string };

export interface ValidateManifestOptions {
  /** Keep an existing `updatedAt` instead of stamping the current time (used when re-parsing a persisted manifest). */
  preserveUpdatedAt?: boolean;
  /** Injectable clock used for manifest timestamps. */
  now?: () => string;
}

function isPlainObject(value: unknown): value is JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validateBoundedString(
  value: unknown,
  field: string,
  maxLen: number,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): string | null {
  if (typeof value !== 'string') return `${field} must be a string`;
  if (!allowEmpty && value.length === 0) return `${field} is required`;
  if (value.length > maxLen) return `${field} exceeds max length (${maxLen})`;
  return null;
}

function validateSupportingPath(value: unknown): string | null {
  if (typeof value !== 'string') return 'supportingFiles entries must be strings';
  if (value.length === 0) return 'supportingFiles entries cannot be empty';
  if (value.length > MAX_SUPPORTING_FILE_LENGTH) {
    return `supportingFiles entries exceed max length (${MAX_SUPPORTING_FILE_LENGTH})`;
  }
  if (/^[A-Za-z]:/.test(value) || value.startsWith('/')) {
    return 'supportingFiles cannot contain absolute paths';
  }
  if (value.includes('\u0000')) return 'supportingFiles cannot contain null bytes';
  const normalized = value.replace(/\\/g, '/');
  if (normalized.includes('..')) return 'supportingFiles cannot contain traversal segments';
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === '.' || p === '..')) {
    return 'supportingFiles cannot contain traversal segments';
  }
  return null;
}

/**
 * Validates a freeform manifest payload against `taxonomy`, returning a
 * sanitized, stamped {@link ArtifactManifest} on success. `manifest == null`
 * is a valid "no manifest supplied" outcome (`{ ok: true, value: null }`) —
 * callers that require a manifest check for `value === null` themselves
 * (see `store.ts`'s `resolveArtifactManifest`).
 */
export function validateArtifactManifestInput(
  { manifest, entry, taxonomy }: { manifest: unknown; entry: unknown; taxonomy: ArtifactManifestTaxonomy },
  options: ValidateManifestOptions = {},
): ValidationResult {
  if (manifest == null) return { ok: true, value: null };
  if (!isPlainObject(manifest)) {
    return { ok: false, error: 'artifactManifest must be an object' };
  }

  const kindErr = validateBoundedString(manifest.kind, 'artifactManifest.kind', 64);
  if (kindErr) return { ok: false, error: kindErr };
  // Cast, not a runtime guard: validateBoundedString's first check is
  // `typeof value !== 'string'`, which already returned above for any
  // non-string `kind` — this only narrows the type for `taxonomy.allowedKinds.has`.
  if (!taxonomy.allowedKinds.has(manifest.kind as string)) {
    return { ok: false, error: 'artifactManifest.kind is not allowed' };
  }

  const rendererErr = validateBoundedString(manifest.renderer, 'artifactManifest.renderer', 64);
  if (rendererErr) return { ok: false, error: rendererErr };
  // Same reasoning as `kind` above.
  if (!taxonomy.allowedRenderers.has(manifest.renderer as string)) {
    return { ok: false, error: 'artifactManifest.renderer is not allowed' };
  }

  if (!Array.isArray(manifest.exports) || manifest.exports.length === 0) {
    return { ok: false, error: 'artifactManifest.exports must be a non-empty array' };
  }
  for (const exp of manifest.exports) {
    if (typeof exp !== 'string') {
      return { ok: false, error: 'artifactManifest.exports must contain strings' };
    }
    if (!taxonomy.allowedExports.has(exp)) {
      return { ok: false, error: `artifactManifest.exports contains unsupported value: ${exp}` };
    }
  }

  if (manifest.status !== undefined) {
    if (typeof manifest.status !== 'string') {
      return { ok: false, error: 'artifactManifest.status must be a string' };
    }
    if (!ALLOWED_STATUS.has(manifest.status as ArtifactStatus)) {
      return { ok: false, error: 'artifactManifest.status is not allowed' };
    }
  }

  if (manifest.primary !== undefined) {
    if (manifest.primary !== true) {
      const primaryErr = validateSupportingPath(manifest.primary);
      if (primaryErr) return { ok: false, error: `artifactManifest.primary ${primaryErr}` };
    }
  }

  if (manifest.supportingFiles !== undefined) {
    if (!Array.isArray(manifest.supportingFiles)) {
      return { ok: false, error: 'artifactManifest.supportingFiles must be an array' };
    }
    if (manifest.supportingFiles.length > MAX_SUPPORTING_FILES) {
      return {
        ok: false,
        error: `artifactManifest.supportingFiles exceeds max items (${MAX_SUPPORTING_FILES})`,
      };
    }
    for (const rel of manifest.supportingFiles) {
      const relErr = validateSupportingPath(rel);
      if (relErr) return { ok: false, error: relErr };
    }
  }

  if (manifest.title !== undefined) {
    const titleErr = validateBoundedString(manifest.title, 'artifactManifest.title', MAX_TITLE_LENGTH, {
      allowEmpty: false,
    });
    if (titleErr) return { ok: false, error: titleErr };
  }

  if (manifest.sourceContextId !== undefined) {
    const sourceErr = validateBoundedString(
      manifest.sourceContextId,
      'artifactManifest.sourceContextId',
      MAX_SOURCE_CONTEXT_ID_LENGTH,
      { allowEmpty: true },
    );
    if (sourceErr) return { ok: false, error: sourceErr };
  }

  if (manifest.metadata !== undefined) {
    if (!isPlainObject(manifest.metadata)) {
      return { ok: false, error: 'artifactManifest.metadata must be a plain object' };
    }
    // JSON.stringify always returns a string (never undefined) when called
    // directly on a plain object — undefined-return only happens when the
    // top-level argument itself is a function/symbol/undefined, which
    // isPlainObject above already rejected.
    const serialized: string = JSON.stringify(manifest.metadata);
    if (new TextEncoder().encode(serialized).byteLength > MAX_METADATA_BYTES) {
      return {
        ok: false,
        error: `artifactManifest.metadata exceeds max size (${MAX_METADATA_BYTES} bytes)`,
      };
    }
  }

  const manifestEntry =
    typeof manifest.entry === 'string' && manifest.entry.trim() ? manifest.entry.trim() : entry;
  const entryErr = validateSupportingPath(manifestEntry);
  if (entryErr) {
    return { ok: false, error: `artifactManifest.entry ${entryErr}` };
  }
  const safeEntry = (manifestEntry as string).replace(/\\/g, '/');

  return { ok: true, value: sanitizeManifest({ manifest, entry: safeEntry }, options) };
}

/** Normalizes a validated manifest payload into the stamped, canonical {@link ArtifactManifest} shape. */
export function sanitizeManifest(
  { manifest, entry }: { manifest: JsonRecord; entry: string },
  options: ValidateManifestOptions = {},
): ArtifactManifest {
  const now = (options.now ?? (() => new Date().toISOString()))();
  const supportingFiles = Array.isArray(manifest.supportingFiles)
    ? manifest.supportingFiles.map((x) => String(x).replace(/\\/g, '/'))
    : undefined;
  const primary =
    manifest.primary === true
      ? true
      : typeof manifest.primary === 'string'
        ? manifest.primary.replace(/\\/g, '/')
        : undefined;
  return {
    version: MANIFEST_VERSION,
    kind: manifest.kind as string,
    title: (manifest.title as string) || entry,
    entry,
    renderer: manifest.renderer as string,
    status:
      typeof manifest.status === 'string' && ALLOWED_STATUS.has(manifest.status as ArtifactStatus)
        ? (manifest.status as ArtifactStatus)
        : 'complete',
    exports: manifest.exports as readonly string[],
    ...(primary !== undefined ? { primary } : {}),
    ...(supportingFiles !== undefined ? { supportingFiles } : {}),
    createdAt: typeof manifest.createdAt === 'string' ? manifest.createdAt : now,
    updatedAt:
      options.preserveUpdatedAt && typeof manifest.updatedAt === 'string'
        ? manifest.updatedAt
        : now,
    ...(manifest.sourceContextId !== undefined ? { sourceContextId: manifest.sourceContextId as string } : {}),
    ...(manifest.metadata !== undefined ? { metadata: manifest.metadata as Record<string, unknown> } : {}),
  };
}

/**
 * Re-validates a manifest read back from persistence (e.g. a sidecar file),
 * preserving its original `updatedAt`. Returns `null` on any validation
 * failure or version mismatch/parse error rather than throwing — a corrupt
 * or stale sidecar should degrade to "no manifest", not crash the reader.
 */
export function parsePersistedManifest(
  { raw, fallbackEntry, taxonomy }: { raw: string; fallbackEntry: string; taxonomy: ArtifactManifestTaxonomy },
): ArtifactManifest | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed) || parsed.version !== MANIFEST_VERSION) return null;
    const entry = typeof parsed.entry === 'string' && parsed.entry ? parsed.entry : fallbackEntry;
    const result = validateArtifactManifestInput({ manifest: parsed, entry, taxonomy }, { preserveUpdatedAt: true });
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

/**
 * Injectable seam for a host's own "what kind of artifact is this path"
 * heuristic (OD: extension-based HTML/deck/markdown/svg inference). The
 * engine has no default beyond "infer nothing" — see
 * {@link noopManifestInferrer} — a host wires in its own file-kind
 * classification (per the task brief: "keep OD's file-kind classification
 * as adapter").
 */
export type ManifestInferrer = (required: { entry: string }) => Partial<ArtifactManifest> | null;

/** Infers nothing — every create call must supply an explicit manifest. */
export const noopManifestInferrer: ManifestInferrer = (_required) => null;
