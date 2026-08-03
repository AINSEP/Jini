/**
 * @module html/regions
 *
 * An `EditTarget` whose parts are **tagged regions of one HTML document** — the shape a
 * single-document host needs, as opposed to the file tree a multi-file host edits.
 *
 * This is the target the port was designed against but never had an implementation for, and it is
 * where `validate` stops being a formality: a file cannot corrupt another file's syntax, but a
 * region shares one document with every other region, so one unbalanced tag corrupts everything
 * after it.
 *
 * ## Addressing reuses `data-agent-element`, deliberately
 *
 * Handles are the existing `data-agent-element` convention (`@jini-ai/agentic`'s
 * `element-handles.ts`), including its handle grammar — lowercase words joined by single hyphens,
 * bounded length, and no quote, bracket, backslash or whitespace. That grammar exists so a handle
 * cannot break out of the attribute selector it gets interpolated into, and it serves equally well
 * here: a `PartId` a model can name is a string a model authored.
 *
 * Minting a new product-specific attribute was considered and rejected twice over — the convention
 * already exists with `region` as a defined role, and a product-named attribute could not live in
 * this workspace anyway.
 *
 * ## THE SECURITY PROPERTY: a model may not extend its own allowlist
 *
 * `listParts` is an allowlist, and an allowlist a model can write to is not an allowlist. If a model
 * may edit region `hero`, and it writes `data-agent-element="anything"` inside `hero`, then the very
 * next `listParts()` publishes `anything` as addressable — the model has granted itself a new part
 * without the host ever deciding to. Every subsequent turn inherits the expanded surface.
 *
 * So `validate` refuses any candidate whose prospective document does not carry **exactly the same
 * multiset of handles** as the current one. That covers all three ways this breaks: a handle
 * invented, a handle deleted, and a handle duplicated (which would make an id ambiguous and let one
 * write land somewhere the host did not intend). Neither reference implementation has an equivalent
 * check, because neither has sub-document parts — there was nothing to copy.
 *
 * ## Writes are byte-preserving outside the edited region
 *
 * `replacePart` is a string splice across the region's inner offsets: everything outside those
 * offsets is carried through untouched, byte for byte. This is a deliberate departure from the
 * visual editor studied for this design, which re-parses, regenerates and pretty-prints the whole
 * file on every write — semantically faithful, but it reformats the document out from under the
 * author, and it does so even to files it failed to parse. A host that stores author-written HTML
 * cannot accept that.
 *
 * ## The parser is injected, not imported
 *
 * This package is `"runtime": "universal"`, and no HTML parser exists anywhere in this workspace, so
 * hard-wiring one would either make this module Node-only or push a parser into every browser
 * bundle. It arrives as a port instead — the same choice, for the same reason, that `EditTarget`
 * itself is a port. A browser host can satisfy it with `DOMParser`; a server host with whatever it
 * already depends on.
 */
import type { EditTarget } from "../core/target.js";
import type { PartId, PartRef, Snapshot, ValidationResult } from "../core/types.js";

/** The attribute that publishes a region's handle. Mirrors `@jini-ai/agentic`'s convention. */
export const AGENT_ELEMENT_ATTRIBUTE = "data-agent-element";

/**
 * Lowercase words joined by single hyphens — the same grammar `@jini-ai/agentic` enforces, restated
 * here rather than imported so `/html` does not acquire a dependency on the agentic package for one
 * regular expression. If that package's grammar ever widens, this must be revisited deliberately.
 */
const HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_HANDLE_LENGTH = 128;

/** Whether `handle` is a syntactically valid region handle. */
export function isValidRegionHandle(handle: string): boolean {
  return handle.length > 0 && handle.length <= MAX_HANDLE_LENGTH && HANDLE_PATTERN.test(handle);
}

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

/**
 * The host-supplied HTML parser.
 *
 * Implementations must report regions in document order with accurate inner offsets — every write
 * this module performs is a splice across those offsets, so an incorrect offset corrupts the
 * document silently.
 */
