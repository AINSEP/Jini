import type { createRenditionAccess } from "../../../media/site/rendition-access.js";
import { guardMediaRenditionRepo, resolveMediaRendition, sniffContentType, lookupMediaOriginalBlob, PRIVATE_NO_STORE, REVALIDATING_PUBLIC, resolveRenditionTransformSpec, ifNoneMatchSatisfied, renditionCacheControl, decideMediaOriginalReply, inlineOriginalType, SVG_CONTENT_SECURITY_POLICY, type MediaRecord } from '../../../media/index.js';
import type { RenditionAccess } from '../../../media/site/rendition-access.js';
import type { sanitizeOriginalBytes } from '../../../media/original-response.js';

const CACHE_CONTROL_HEADER = 'Cache-Control';

export async function mediaRenditionRoute({ deps, facts, res }: {
  deps: {
    workspaceId: string;
    access: RenditionAccess;
    readEntitlement: Parameters<RenditionAccess['decide']>[0]['readEntitlement'];
    rendition: Parameters<typeof resolveMediaRendition>[0]['deps'];
    original: Parameters<typeof lookupMediaOriginalBlob>[0]['deps'];
    blobStore: Parameters<typeof resolveMediaRendition>[0]['deps']['blobStore'];
    resolveMediaRendition: typeof resolveMediaRendition;
    sanitizeOriginalBytes: typeof sanitizeOriginalBytes;
    parseRangeHeader: Parameters<typeof decideMediaOriginalReply>[0]['deps']['parseRangeHeader'];
    hash: (required: { identity: string; bytes?: Uint8Array }) => string;
    ImageTransformUnavailableError: abstract new (...args: never[]) => Error;
    ImageSourceCorruptError: abstract new (...args: never[]) => Error;
    sendMediaOriginalTrashed: () => void;
    writeMediaOriginalReply: (reply: ReturnType<typeof decideMediaOriginalReply>) => void;
  };
  facts: { assetId: string; transformSpec: string; ifNoneMatch: () => string | string[] | undefined; range: () => string | undefined };
  res: {
    status: (code: number) => Parameters<typeof mediaRenditionRoute>[0]['res'];
    set: (name: string, value: string) => Parameters<typeof mediaRenditionRoute>[0]['res'];
    json: (body: unknown) => void; end: () => void; send: (bytes: Uint8Array) => void;
  };
}, _optional = {}): Promise<void> {
  const { assetId, transformSpec } = facts;
  const parsed = resolveRenditionTransformSpec({ assetId, transformSpec });
  if ('errorMessage' in parsed) {
    res.status(400).json({ error: parsed.errorMessage });
    return;
  }
  const { transformName, version } = parsed;
  await sendMediaRenditionResult(deps, facts, res, assetId, transformName, version);
}

/**
 * The ONE writer for every 404 either public media route emits.
 *
 * Both routes must answer "this asset is gated and you may not read it" and "there is no such
 * rendition" identically — that indistinguishability is the whole point of returning 404 rather
 * than 403 for a denied caller. Before 2026-09-05 each outcome set its own header inline and they
 * disagreed (`private, no-store` vs `public, max-age=60`), handing anyone a free existence oracle.
 * Routing every 404 through one function makes agreement structural instead of a convention four
 * call sites have to remember; the header can only ever be {@link PRIVATE_NO_STORE}, since a
 * session-dependent denial must never be replayable from a shared cache.
 *
 * @complexity O(1).
 */
function sendMediaNotFound({ res, error }: { res: Parameters<typeof mediaRenditionRoute>[0]['res']; error: string }, _optional = {}): void {
  res.status(404).set(CACHE_CONTROL_HEADER, PRIVATE_NO_STORE).json({ error });
}

/** Source and stored rendition identities identify the deterministic served representation,
 * including SVG sanitization, without reloading bytes for a conditional request. */
async function publicRenditionTag({ deps, media, transformName, version }: {
  deps: Parameters<typeof mediaRenditionRoute>[0]['deps']; media: MediaRecord | null; transformName: string; version: number;
}): Promise<string | null> {
  if (!media || media.status !== 'active') return null;
  const input = { workspaceId: deps.workspaceId, assetId: media.id, transformName, version };
  if (!await deps.rendition.transformRepo.findByNameVersion({ workspaceId: deps.workspaceId, name: transformName, version })) return null;
  const stored = await deps.rendition.renditionRepo.findOne(input);
  if (!stored && media.source.contentType !== 'image/svg+xml') return null;
  const identity = JSON.stringify([media.source.sha256, transformName, version, stored?.storageKey ?? 'svg']);
  return `"${deps.hash({ identity })}"`;
}

