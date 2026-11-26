import type { MediaProviderOption } from "@jini-ai/core";
import { I18nProvider, MediaProvidersTab, SETTINGS_DIALOG_DICTIONARIES } from "@jini-ai/ui";

import type { ComponentProps } from "react";

/** No cards until the host answers: an empty list, never a stale built-in roster. */
const NO_PROVIDERS: readonly MediaProviderOption[] = [];

/**
 * The "External Providers" tab body — credentials for outside media generation services (API
 * keys for image/video/audio-generation vendors), extracted the same way `MediaToolbar`/
 * `MediaGridOrEmpty` above are: an independent branch of `Media`'s own render, scored in its own
 * scope.
 *
 * Landed here 2026-09-10 (owner call, second pass) after one day on
 * `features/providers/Providers.tsx` as its "Media" tab — see that file's own header for the full
 * move history, and `media-provider-catalog.ts`/`media-providers-port.ts` (both moved into this
 * feature alongside it) for why the catalog is keyed off the generation engine's own spellings, not
 * `@jini-ai/ui`'s sample one.
 *
 * `I18nProvider` is load-bearing here, not decoration — same trap `Providers.tsx`'s own header
 * documents in full: `MediaProvidersTab` resolves its own copy through `@jini-ai/ui`'s `useT()`,
 * which silently falls through to raw English keys with no ancestor provider, in every non-English
 * locale, with no error anywhere. Classic's light pin on the inner wrapper is the same
 * `media-providers-panel` class `styles.css`'s "Media providers tab: neutralize Jini's warm 'paper'
 * tokens" section targets — kept byte-for-byte through both moves so that CSS keeps applying
 * unmoved. Glass follows the document scheme through the shared controller boundary instead.
 *
 * Moved out of `Media.tsx` (2026-11-25) when its cards stopped coming from a static import: `catalog`
 * is now the host's live provider catalog (`useMediaProviderCatalog`), the same array `Media` counts
 * for the tab badge, so a plugin-mounted vendor gets exactly one card and one count entry.
 */
export function ExternalProvidersPanel({ locale, catalog, useAdminThemeBoundaryHook, mediaProvidersPort, mediaProviderCatalogPolicy, pinnedProviderIds }: {
  locale: string;
  catalog: readonly MediaProviderOption[] | null;
  useAdminThemeBoundaryHook: (required: Record<string, never>, optional: Record<string, never>) => { "data-theme": string; "data-color-scheme"?: string };
  mediaProvidersPort: ComponentProps<typeof MediaProvidersTab>["port"];
  mediaProviderCatalogPolicy: NonNullable<ComponentProps<typeof MediaProvidersTab>["catalogPolicy"]>;
  pinnedProviderIds: NonNullable<ComponentProps<typeof MediaProvidersTab>["pinnedProviderIds"]>;
}, _optional = {}) {
  const themeBoundary = useAdminThemeBoundaryHook({}, {});
  return (
    <I18nProvider
      initialLocale={locale}
      dictionaries={SETTINGS_DIALOG_DICTIONARIES}
      fallbackLocale="en"
      syncDocumentAttributes={false}
    >
      <div className="media-providers-panel" {...themeBoundary}>
        <MediaProvidersTab port={mediaProvidersPort} catalog={catalog ?? NO_PROVIDERS} catalogPolicy={mediaProviderCatalogPolicy} pinnedProviderIds={pinnedProviderIds} />
      </div>
    </I18nProvider>
  );
}
