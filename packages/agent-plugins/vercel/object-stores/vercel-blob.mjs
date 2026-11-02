/**
 * @file Vercel Blob share-link store: the Vercel plugin's `ObjectStoreProvider` (provider id `vercel`,
 * so the share path resolves the saved `vercel` connection), contributing only `createArtifactStore`.
 * A site owner whose only host is Vercel gets a share download link without setting up S3.
 *
 * Wire format mirrors `@vercel/blob`'s `put()` and `del()` (an installed plugin has no npm
 * dependencies): `PUT {BLOB_API}/?pathname=<key>` and `POST {BLOB_API}/delete { urls }`, both with the
 * Blob store's read-write token. Every request goes through `kit.fetch` with the redirect guard, so
 * the token is never forwarded to another host.
 *
 * Unguessable without a random suffix: the key already carries the share's 16-letter (~91-bit) token
 * (`_share/<token>/<name>.tovu.zip`) and anonymous readers cannot list a Blob store. A suffix would
 * also make the URL underivable from the key, and `delete` (revoke) receives only the key.
 *
 * Plain JS by owner decision (2026-09-29), like `targets/vercel.mjs`.
 */

const BLOB_API = "https://vercel.com/api/blob";
/** Matches `@vercel/blob` 2.8.2 (`BLOB_API_VERSION = 13`, sent on every API call). */
const BLOB_API_VERSION = "13";
/** The smallest edge cache Blob allows, so a revoked link stops serving within about a minute. */
const BLOB_CACHE_MAX_AGE_SECONDS = "60";
/** The token is 16 ASCII letters, the shape core's `SHARE_TOKEN` mints (a plugin cannot import core). */
const SHARE_KEY = /^_share\/[A-Za-z]{16}\/[a-z0-9][a-z0-9-]{0,79}\.tovu\.zip$/;
/** `vercel_blob_rw_<storeId>_<secret>`: the store id names the public host, as `@vercel/blob` reads it. */
const BLOB_TOKEN = /^vercel_blob_rw_([A-Za-z0-9]+)_\w+$/;

/**
 * The Blob store's public origin. `new URL` lowercases the host, as Blob serves it.
 * @param {{ blobToken: string | undefined, kit: any }} required
 * @throws {DeployError} The token is missing or not a Blob read-write token; the message never echoes it.
 * @complexity O(token length).
 */
function storeOrigin(required) {
  const match = BLOB_TOKEN.exec(required.blobToken ?? "");
  if (!match) throw new required.kit.DeployError("Add a Vercel Blob read-write token to the Vercel connection to get share links.", 400);
  return new URL(`https://${match[1]}.public.blob.vercel-storage.com`).origin;
}

/**
 * One authenticated Blob API call. Errors carry only the operation and HTTP status, never the token,
 * key or a response body (which may echo either).
 * @param {{ kit: any, blobToken: string, path: string, op: string, init: RequestInit }} required
 * @complexity One request.
 */
async function blobApi(required) {
  const { kit, blobToken, path, op, init } = required;
  const headers = { ...init.headers, authorization: `Bearer ${blobToken}`, "x-api-version": BLOB_API_VERSION };
  const response = await kit.fetch(`${BLOB_API}${path}`, kit.redirectGuardInit({ ...init, headers }), { timeoutMs: kit.timeouts.UPLOAD });
  kit.assertNotRedirected(response, "Vercel Blob");
  if (!response.ok) throw new kit.DeployError(`Vercel Blob ${op} failed (HTTP ${response.status}).`, 502);
  return response;
}

/**
 * @param {{ key: string, kit: any }} required
 * @throws {DeployError} Not a share artifact key.
 */
function requireKey(required) {
  if (!SHARE_KEY.test(required.key)) throw new required.kit.DeployError("Invalid share artifact key.", 400);
}

/**
 * True when Blob stored the object at exactly `origin/key`: no suffix, no other store.
 * @param {{ returned: unknown, origin: string, key: string }} required
 */
