/**
 * @file S3-compatible `ObjectStoreProvider` (`@jini-ai/core/object-store`, provider id `s3_compatible`)
 * for the bundled s3-compatible Agent Plugin: AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean
 * Spaces, Wasabi, MinIO, ...
 *
 * Moved from Tovu core `apps/website/src/features/media/blob-store.s3.ts` (`S3BlobStore`): same
 * requests, same path-style object URLs, same status handling, error texts re-prefixed
 * `S3ObjectStore.<method>`. SigV4 signing comes from the host (`host.createSigV4Client`, the same
 * `aws4fetch` `AwsClient` core used), because an installed plugin has no npm dependencies; the host
 * may wrap the signed fetch (`host.wrapFetch`) to trace each object call. Plain JS by owner decision
 * (2026-09-29), like `targets/s3-compatible.mjs`.
 *
 * Bucket posture (carried over from `S3BlobStore`): this store signs key → bytes operations against
 * a bucket the Tovu server itself is the ONLY reader of — every public media byte is proxied back out
 * through the `/m/...` rendition route, which calls the store's `get()` and streams the result itself.
 * That proxying is what makes this bucket safe to leave PRIVATE (least-privilege
 * `s3:GetObject`/`PutObject`/`DeleteObject`/`HeadObject` on one prefix, no `s3:ListBucket`, no
 * public-read ACL, no CORS, no website hosting, no custom domain) — intentionally the opposite posture
 * from the publish target's bucket (`targets/s3-compatible.mjs`), so a reader who has seen that
 * target's config shape should not assume the two need the same bucket setup. Hence no
 * `publicAccess` on this store; shares go through {@link createArtifactStore}, the publish target's
 * own public-bucket capability.
 *
 * Object keys (the no-data-loss rule): the S3 object key is `keyPrefix + key`, byte-identical to
 * `S3BlobStore`'s `keyPrefix + storageKey`, and the URL is built segment by segment exactly as its
 * `objectUrl` was. A site switching from `S3BlobStore` to this provider therefore addresses the exact
 * same objects the SQLite `asset_blobs.storage_key` column already records; only what interprets that
 * string changes. Changing this derivation would orphan every existing upload.
 *
 * Every data-plane operation is one signed HTTP request against
 * `{endpoint-or-derived-AWS-host}/{bucket}/{key}` — no retries, no multipart (the objects this store
 * handles are single-file media uploads, not the multi-GB objects multipart exists for).
 */

import deployTargetModule from "../targets/s3-compatible.mjs";

/** `get` bound, as `S3BlobStore.get` had: a whole media object, so generous. */
const GET_TIMEOUT_MS = 120_000;
/** `head` bound, as `S3BlobStore.sizeOf` had: no payload, so short. */
const HEAD_TIMEOUT_MS = 30_000;

/**
 * @typedef {{ readonly bucket: string, readonly region: string, readonly endpoint?: string, readonly keyPrefix?: string }} S3ObjectStoreConfig
 * @typedef {(url: string, init: RequestInit) => Promise<Response>} SendFn
 * @typedef {{ createSigV4Client(input: { accessKeyId: string, secretAccessKey: string, service: string, region: string }): { fetch: SendFn }, wrapFetch?: (fetchFn: SendFn) => SendFn }} S3ObjectStoreHost
 */

/**
 * The setting/credential names `create` refuses without, each with how to read it. A blank string is
 * missing too — the same `!value` test Tovu's env path (`TOVU_S3_*`) applies.
 */
const REQUIRED_INPUTS = [
  ["credential.fields.accessKeyId", ({ credential }) => credential?.fields?.accessKeyId],
  ["credential.fields.region", ({ credential }) => credential?.fields?.region],
  ["credential.secret", ({ credential }) => credential?.secret],
  ["settings.bucket", ({ settings }) => settings?.bucket],
];

/**
 * @param {{ settings?: Readonly<Record<string, string | undefined>>, credential?: { fields?: Readonly<Record<string, string | undefined>>, secret?: string } }} required
 * @returns {string[]} The names of every missing required input, in {@link REQUIRED_INPUTS} order.
 * @complexity O(1) — a fixed list.
 */
function missingInputs(required) {
  return REQUIRED_INPUTS.filter(([, read]) => !read(required)).map(([name]) => name);
}

/**
 * Blank (or whitespace-only) derives a plain-AWS-S3 host from the region — byte-identical to
 * `S3BlobStore`'s and the publish target's `deriveEndpoint`. Trailing slashes are stripped.
 * @param {{ endpoint?: string, region: string }} required
 * @complexity O(n) in the endpoint length.
 */
