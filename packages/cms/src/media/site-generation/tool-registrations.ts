import { captureMediaUploaded } from "../site/analytics.js";
import { withChatPreview } from "../site/chat-preview.js";
import { sniffContentType } from "../content-type-sniffer.js";
import type { ImageCodecPort, MediaRecord, MediaProvenance } from "@jini-ai/core/contracts/site/cms-media";
import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";
import type { GeneratedImageBytes, ImageGenerationCredential, ImageGenerationPorts, MediaToolStoragePorts } from "@jini-ai/core/contracts/site/media-tool-ports";
import type { ToolFailureDiagnostic } from "@jini-ai/core/contracts/site/daemon-tool-recovery";
import { toolMetadata } from "@jini-ai/core/tool-metadata/media-generation";
import { buildDomainRegistrations, indexCatalogById, optionalBoolean, optionalString, requireInputRecord, requireString, requireToolPermission, withSchemaOnRejection, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolContributor, type ToolExecutionContext, type ToolHandler, type ToolPermissionAuthorizationPort, type ToolRegistration } from "@jini-ai/core";
import { buildMediaGenerationAgentToolCatalog } from "./agent-tools.js";
import { adaptLegacyAuthorize } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { uploadMedia, UploadMediaDeps } from "../media-service.js";
import type { getMediaProviderCredentials, resolveMediaProviderCredential, MediaProviderCredentialResolveDeps } from "../site/provider-credential-store.js";
import type { MediaProviderCredentialRepoPort } from "../site/provider-credential-contracts.js";
import type { MediaContentTypeStorePort } from "../site/content-type-store.js";
import type { MediaPublicUrlDeps } from "../site/contracts.js";

export interface MediaGenerationToolDeps {
  workspaceId: string;
  authorize: ToolPermissionAuthorizationPort;
  storage: MediaToolStoragePorts;
  providers: ImageGenerationPorts;
  tracker?: Tracker | undefined;
  imageCodec?: ImageCodecPort | undefined;
  findModel(required: { id: string }, optional?: Record<string, never>): { provider: string } | undefined;
  missingCredential(required: { providerId: string }, optional?: Record<string, never>): { generated: false; message: string; credentialSetup: ToolFailureDiagnostic };
}

export type MediaGenerationCatalogInput = { imageModelIds: readonly string[]; defaultModelId: string; mediaAssetReadToolId: string };

async function resolveCredentialForProvider({ routeDeps, providerId }: { routeDeps: MediaGenerationToolDeps; providerId: string }, _optional = {}): Promise<ImageGenerationCredential | null> {
  const { providers, workspaceId } = routeDeps;
  const saved = await providers.readSavedCredential({ workspaceId, providerId }, {});
  return saved === null
    ? providers.readEnvCredential({ providerId }, {})
    : saved;
}

/**
 * Resolves which image model to use as the DEFAULT when the caller omits `model` — the first
 * catalog model (in `imageModelIds` (`agent-tools.ts`'s `IMAGE_MODEL_IDS` rule over the live registry) order) whose provider actually has a REACHABLE
 * credential (saved row first, then env — same precedence {@link resolveCredentialForProvider}
 * itself applies), not simply the catalog's `default: true` entry regardless of whether anything
 * can actually generate with it. `IMAGE_MODEL_IDS` already starts with that `default: true` entry
 * (`gpt-image-2`/openai), so this still resolves to it whenever OpenAI's own credential is the one
 * that succeeds — unchanged from before this function existed. Falls back to
 * {@link DEFAULT_MODEL} only when NO provider anywhere has a resolvable credential; the caller then
 * gets the same "no credential configured" rejection as always, just for whichever provider was
 * actually tried rather than a provider hardcoded independent of what this workspace has configured.
 * A saved credential's own image model (Admin -> Media providers) wins first, in catalog order.
 *
 * Each DISTINCT provider is checked at most once ({@link checkedProviders}) rather than once per
 * model — `IMAGE_MODEL_IDS` spans ~20 distinct providers, so re-checking a provider that already
 * failed (or already won) for each of its other models would be wasted, catalog-bounded I/O.
 *
 * @complexity O(P) credential lookups, P = the number of distinct providers among
 *   `IMAGE_MODEL_IDS` — a fixed, catalog-bounded count, never caller-controlled.
 */
