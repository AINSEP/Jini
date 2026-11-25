/**
 * @file The xAI plugin's `media` contribution (provider-plugin contract `media`): the Grok image and
 * text-to-speech adapters, shaped as one media-provider contribution for the host's media-provider registry.
 *
 * Why here: the engine ships no vendor of its own for this row. A host binds it at composition
 * (`createMediaProviderRegistry({}, { contributions: [...builtinMediaProviderContributions(), createXaiMediaContribution({ kit })] })`),
 * so a host that does not contribute it has no Grok availability, and the engine never selects it.
 * The catalogue row and model ids are generic reference data owned by `@jini-ai/integrations`; the kit's
 * `catalogMediaProviderContribution` attaches them so media kind ids, list order and availability are the
 * ones the engine registered before this move. The plugin imports nothing from `@jini-ai/integrations`
 * (a provider plugin may import only core and protocol): the host injects the dispatch helpers as `kit`.
 */
import { createGrokImageAdapter, createXaiTTSAdapter } from './grok.js';
import type { XaiMediaKit, XaiRenderContext, XaiVendorAdapter } from './kit.js';

/** The catalogue provider id (not the vendor-plugin id): saved credentials and env maps key on it. */
export const XAI_MEDIA_PROVIDER_ID = 'grok';

/**
 * The xAI media contribution, with the image and `audio:speech` routes bound.
 * @returns A fresh contribution of the kit's contribution type; the adapters are built fresh from the kit.
 * @throws {Error} When the kit's catalogue has no `grok` provider.
 * @complexity O(p + m) over the catalogue.
 */
export function createXaiMediaContribution<Ctx extends XaiRenderContext, Contribution>(
  { kit }: { kit: XaiMediaKit<Ctx, Contribution> },
  _optional: Record<string, never> = {},
): Contribution {
  // The registry keys adapters by route and erases each adapter's `meta` type (an adapter reads back only the meta it built).
  const erase = <Meta,>(adapter: XaiVendorAdapter<Meta, Ctx>) => adapter as unknown as XaiVendorAdapter<never, Ctx>;
  return kit.catalogMediaProviderContribution({
    providerId: XAI_MEDIA_PROVIDER_ID,
    adapters: { image: erase(createGrokImageAdapter({ kit })), 'audio:speech': erase(createXaiTTSAdapter({ kit })) },
  });
}

export { createGrokImageAdapter, createXaiTTSAdapter } from './grok.js';
export type {
  XaiCredentials, XaiCredentialGuard, XaiMediaKit, XaiRawBytesParserOptions, XaiRenderContext, XaiRenderResult,
  XaiResponseParser, XaiVendorAdapter, XaiVendorRequest,
} from './kit.js';
