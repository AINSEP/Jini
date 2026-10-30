/** Vendor-neutral pixel operations. Hosts inject the codec; importing this port loads no native binary. */
export interface ImageCodecLimits { maxInputPixels?: number; timeoutSeconds?: number }
export interface ImageMetadata {
  format?: string; width: number; height: number; hasAlpha: boolean; orientation?: number;
  autoOrient: { width: number; height: number };
}
export interface EncodedImage { bytes: Uint8Array; width: number; height: number }
export interface ImageGeometry {
  autoOrient?: boolean;
  extract?: { left: number; top: number; width: number; height: number };
  rotate?: number; flip?: boolean; flop?: boolean; background?: string;
  resize?: { width?: number; height?: number; fit?: "cover" | "contain" | "inside" | "outside" | "fill"; position?: string; withoutEnlargement?: boolean };
}
export interface ImageEncodeInput extends ImageGeometry {
  source: Uint8Array; format: "png" | "jpeg" | "webp" | "avif";
  quality?: number; stripMetadata?: boolean; flatten?: { background: string };
}
export interface ImageTileInput { source: Uint8Array; maxWidth: number; tileHeight: number }
export interface ImageCodecPort {
  inspect(input: { source: Uint8Array }, options?: ImageCodecLimits): Promise<ImageMetadata>;
  encode(input: ImageEncodeInput, options?: ImageCodecLimits): Promise<EncodedImage>;
  encodeTiles(input: ImageTileInput, options?: { quality?: number }): Promise<(EncodedImage & { top: number })[]>;
}