function isExactBlobUrl(required) {
  if (typeof required.returned !== "string") return false;
  const url = URL.canParse(required.returned) ? new URL(required.returned) : undefined;
  return url?.origin === required.origin && url.pathname === `/${required.key}` && !url.search;
}

/**
 * The share-facing artifact store over one Blob store.
 * @param {{ blobToken: string, kit: any }} required
 * @returns {import("@jini-ai/devops/deploy").ArtifactStorePort & { binding: string }}
 * @complexity O(1) to build; each call is one request.
 */
function createBlobArtifactStore(required) {
  const { blobToken, kit } = required;
  const origin = storeOrigin(required);
  // `?download=1` is Blob's attachment URL, so the browser saves the ZIP instead of opening it.
  const shareUrl = (key) => `${origin}/${key}?download=1`;
  return {
    /** Core records this so revoke only deletes through the same Blob store the share was put in. */
    binding: origin,
    async upload({ key, bytes }, options = {}) {
      requireKey({ key, kit });
      options.signal?.throwIfAborted();
      const response = await blobApi({ kit, blobToken, op: "upload", path: `/?pathname=${encodeURIComponent(key)}`, init: {
        method: "PUT", body: bytes, signal: options.signal,
        // `@vercel/blob` 2.8.2 `put()` always sends the access header; shares are public by design.
        headers: { "x-vercel-blob-access": "public", "x-content-type": "application/zip", "x-add-random-suffix": "0", "x-allow-overwrite": "1", "x-cache-control-max-age": BLOB_CACHE_MAX_AGE_SECONDS },
      } });
      const stored = await response.json().catch(() => ({}));
      if (!isExactBlobUrl({ returned: stored.url, origin, key })) throw new kit.DeployError("Vercel Blob stored the share under an unexpected address.", 502);
      return { url: shareUrl(key) };
    },
    /** Revoke. Blob's delete is idempotent: an already-absent URL still answers 200. */
    async delete({ key }, options = {}) {
      requireKey({ key, kit });
      await blobApi({ kit, blobToken, op: "delete", path: "/delete", init: {
        method: "POST", signal: options.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ urls: [`${origin}/${key}`] }),
      } });
    },
    /**
     * Anonymous HEAD of the public URL. Blob does not serve the no-store/robots headers the Tovu
     * delivery contract checks, so this checks what Blob does guarantee: exact size and ZIP type.
     */
    async verify({ key, url, present, bytes }, options = {}) {
      requireKey({ key, kit });
      if (url !== shareUrl(key)) return false;
      const response = await kit.fetch(url, { method: "HEAD", redirect: "error", signal: options.signal }, { timeoutMs: kit.timeouts.QUICK });
      if (!present) return response.status === 404 || response.status === 410;
      return response.status === 200 && Number(response.headers.get("content-length")) === bytes && /^application\/zip(?:;|$)/i.test(response.headers.get("content-type") ?? "");
    },
  };
}

/** The module contract the host's object-store registry loads (`ObjectStoreProvider`). */
export default {
  /** Publishing needs only an API token; sharing requires the separate Blob token.
   * @param {{ credential: any }} required
   * @returns {boolean} Whether this connection can supply a Blob artifact store, without I/O.
   * @complexity O(token length).
   */
  acceptsArtifactCredential({ credential }, _optional = {}) {
    return typeof credential?.blobToken === "string" && BLOB_TOKEN.test(credential.blobToken);
  },
  /**
   * Blob holds share links only; site media stays on its configured store.
   * @returns {{ status: "rejected", error: { code: "not_configured", message: string } }}
   */
  create(_required, _optional = {}) {
    return { status: "rejected", error: { code: "not_configured", message: "Vercel Blob is used for share links only, not site media." } };
  },

  /**
   * @param {{ credential: Record<string, string | undefined> & { token: string }, kit: any }} required
   *   `credential.blobToken`: the optional Blob read-write token on the Vercel connection.
   * @param {Record<string, never>} [_optional]
   * @throws {DeployError} No usable Blob token; the share path then falls back to download-only.
   */
  createArtifactStore(required, _optional = {}) {
    return createBlobArtifactStore({ blobToken: required.credential.blobToken, kit: required.kit });
  },
};