async function resolveDefaultImageModel({ routeDeps, imageModelIds, defaultModelId }: { routeDeps: MediaGenerationToolDeps; imageModelIds: readonly string[]; defaultModelId: string }, _optional = {}): Promise<string> {
  const saved = await routeDeps.providers.readSavedSelections({ workspaceId: routeDeps.workspaceId }, {});
  const savedModel = imageModelIds.find((id) => {
    const entry = saved[routeDeps.findModel({ id })?.provider ?? ""];
    return entry?.apiKeyConfigured === true && entry.model === id;
  });
  if (savedModel) return savedModel;
  const checkedProviders = new Set<string>();
  for (const modelId of imageModelIds) {
    // Non-null: every id in imageModelIds is derived from this same registry (agent-tools.ts).
    const model = routeDeps.findModel({ id: modelId }, {});
    if (model == null) throw new Error(`Media generation registry has no model ${modelId}`);
    const providerId = model.provider;
    if (checkedProviders.has(providerId)) continue;
    checkedProviders.add(providerId);
    const credential = await resolveCredentialForProvider({ routeDeps, providerId });
    if (credential) return modelId;
  }
  return defaultModelId;
}

const DOMAIN = "media-generation";

/**
 * This wiring layer's OWN risk classification, authored from what the one handler below actually
 * calls — see `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const mediaGenerationDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // -> resolveMediaProviderCredential (a decrypting read) + one outbound generation call to the
  // vendor's API + uploadMedia (mediaRepo.save/blobRepo.save/renditionRepo.save) +
  // mediaContentTypeStore.set. A genuine durable host-side write, same classification
  // media_upload_asset's own entry carries.
  ["media_generate_asset", "mutates-durable-state"],
]);

/**
 * Builds a filename for the generated asset from its prompt, so the uploaded asset's title
 * (`uploadMedia`'s own `deriveTitleFromFilename`, which strips the extension) reflects what was
 * actually generated rather than a generic placeholder. Bounded and sanitized: only
 * alphanumerics/spaces/hyphens survive, collapsed and trimmed, so a prompt containing path
 * separators, control characters, or pathological punctuation can never produce a surprising
 * filename — this value only ever reaches `uploadMedia`'s title-derivation, never a filesystem path.
 *
 * @complexity O(n) in `prompt.length`, once.
 */
function buildGeneratedFilename({ prompt }: { prompt: string }, _optional = {}): string {
  const slug = prompt
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${slug || "generated-image"}.png`;
}

/** The only rejection worth decorating with the published schema — a caller-supplied `model` outside
 *  `imageModelIds` (`agent-tools.ts`'s `IMAGE_MODEL_IDS` rule over the live registry), which a DIFFERENT input would fix. Everything else this handler can
 *  throw (no credential configured, a vendor/network failure, an upload validation failure) is not a
 *  shape problem and is deliberately NOT wrapped in this class. */
export class MediaGenerationValidationError extends Error {}

/**
 * Validates the optional `model` field against the published, catalog-derived enum — the
 * handler-level enforcement the published schema's own `enum` cannot itself guarantee (see
 * `agent-tools.ts`'s `IMAGE_MODEL_IDS` doc for why). `undefined` resolves through
 * {@link resolveDefaultImageModel} — a credential-aware default, not unconditionally
 * {@link DEFAULT_MODEL} — see that function's own doc for why.
 *
 * @throws {MediaGenerationValidationError} `raw` is present but not one of `IMAGE_MODEL_IDS`.
 * @complexity O(n) in `IMAGE_MODEL_IDS.length` for the explicit-model branch (a fixed,
 *   catalog-bounded set — a simple membership check, not worth a Set for a list this size); see
 *   {@link resolveDefaultImageModel}'s own complexity note for the omitted-`model` branch.
 */
async function requireImageModel({ raw, routeDeps, imageModelIds, defaultModelId }: { raw: string | undefined; routeDeps: MediaGenerationToolDeps; imageModelIds: readonly string[]; defaultModelId: string }, _optional = {}): Promise<string> {
  if (raw === undefined) return resolveDefaultImageModel({ routeDeps, imageModelIds, defaultModelId });
  if (!imageModelIds.includes(raw)) {
    throw new MediaGenerationValidationError(
      `'model' must be a registered image model — got '${raw}'. See this tool's own schema for the full list of ${imageModelIds.length} supported ids across every configured vendor.`
    );
  }
  return raw;
}

