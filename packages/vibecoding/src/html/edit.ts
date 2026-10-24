/**
 * Pure region edits over a caller-owned scan. Offsets always index the original string (UTF-16
 * code units); scan each new string once and keep storage, version checks and policy in the host.
 * Unlike the EditTarget allowlist, these helpers permit adding/removing handles. The ambiguity
 * comparison only identifies handles whose duplicate count increases.
 *
 * @example
 * const found = locateRegion({ scan, handle: "hero" });
 * if ("region" in found) replaceRegionInner({ html, region: found.region, fragment: "<h1>Hi</h1>" });
 */
import type { ParsedRegion } from "./regions.js";

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

/** Resolve one address, refusing duplicates and unsafe boundaries without throwing on reads. */
export function locateRegion(
  { scan, handle }: { readonly scan: HtmlRegionScan; readonly handle: string },
  _options: Record<string, never> = {},
): RegionLookup {
  const matches = scan.regions.filter((region) => region.handle === handle);
  if (matches.length === 0) return { problem: { kind: "absent", available: regionHandlesIn({ scan }) } };
  if (matches.length > 1) return { problem: { kind: "ambiguous", count: matches.length } };
  const region = matches[0] as ScannedRegion; // Exactly one match on this branch.
  if (region.problem !== undefined) return { problem: { kind: "not-replaceable", tag: region.tag } };
  return { region };
}

/**
 * Replace INNER content only: the addressed element, its handle and every surrounding byte survive.
 * The region must be safely located in this exact html string; this helper performs no policy check.
 */
export function replaceRegionInner(
  { html, region, fragment }: { readonly html: string; readonly region: ParsedRegion; readonly fragment: string },
  _options: Record<string, never> = {},
): string {
  return html.slice(0, region.innerStart) + fragment + html.slice(region.innerEnd);
}

export type RegionMoveProblem = "self" | "into-itself";

/** The end of the whitespace run adjoining an element, in either direction. */
function whitespaceRun(html: string, from: number, direction: 1 | -1): number {
  let cursor = from;
  while (/\s/.test(html[direction === 1 ? cursor : cursor - 1] ?? "")) cursor += direction;
  return cursor;
}

/**
 * Move a WHOLE safely located element, carrying trailing whitespace (or leading whitespace at EOF).
 * Refuse self/descendant destinations. Both regions must have been resolved from this exact source.
 * Everything else retains its original bytes and order; an adjacent move may return identical HTML.
 */
export function moveRegion(
  { html, moving, target, placement }: {
    readonly html: string;
    readonly moving: ScannedRegion;
    readonly target: ScannedRegion;
    readonly placement: "before" | "after";
  },
  _options: Record<string, never> = {},
): { readonly html: string } | { readonly problem: RegionMoveProblem } {
  if (moving.start === target.start) return { problem: "self" };
  if (target.start > moving.start && target.end <= moving.end) return { problem: "into-itself" };

  let cutStart = moving.start;
  const cutEnd = whitespaceRun(html, moving.end, 1);
  if (cutEnd === moving.end) cutStart = whitespaceRun(html, moving.start, -1);
  const element = html.slice(moving.start, moving.end);
  const gap = cutEnd > moving.end ? html.slice(moving.end, cutEnd) : html.slice(cutStart, moving.start);
  const without = html.slice(0, cutStart) + html.slice(cutEnd);
  const anchor = placement === "before" ? target.start : target.end;
  const at = anchor >= cutEnd ? anchor - (cutEnd - cutStart) : anchor;
  const piece = placement === "before" ? element + gap : gap + element;
  return { html: without.slice(0, at) + piece + without.slice(at) };
}

/** Host-owned slug policy keeps suggestions compatible without adding a slugifier dependency. */
export interface RegionHandleOptions {
  readonly slugify: (text: string) => string;
}

/** A top-level element needing a handle, with a suggestion only when its own heading provides one. */
export interface UntaggedSection {
  readonly tag: string;
  readonly suggestedHandle: string | undefined;
}

const HEADING_PATTERN = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i;

/**
 * Derive a stable handle from the first heading, stripping inline tags and truncating to 48 chars.
 * Never suggest positional handles: moving sections must not change their addresses. Collisions,
 * absent headings and empty slugs get no suggestion; the host chooses its own slugification policy.
 */
export function suggestRegionHandle(
  { inner, taken }: { readonly inner: string; readonly taken: ReadonlySet<string> },
  { slugify }: RegionHandleOptions,
): string | undefined {
  const heading = HEADING_PATTERN.exec(inner);
  if (!heading) return undefined;
  const slug = slugify((heading[1] as string).replace(/<[^>]*>/g, " ")).slice(0, 48).replace(/-+$/g, "");
  if (slug === "" || taken.has(slug)) return undefined;
  return slug;
}

// Stylesheets and metadata need no content address. Requiring nested elements to carry handles
// would impose a stricter contract than "every top-level section" and make ordinary pages unusable.
const UNTAGGABLE_TOP_LEVEL_ELEMENTS = new Set(["style", "script", "template", "link", "meta", "base", "title"]);

/** Find untagged top-level content; reserve each suggestion so a batch never creates duplicates. */
export function untaggedTopLevelSections(
  { html, scan }: { readonly html: string; readonly scan: HtmlRegionScan },
  options: RegionHandleOptions,
): readonly UntaggedSection[] {
  const taken = new Set(regionHandlesIn({ scan }));
  const offenders: UntaggedSection[] = [];
  for (const element of scan.topLevel) {
    if (element.handle !== undefined || UNTAGGABLE_TOP_LEVEL_ELEMENTS.has(element.tag)) continue;
    const inner = html.slice(element.innerStart, element.innerEnd);
    const suggestedHandle = suggestRegionHandle({ inner, taken }, options);
    if (suggestedHandle !== undefined) taken.add(suggestedHandle);
    offenders.push({ tag: element.tag, suggestedHandle });
  }
  return offenders;
}

/** Count every discovered handle, including duplicates and unsafe regions. */
function countHandles(scan: HtmlRegionScan): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const { handle } of scan.regions) counts.set(handle, (counts.get(handle) ?? 0) + 1);
  return counts;
}

/** Report newly worsened ambiguity, once per handle in after's source order; existing duplicates stay editable. */
export function handlesMadeAmbiguous(
  { before, after }: { readonly before: HtmlRegionScan; readonly after: HtmlRegionScan },
  _options: Record<string, never> = {},
): string[] {
  const was = countHandles(before);
  const offenders: string[] = [];
  for (const [handle, count] of countHandles(after)) {
    if (count > 1 && count > (was.get(handle) ?? 0)) offenders.push(handle);
  }
  return offenders;
}

/** All handles in source order, preserving duplicates, empty values and legacy grammar. */
export function regionHandlesIn(
  { scan }: { readonly scan: HtmlRegionScan },
  _options: Record<string, never> = {},
): string[] {
  return scan.regions.map((region) => region.handle);
}
