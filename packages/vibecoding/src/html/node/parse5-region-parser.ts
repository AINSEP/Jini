/**
 * @module html/node/parse5-region-parser
 *
 * The `HtmlRegionParser` (`../regions.js`) has no implementation anywhere until this file — this is
 * it: a spec-compliant WHATWG HTML parser (parse5, the same one jsdom depends on), Node-only because
 * parse5 is Node-only, which is why this lives behind `./html/node` rather than the dependency-free
 * `./html` entry `regions.ts` itself ships from.
 *
 * ## Fragment, not document
 *
 * A host's "one HTML document" (per `regions.ts`'s own module doc) may genuinely be a whole page,
 * but the shape this was built against is inner content only — a string meant to be spliced into an
 * existing container, not a standalone `<html>` page. `parse5.parseFragment` (the same algorithm
 * browsers use for `Element.innerHTML`) is the correct entry point for that shape, parsed against a
 * `<div>` context element: a generic block container, matching how a real host embeds this content.
 * Getting this choice right is not cosmetic — the fragment context materially changes recovery
 * behavior (verified empirically; see the section below), so a `<template>` context (parse5's
 * own default when none is given) would UNDER-detect a real failure mode this module exists to
 * catch.
 *
 * ## — a tagged element the parser could not reliably locate must never be silently dropped
 *
 * `regions.ts`'s own contract states the requirement (`findRegions`'s doc: "must report ALL of
 * them... a parser that filters them out silently defeats the allowlist check"). Silently omitting
 * an unlocatable region is actively dangerous, not merely incomplete: the omitted handle vanishes
 * from `listParts`'s next call, and the region's own multiset check (`regions.ts`'s `validate`) then
 * reports the *next*, unrelated edit to that document as "removes existing handle" — a permanent
 * lockout with a reason that misdescribes the actual defect, because nothing was removed; the parser
 * lost track of something still in the DOM.
 *
 * **This was verified empirically against real parse5 output before being implemented — not
 * inferred from parse5's docs alone.** Two distinct mechanisms were confirmed reachable:
 *
 * 1. **A located-but-incomplete node.** parse5's own docs state `sourceCodeLocation` is `undefined`
 * for elements the parser implicitly created during tree correction; concretely, this shows up as
 * a tagged element whose `sourceCodeLocation.endTag` is missing — an implicitly-closed element at
 * EOF, or (structurally, always) a tagged void element (`<img>`, `<br>`,...), which has no
 * content model and therefore can never have a closing tag to locate.
 * 2. **A node dropped from the tree entirely — no location to inspect because no node exists.**
 * Confirmed with a tagged `<td>` used outside a `<table>`, parsed with a `<div>` fragment context:
 * the HTML5 "in body" insertion mode's table-tag handling is a spec-mandated "parse error, ignore
 * the token" — the element (and its `data-agent-element` attribute) never enters the tree at all.
 * Neither `sourceCodeLocationInfo` nor `onParseError` flags this case on its own (verified: this
 * fixture produces zero `onParseError` entries), which is why this module cross-checks the raw
 * source text's occurrence count against what the tree walk actually found, independent of
 * parse5's own error stream.
 *
 * `scanHtmlRegions` retains every tree-discovered handle, recording unsafe boundaries on that
 * region and dropped-source handles as a document diagnostic. Reads can still inspect the page
 * and edit another safely delimited region. The strict `findRegions` throws on either problem
 * (never returns a silently-shortened list), and `checkWellFormed` reports the same problem through
 * the port's ordinary rejection channel so `regions.ts`'s `validate` can surface it before writing.
 *
 * ## `checkWellFormed` is a courtesy diagnostic, not the safety mechanism
 *
 * Per the port's own doc: "omit the method entirely if the parser cannot distinguish a malformed
 * document from a recovered one." parse5 genuinely cannot always tell, so `checkWellFormed` is
 * honest about that — ordinary spec-compliant recovery that produces no `onParseError` entry (e.g.
 * an implied `</p>` before a following block element) is allowed to pass. Only two things fail it:
 * a location problem (above), or at least one genuine `onParseError` entry, phrased for the
 * model. The handle-multiset check in `regions.ts`'s `validate` remains the actual security
 * property; this method exists to give the model a better reason sooner, not to replace that check.
 * See docs/decisions/DR-001-conservative-region-detection.md.
 */