function resolveHost(required) {
  const endpoint = required.endpoint?.trim();
  return stripTrailingSlashes({ value: endpoint ? endpoint : `https://s3.${required.region}.amazonaws.com` });
}

/**
 * Same result as `.replace(/\/+$/, "")`, without that regex's backtracking on a long run of slashes.
 * @param {{ value: string }} required
 * @complexity O(n) in the value length.
 */
function stripTrailingSlashes(required) {
  const { value } = required;
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

/**
 * Builds the path-style object URL for one key, each path segment percent-encoded independently
 * (mirrors `S3BlobStore`'s and `targets/s3-compatible.mjs`'s `objectUrl`).
 * @param {{ host: string, config: S3ObjectStoreConfig, key: string }} required
 * @complexity O(n) in the number of path segments.
 */
function objectUrl(required) {
  const { host, config, key } = required;
  const fullKey = `${config.keyPrefix ?? ""}${key}`;
  const encodedKey = fullKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${host}/${encodeURIComponent(config.bucket)}/${encodedKey}`;
}

/**
 * Reads a response body defensively for an error message — never throws itself, capped at 200
 * characters since these messages are logged/thrown locally rather than surfaced to a user.
 * @param {{ response: Response }} required
 * @complexity O(body).
 */
async function safeErrorBody(required) {
  try {
    return (await required.response.text()).slice(0, 200);
  } catch {
    return "";
  }
}

/**
 * The caller's abort signal, bounded by `timeoutMs` when one is given.
 * @param {{ signal?: AbortSignal }} required
 * @param {{ timeoutMs?: number }} [optional]
 * @returns {{ signal?: AbortSignal }} A `RequestInit` fragment (empty when there is nothing to bound).
 * @complexity O(1).
 */
function signalInit(required, optional = {}) {
  const { signal } = required;
  const { timeoutMs } = optional;
  if (timeoutMs === undefined) return signal ? { signal } : {};
  const timeout = AbortSignal.timeout(timeoutMs);
  return { signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
}

/**
 * The request headers for one `put`: caller headers, then `content-type`, then the create-only
 * precondition — so neither of the latter two can be overridden by a stray caller header.
 * A native `Headers` with `.set()`, not an object spread: header names are case-insensitive, so a
 * caller's `if-none-match` and an enforced `If-None-Match` would otherwise both be sent and combine
 * into one `etag-1, *` value instead of the required `*`.
 * @param {{ contentType?: string, headers?: Readonly<Record<string, string>>, ifAbsent?: boolean }} required
 * @returns {Headers}
 * @complexity O(headers).
 */
function putHeaders(required) {
  const { contentType, headers, ifAbsent } = required;
  const merged = new Headers(headers);
  if (contentType !== undefined) merged.set("content-type", contentType);
  if (ifAbsent) merged.set("if-none-match", "*");
  return merged;
}

/**
 * Builds the store over one signing `send`.
 * @param {{ config: S3ObjectStoreConfig, send: SendFn }} required
 * @returns {import("@jini-ai/core/object-store").ObjectStore}
 * @complexity O(1) to build; each call is one signed HTTP request.
 */
function createS3ObjectStore(required) {
  const { config, send } = required;
  const host = resolveHost(config);
  /**
   * One signed request; a transport failure rejects as `S3ObjectStore.<method>: request failed`.
   * @param {{ method: string, op: string, key: string, init: RequestInit }} call
   */
  const request = async (call) => {
    try {
      return await send(objectUrl({ host, config, key: call.key }), { method: call.method, ...call.init });
    } catch (err) {
      throw new Error(`S3ObjectStore.${call.op}: request failed for '${call.key}' — ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return {
    /**
     * `ifAbsent` sends `If-None-Match: *`, making this a conditional PUT: the object store itself
     * refuses the write (HTTP 412) when the key is already occupied, so there is no separate `head()`
     * round trip and therefore no window between "check" and "write" for a concurrent writer to land
     * in — the same atomicity guarantee the local store's `"wx"` flag gets from the filesystem.
     *
     * Provider caveat (disclosed, not silently assumed): AWS S3 and Cloudflare R2 honor
     * `If-None-Match: *` on `PUT`; some other S3-compatible providers (older MinIO, some DigitalOcean
     * Spaces/Wasabi deployments) may not enforce it and could return 200 on an unconditional overwrite
     * instead of 412 — on those providers specifically this degrades to an unconditional overwrite,
     * not a crash or a silently wrong `written` value for the providers that do enforce it.
     */
    async put({ key, bytes }, options = {}) {
      const resp = await request({
        method: "PUT",
        op: "put",
        key,
        init: { headers: putHeaders(options), body: bytes, ...signalInit(options) },
      });
      if (options.ifAbsent && resp.status === 412) {
        // Precondition Failed — an object already occupies this key. Content-addressed callers
        // (media blobs are keyed by sha256) know whatever is there carries the same bytes this call
        // would have written, so leaving it untouched is always correct.
        return { written: false };
      }
      if (!resp.ok) {
        const body = await safeErrorBody({ response: resp });
        const bodySuffix = body ? ` — ${body}` : "";
        throw new Error(`S3ObjectStore.put: failed to write '${key}' — HTTP ${resp.status}${bodySuffix}`);
      }
      return { written: true };
    },

    /** `null` only on a genuine 404; every other non-ok status rejects. */
    async get({ key }, options = {}) {
      const resp = await request({ method: "GET", op: "get", key, init: signalInit(options, { timeoutMs: GET_TIMEOUT_MS }) });
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`S3ObjectStore.get: failed to read '${key}' — HTTP ${resp.status}`);
      return new Uint8Array(await resp.arrayBuffer());
    },

    /**
     * A 404 means the object is genuinely absent and resolves to `null`. Any other non-ok status
     * (403/429/5xx — an auth failure, rate limit, or provider outage) rejects instead of collapsing
     * into `null`: a caller branching on presence must not mistake "the store rejected/failed this
     * request" for "the object was deleted". A bounded exporter needs the size BEFORE buffering an
     * object, so a missing or malformed `content-length` rejects rather than guessing.
     */
    async head({ key }, options = {}) {
      const resp = await request({ method: "HEAD", op: "head", key, init: signalInit(options, { timeoutMs: HEAD_TIMEOUT_MS }) });
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`S3ObjectStore.head: failed to check '${key}' — HTTP ${resp.status}`);
      const length = resp.headers.get("content-length");
      if (length === null || !/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) {
        throw new Error("S3ObjectStore.head: storage did not return a valid content length");
      }
      return { size: Number(length) };
    },

    /** Idempotent — a 404 (already absent) is success, the same tolerance the local store gets from `rm({ force: true })`. */
    async delete({ key }, options = {}) {
      const resp = await request({ method: "DELETE", op: "delete", key, init: signalInit(options) });
      if (!resp.ok && resp.status !== 404) {
        throw new Error(`S3ObjectStore.delete: failed to delete '${key}' — HTTP ${resp.status}`);
      }
    },
  };
}

