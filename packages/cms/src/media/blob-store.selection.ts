/**
 * @file Where media bytes live: an operator env override, else a stored site setting, else local
 * disk — the one seam behind a host's media blob store, so no read/write path changes when the
 * provider does.
 *
 * Fails LOUD, not silently: an unknown env value or an incomplete remote env config throws here,
 * synchronously at boot — an operator who typos the opt-in must see a startup error, not have the
 * install quietly write local files nobody expected (which would look like "media works" until the
 * next deploy wipes the ephemeral disk). A setting choice that cannot be honoured (provider not
 * installed, credential missing) rejects every media call with the reason, for the same reason: it
 * never falls back to local disk.
 *
 * Keys never change: every provider is handed `computeBlobStorageKey`'s `ws/...` key (plus the
 * operator's key prefix for a remote store), so no stored storage key needs migrating.
 */
import { deferObjectStore, type ObjectStore, type ObjectStoreCreateInput, type ObjectStoreProvider } from "@jini-ai/core/object-store";
import type { ProviderRegistry } from "@jini-ai/core/provider-registry";

import { blobStoreFromObjectStore } from "./blob-store.object-store.js";
import type { BlobStorePort } from "./ports.js";

export type MediaStoreCredential = NonNullable<ObjectStoreCreateInput["credential"]>;

/** One env selector a bundled provider declares (structurally an object-store
 *  env declaration): `required` lists the variables in their operator-facing order. */
export interface MediaStoreEnvDeclaration {
  readonly providerId: string;
  readonly selector: string;
  readonly settings: Readonly<Record<string, string>>;
  readonly credentialFields: Readonly<Record<string, string>>;
  readonly secret: string;
  readonly required: readonly string[];
}

/** The env override, resolved synchronously: unset, local, or a complete config for the provider
 *  whose declaration owns the selector. */
export type MediaStoreEnvChoice =
  | { readonly kind: "unset" }
  | { readonly kind: "local" }
  | { readonly kind: "remote"; readonly providerId: string; readonly settings: Readonly<Record<string, string | undefined>>; readonly credential: MediaStoreCredential };

export interface LoadedMediaStoreRegistry<H> {
  readonly registry: ProviderRegistry<ObjectStoreProvider<H>>;
  /** Log-safe, one line per provider that was not loaded and why. */
  readonly refusals: readonly string[];
}

/** Late-bound boot ports: read on first media use, after the composition root has built them. */
export interface MediaObjectStorePorts<H> {
  readonly host: H;
  /** Bundled-source providers for the env override (no activation gate). */
  loadBundledRegistry(): Promise<LoadedMediaStoreRegistry<H>>;
  /** This workspace's installed providers for the site setting. */
  loadSiteRegistry(): Promise<LoadedMediaStoreRegistry<H>>;
  readSetting(): Promise<string>;
  /** The site's saved connection shared with backup shares, for a remote provider id. */
  resolveSharedCredential(required: { readonly providerId: string }): Promise<MediaStoreCredential | undefined>;
}

export interface ReadMediaStoreEnvOptions {
  readonly envDeclarations?: readonly MediaStoreEnvDeclaration[];
}

/**
 * Reads and validates the env override named `envName`. Error texts are the ones operators already
 * know: the declaration supplies the selector and the required variables in their original order,
 * so the messages stay byte-identical.
 * @throws {Error} Unknown backend, or a declared selector without every required variable.
 * @complexity O(1).
 */
export function readMediaStoreEnvChoice(required: { readonly env: Readonly<Record<string, string | undefined>>; readonly envName: string }, optional: ReadMediaStoreEnvOptions = {}): MediaStoreEnvChoice {
  const { env, envName } = required;
  const backend = env[envName];
  if (backend === undefined) return { kind: "unset" };
  if (backend === "local") return { kind: "local" };
  const declarations = optional.envDeclarations ?? [];
  const declaration = declarations.find(entry => entry.selector === backend);
  if (!declaration) {
    const expected = ["local", ...declarations.map(entry => entry.selector)].map(selector => `'${selector}'`).join(" or ");
    throw new Error(`Unknown ${envName} '${backend}' — expected ${expected}.`);
  }
  // Each entry pairs the env var name with its value, so a missing one is reported by its real name.
  const requiredVars = declaration.required;
  const missing = requiredVars.filter(name => !env[name]);
  if (missing.length > 0) {
    throw new Error(`${envName}=${backend} requires ${requiredVars.join(", ")} — missing: ${missing.join(", ")}.`);
  }
  const map = (mapping: Readonly<Record<string, string>>) => Object.fromEntries(Object.entries(mapping).map(([field, name]) => [field, env[name]]));
  return {
    kind: "remote", providerId: declaration.providerId,
    settings: map(declaration.settings),
    credential: { fields: map(declaration.credentialFields), secret: env[declaration.secret] as string },
  };
}

