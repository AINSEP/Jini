/** A private locator is kept by the consumer; only verified public URLs reach recipients. */
export interface ArtifactUpload {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}
/**
 * Single-object delivery. Publishing a whole tree must never own these objects.
 *
 * The share-facing view of `@jini-ai/core/object-store`: `upload`/`delete` are an `ObjectStore`'s
 * `put`/`delete`, `url`/`verify` its `publicAccess`. Hosts select the provider that hands one out
 * through the object-store registry by capability, not by a vendor id.
 */
export interface ArtifactStorePort {
  upload(required: ArtifactUpload, optional?: { signal?: AbortSignal }): Promise<{ url: string }>;
  delete(required: { key: string }, optional?: { signal?: AbortSignal }): Promise<void>;
  /** Anonymous read, or confirmed 404/410 when present=false. Errors are not absence. */
  verify(required: { key: string; url: string; present: boolean; bytes?: number }, optional?: { signal?: AbortSignal }): Promise<boolean>;
}