/** The module contract the host's object-store registry loads (`ObjectStoreProvider`). */
export default {
  /**
   * @param {{ settings: Readonly<Record<string, string | undefined>>, credential?: { fields: Readonly<Record<string, string | undefined>>, secret: string }, host: S3ObjectStoreHost }} required
   *   `credential.fields`: `accessKeyId`, `region`, optional `endpoint`; `credential.secret`: the secret
   *   access key; `settings`: `bucket`, optional `keyPrefix`.
   * @param {Record<string, never>} [_optional]
   * @returns {{ status: "ok", value: import("@jini-ai/core/object-store").ObjectStore } | { status: "rejected", error: { code: "not_configured", message: string } }}
   *   Never throws for a missing input: the host reports the refusal instead of crashing.
   */
  create(required, _optional = {}) {
    const missing = missingInputs(required);
    if (missing.length > 0) {
      return {
        status: "rejected",
        error: { code: "not_configured", message: `S3-compatible object store is missing required input(s): ${missing.join(", ")}.` },
      };
    }
    const { settings, credential, host } = required;
    const { accessKeyId, region, endpoint } = credential.fields;
    const client = host.createSigV4Client({ accessKeyId, secretAccessKey: credential.secret, service: "s3", region });
    const signed = (url, init) => client.fetch(url, init);
    const send = host.wrapFetch ? host.wrapFetch(signed) : signed;
    const config = {
      bucket: settings.bucket,
      region,
      ...(endpoint === undefined ? {} : { endpoint }),
      ...(settings.keyPrefix === undefined ? {} : { keyPrefix: settings.keyPrefix }),
    };
    return { status: "ok", value: createS3ObjectStore({ config, send }) };
  },

  /**
   * The public share capability, delegated to this plugin's own publish target
   * (`targets/s3-compatible.mjs`) so a share can be resolved through the object-store registry while
   * the public-bucket code (key shape check, public URL, anonymous verify) keeps one owner.
   * @param {{ credential: Record<string, string | undefined> & { token: string }, kit: any }} required
   * @param {Record<string, never>} [optional]
   */
  createArtifactStore(required, optional = {}) {
    return deployTargetModule.createArtifactStore(required, optional);
  },
};
