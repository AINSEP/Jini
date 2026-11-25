/** A theme as the asset tools see it: its folder and the verdict a reload returns. */
export interface AssetTheme { readonly dir: string; readonly status: unknown; readonly errors?: unknown }
export interface AssetFile<B extends Uint8Array> { path: string; bytes: B; sourceUrl?: string }
export type OverwritePolicy = "skip" | "overwrite" | "rename";
export type AssetDestination = { kind: "theme"; themeId: string } | { kind: "site" | "media" | "library" | "picked" };
export type PreparedAssetBatch<B extends Uint8Array> = {
  readonly folder: string;
  readonly writes: readonly { readonly path: string; readonly bytes: B; readonly overwrite: boolean }[];
};
export type PreparedAssets<B extends Uint8Array> = {
  destination: AssetDestination;
  files: AssetFile<B>[];
  skipped: string[];
  batch?: PreparedAssetBatch<B>;
};
export interface AssetSourceSchema {
  readonly type: "object";
  readonly additionalProperties: false;
  readonly required: readonly string[];
  readonly properties: {
    readonly root: { readonly type: "string"; readonly enum: readonly string[] };
    readonly path: { readonly type: "string"; readonly minLength: number; readonly description: string };
    readonly themeId: { readonly type: "string"; readonly minLength: number; readonly description: string };
  };
}