/**
 * What the media library records about where generated bytes came from. A real generation names the
 * model and the vendor the engine ACTUALLY used (`MediaGenerationResult.providerId`, which can differ
 * from the catalog's vendor when the engine routes through an override). A placeholder records
 * neither: no model drew those bytes, so the library must never credit one with them.
 *
 * @complexity O(1).
 */
function generatedProvenance(required: { model: string; generated: GeneratedImageBytes }, _options = {}): MediaProvenance {
  const { model, generated } = required;
  if (generated.usedStubFallback) return { kind: "generated" };
  return { kind: "generated", model, provider: generated.providerId };
}

/**
 * Uploads generated bytes through the SAME `uploadMedia` service human uploads use, then records the
 * sniffed content type and the upload analytics event.
 *
 * @returns The stored record and the sniffed content type of the actual bytes.
 * @complexity O(n) in the generated byte length (hash + sniff), plus the repo writes.
 */
async function storeGeneratedImage(
  required: { routeDeps: MediaGenerationToolDeps; ctx: ToolExecutionContext; input: Record<string, unknown>; prompt: string; generated: GeneratedImageBytes; provenance: MediaProvenance },
  _options = {}
): Promise<{ media: MediaRecord; sniffed: string }> {
  const { routeDeps, ctx, input, prompt, generated, provenance } = required;
  // A best-effort initial guess, corrected immediately below by a real sniff of the actual
  // bytes — most registered vendors return PNG (`dispatch/stub.ts`'s placeholder included),
  // but this is no longer an OpenAI-specific fact now that `model` can select any vendor.
  const contentType = "image/png";
  // A started multi-write storage sequence must not be interrupted halfway through.
  ctx.signal.throwIfAborted();
  const { media } = await routeDeps.storage.upload({
    input: {
      workspaceId: routeDeps.workspaceId,
      bytes: generated.bytes,
      filename: buildGeneratedFilename({ prompt }),
      contentType,
      alt: optionalString({ input: input, key: "alt" }),
      caption: optionalString({ input: input, key: "caption" }),
      credit: optionalString({ input: input, key: "credit" }),
      // A prompt is what was asked for, not what the bytes show, so only an explicit description is stored.
      description: optionalString({ input: input, key: "description" }),
      createdByPrincipal: ctx.principal.id,
      provenance,
    },
  }, {});

  // Same "record what the bytes actually are" write the host's `server/inbound/admin-http/routes/media/upload.ts` performs
  // after every human upload — see that route's own doc for why this is sniffed rather than
  // trusted from the (here, fixed) `contentType` string.
  const sniffed = sniffContentType({ bytes: generated.bytes });
  await routeDeps.storage.recordContentType({ workspaceId: routeDeps.workspaceId, sha256: media.source.sha256, contentType: sniffed }, {});
  captureMediaUploaded({ ...(routeDeps.tracker === undefined ? {} : { tracker: routeDeps.tracker }), actorId: ctx.principal.id, byteLength: generated.bytes.byteLength, kind: "image", source: "assistant" });
  return { media, sniffed };
}

/** What `media_generate_asset` returns — the SAME shape `media_upload_asset`/`media_list_assets`
 *  return (id/title/alt/caption/credit/sha256/status/version/publicUrl), so the model can chain
 *  straight into `media_update_metadata`/`media_trash_asset` off the returned `id` with no separate
 *  lookup, and use `publicUrl` to embed the image immediately. Declared locally rather than imported:
 *  `Jini packages/cms/src/media/tool-registrations.ts`'s own equivalent view type is not part of that
 *  package's public surface (an internal projection, not a contract this domain depends on). */