import { defaultTreeAdapter, html, parseFragment, type DefaultTreeAdapterTypes, type ParserError } from "parse5";

import type { HtmlRegionScan, HtmlTopLevelElement, ScannedRegion } from "../edit.js";

import { AGENT_ELEMENT_ATTRIBUTE, isValidRegionHandle, type HtmlRegionParser, type ParsedRegion } from "../regions.js";

// parse5's package.json `exports` map publishes only its top-level entry — a deep import like
// `parse5/dist/tree-adapters/default.js` resolves under `moduleResolution: "Bundler"` at typecheck
// time but is not a real subpath Node will serve at runtime. `DefaultTreeAdapterTypes` is the
// sanctioned re-export for these shapes.
type Parse5Element = DefaultTreeAdapterTypes.Element;
type Parse5Node = DefaultTreeAdapterTypes.Node;

/**
 * HTML5 void elements — no content model, so they can never have a closing tag for parse5 to
 * locate. Tagging one with `data-agent-element` is a structural impossibility for a "region" (a
 * span of editable inner content), not a parser-recovery accident, so it gets a distinct message.
 */
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Matches `data-agent-element` as an attribute *name* only — deliberately not the value or its
 * quoting style, so it survives single-quoted, double-quoted and unquoted attribute forms alike.
 *
 * This remains a conservative source cross-check for genuinely dropped regions. Comments and
 * raw-text bodies are blanked using parse5 locations first: a script building a handle string
 * is not a region. Treating those examples as failures would break otherwise valid page reads.
 * See docs/decisions/DR-001-conservative-region-detection.md.
 */
const RAW_HANDLE_ATTRIBUTE_RE = new RegExp(`\\b${AGENT_ELEMENT_ATTRIBUTE}\\s*=`, "gi");

function attributeValue(element: Parse5Element, name: string): string | undefined {
  return element.attrs.find((a) => a.name === name)?.value;
}

/** Visit all nodes, including comments/raw text and nested template contents. */
function* walkNodes(root: Parse5Node): Generator<Parse5Node> {
  const pending = [root];
  // An explicit stack avoids overflowing the JS call stack on deeply nested author markup.
  while (pending.length > 0) {
    const node = pending.pop() as Parse5Node; // Nonempty stack on this branch.
    yield node;
    const children = childrenOf(node);
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index] as Parse5Node);
  }
}

// RCDATA bodies also contain literal text rather than child markup. Keep their source examples
// out of the dropped-region check just like raw-text bodies; opening-tag attributes still count.
// `noscript` is raw text too: parse5 parses with scripting enabled, as a browser running the page does.
const TEXT_BODY_ELEMENTS: ReadonlySet<string> = new Set([
  "script", "style", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext", "textarea", "title",
]);

/** Whether a located node is a comment or the literal text body of a raw-text/RCDATA element. */
function isNonMarkup(node: Parse5Node): boolean {
  if (node.nodeName === "#comment") return true;
  if (node.nodeName !== "#text" || !("parentNode" in node)) return false;
  const parent = node.parentNode;
  return parent !== null && "tagName" in parent && TEXT_BODY_ELEMENTS.has(parent.tagName);
}

/** A parse-error entry, phrased for the model rather than left as parse5's bare kebab-case code. */
function describeParseError(error: ParserError): string {
  return `${error.code.replace(/-/g, " ")} near character ${error.startOffset}`;
}

/** Why a tagged element's boundaries are unsafe; optional closing tags are unsafe too. */
function regionProblem(element: Parse5Element, handle: string): string | undefined {
  const location = element.sourceCodeLocation;
  if (location === null || location === undefined || location.startTag === undefined) {
    return `a "${AGENT_ELEMENT_ATTRIBUTE}" region ("${handle}") could not be located in the document — ` +
      "the parser's error-recovery rules likely dropped or repositioned it. Rewrite the document " +
      "so this element is reachable in ordinary document structure (for example, not a table-only " +
      "tag used outside a <table>).";
  }
  if (location.endTag === undefined) {
    return VOID_ELEMENTS.has(element.tagName)
      ? `"${handle}" tags a <${element.tagName}> element, which is void and has no inner content — ` +
        `void elements cannot be a ${AGENT_ELEMENT_ATTRIBUTE} region`
      : `a "${AGENT_ELEMENT_ATTRIBUTE}" region ("${handle}") has no closing tag the parser could ` +
        "locate — its content boundaries cannot be determined safely. Close the tag explicitly.";
  }
  return undefined;
}

