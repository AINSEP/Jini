/**
 * @module artifacts/store
 *
 * `ArtifactStore` — the generic artifact-store kernel port. Ported from OD's
 * `apps/daemon/src/artifacts/create.ts` create/manifest-resolution flow;
 * "artifacts feel like a kernel-adjacent concept tied to runs producing
 * output" per this task's brief — homed in `@jini-ai/daemon` alongside
 * `EventLog` (same async-port + in-memory-reference-implementation shape as
 * `event-log.ts`), not `@jini-ai/core` (which owns pure registries/DI, not
 * stateful storage).
 *
 * De-branded: the origin's `createProjectArtifactFile` took OD's own
 * product-shaped workspace/file-tree writer (a function keyed on OD's own
 * workspace-root and workspace-id nouns) as its injected dependency, and a
 * companion `postCreateArtifactRequest` built a request body for OD's own
 * per-workspace HTTP file-upload route. Neither is a generic engine concern
 * (a workspace model and an HTTP route shape are product surfaces), so this
 * port defines `ArtifactStore.create/get/list` directly against an
 * in-memory reference map — the origin's writer/request-builder pair were
 * the composition points a real OD adapter would wire against this port
 * from, not something to port verbatim. OD's HTML-prototype file-kind
 * inference (`inferLegacyManifest`) stays adapter-owned — see
 * `manifest.ts`'s `ManifestInferrer` seam.
 */
import {
  emptyArtifactManifestTaxonomy,
  noopManifestInferrer,
  validateArtifactManifestInput,
  type ArtifactManifest,
  type ArtifactManifestTaxonomy,
  type ManifestInferrer,
} from './manifest.js';

export class ArtifactManifestRequiredError extends Error {
  readonly code = 'ARTIFACT_MANIFEST_REQUIRED' as const;

  constructor(name: string) {
    super(`artifactManifest is required for ${name}; no safe default manifest can be inferred`);
    this.name = 'ArtifactManifestRequiredError';
  }
}

export class ArtifactManifestInvalidError extends Error {
  readonly code = 'ARTIFACT_MANIFEST_INVALID' as const;

  constructor(message: string) {
    super(`invalid artifactManifest: ${message}`);
    this.name = 'ArtifactManifestInvalidError';
  }
}

export interface CreateArtifactInput {
  readonly name: string;
  readonly content: string;
  readonly encoding?: 'utf8' | 'base64';
  /** Explicit manifest fields, or `undefined` to fall back to the store's {@link ManifestInferrer}. */
  readonly artifactManifest?: unknown;
}

export interface ArtifactRecord {
  readonly name: string;
  readonly content: Buffer;
  readonly manifest: ArtifactManifest;
}

/**
 * A replayable, ordered artifact-manifest resolver: given a create request,
 * either the caller-supplied manifest (validated against `taxonomy`) or the
 * result of `inferManifest(name)` (also validated) becomes the record's
 * manifest. Throws {@link ArtifactManifestRequiredError} when neither
 * source produces one, {@link ArtifactManifestInvalidError} when the
 * resolved manifest fails validation.
 */
export function resolveArtifactManifest(
  input: CreateArtifactInput,
  taxonomy: ArtifactManifestTaxonomy,
  inferManifest: ManifestInferrer,
): ArtifactManifest {
  const manifest = input.artifactManifest !== undefined && input.artifactManifest !== null
    ? input.artifactManifest
    : inferManifest(input.name);
  if (manifest) {
    const validated = validateArtifactManifestInput(manifest, input.name, taxonomy);
    if (!validated.ok) {
      throw new ArtifactManifestInvalidError(validated.error);
    }
    // `manifest != null` above and `validateArtifactManifestInput` only
    // returns `{ ok: true, value: null }` when its own `manifest` param is
    // `== null` — so `validated.value` is non-null here.
    return validated.value!;
  }
  throw new ArtifactManifestRequiredError(input.name);
}

/**
 * A store of named artifacts with validated manifests. Kernel port —
 * `@jini-ai/daemon` ships `createInMemoryArtifactStore` as the reference
 * implementation; a durable adapter (`@jini-ai/sqlite`) can implement the same
 * interface against real persistence.
 */
export interface ArtifactStore {
  /**
   * Creates or overwrites the artifact named `input.name`, resolving its
   * manifest per {@link resolveArtifactManifest}.
   * @throws {ArtifactManifestRequiredError} No manifest supplied and the inferrer produced none.
   * @throws {ArtifactManifestInvalidError} The resolved manifest failed taxonomy validation.
   */
  create(input: CreateArtifactInput): Promise<ArtifactRecord>;
  /** Returns the named artifact, or `null` if it doesn't exist. */
  get(name: string): Promise<ArtifactRecord | null>;
  /** Returns every stored artifact, most-recently-updated first. */
  list(): Promise<ArtifactRecord[]>;
}

export interface InMemoryArtifactStoreOptions {
  readonly taxonomy?: ArtifactManifestTaxonomy;
  readonly inferManifest?: ManifestInferrer;
}

/**
 * Reference `ArtifactStore` implementation: an in-memory `Map` keyed by
 * artifact name. No durable persistence — matching this task's scope (a
 * real persistent adapter is a future storage task's concern, mirroring
 * `event-log.ts`'s own in-memory-only reference implementation).
 */
export function createInMemoryArtifactStore(options: InMemoryArtifactStoreOptions = {}): ArtifactStore {
  const taxonomy = options.taxonomy ?? emptyArtifactManifestTaxonomy;
  const inferManifest = options.inferManifest ?? noopManifestInferrer;
  const records = new Map<string, ArtifactRecord>();

  return {
    async create(input: CreateArtifactInput): Promise<ArtifactRecord> {
      const manifest = resolveArtifactManifest(input, taxonomy, inferManifest);
      const content = input.encoding === 'base64'
        ? Buffer.from(input.content, 'base64')
        : Buffer.from(input.content, 'utf8');
      const record: ArtifactRecord = { name: input.name, content, manifest };
      records.set(input.name, record);
      return record;
    },

    async get(name: string): Promise<ArtifactRecord | null> {
      return records.get(name) ?? null;
    },

    async list(): Promise<ArtifactRecord[]> {
      return Array.from(records.values()).sort(
        (a, b) => b.manifest.updatedAt.localeCompare(a.manifest.updatedAt),
      );
    },
  };
}