export interface HtmlRegionParser {
  /**
   * Locate every element carrying `data-agent-element`.
   *
   * Must report ALL of them, including duplicates and handles that fail `isValidRegionHandle` —
   * this module needs to *see* invalid and duplicated handles in order to refuse them. A parser
   * that filters them out silently defeats the allowlist check.
   */
  findRegions(html: string): readonly ParsedRegion[];

  /**
   * Optional structural check on a whole document.
   *
   * Return a reason phrased for the MODEL, since it is fed back as the next turn's input. Omit the
   * method entirely if the parser cannot distinguish a malformed document from a recovered one —
   * that is honest, and the handle-set check below still catches the damage that matters most.
   */
  checkWellFormed?(html: string): { readonly ok: true } | { readonly ok: false; readonly reason: string };
}

/** Where the document itself lives. The host owns storage; this module never assumes one. */
export interface HtmlDocumentStore {
  read(): Promise<string>;
  write(html: string): Promise<void>;
}

export interface HtmlRegionTargetOptions {
  /**
   * Reject a proposed region body larger than this many characters.
   *
   * Content is model-authored and arrives over a network boundary; without a bound, one turn can
   * grow the stored document without limit. Defaults to 256 KiB, generous for a page region.
   */
  readonly maxPartLength?: number;
}

export interface HtmlRegionTargetDeps {
  readonly store: HtmlDocumentStore;
  readonly parser: HtmlRegionParser;
  readonly options?: HtmlRegionTargetOptions;
}

/** Handles in document order, including duplicates — order and multiplicity both matter. */
function handlesOf(regions: readonly ParsedRegion[]): string[] {
  return regions.map((region) => region.handle);
}

/** A stable, order-insensitive description of a handle multiset, for comparison in a message. */
function describeHandles(handles: readonly string[]): string {
  return [...handles].sort().join(", ") || "(none)";
}

/** Locates one region by handle, refusing ambiguity rather than silently picking the first. */
function findOne(
  regions: readonly ParsedRegion[],
  id: PartId
): { readonly ok: true; readonly region: ParsedRegion } | { readonly ok: false; readonly reason: string } {
  const matches = regions.filter((region) => region.handle === id);
  if (matches.length === 0) return { ok: false, reason: `no region is tagged ${AGENT_ELEMENT_ATTRIBUTE}="${id}"` };
  if (matches.length > 1) {
    return {
      ok: false,
      reason: `${matches.length} regions are tagged ${AGENT_ELEMENT_ATTRIBUTE}="${id}" — a handle must identify exactly one region`,
    };
  }
  // `matches[0]` is present: length is exactly 1 on this branch.
  return { ok: true, region: matches[0] as ParsedRegion };
}

/**
 * Build an `EditTarget` over the tagged regions of one HTML document.
 *
 * @param deps - document storage and an HTML parser, both host-supplied.
 * @returns a target ready to hand to `applyEdit`/`applyEdits` or to `createEditHistory`.
 * @complexity 4
 */