/** Access is resolved before validators: a gated request can never reuse public evidence. */
async function sendNotModifiedRendition({ deps, facts, res, access, transformName, version }: {
  deps: Parameters<typeof mediaRenditionRoute>[0]['deps']; facts: Parameters<typeof mediaRenditionRoute>[0]['facts']; res: Parameters<typeof mediaRenditionRoute>[0]['res'];
  access: { gated: boolean; record: MediaRecord | null }; transformName: string; version: number;
}): Promise<boolean> {
  if (access.gated || !facts.ifNoneMatch()) return false;
  const etag = await publicRenditionTag({ deps, media: access.record, transformName, version });
  if (!etag || !ifNoneMatchSatisfied({ header: facts.ifNoneMatch() as string | undefined, etag })) return false;
  res.status(304).set(CACHE_CONTROL_HEADER, REVALIDATING_PUBLIC).set('ETag', etag).end();
  return true;
}

/**
 * Resolves the access gate, fetches (or generates) the rendition, and writes the final HTTP
 * response — every outcome branch {@link registerMediaRenditionRoute}'s handler previously held
 * inline. Extracted verbatim (pure extract-method: same checks, same order, same early returns)
 * so the route handler's own cognitive-complexity count only has to account for the malformed-URL
 * guard above it, not this function's outcome fan-out too.
 *
 * @complexity O(1) plus {@link resolveMediaAccessDecision}'s own O(p) cost over the workspace's
 * published posts.
 */
async function sendMediaRenditionResult(
  deps: Parameters<typeof mediaRenditionRoute>[0]['deps'],
  facts: Parameters<typeof mediaRenditionRoute>[0]['facts'],
  res: Parameters<typeof mediaRenditionRoute>[0]['res'],
  assetId: string,
  transformName: string,
  version: number
): Promise<void> {
  try {
    const access = await deps.access.decide({ idOrSlug: assetId, readEntitlement: deps.readEntitlement });
    if (!access.allowed) {
      // ADR-030 §4 gate (2026-09-03 sweep): the SAME "rendition not found" 404 an unknown
      // assetId already gets below — a gated asset must be indistinguishable from one that
      // doesn't exist, matching `9bf661e9`'s content-API fix. `private, no-store`, never the
      // short-TTL `public` header the plain not-found branch below uses: this outcome depends on
      // the caller's own session cookie, so a shared/CDN cache must never replay it to a
      // DIFFERENT visitor (see `MediaRenditionRouteDeps`'s own doc).
      sendMediaNotFound({ res, error: "rendition not found" });
      return;
    }

    if (await sendNotModifiedRendition({ deps, facts, res, access, transformName, version })) return;

    const result = await deps.resolveMediaRendition({
      deps: {
        mediaRepo: deps.rendition.mediaRepo,
        blobRepo: deps.rendition.blobRepo,
        // The shared service assumes immutable sources. This host's explicit replace
        // command needs an atomic source guard on late preview writes.
        renditionRepo: guardMediaRenditionRepo({ mediaRepo: deps.rendition.mediaRepo, renditionRepo: deps.rendition.renditionRepo, media: access.record }),
        transformRepo: deps.rendition.transformRepo,
        blobStore: deps.blobStore,
        imageTransformer: deps.rendition.imageTransformer,
        clock: deps.rendition.clock,
        idGen: deps.rendition.idGen,
      },
      input: { workspaceId: deps.workspaceId, assetId, transformName, version },
    });

    await sendResolvedRendition({ deps, res, access, transformName, version }, result);
  } catch (err) {
    sendRenditionFailure({ deps, res, err });
  }
}

/** Maps a failure while resolving/generating a rendition to its HTTP response. @complexity O(1). */
function sendRenditionFailure({ deps, res, err }: { deps: Parameters<typeof mediaRenditionRoute>[0]['deps']; res: Parameters<typeof mediaRenditionRoute>[0]['res']; err: unknown }, _optional = {}): void {
  if (err instanceof deps.ImageTransformUnavailableError) {
    // The transform is valid and generation was allowed, but the real pixel-operation
    // adapter can't run in this environment (disclosed `sharp`-not-installed blocker — see
    // `image-transformer.sharp.ts`). Service-unavailable, not a routine 404/410/500.
    res.status(503).set(CACHE_CONTROL_HEADER, "no-store").json({ error: err.message });
    return;
  }
  if (err instanceof deps.ImageSourceCorruptError) {
    // The asset and transform are both valid, but the STORED bytes cannot actually be
    // decoded/re-encoded by the pixel pipeline (a corrupt or codec-rejected blob — see that
    // error's own doc for how bytes can pass this package's upload allowlist and its
    // magic-byte sniff while still failing here). A data condition on this one asset, not a
    // server fault — 422, never the opaque catch-all 500, and never cached (a future fix to
    // the stored blob must not stay masked by a long-lived negative cache entry).
    res.status(422).set(CACHE_CONTROL_HEADER, "no-store").json({ error: "source image could not be processed" });
    return;
  }
  res.status(500).json({ error: "internal error" });
}