/**
 * Builds the media blob store. Synchronous so boot can fail loud before any background work starts;
 * the provider itself is resolved on first media use through `ports()`.
 * @returns The store; whether media is known remote at boot (`mediaIsRemoteByEnv`, env override
 *   only); and `isMediaRemote`, the EFFECTIVE answer (env override, else the site setting) read
 *   when asked — backups use it so a setting-selected remote provider never makes them walk the
 *   unused local folder and omit the "media is not in this backup" note.
 * @throws {Error} See {@link readMediaStoreEnvChoice}.
 * @complexity O(1) now; first media call does one setting read and at most one registry load.
 */
export function selectMediaBlobStore<H>(
  required: {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly envName: string;
    /** Named in the "no saved connection" error so an operator knows what to clear. */
    readonly settingName: string;
    readonly local: () => ObjectStore;
    readonly ports: () => MediaObjectStorePorts<H>;
  },
  optional: ReadMediaStoreEnvOptions = {}
): { readonly blobStore: BlobStorePort; readonly mediaIsRemoteByEnv: boolean; readonly isMediaRemote: () => Promise<boolean> } {
  const { local, settingName } = required;
  const choice = readMediaStoreEnvChoice({ env: required.env, envName: required.envName }, optional);
  const store = choice.kind === "local" ? local() : deferObjectStore({ load: () => loadMediaObjectStore({ choice, ports: required.ports(), local, settingName }) });
  const isMediaRemote = async () => (choice.kind === "unset" ? (await settingProviderId({ ports: required.ports() })) !== "local" : choice.kind === "remote");
  return { blobStore: blobStoreFromObjectStore({ store }), mediaIsRemoteByEnv: choice.kind === "remote", isMediaRemote };
}

/** The site setting's provider id, blank meaning the registry default `local`. @complexity One setting read. */
async function settingProviderId<H>(required: { readonly ports: MediaObjectStorePorts<H> }): Promise<string> {
  return (await required.ports.readSetting()) || "local";
}

/**
 * Resolves the provider for an env-remote or setting-driven choice.
 * @throws {Error} The chosen provider is not available or refused its configuration.
 * @complexity One setting read, at most one registry load and one credential read.
 */
async function loadMediaObjectStore<H>(required: { readonly choice: Exclude<MediaStoreEnvChoice, { kind: "local" }>; readonly ports: MediaObjectStorePorts<H>; readonly local: () => ObjectStore; readonly settingName: string }): Promise<ObjectStore> {
  const { choice, ports } = required;
  if (choice.kind === "remote") {
    return createFrom({ loaded: await ports.loadBundledRegistry(), providerId: choice.providerId, settings: choice.settings, credential: choice.credential, host: ports.host });
  }
  const providerId = await settingProviderId({ ports });
  if (providerId === "local") return required.local();
  const credential = await ports.resolveSharedCredential({ providerId });
  if (!credential) throw new Error(`Media storage '${providerId}' has no saved connection — connect it first, or clear ${required.settingName}.`);
  const bucket = privateMediaBucket({ providerId, credential });
  return createFrom({ loaded: await ports.loadSiteRegistry(), providerId, settings: { bucket, keyPrefix: credential.fields.mediaKeyPrefix }, credential, host: ports.host });
}

/**
 * The shared connection's bucket is the PUBLIC publish/share bucket; media (drafts included) must
 * live in a private bucket of its own, so only an explicit `mediaBucket` is ever used — and one that
 * names the public bucket again (compared trimmed and case-folded, as bucket names are lowercase) is
 * refused, or private originals would be written into public storage.
 * @returns The trimmed `mediaBucket`.
 * @throws {Error} `mediaBucket` is blank, or is the public `bucket`.
 * @complexity O(name length).
 */
function privateMediaBucket(required: { readonly providerId: string; readonly credential: MediaStoreCredential }): string {
  const { providerId, credential } = required;
  const bucket = credential.fields.mediaBucket?.trim();
  if (!bucket) throw new Error(`Media storage '${providerId}' needs the connection's 'mediaBucket' field (a private bucket) — the publish bucket is public and is never used for media.`);
  if (bucket.toLowerCase() === credential.fields.bucket?.trim().toLowerCase()) {
    throw new Error(`Media storage '${providerId}' needs a 'mediaBucket' different from the connection's public 'bucket' — media (drafts included) must live in a private bucket.`);
  }
  return bucket;
}

/**
 * Both callers always hold a credential (a remote env choice validates it at boot; the setting path refuses
 * without a saved connection), so it is required here rather than optional.
 * @throws {Error} Unknown provider (with the registry's refusals) or a refused configuration. @complexity O(1).
 */
function createFrom<H>(required: { readonly loaded: LoadedMediaStoreRegistry<H>; readonly providerId: string; readonly credential: MediaStoreCredential } & ObjectStoreCreateInput<H>): ObjectStore {
  const { loaded, providerId, settings, credential, host } = required;
  const entry = loaded.registry.get({ id: providerId });
  if (!entry) {
    const why = loaded.refusals.length > 0 ? ` (${loaded.refusals.join("; ")})` : "";
    throw new Error(`Media storage provider '${providerId}' is not available${why}.`);
  }
  const created = entry.provider.create({ settings, credential, host });
  if (created.status !== "ok") throw new Error(`Media storage provider '${providerId}' refused its configuration: ${created.error.message}`);
  return created.value;
}
