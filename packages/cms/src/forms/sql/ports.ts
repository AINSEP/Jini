/** What the retention adapter needs from its host's database toolkit; the host binds it (dialect catalogs differ). */
export type ColumnCatalogPort = (required: { table: string }) => Promise<readonly { readonly name: string; readonly notNull: boolean }[]>;