/** Original-source offsets shared by region discovery and top-level tagging advice. */
function sourceOffsets(element: Parse5Element): Pick<ScannedRegion, "start" | "end" | "innerStart" | "innerEnd"> {
  const location = element.sourceCodeLocation;
  if (!location?.startTag) return { start: -1, end: -1, innerStart: -1, innerEnd: -1 };
  return {
    start: location.startTag.startOffset,
    end: location.endTag?.endOffset ?? location.endOffset,
    innerStart: location.startTag.endOffset,
    innerEnd: location.endTag?.startOffset ?? location.endOffset,
  };
}

/** Keep unsafe regions discoverable; sentinel offsets are never used by locateRegion for edits. */
function analyzeRegion(element: Parse5Element, handle: string): ScannedRegion {
  const role = attributeValue(element, "data-agent-role");
  const label = attributeValue(element, "data-agent-label");
  const problem = regionProblem(element, handle);
  return {
    handle,
    tag: element.tagName,
    ...sourceOffsets(element),
    ...(role === undefined ? {} : { role }),
    ...(label === undefined ? {} : { label }),
    ...(problem === undefined ? {} : { problem }),
  };
}

/** A template's content children, an ordinary node's children, or none for a leaf. */
function childrenOf(node: Parse5Node): readonly unknown[] {
  if ("content" in node) return node.content.childNodes;
  return "childNodes" in node ? node.childNodes : [];
}

/** Direct fragment children in source order; implied closes suffice for tagging advice, not edits. */
function topLevelElements(fragment: DefaultTreeAdapterTypes.DocumentFragment): HtmlTopLevelElement[] {
  const elements: HtmlTopLevelElement[] = [];
  for (const child of fragment.childNodes) {
    // Implicit wrappers have no authored open tag to annotate.
    if (!("tagName" in child) || !child.sourceCodeLocation?.startTag) continue;
    const handle = attributeValue(child, AGENT_ELEMENT_ATTRIBUTE);
    elements.push({
      tag: child.tagName,
      ...(handle === undefined ? {} : { handle }),
      ...sourceOffsets(child),
    });
  }
  return elements.sort((a, b) => a.start - b.start);
}

/**
 * Report each authored tag once. parse5 copies an unclosed or misnested formatting element's
 * start-tag location onto every clone it reconstructs (`<p><b data-agent-element="x">a</p><p>b`
 * yields two `b`s starting at the same offset), and a clone can even pick up a later `</b>` that
 * does not delimit the authored element. Counting clones would make one handle "ambiguous", and an
 * unrelated edit that adds text after it would then look like it newly duplicated that handle.
 * Input must be sorted by `start`; the stable sort keeps the authored element (first in tree order).
 */
function collapseClones(sorted: readonly ScannedRegion[]): ScannedRegion[] {
  const out: ScannedRegion[] = [];
  for (const region of sorted) {
    const previous = out[out.length - 1];
    if (previous === undefined || region.start < 0 || previous.start !== region.start) {
      out.push(region);
      continue;
    }
    out[out.length - 1] = {
      ...previous,
      problem: previous.problem ?? `"${region.handle}" tags an element the parser had to split while ` +
        "recovering misnested or unclosed tags — its content boundaries cannot be determined safely. " +
        "Close the tag explicitly, inside the element that contains it.",
    };
  }
  return out;
}

/** Cross-check only markup-bearing source; recovered/dropped tokens may have no tree node. */
function droppedRegionProblem(masked: string, regionCount: number): string | undefined {
  const rawMentions = masked.match(RAW_HANDLE_ATTRIBUTE_RE)?.length ?? 0;
  if (rawMentions <= regionCount) return undefined;
  return `the source mentions ${AGENT_ELEMENT_ATTRIBUTE} ${rawMentions} time(s) but only ` +
    `${regionCount} could be located in the parsed document — the parser's error-recovery ` +
    "rules likely dropped one entirely (a common cause: a table-only tag, such as <td>, used " +
    "outside a <table>). Rewrite the document so every tagged element sits in ordinary, " +
    "non-table-recovery document structure.";
}

