/** One tagged region located in a document, as reported by the injected parser. */
export interface ParsedRegion {
  /** The `data-agent-element` value. */
  readonly handle: string;
  /** The `data-agent-role` value, if the markup carries one. */
  readonly role?: string;
  /** The `data-agent-label` value, if present. Page-authored and therefore untrusted for display. */
  readonly label?: string;
  /** Index of the first character of the region's INNER content. */
  readonly innerStart: number;
  /** Index one past the last character of the region's inner content. */
  readonly innerEnd: number;
}


/** A discovered handle, including unsafe regions so reads never silently lose an address. */
export interface ScannedRegion extends ParsedRegion {
  readonly tag: string;
  /** Outer offsets; -1 means parse5 could not locate the boundary. Never splice a problem region. */
  readonly start: number;
  readonly end: number;
  /** Why this region cannot safely be replaced or moved. */
  readonly problem?: string;
}

/** A direct fragment child, used for host tagging advice; implicit closes are allowed here. */
export interface HtmlTopLevelElement {
  readonly tag: string;
  readonly handle?: string;
  readonly start: number;
  readonly end: number;
  readonly innerStart: number;
  readonly innerEnd: number;
}

/** Reusable analysis of exactly one source string. Parse errors are diagnostics, not read failures. */
export interface HtmlRegionScan {
  readonly regions: readonly ScannedRegion[];
  readonly topLevel: readonly HtmlTopLevelElement[];
  /** A raw-source handle could not be accounted for in the recovered tree. */
  readonly documentProblem?: string;
  readonly parseErrorReasons?: readonly string[];
}

/** Why lookup could not identify a single safe span. Legacy handle values are deliberately retained. */
export type RegionLookupProblem =
  | { readonly kind: "absent"; readonly available: readonly string[] }
  | { readonly kind: "ambiguous"; readonly count: number }
  | { readonly kind: "not-replaceable"; readonly tag: string };

export type RegionLookup = { readonly region: ScannedRegion } | { readonly problem: RegionLookupProblem };

export type RegionMoveProblem = "self" | "into-itself";

/** Host-owned slug policy keeps suggestions compatible without adding a slugifier dependency. */
export interface RegionHandleOptions {
  readonly slugify: (text: string) => string;
}

/** A top-level element needing a handle, with a suggestion only when its own heading provides one. */
export interface UntaggedSection {
  readonly tag: string;
  readonly suggestedHandle: string | undefined;
}

export interface PageHtmlRegionPorts {
  scanHtmlRegions(required: { readonly html: string }, optional?: Record<string, never>): HtmlRegionScan & { readonly parseErrorReasons: readonly string[] };
  handlesMadeAmbiguous(required: { readonly before: HtmlRegionScan; readonly after: HtmlRegionScan }, optional?: Record<string, never>): string[];
  locateRegion(required: { readonly scan: HtmlRegionScan; readonly handle: string }, optional?: Record<string, never>): RegionLookup;
  moveRegion(required: { readonly html: string; readonly moving: ScannedRegion; readonly target: ScannedRegion; readonly placement: "before" | "after" }, optional?: Record<string, never>): { readonly html: string } | { readonly problem: RegionMoveProblem };
  regionHandlesIn(required: { readonly scan: HtmlRegionScan }, optional?: Record<string, never>): string[];
  replaceRegionInner(required: { readonly html: string; readonly region: ParsedRegion; readonly fragment: string }, optional?: Record<string, never>): string;
  untaggedTopLevelSections(required: { readonly html: string; readonly scan: HtmlRegionScan }, options: RegionHandleOptions): readonly UntaggedSection[];
}
