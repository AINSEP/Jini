/** The intentionally small palette every admin theme supplies in both schemes. */
export interface AdminThemeColors {
  readonly primary: string;
  readonly primaryInk: string;
  readonly bg: string;
  readonly surface: string;
  readonly text: string;
  readonly muted: string;
  readonly border: string;
  readonly danger: string;
  readonly success: string;
  readonly warning: string;
}

/** Product fonts and palette are data. Font loading URLs are stylesheet URLs. */
export interface AdminTheme {
  readonly name: string;
  readonly fonts: { readonly body: string; readonly heading: string; readonly mono?: string; readonly load?: readonly string[] };
  readonly light: AdminThemeColors;
  readonly dark: AdminThemeColors;
  readonly radius?: string;
  /** Unitless spacing multiplier, from 0.5 to 2. */
  readonly density?: number;
}

export type ColorScheme = 'light' | 'dark';
export type ColorSchemePreference = ColorScheme | 'system';
export type MatchMediaPort = (query: string) => {
  readonly matches: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
};

/** Only these DOM capabilities are needed; no ambient document is consulted. */
export type AdminThemeTarget = Pick<HTMLElement, 'style' | 'getAttribute' | 'setAttribute' | 'removeAttribute'>;
export type AdminThemeDocument = Pick<Document, 'head' | 'createElement' | 'baseURI'>;