/**
 * Scan once without throwing for malformed markup: unsafe regions carry their own problem, while
 * unaccounted-for source handles produce documentProblem. Every offset indexes the untouched input.
 * Comments/raw-text bodies are blanked by parse5's own locations before the raw-mention check.
 * @example const scan = scanHtmlRegions({ html: '<section data-agent-element="hero">Hi</section>' });
 * @complexity One parse and node walk, plus source-order sorting: O(n + r log r) for n source code
 * units and r discovered elements. Masked ranges are disjoint, so blanking is linear in source size.
 */
export function scanHtmlRegions(
  { html: html_ }: { readonly html: string },
  _options: Record<string, never> = {},
): HtmlRegionScan & { readonly parseErrorReasons: readonly string[] } {
  const parseErrorReasons: string[] = [];
  /** Fresh `<div>` fragment-context element — see this module's doc for why `<div>`, not the default. */
  const context = defaultTreeAdapter.createElement("div", html.NS.HTML, []);
  const fragment = parseFragment(context, html_, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => parseErrorReasons.push(describeParseError(error)),
  });
  const found: ScannedRegion[] = [];
  // split("") preserves UTF-16 code units, including CRLF, BOM and astral-character offsets.
  const masked = html_.split("");
  for (const node of walkNodes(fragment)) {
    const location = node.sourceCodeLocation;
    if (isNonMarkup(node) && location) masked.fill(" ", location.startOffset, location.endOffset);
    if (!("tagName" in node)) continue;
    const handle = attributeValue(node, AGENT_ELEMENT_ATTRIBUTE);
    if (handle !== undefined) found.push(analyzeRegion(node, handle));
  }
  const regions = collapseClones(found.sort((a, b) => a.start - b.start));
  const documentProblem = droppedRegionProblem(masked.join(""), regions.length);
  return {
    regions,
    topLevel: topLevelElements(fragment),
    parseErrorReasons,
    ...(documentProblem === undefined ? {} : { documentProblem }),
  };
}

/** Preserve strict rejection precedence: an unsafe discovered region before a dropped-source handle. */
function locationProblem(scan: HtmlRegionScan): string | undefined {
  return scan.regions.find((region) => region.problem !== undefined)?.problem ?? scan.documentProblem;
}

/**
 * Build the parse5-backed `HtmlRegionParser`. Stateless — a single instance is safe to share as a
 * module-level singleton across every call, per `./regions.js`'s injected-port contract.
 *
 * @returns a parser ready to hand to `createHtmlRegionTarget`, with `checkWellFormed` always
 * present even though the generic parser port allows implementations to omit it.
 * @complexity 1 (delegates to `scanHtmlRegions`)
 */
export function createParse5RegionParser(): HtmlRegionParser & Required<Pick<HtmlRegionParser, "checkWellFormed">> {
  return {
    findRegions({ html: html_ }: { readonly html: string }): readonly ParsedRegion[] {
      const scan = scanHtmlRegions({ html: html_ });
      const problem = locationProblem(scan);
      if (problem !== undefined) throw new Error(problem);
      return scan.regions;
    },

    checkWellFormed({ html: html_ }: { readonly html: string }): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
      const scan = scanHtmlRegions({ html: html_ });
      const problem = locationProblem(scan);
      if (problem !== undefined) return { ok: false, reason: problem };
      // This concrete scanner always initializes the list, unlike the optional generic port field.
      const parseErrorReasons = scan.parseErrorReasons;
      if (parseErrorReasons.length > 0) {
        return { ok: false, reason: `the document does not parse cleanly: ${parseErrorReasons.join("; ")}` };
      }
      return { ok: true };
    },
  };
}

// Re-exported so a caller can reuse the same grammar this parser's handles are checked against
// without importing `../regions.js` directly for one symbol.
export { isValidRegionHandle };