/**
 * Public, unauthenticated `GET /m/{assetId}/original` — the video/embed capability's real
 * render-path fix (2026-08-24; see the video-embed handoff report for the full investigation).
 *
 * WHY THIS EXISTS RATHER THAN A NEW TRANSFORM: {@link registerMediaRenditionRoute} above always
 * resolves a request through `resolveMediaRendition` (`rendition-service.ts`), which — for any
 * not-yet-generated rendition — calls `imageTransformer.transform()` with the transform
 * definition's `params.format`. `TransformFormat` (`transform-types.ts`) is a closed
 * `"jpeg" | "png" | "webp" | "gif"` union with no video member, and the one core transform this
 * host registers (`media/bootstrap.ts`'s `"public"`, `format: "webp"`) is a `sharp` re-encode —
 * pointing a `<video>` tag's `src` at that same URL would hand raw video bytes to `sharp`, which
 * cannot process them. Extending `TransformFormat`/`imageTransformer` to understand video would
 * mean teaching the ADR-027 §4 "frozen" contract a passthrough format it was never designed for,
 * for a media kind (video) that has no resize/re-encode step to apply in the first place — video
 * is served byte-identical to how it was uploaded, same as every image's own `"original"`
 * passthrough rendition row already is, just without a transform-definition lookup gating it.
 *
 * So this route bypasses the transform system entirely: `lookupMediaOriginalBlob` +
 * `decideMediaOriginalReply` (written by `writeMediaOriginalReply`) are the SAME functions `host src/server/inbound/admin-http/routes/media/original.ts`'s
 * authenticated admin-preview route already uses (content-type sniffed fresh from bytes, SVG sanitized, HTML
 * forced to `application/octet-stream` + `attachment`, `nosniff`/CSP/CORP headers, `Range` support
 * for video seeking) — reused, not reimplemented, so the two routes' security posture can't drift
 * apart. The one behavioral difference from the admin route: no `requireAdminSession`/`media.read`
 * gate, since this URL is meant to sit in a `<video src>` on a public page.
 *
 * Video/audio and sanitized SVG share this original-byte path. Raster images still use
 * {@link registerMediaRenditionRoute}'s re-encode. SVG is sanitized before serving even for
 * legacy blobs; unknown bytes and HTML stay 404. Range handling and the member gate keep
 * their existing owners.
 *
 * ADR-030 §4 gate (2026-09-03 sweep): {@link resolveMediaAccessDecision} runs before the blob is
 * even fetched, same as {@link registerMediaRenditionRoute} above — a denied caller gets the SAME
 * "video rendition not found" 404 the not-a-video branch below already uses, so a gated video is
 * indistinguishable from one that was never a video at all. No cache-header special-casing is
 * needed on the ALLOW path here: `decideMediaOriginalReply` already sends `private, no-store`
 * unconditionally for every successful response, gated or not.
 *
 * @complexity O(1) plus the byte copy for a partial range (inherited from
 * `decideMediaOriginalReply`), plus {@link resolveMediaAccessDecision}'s own O(p) cost.
 */
