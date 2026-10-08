import type { ContentTypeFieldDef, ContentTypeRecord } from "../../content-types/index.js";
import type { EntryRecord, EntryStatus } from "../../entries/index.js";
import type { resolveMenuDoc } from "../../navigation/index.js";

/** The host's navigation resolver, retained as its owning function's type. */
export interface MenusPort { resolveMenuDoc: typeof resolveMenuDoc; }

export type CollectionListLayout = "cards" | "list" | "accordion" | "carousel";
export interface CollectionListQuery {
  readonly type: string;
  readonly where: readonly { readonly field: string; readonly value: string | number | boolean }[];
  readonly sort: { readonly by: "published" | "updated" | "title" | { readonly field: string }; readonly dir: "asc" | "desc" };
  readonly limit: number;
}
export interface EntryDisplayListPort {
  listPublishedForDisplay(required: { readonly workspaceId: string; readonly query: CollectionListQuery }): Promise<EntryRecord[]>;
}
export interface EntryListExcludingTypesPort {
  listByWorkspaceExcludingTypes(required: {
    readonly workspaceId: string; readonly excludeTypes: readonly string[]; readonly status?: EntryStatus;
    readonly orderBy?: "updatedAt"; readonly orderDirection?: "asc" | "desc"; readonly limit?: number;
  }): Promise<EntryRecord[]>;
}
/** Collection parsing, routing and display policy remain with the host's existing public-list owner. */
export interface CollectionListPort {
  parseCollectionListConfig(config: unknown, contentType: ContentTypeRecord, options?: { readonly defaultSort?: string; readonly limitKey?: string }):
    | { readonly ok: false; readonly reason: string }
    | { readonly ok: true; readonly query: CollectionListQuery; readonly display: { readonly columns: number; readonly layout: CollectionListLayout; readonly fields: readonly ContentTypeFieldDef[]; readonly structuredData?: "faq-page" } };
  entryPublicHref(type: string, slug: string): string | null;
  humanizeFieldName(name: string): string;
  isCollectionListLayout(value: unknown): value is CollectionListLayout;
  readonly systemContentTypes: readonly string[];
}
/** Definitions are opaque read snapshots. Submission and notification behavior stays with Forms. */
export interface FormDefinitionView {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
  readonly fields: readonly unknown[];
  readonly mode?: string;
  readonly html?: string | null;
}
/** Both lookup methods are used by today's resolver (id first, then authored slug). */
export interface FormDefinitionReadPort {
  findById(required: { workspaceId: string; id: string }): Promise<FormDefinitionView | null>;
  findBySlug(required: { workspaceId: string; slug: string }): Promise<FormDefinitionView | null>;
}