interface GeneratedMediaView {
  id: string;
  createdBy: string | null;
  /** The asset's short lookup name (2026-09-16) — a page marker can reference this instead of the
   *  long `id`; mirrors `@jini-ai/cms/media`'s own `MediaToolView.slug` addition. */
  slug: string;
  title: string;
  alt: string;
  caption: string;
  credit: string;
  sha256: string;
  status: string;
  version: number;
  publicUrl: string | null;
  /** `true` only when the engine's own stub fallback rendered a deterministic placeholder instead of
   *  a real image (`MediaGenerationResult.usedStubFallback`, only reachable with `allowStubFallback`
   *  explicitly set — see `GENERATE_SCHEMA`). A placeholder must never be mistaken for a real
   *  generation, so this travels on every response rather than being omitted on the common path. */
  placeholder: boolean;
}

/** Projects the stored record into {@link GeneratedMediaView}. @complexity O(1). */
function toGeneratedMediaView(required: { media: MediaRecord; publicUrl: string | null; placeholder: boolean }, _options = {}): GeneratedMediaView {
  const { media, publicUrl, placeholder } = required;
  return {
    id: media.id,
    createdBy: media.createdBy ?? null,
    slug: media.slug,
    title: media.title,
    alt: media.alt,
    caption: media.caption,
    credit: media.credit,
    sha256: media.source.sha256,
    status: media.status,
    version: media.version,
    publicUrl,
    placeholder,
  };
}

async function executeGeneration(
  { routeDeps, ctx, input, prompt, catalogInput }: { routeDeps: MediaGenerationToolDeps; ctx: ToolExecutionContext; input: Record<string, unknown>; prompt: string; catalogInput: MediaGenerationCatalogInput },
  _optional: Record<string, never> = {},
): Promise<unknown> {
  const model = await requireImageModel({ raw: optionalString({ input: input, key: "model" }), routeDeps, imageModelIds: catalogInput.imageModelIds, defaultModelId: catalogInput.defaultModelId });
  const allowStubFallback = optionalBoolean({ input, key: "allowStubFallback" }) ?? false;
  // Guaranteed non-null: `model` was just validated against `imageModelIds`, itself
  // derived from this same registry (`agent-tools.ts`'s own doc for both).
  const registeredModel = routeDeps.findModel({ id: model }, {});
  if (registeredModel == null) throw new Error(`Media generation registry has no model ${model}`);
  const providerId = registeredModel.provider;

  const credential = await resolveCredentialForProvider({ routeDeps, providerId });
  if (!credential && !allowStubFallback) {
    return routeDeps.missingCredential({ providerId }, {});
  }

  // Waiting on credentials opens a fresh cancellation window.
  ctx.signal.throwIfAborted();
  const generated = await routeDeps.providers.generateImage({ model, prompt, providerId, credentials: credential ?? {}, allowStubFallback }, { signal: ctx.signal });

  const { media, sniffed } = await storeGeneratedImage({ routeDeps, ctx, input, prompt, generated, provenance: generatedProvenance({ model, generated }) });

  const urls = await routeDeps.storage.resolvePublicUrls({ assets: [media] }, {});
  // `model`/`provider` let the assistant tell the user which generator it used; `provider` is
  // the vendor the engine actually ran, reported even for a placeholder (`media.placeholder`).
  const result: { media: GeneratedMediaView; model: string; provider: string } = {
    model,
    provider: generated.providerId,
    media: toGeneratedMediaView({ media, publicUrl: urls.get(media.id) ?? null, placeholder: generated.usedStubFallback }),
  };
  return withChatPreview({ routeDeps, bytes: generated.bytes, contentType: sniffed, result });
}

