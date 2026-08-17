import type { Catalog, ComponentKind } from './protocol.js';
import type { InteractiveUiRegistry } from '../interactive-ui/registry.js';

export interface BuildA2uiCatalogFromRegistryOptions {
  /**
   * A catalog to merge registry components into — typically `createLabCatalog()`, so the result
   * has both the 18 basic layout/text primitives (`Row`/`Column`/`Card`/`Text`/`Button`/etc.) AND
   * registry-sourced components (`native.data-table`, `shadcn.data-table`). Without a `base`, the
   * result has only registry components, which is enough to validate/resolve one in isolation but
   * cannot compose a tree — a table alone isn't a page, it needs a container to sit in. Omitted
   * entirely (not defaulted to `createLabCatalog()` here) so a caller that only ever wants
   * registry components — the manifests-only MCP search path, for one — doesn't pull in basic-type
   * schemas it will never use. `functions` come from `base` unchanged; registry components don't
   * define any of their own.
   */
  readonly base?: Catalog;
}

/**
 * Builds an A2UI `Catalog` from an `InteractiveUiRegistry`'s current entries — each registered
 * component becomes a catalog component type keyed by its manifest `id` (e.g.
 * `"native.data-table"`), reusing the manifest's own zod `propsSchema` directly rather than
 * re-declaring it.
 *
 * `kind` is deliberately always `'container'` — the closed `ComponentKind` union (text/button/
 * image/etc., see `catalog.ts`) is a rendering hint for the 18 basic-catalog primitives, not
 * something richer registry-sourced components map onto cleanly. `renderer.tsx` never reads
 * `kind` for these entries anyway — it resolves by matching `component.component` directly
 * against the registry, so this is a documented simplification, not a load-bearing choice.
 */
export function buildA2uiCatalogFromRegistry(
  registry: InteractiveUiRegistry,
  catalogId: string,
  options: BuildA2uiCatalogFromRegistryOptions = {},
): Catalog {
  const registryComponents = registry.list().map(
    (entry): readonly [string, { kind: ComponentKind; propsSchema: typeof entry.propsSchema }] => [
      entry.id,
      { kind: 'container' as ComponentKind, propsSchema: entry.propsSchema },
    ],
  );
  const { base } = options;
  return {
    catalogId,
    components: base ? new Map([...base.components, ...registryComponents]) : new Map(registryComponents),
    functions: base ? base.functions : new Map(),
  };
}