export async function mediaOriginalVideoRoute({ deps, facts, res }: Parameters<typeof mediaRenditionRoute>[0], _optional = {}): Promise<void> {
  const { assetId } = facts;
    try {
      const access = await deps.access.decide({ idOrSlug: assetId, readEntitlement: deps.readEntitlement });
      if (!access.allowed) {
        sendMediaNotFound({ res, error: "video rendition not found" });
        return;
      }

      // Unknown-asset 404s through the SAME `sendMediaNotFound` writer as the gate-denied branch
      // just above (2026-09-23 oracle close, S2b) — the admin original route's own bare
      // `{error: "media '<x>' was not found"}` (no Cache-Control at all) stays reserved for its
      // authenticated admin caller; see `lookupMediaOriginalBlob`'s doc.
      const resolved = await lookupMediaOriginalBlob({ deps: deps.original, params: { workspaceId: deps.workspaceId, mediaId: assetId } });
      if (resolved.outcome === "not-found") {
        sendMediaNotFound({ res, error: "video rendition not found" });
        return;
      }
      if (resolved.outcome === "trashed") {
        deps.sendMediaOriginalTrashed();
        return;
      }
      const { blob } = resolved;

      const sourceBytes = await deps.blobStore.get({ storageKey: blob.storageKey });
      const sniffed = sniffContentType({ bytes: sourceBytes });
      if (sniffed !== "image/svg+xml" && sniffed !== "text/vtt" && !sniffed.startsWith("video/") && !sniffed.startsWith("audio/")) {
        // Neither recognized video/audio, SVG, nor WebVTT captions (G7-9) — or an unrecognized/corrupt asset.
        // everything else's public URL is `registerMediaRenditionRoute`'s transform-backed one.
        // `private, no-store` for the same reason the rendition route's not-found branch uses it
        // (2026-09-05): it must be byte-identical to this route's own gate-denied 404 just above,
        // or the header alone tells an anonymous caller which of the two they hit.
        sendMediaNotFound({ res, error: "video rendition not found" });
        return;
      }

      // Reuse ingest sanitization for legacy blobs before applying byte ranges.
      const bytes = await deps.sanitizeOriginalBytes({ sniffed, sourceBytes });
      deps.writeMediaOriginalReply(decideMediaOriginalReply({ deps: { parseRangeHeader: deps.parseRangeHeader }, bytes, rangeHeader: facts.range(), type: inlineOriginalType({ sniffed }) }));
    } catch {
      res.status(500).json({ error: "internal error" });
    }
}

async function sendResolvedRendition(
  { deps, res, access, transformName, version }: { deps: Parameters<typeof mediaRenditionRoute>[0]['deps']; res: Parameters<typeof mediaRenditionRoute>[0]['res']; access: { gated: boolean; record: MediaRecord | null }; transformName: string; version: number },
  result: Awaited<ReturnType<typeof resolveMediaRendition>>,
): Promise<void> {
    if (result.outcome === "gone") {
      // ADR-027 §4: a purged/gone asset is `410 no-store`. See
      // `rendition-service.ts`'s doc comment for the disclosed
      // trashed-stands-in-for-purged mapping this build uses.
      res.status(410).set(CACHE_CONTROL_HEADER, "no-store").end();
      return;
    }

    if (result.outcome === "not-found") {
      // Not-yet-generated-and-not-generatable-anonymously (or a wholly unknown assetId/transform).
      //
      // `private, no-store`, matching the gate-denied 404 above BYTE FOR BYTE (2026-09-05 fix).
      // This branch used to send `public, max-age=60`, which made the two 404s trivially
      // distinguishable on a header alone: any caller could ask "does this assetId exist and is it
      // gated?" and read the answer off `Cache-Control`, defeating the indistinguishability the
      // gate branch's own comment says it is there to provide. The two headers can only be
      // reconciled downwards — the gate's outcome depends on the caller's session cookie, so it can
      // never be given a shared-cacheable header. The cost is the 60s negative cache on a
      // not-found rendition, which is the correct thing to trade for closing the oracle.
      sendMediaNotFound({ res, error: "rendition not found" });
      return;
    }

    if (result.contentType === "image/svg+xml") {
      // Vector passthroughs do not receive the raster pipeline's re-encode protection.
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Content-Security-Policy", SVG_CONTENT_SECURITY_POLICY);
    }
    // Prefer source/rendition identities; legacy sources without stored evidence still hash bytes.
    if (!access.gated) {
      const identity = `${access.record?.source.sha256}:${transformName}:${version}:`;
      const etag = await publicRenditionTag({ deps, media: access.record, transformName, version });
      res.set("ETag", etag ?? `"${deps.hash({ identity, bytes: result.bytes })}"`);
    }
    res
      .status(200)
      .set(CACHE_CONTROL_HEADER, renditionCacheControl({ gated: access.gated }))
      .set("Content-Type", result.contentType)
      .send(result.bytes);
}

