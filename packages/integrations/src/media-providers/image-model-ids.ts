import { IMAGE_MODELS, findProvider } from './providers.js';

/** The two catalogue reads the image-model rule needs: structurally a `MediaModelCatalog` /
 *  `MediaProviderRegistry`, declared here so this file stays inside the dependency-free catalog graph. */
export interface ImageModelCatalog {
  modelsForSurface(required: { surface: "image" }): readonly { readonly id: string; readonly provider: string }[];
  findProvider(required: { id: string }): { readonly integrated: boolean } | null;
}

/**
 * Every image model in `catalog` whose vendor the catalogue itself marks `integrated` (a real vendor,
 * not a planned/placeholder entry). A host advertising an image tool uses this as the `model` enum AND
 * re-checks the caller's `model` against it in the handler: a tool schema's `enum` is descriptive only
 * (the kernel neither parses nor validates a tool's schema), so a model outside this set must be
 * rejected there. Catalogue order is kept: it is the default-model resolution order. Pass the live
 * provider registry so plugin-contributed vendors' image models are included.
 * @complexity O(m) image models.
 */
export function imageModelIdsFrom({ catalog }: { catalog: ImageModelCatalog }, _optional: Record<string, never> = {}): string[] {
  return catalog.modelsForSurface({ surface: "image" })
    .filter((model) => catalog.findProvider({ id: model.provider })?.integrated === true)
    .map((model) => model.id);
}

/**
 * {@link imageModelIdsFrom} over the built-in catalogue, computed at import time. `integrated` is a
 * reliable proxy for "the dispatch engine has a real adapter": every image-surface provider marked
 * `integrated: true` has an adapter registered in the dispatch engine's vendor registry (which this
 * dependency-free subpath deliberately does not import), and the `providers.test.ts` adapter-coverage
 * assertion fails if the catalogue claims a vendor the engine cannot render.
 */
export const IMAGE_MODEL_IDS: readonly string[] = imageModelIdsFrom({ catalog: { modelsForSurface: () => IMAGE_MODELS, findProvider } });
