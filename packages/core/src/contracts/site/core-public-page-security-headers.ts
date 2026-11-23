/** @file The shipped theme resource origins the public-page security headers are built from. */

/** Shipped theme resource data, shared by live headers and static exports. */
export interface PublicThemeResources {
  readonly scripts: readonly string[];
  readonly styles: readonly string[];
  readonly fonts: readonly string[];
  readonly fontPreconnects: Readonly<Record<string, readonly { readonly url: string; readonly crossorigin?: boolean }[]>>;
  readonly legacyFontStylesheetTemplate?: string;
}