export function buildMediaGenerationRegistrations(
  { deps: routeDeps, catalogInput }: { deps: MediaGenerationToolDeps; catalogInput: MediaGenerationCatalogInput },
  _optional: Record<string, never> = {},
): ToolRegistration[] {
  const CATALOG_BY_ID = indexCatalogById({ catalog: buildMediaGenerationAgentToolCatalog(catalogInput) });
  const handlers: Record<string, ToolHandler> = {
    media_generate_asset: async (ctx) => {
      const input = requireInputRecord({ input: ctx.input });
      const prompt = requireString({ input: input, key: "prompt" });
      await requireToolPermission({ authorize: routeDeps.authorize, workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: "media.upload" }, { entityType: "media" });

      return withSchemaOnRejection({ toolId: "media_generate_asset", catalog: CATALOG_BY_ID,
        isShapeRejection: ({ error }) => error instanceof MediaGenerationValidationError,
        fn: () => executeGeneration({ routeDeps, ctx, input, prompt, catalogInput }),
      });
    },
  };

  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: DOMAIN,
    catalogModule: "@jini-ai/cms/media/site-generation/agent-tools",
    catalog: CATALOG_BY_ID,
    handlers,
    derivedRisk: mediaGenerationDerivedRisk,
  });
}

/**
 * Contributes `media-generation`'s AI tools to the assistant's catalog — called once by
 * `server/runtime/composition/tool-catalog-manifest.ts`'s `installFirstPartyToolContributors()`,
 * not by importing this module.
 */
export function contributeMediaGenerationTools<D>(
  { bind }: { bind: (required: { deps: D }, optional?: Record<string, never>) => { deps: MediaGenerationToolDeps; catalogInput: MediaGenerationCatalogInput } },
  _optional: Record<string, never> = {},
): ToolContributor<D, unknown> {
  return { domain: DOMAIN, build: (deps) => buildMediaGenerationRegistrations(bind({ deps }, {})), risk: mediaGenerationDerivedRisk };
}

