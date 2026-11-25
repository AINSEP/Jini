/**
 * @file The structural kit the xAI media plugin is built from. Why: a provider plugin may import only
 * `@jini-ai/core` and `@jini-ai/protocol`, so the media dispatch helpers (credential guard, raw-bytes
 * parser, OpenAI-compatible wire helpers, catalogue contribution) are injected by the host composition
 * rather than imported from `@jini-ai/integrations`. The types here are the minimum the Grok adapters
 * read; the host's real `integrations/media-providers` values satisfy them structurally, and the render
 * context stays generic (`Ctx`) because the host's helpers thread the whole context to the outbound client.
 */

/** The credential fields the xAI adapters read. */
export interface XaiCredentials {
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

/** The render-context fields the xAI adapters read; the host's context carries many more. */
export interface XaiRenderContext {
  readonly wireModel: string;
  readonly prompt: string;
  readonly aspect: string | undefined;
  readonly voice: string;
  readonly language: string;
}

/** What one adapter returns: the media bytes, a note for the operator and an optional file extension. */
export interface XaiRenderResult {
  readonly bytes: Buffer;
  readonly providerNote: string;
  readonly suggestedExt?: string;
}

/** The request an adapter builds, plus the `meta` its response parser reads back. */
export interface XaiVendorRequest<Meta> {
  readonly url: string;
  readonly init: RequestInit;
  readonly meta: Meta;
}

/** Turns the vendor response into a result, or throws a vendor-tagged error. */
export type XaiResponseParser<Meta, Ctx> = (required: { resp: Response; ctx: Ctx; request: XaiVendorRequest<Meta> }) => Promise<XaiRenderResult>;

/** Throws before any network call when the credentials are unusable. */
export type XaiCredentialGuard = (required: { credentials: XaiCredentials }) => void;

/** One vendor route: credential guard, request shape and response parsing. */
export interface XaiVendorAdapter<Meta, Ctx> {
  readonly requireCredential?: XaiCredentialGuard;
  readonly buildRequest: (required: { ctx: Ctx; credentials: XaiCredentials }) => XaiVendorRequest<Meta>;
  readonly parseResponse: XaiResponseParser<Meta, Ctx>;
}

/** The options of the raw-bytes response parser the TTS route uses. */
export interface XaiRawBytesParserOptions<Meta> {
  readonly errorTag: string;
  readonly zeroBytesMessage: string;
  readonly note: (required: { bytes: Buffer; meta: Meta }) => string;
  readonly suggestedExt: string;
}

/**
 * The dispatch helpers the host injects. `Ctx` is the host's render context; `Contribution` is whatever
 * the host's catalogue helper returns for the media-provider registry (the plugin never inspects it).
 */
export interface XaiMediaKit<Ctx extends XaiRenderContext, Contribution> {
  requireApiKey(required: { message: string }): XaiCredentialGuard;
  createRawBytesParser<Meta>(options: XaiRawBytesParserOptions<Meta>): XaiResponseParser<Meta, Ctx>;
  jsonPostInit(required: { ctx: Ctx; body: unknown }, optional?: { apiKey?: string }): RequestInit;
  buildOpenAIImageUrl(required: { baseUrl: string; isAzure: boolean }): string;
  parseOpenAICompatibleJson(required: { resp: Response; providerTag: string }): Promise<unknown>;
  bytesFromOpenAICompatibleData(required: { data: unknown; providerTag: string }, ctx: Ctx): Promise<Buffer>;
  sniffImageExt(bytes: Buffer): string;
  standardImageAspectFor(required: { aspect: string | undefined }): string;
  dispatchVendorRequest<Meta>(required: { adapter: XaiVendorAdapter<Meta, Ctx>; ctx: Ctx; credentials: XaiCredentials }): Promise<XaiRenderResult>;
  catalogMediaProviderContribution(required: { providerId: string; adapters: Readonly<Record<string, XaiVendorAdapter<never, Ctx>>> }): Contribution;
}