export function createPublicMediaHandlers<TContext, TAccess, TRequest, TResponse>(required: {
  deps: Omit<Parameters<typeof mediaRenditionRoute>[0]['deps'], 'access' | 'readEntitlement' | 'sendMediaOriginalTrashed' | 'writeMediaOriginalReply'>;
  accessDeps: Parameters<typeof createRenditionAccess>[0]; createRenditionAccess: typeof createRenditionAccess;
  createMemberAccessResolver: () => {
    resolveContext: (input: { workspaceId: string; sessionToken: string | undefined; nowIso: string }) => Promise<TContext>;
    decide: (input: { access: TAccess; context: TContext }) => { allowed: boolean };
  };
  readSessionToken: (required: { request: TRequest }) => string | undefined; nowIso: () => string;
  resolvePostMemberAccess: (input: { raw: string | null | undefined }) => TAccess;
  writer: {
    status: (required: { response: TResponse; code: number }) => void; set: (required: { response: TResponse; name: string; value: string }) => void;
    json: (required: { response: TResponse; body: unknown }) => void; end: (required: { response: TResponse }) => void;
    send: (required: { response: TResponse; bytes: Uint8Array }) => void;
  };
  sendMediaOriginalTrashed: (required: { response: TResponse }) => void;
  writeMediaOriginalReply: (required: { response: TResponse; reply: ReturnType<typeof decideMediaOriginalReply> }) => void;
}, _optional = {}) {
  return {
    rendition: { method: 'get' as const, path: '/m/:assetId/:transformSpec/:filename',
      handle: (input: { request: TRequest; params: Readonly<Record<string, string | undefined>>; ifNoneMatch: () => string | string[] | undefined; range: () => string | undefined; response: TResponse }) =>
        mediaRenditionRoute({ ...resolveMediaAccessDecision({ ports: required, request: input.request, response: input.response }), facts: { ...readRenditionRouteParams(input), ifNoneMatch: input.ifNoneMatch, range: input.range } }),
    },
    // Both URL generations use the same gate, byte sniffing and response headers. The suffix is
    // for static-host MIME inference; it never selects the live response's Content-Type.
    original: { method: 'get' as const, path: ['/m/:assetId/original', '/m/:assetId/original.:ext'],
      handle: (input: { request: TRequest; params: Readonly<Record<string, string | undefined>>; ifNoneMatch: () => string | string[] | undefined; range: () => string | undefined; response: TResponse }) =>
        mediaOriginalVideoRoute({ ...resolveMediaAccessDecision({ ports: required, request: input.request, response: input.response }), facts: { ...readRenditionRouteParams(input), ifNoneMatch: input.ifNoneMatch, range: input.range } }),
    },
  };
}

function resolveMediaAccessDecision<TContext, TAccess, TRequest, TResponse>({ ports, request, response }: {
  ports: Parameters<typeof createPublicMediaHandlers<TContext, TAccess, TRequest, TResponse>>[0]; request: TRequest; response: TResponse;
}, _optional = {}): Pick<Parameters<typeof mediaRenditionRoute>[0], 'deps' | 'res'> {
  const deps: Parameters<typeof mediaRenditionRoute>[0]['deps'] = {
    get workspaceId() { return ports.deps.workspaceId; },
    get rendition() { return ports.deps.rendition; },
    get original() { return ports.deps.original; },
    get blobStore() { return ports.deps.blobStore; },
    resolveMediaRendition: ports.deps.resolveMediaRendition, sanitizeOriginalBytes: ports.deps.sanitizeOriginalBytes,
    parseRangeHeader: ports.deps.parseRangeHeader, hash: ports.deps.hash,
    ImageTransformUnavailableError: ports.deps.ImageTransformUnavailableError, ImageSourceCorruptError: ports.deps.ImageSourceCorruptError,
    sendMediaOriginalTrashed: () => ports.sendMediaOriginalTrashed({ response }), writeMediaOriginalReply: reply => ports.writeMediaOriginalReply({ response, reply }),
    get access() { return ports.createRenditionAccess(ports.accessDeps); },
/** Route-local duplicate of `pages.ts`'s own `createMemberAccessResolver` — built per request from
 *  `deps`, never a module-level singleton, same "tests inject their own in-memory repos per
 *  composition" reason that file's own doc gives. */
    readEntitlement: async () => {
      const resolver = ports.createMemberAccessResolver();
      const context = await resolver.resolveContext({ workspaceId: ports.deps.workspaceId,
        sessionToken: ports.readSessionToken({ request }), nowIso: ports.nowIso() });
      return ({ entry }) => resolver.decide({ access: ports.resolvePostMemberAccess({ raw: entry.memberAccessJson }), context }).allowed;
    },
  };
  const res: Parameters<typeof mediaRenditionRoute>[0]['res'] = {
    status: code => { ports.writer.status({ response, code }); return res; }, set: (name, value) => { ports.writer.set({ response, name, value }); return res; },
    json: body => { ports.writer.json({ response, body }); }, end: () => { ports.writer.end({ response }); }, send: bytes => { ports.writer.send({ response, bytes }); },
  };
  return { deps, res };
}

function readRenditionRouteParams(required: { params: Readonly<Record<string, string | undefined>> }, _optional = {}): { assetId: string; transformSpec: string } {
  return { assetId: String(required.params.assetId ?? ""), transformSpec: String(required.params.transformSpec ?? "") };
}
