import type { EntryDisplayListPort, EntryListExcludingTypesPort, CollectionListPort, MenusPort, FormDefinitionReadPort } from "./ports.js";
import type { EntryListPort } from "../../entries/index.js";

import type { NavMenuReadModel, ResolveTargetHrefFn } from "../../navigation/index.js";
import type { WidgetResolver, WidgetTypeKey } from "../types.js";
import { createContactFormResolver } from "./contact-form.js";
import { createMenuResolver } from "./menu.js";
import { createRecentEntriesResolver, type ContentTypeLookup } from "./recent-entries.js";

/**
 * @file Assembles the real, DI'd v1 dynamic resolvers against real infrastructure deps.
 *
 * Purpose:
 * The one place that turns "real repo adapters" into "the closed `CORE_RESOLVERS` map"
 * (`resolvers/index.ts`'s `wireCoreResolvers` calls this). Kept separate from `index.ts` itself so
 * the dispatch module (`resolveWidgetType`, exercised by every test in this slice) has no
 * import-time dependency on `features/entries`/`navigation`/`forms` deps that a pure dispatch unit
 * test would otherwise need to construct.
 */
export interface CoreResolverDeps {
  menus: MenusPort;
  collectionList: CollectionListPort;
  resolveMenuTargetHref?: ResolveTargetHrefFn;
  /** Widened by collections plan R1 with `EntryDisplayListPort` — the `recent-entries` widget's
   * "Collection list" mode shares `EntryDisplayListPort.listPublishedForDisplay` with the
   * `{"type":"collection"}` marker (C2). Widened again by review fix 3b with
   * `EntryListExcludingTypesPort`, the legacy (no-`collection`) path's query-level
   * `SYSTEM_CONTENT_TYPES` exclusion. Both composition roots' real `entryRepo` already implements
   * all three (`server/runtime/composition/{app,deps}.ts`'s `TrashAwareInMemoryEntryRepo`/`SqliteEntryRepo`). */
  entryList: EntryListPort & EntryDisplayListPort & EntryListExcludingTypesPort;
  navMenuReadModel: NavMenuReadModel;
  formDefinitionRepo: FormDefinitionReadPort;
  /** R1 addition — resolves a `collection` config's target content type. See `recent-entries.ts`'s
   * `ContentTypeLookup` for why this is its own narrow port rather than `ContentTypeRepoPort`. */
  contentTypes: ContentTypeLookup;
}

export function createCoreResolvers(deps: CoreResolverDeps, _optional: Record<string, never> = {}): Partial<Record<WidgetTypeKey, WidgetResolver>> {
  return {
    "recent-entries": createRecentEntriesResolver({ collectionList: deps.collectionList, entryList: deps.entryList, contentTypes: deps.contentTypes }),
    menu: createMenuResolver({ menus: deps.menus, navMenuReadModel: deps.navMenuReadModel, ...(deps.resolveMenuTargetHref === undefined ? {} : { resolveTargetHref: deps.resolveMenuTargetHref }), publicOnly: true }),
    "contact-form": createContactFormResolver({ formDefinitionRepo: deps.formDefinitionRepo }),
  };
}