export function bindMediaGenerationTools<TRegistry extends object = object>(required: {
  imageModelIds: readonly string[]; defaultModelId: string; mediaAssetReadToolId: string;
  imageModelIdsFrom(required: { catalog: TRegistry }): readonly string[];
  findModel(required: { registry: TRegistry; id: string }): { provider: string } | undefined;
  uploadMedia: typeof uploadMedia; uploadCaps: Parameters<typeof uploadMedia>[1];
  credentialBindings: Omit<MediaProviderCredentialResolveDeps, "repo" | "sealer">;
  getMediaProviderCredentials: typeof getMediaProviderCredentials; resolveMediaProviderCredential: typeof resolveMediaProviderCredential;
  resolveProviderCredentialsFromEnv(required: { providerId: string; env: Record<string, string | undefined> }, optional: { envVars: Readonly<Record<string, readonly string[]>>; aliases: Readonly<Record<string, string>> }): ImageGenerationCredential;
  readEnvironment(): Record<string, string | undefined>; envVars: Readonly<Record<string, readonly string[]>>; aliases: Readonly<Record<string, string>>;
  buildNoCredentialError(required: { providerId: string; registry: TRegistry }): { message: string };
  issueCredentialSetup(required: { setupToolId: string; prefill: { kind: string; target: string } }, optional: Record<string, never>): ToolFailureDiagnostic;
  defaultGenerateMedia(required: { request: { surface: "image"; model: string; prompt: string }; credentials: ImageGenerationCredential; options: { providerId: string; allowStubFallback: boolean; httpClient: HttpClientPort; registry: TRegistry } }, optional: { signal: AbortSignal }): Promise<GeneratedImageBytes>;
}, _optional: Record<string, never> = {}) {
  const bind = ({ deps: routeDeps, resolvePublicUrls }: { deps: Omit<UploadMediaDeps, "blobRepo" | "renditionRepo"> & {
    authorize: AuthorizeFn; tracker?: Tracker; imageCodec?: ImageCodecPort; mediaGenerationHttpClient: HttpClientPort;
    mediaProviderRegistry: TRegistry | undefined; assetBlobRepo: UploadMediaDeps["blobRepo"]; assetRenditionRepo: UploadMediaDeps["renditionRepo"];
    mediaContentTypeStore: MediaContentTypeStorePort; mediaProviderCredentialRepo: MediaProviderCredentialRepoPort; siteAssistantSecretSealer: MediaProviderCredentialResolveDeps["sealer"];
    workspaceId: string; env?: Record<string, string | undefined>;
    generateMedia?(input: Parameters<typeof required.defaultGenerateMedia>[0], optional: { signal: AbortSignal }): Promise<GeneratedImageBytes>;
  }; resolvePublicUrls: (required: { deps: MediaPublicUrlDeps & { workspaceId: string }; assets: readonly MediaRecord[] }, optional?: Record<string, never>) => Promise<Map<string, string | null>> }): { deps: MediaGenerationToolDeps; catalogInput: MediaGenerationCatalogInput } => {
    const registry = routeDeps.mediaProviderRegistry;
    return { catalogInput: { imageModelIds: registry === undefined ? required.imageModelIds : required.imageModelIdsFrom({ catalog: registry }), defaultModelId: required.defaultModelId, mediaAssetReadToolId: required.mediaAssetReadToolId }, deps: {
      get workspaceId() { return routeDeps.workspaceId; }, get authorize() { return adaptLegacyAuthorize({ authorize: routeDeps.authorize }); },
      get tracker() { return routeDeps.tracker; }, get imageCodec() { return routeDeps.imageCodec; },
      findModel: ({ id }) => required.findModel({ registry: registry!, id }),
      missingCredential: ({ providerId }) => ({ generated: false, message: required.buildNoCredentialError({ providerId, registry: registry! }).message,
        credentialSetup: required.issueCredentialSetup({ setupToolId: "credential_save", prefill: { kind: "media-provider", target: providerId } }, {}) }),
      storage: { upload: ({ input }) => required.uploadMedia({ deps: { clock: routeDeps.clock, idGen: routeDeps.idGen, mediaRepo: routeDeps.mediaRepo, blobRepo: routeDeps.assetBlobRepo, renditionRepo: routeDeps.assetRenditionRepo, blobStore: routeDeps.blobStore }, input }, required.uploadCaps),
        recordContentType: input => routeDeps.mediaContentTypeStore.set(input), resolvePublicUrls: input => resolvePublicUrls({ deps: routeDeps, ...input }) },
      providers: { readSavedSelections: input => required.getMediaProviderCredentials({ deps: { ...required.credentialBindings, repo: routeDeps.mediaProviderCredentialRepo }, ...input }),
        readSavedCredential: ({ workspaceId, providerId }) => required.resolveMediaProviderCredential({ deps: { ...required.credentialBindings, repo: routeDeps.mediaProviderCredentialRepo, sealer: routeDeps.siteAssistantSecretSealer }, workspaceId, providerId }).then(saved => saved ? { apiKey: saved.apiKey, ...(saved.baseUrl ? { baseUrl: saved.baseUrl } : {}) } : null),
        readEnvCredential: ({ providerId }) => (fromEnv => fromEnv.apiKey ? fromEnv : null)(required.resolveProviderCredentialsFromEnv({ providerId, env: routeDeps.env ?? required.readEnvironment() }, { envVars: required.envVars, aliases: required.aliases })),
        generateImage: ({ model, prompt, providerId, credentials, allowStubFallback }, optional) => (routeDeps.generateMedia ?? required.defaultGenerateMedia)({ request: { surface: "image", model, prompt }, credentials, options: { providerId, allowStubFallback, httpClient: routeDeps.mediaGenerationHttpClient, registry: registry! } }, optional),
      },
    } };
  };
  return {
    buildMediaGenerationRegistrations: (routeDeps: Parameters<typeof bind>[0]["deps"], { resolvePublicUrls }: Pick<Parameters<typeof bind>[0], "resolvePublicUrls">) => buildMediaGenerationRegistrations(bind({ deps: routeDeps, resolvePublicUrls })),
    contributeMediaGenerationTools: ({ resolvePublicUrls }: Pick<Parameters<typeof bind>[0], "resolvePublicUrls">, _optional: Record<string, never> = {}) => contributeMediaGenerationTools({ bind: ({ deps }: Pick<Parameters<typeof bind>[0], "deps">) => bind({ deps, resolvePublicUrls }) }),
  };
}
