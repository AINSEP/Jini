// Small hex-color math primitives: normalization, RGB decoding, a perceptual
// luminance heuristic, and weighted hex mixing. Used for deriving readable
// text/border/muted shades from an arbitrary source color (e.g. a generated
// or user-picked accent) without a full color-management library.
//
// `luminance()` here is the ITU-R BT.709 luma formula applied directly to
// gamma-encoded (sRGB) channel values — a fast perceptual-brightness
// approximation, NOT the WCAG 2.x "relative luminance" definition (which
// first linearizes each channel through the sRGB gamma curve). Preserved
// as-is from the origin implementation rather than "corrected" to the WCAG
// formula, since that would change every derived color's output.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Extracts and normalizes the first 3/6/8-digit hex color found anywhere in
 * `value` (e.g. pulled out of a longer string like `"color: #fff;"`) to a
 * lowercase `#rrggbb` string. An 8-digit match (`#rrggbbaa`) has its alpha
 * channel dropped. Returns `null` if `value` is undefined or contains no
 * hex-color-shaped substring.
 */
export function normalizeHex({ value }: { value: string | undefined }): string | null {
  const match = value?.match(/#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b/);
  if (!match) return null;
  const raw = match[0].toLowerCase();
  if (raw.length === 4) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  if (raw.length === 9) return raw.slice(0, 7);
  return raw;
}

/** Decodes a hex color string to `{ r, g, b }` (0-255 each), or `null` if it doesn't normalize to a valid hex color. */
export function hexToRgb({ hex }: { hex: string }): Rgb | null {
  const normalized = normalizeHex({ value: hex });
  if (!normalized) return null;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

/**
 * Perceptual luminance of `hex` in `[0, 1]` via the ITU-R BT.709 luma
 * weights (0.2126R + 0.7152G + 0.0722B). Not true WCAG relative luminance —
 * see the module doc comment. Returns `1` (treated as "light") if `hex`
 * doesn't decode to a valid color.
 */
export function luminance({ hex }: { hex: string }): number {
  const rgb = hexToRgb({ hex });
  if (!rgb) return 1;
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

/** Clamps `value` to `[0, 255]` and formats it as a 2-digit lowercase hex byte. */
export function toHexByte({ value }: { value: number }): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
}

/**
 * Linearly mixes `hex` and `other` in RGB space. `weight` is `hex`'s share
 * of the result, clamped to `[0, 1]` (`1` returns `hex`, `0` returns
 * `other`). A color that fails to decode falls back to black (`hex`) or
 * white (`other`) respectively, so the mix is still well-defined.
 */
export function mixHex({ hex, other, weight }: { hex: string; other: string; weight: number }): string {
  const a = hexToRgb({ hex }) ?? { r: 0, g: 0, b: 0 };
  const b = hexToRgb({ hex: other }) ?? { r: 255, g: 255, b: 255 };
  const clampedWeight = Math.max(0, Math.min(1, weight));
  const mixed = {
    r: Math.round(a.r * clampedWeight + b.r * (1 - clampedWeight)),
    g: Math.round(a.g * clampedWeight + b.g * (1 - clampedWeight)),
    b: Math.round(a.b * clampedWeight + b.b * (1 - clampedWeight)),
  };
  return `#${toHexByte({ value: mixed.r })}${toHexByte({ value: mixed.g })}${toHexByte({ value: mixed.b })}`;
}

/** Picks `#111111` (near-black) or `#ffffff` (white) as the more readable text color for a `hex` background, using {@link luminance}. */
export function readableTextColor({ hex }: { hex: string }): string {
  return luminance({ hex }) > 0.56 ? '#111111' : '#ffffff';
}