export function createHtmlRegionTarget(deps: HtmlRegionTargetDeps): EditTarget {
  const { store, parser } = deps;
  const maxPartLength = deps.options?.maxPartLength ?? 256 * 1024;

  /** Splices `content` into `region`'s inner range, preserving every byte outside it. */
  function spliced(html: string, region: ParsedRegion, content: string): string {
    return html.slice(0, region.innerStart) + content + html.slice(region.innerEnd);
  }

  return {
    async listParts(): Promise<readonly PartRef[]> {
      const regions = parser.findRegions(await store.read());
      const seen = new Set<string>();
      const refs: PartRef[] = [];
      for (const region of regions) {
        // A malformed or duplicated handle is not publishable: publishing it would advertise an id
        // that `readPart`/`replacePart` must then refuse, or worse, resolve ambiguously.
        if (!isValidRegionHandle(region.handle) || seen.has(region.handle)) continue;
        seen.add(region.handle);
        refs.push({
          id: region.handle,
          ...(region.role === undefined ? {} : { kind: region.role }),
          ...(region.label === undefined ? {} : { label: region.label }),
        });
      }
      return refs;
    },

    async readPart(id: PartId): Promise<string> {
      const html = await store.read();
      const found = findOne(parser.findRegions(html), id);
      if (!found.ok) throw new Error(found.reason);
      return html.slice(found.region.innerStart, found.region.innerEnd);
    },

    /**
     * Note that this is NOT an upsert here, unlike the port's general contract: a region that does
     * not exist cannot be created by writing to it, because creating one would mean inventing a
     * position in someone else's document and a tag to wrap it in. A host that wants a new region
     * adds it to the document itself, and it becomes addressable at the next `listParts`.
     */
    async replacePart(id: PartId, content: string): Promise<void> {
      const html = await store.read();
      const found = findOne(parser.findRegions(html), id);
      if (!found.ok) throw new Error(found.reason);
      await store.write(spliced(html, found.region, content));
    },

    async snapshot(): Promise<Snapshot> {
      const html = await store.read();
      const regions = parser.findRegions(html);
      const parts: Record<PartId, string> = {};
      const seen = new Set<string>();
      for (const region of regions) {
        if (!isValidRegionHandle(region.handle) || seen.has(region.handle)) continue;
        seen.add(region.handle);
        parts[region.handle] = html.slice(region.innerStart, region.innerEnd);
      }
      return { id: `html-${regions.length}-${html.length}`, parts };
    },

    /**
     * Restores each region's content in one pass.
     *
     * Offsets are re-resolved between writes rather than computed once, because every splice shifts
     * the offsets of every region after it. Computing them all up front is the obvious
     * implementation and it silently corrupts the document whenever two regions change length.
     */
    async restore(snapshot: Snapshot): Promise<void> {
      for (const [handle, content] of Object.entries(snapshot.parts)) {
        const html = await store.read();
        const found = findOne(parser.findRegions(html), handle);
        if (!found.ok) continue; // The region is gone; there is nowhere to put its content back.
        await store.write(spliced(html, found.region, content));
      }
    },

    async validate(candidate): Promise<ValidationResult> {
      if (candidate.content.length > maxPartLength) {
        return {
          ok: false,
          reason: `that content is ${candidate.content.length} characters, over the ${maxPartLength}-character limit for one region — send a shorter version`,
        };
      }

      const html = await store.read();
      const before = parser.findRegions(html);
      const found = findOne(before, candidate.id);
      if (!found.ok) return { ok: false, reason: found.reason };

      // Judge the WHOLE prospective document, never the fragment alone: a fragment that is
      // well-formed by itself can still break the document it lands in.
      const prospective = spliced(html, found.region, candidate.content);

      const structural = parser.checkWellFormed?.(prospective);
      if (structural && !structural.ok) return { ok: false, reason: structural.reason };

      const afterHandles = handlesOf(parser.findRegions(prospective));
      const beforeHandles = handlesOf(before);

      // The allowlist check. Compared as multisets so an invented, deleted OR duplicated handle is
      // all caught by one comparison — see this module's doc for why this is the security property.
      const beforeKey = describeHandles(beforeHandles);
      const afterKey = describeHandles(afterHandles);
      if (beforeKey !== afterKey) {
        const invented = afterHandles.filter((handle) => !beforeHandles.includes(handle));
        const removed = beforeHandles.filter((handle) => !afterHandles.includes(handle));
        const detail =
          invented.length > 0
            ? `it adds ${AGENT_ELEMENT_ATTRIBUTE} handles that did not exist (${describeHandles(invented)})`
            : removed.length > 0
              ? `it removes existing ${AGENT_ELEMENT_ATTRIBUTE} handles (${describeHandles(removed)})`
              : `it changes how many times a ${AGENT_ELEMENT_ATTRIBUTE} handle appears`;
        return {
          ok: false,
          reason: `${detail}. Edit only the content inside the region you were asked to change, and do not add, remove or duplicate ${AGENT_ELEMENT_ATTRIBUTE} attributes.`,
        };
      }

      return { ok: true };
    },
  };
}
