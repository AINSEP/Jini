/**
 * @file The ONE object-storage contract (2026-10-21): key → bytes, with an optional public-read
 * capability. It absorbs four overlapping shapes (cms `BlobStorePort`, capability-providers
 * `StorageProvider`, devops `ArtifactStorePort`, platform `BlobStorage`); those stay as thin views
 * over this one until their consumers move. Providers are keyed in a `createProviderRegistry`
 * (`contract: 'object_store'`), default `local`.
 *
 * Universal: types and pure helpers only, so every storage package (all of which already depend
 * on core) can implement it. Filesystem and network adapters live in node/host packages.
 *
 * Data-plane calls REJECT on a storage fault (as every existing byte port did), and report absence
 * as `null`/`false`, never as a rejection: a caller must never mistake "the store failed" for "the
 * object is gone". Only `ObjectStoreProvider.create` returns a `ProviderResult`, so a bad or missing
 * setting is a refusal the host can report, not a boot crash.
 */
import { createProviderRegistry, type ProviderDefinition, type ProviderRegistry, type ProviderResult } from './provider-registry.js';

/** Registry contract name for object-store providers. */
export const OBJECT_STORE_CONTRACT = 'object_store';

/** The built-in default provider id (local filesystem). */
export const DEFAULT_OBJECT_STORE_PROVIDER_ID = 'local';

export interface ObjectStorePutOptions {
  readonly contentType?: string;
  /** Extra stored response headers (e.g. `content-disposition`); a provider may drop unsupported ones. */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Create-only write: lands `bytes` iff no object occupies `key`, atomically with respect to any
   * other concurrent writer of the SAME key. No adapter may implement this as a separate existence
   * check followed by a write — that pair is exactly the TOCTOU gap this flag exists to close.
   */
  readonly ifAbsent?: boolean;
  readonly signal?: AbortSignal;
}

export interface ObjectStoreCallOptions {
  readonly signal?: AbortSignal;
}

/** Anonymous read access, present only on a store whose objects are publicly reachable. */
export interface PublicObjectAccess {
  /** The public URL a recipient fetches `key` at. */
  url(required: { readonly key: string }): string;
  /** Anonymous read check: present with `bytes`, or a confirmed 404/410 when `present` is false. Errors are not absence. */
  verify(
    required: { readonly key: string; readonly url: string; readonly present: boolean; readonly bytes?: number },
    optional?: ObjectStoreCallOptions,
  ): Promise<boolean>;
}

export interface ObjectStore {
  /** `written: false` only when `ifAbsent` was set and the key was already occupied. */
  put(required: { readonly key: string; readonly bytes: Uint8Array }, optional?: ObjectStorePutOptions): Promise<{ readonly written: boolean }>;
  /** `null` only when the key is absent; every other fault rejects. */
  get(required: { readonly key: string }, optional?: ObjectStoreCallOptions): Promise<Uint8Array | null>;
  /** Byte count without reading the payload; `null` only when the key is absent. */
  head(required: { readonly key: string }, optional?: ObjectStoreCallOptions): Promise<{ readonly size: number } | null>;
  /** Idempotent — deleting an absent key is not an error. */
  delete(required: { readonly key: string }, optional?: ObjectStoreCallOptions): Promise<void>;
  readonly publicAccess?: PublicObjectAccess;
}

/** What a host hands a provider: non-secret settings, a pre-resolved credential, and its own kit. */
export interface ObjectStoreCreateInput<H = unknown> {
  readonly settings: Readonly<Record<string, string | undefined>>;
  /** Pre-resolved by the host (`fields` non-secret, `secret` the one secret value); never looked up by the provider. */
  readonly credential?: { readonly fields: Readonly<Record<string, string | undefined>>; readonly secret: string };
  /** Host capabilities a plain-JS plugin cannot import (signing, guarded fetch, observability). */
  readonly host: H;
}

export interface ObjectStoreProvider<H = unknown> {
  create(required: ObjectStoreCreateInput<H>, optional?: Record<string, never>): ProviderResult<ObjectStore>;
}

/**
 * Shape check for a provider value, usable as a registry `validate` or a plugin module `validate`.
 * @returns The reason it is not a provider, or `undefined`.
 * @complexity O(1).
 */
export function objectStoreProviderFault(required: { readonly provider: unknown }): string | undefined {
  const { provider } = required;
  if (typeof provider !== 'object' || provider === null) return 'an object-store provider must be an object';
  return typeof (provider as { create?: unknown }).create === 'function' ? undefined : 'an object-store provider must define create()';
}

/**
 * A keyed registry for object-store providers whose default is the local filesystem provider.
 * The `local` provider itself is node-only, so the host registers it (`seed` or `register`).
 * @complexity O(seed).
 */
export function createObjectStoreRegistry<H = unknown>(
  _required: Record<string, never> = {},
  optional: { readonly seed?: readonly ProviderDefinition<ObjectStoreProvider<H>>[] } = {},
): ProviderRegistry<ObjectStoreProvider<H>> {
  return createProviderRegistry<ObjectStoreProvider<H>>({ contract: OBJECT_STORE_CONTRACT }, {
    defaultProviderId: DEFAULT_OBJECT_STORE_PROVIDER_ID,
    validate: objectStoreProviderFault,
    ...(optional.seed === undefined ? {} : { seed: optional.seed }),
  });
}
