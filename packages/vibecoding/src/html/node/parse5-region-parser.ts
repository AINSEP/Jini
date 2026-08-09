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
 * behavior (verified empirically; see the CIC-2 section below), so a `<template>` context (parse5's
 * own default when none is given) would UNDER-detect a real failure mode this module exists to
 * catch.
 *
 * ## CIC-2 — a tagged element the parser could not reliably locate must never be silently dropped
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
 *    for elements the parser implicitly created during tree correction; concretely, this shows up as
 *    a tagged element whose `sourceCodeLocation.endTag` is missing — an implicitly-closed element at
 *    EOF, or (structurally, always) a tagged void element (`<img>`, `<br>`, ...), which has no
 *    content model and therefore can never have a closing tag to locate.
 * 2. **A node dropped from the tree entirely — no location to inspect because no node exists.**
 *    Confirmed with a tagged `<td>` used outside a `<table>`, parsed with a `<div>` fragment context:
 *    the HTML5 "in body" insertion mode's table-tag handling is a spec-mandated "parse error, ignore
 *    the token" — the element (and its `data-agent-element` attribute) never enters the tree at all.
 *    Neither `sourceCodeLocationInfo` nor `onParseError` flags this case on its own (verified: this
 *    fixture produces zero `onParseError` entries), which is why this module cross-checks the raw
 *    source text's occurrence count against what the tree walk actually found, independent of
 *    parse5's own error stream.
 *
 * Both mechanisms are handled uniformly: `findRegions` throws (never returns a silently-shortened
 * list), and `checkWellFormed` reports the same problem through the port's ordinary rejection
 * channel so `regions.ts`'s `validate` can surface it as a model-facing reason before `findRegions`
 * is ever reached a second time for the same prospective document.
 *
 * ## `checkWellFormed` is a courtesy diagnostic, not the safety mechanism
 *
 * Per the port's own doc: "omit the method entirely if the parser cannot distinguish a malformed
 * document from a recovered one." parse5 genuinely cannot always tell, so `checkWellFormed` is
 * honest about that — ordinary spec-compliant recovery that produces no `onParseError` entry (e.g.
 * an implied `</p>` before a following block element) is allowed to pass. Only two things fail it:
 * a CIC-2 location problem (above), or at least one genuine `onParseError` entry, phrased for the
 * model. The handle-multiset check in `regions.ts`'s `validate` remains the actual security
 * property; this method exists to give the model a better reason sooner, not to replace that check.
 */
import { defaultTreeAdapter, html, parseFragment, type DefaultTreeAdapterTypes, type ParserError } from "parse5";

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
 * This is a plain substring/regex scan of the raw source, the same cost/precision tradeoff
 * `withFormGuardrail` (ADR-056 Decision 8) makes for its own guardrail: a comment or script-text
 * mention of the attribute name can inflate the count and cause an over-eager rejection, but that
 * false positive is a safe failure mode (the model is asked to retry), whereas the false negative
 * this check exists to catch — a genuinely dropped region — is not. */
const RAW_HANDLE_ATTRIBUTE_RE = new RegExp(`\\b${AGENT_ELEMENT_ATTRIBUTE}\\s*=`, "gi");

function attributeValue(element: Parse5Element, name: string): string | undefined {
  return element.attrs.find((a) => a.name === name)?.value;
}

/** Yields every element node in the tree, in document order, recursing into `<template>` content. */
function* walkElements(node: Parse5Node): Generator<Parse5Element> {
  if ("tagName" in node) yield node;
  const children = "content" in node ? node.content.childNodes : "childNodes" in node ? node.childNodes : undefined;
  if (children === undefined) return;
  for (const child of children) yield* walkElements(child);
}

/** Fresh `<div>` fragment-context element — see this module's doc for why `<div>`, not the default. */
function divFragmentContext(): Parse5Element {
  return defaultTreeAdapter.createElement("div", html.NS.HTML, []);
}

/** A parse-error entry, phrased for the model rather than left as parse5's bare kebab-case code. */
function describeParseError(error: ParserError): string {
  return `${error.code.replace(/-/g, " ")} near character ${error.startOffset}`;
}

interface DocumentAnalysis {
  readonly regions: readonly ParsedRegion[];
  /** Set when a tagged element's boundaries could not be safely determined — see CIC-2 above. */
  readonly locationProblem?: string;
  readonly parseErrorReasons: readonly string[];
}

/**
 * One parse pass, shared by `findRegions` and `checkWellFormed` so both methods judge the same
 * parse5 run rather than parsing the document twice with a chance of disagreeing.
 *
 * @complexity Linear in document size: one parse5 pass plus one tree walk plus one regex scan.
 */
function analyzeDocument(html_: string): DocumentAnalysis {
  const parseErrorReasons: string[] = [];
  const fragment = parseFragment(divFragmentContext(), html_, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => parseErrorReasons.push(describeParseError(error)),
  });

  const regions: ParsedRegion[] = [];
  let locationProblem: string | undefined;

  for (const element of walkElements(fragment)) {
    const handle = attributeValue(element, AGENT_ELEMENT_ATTRIBUTE);
    if (handle === undefined) continue;
    if (locationProblem !== undefined) continue; // Already failed; stop accumulating regions.

    const location = element.sourceCodeLocation;
    if (location === null || location === undefined || location.startTag === undefined) {
      locationProblem =
        `a "${AGENT_ELEMENT_ATTRIBUTE}" region ("${handle}") could not be located in the document — ` +
        "the parser's error-recovery rules likely dropped or repositioned it. Rewrite the document " +
        "so this element is reachable in ordinary document structure (for example, not a table-only " +
        "tag used outside a <table>).";
      continue;
    }
    if (location.endTag === undefined) {
      locationProblem = VOID_ELEMENTS.has(element.tagName)
        ? `"${handle}" tags a <${element.tagName}> element, which is void and has no inner content — ` +
          `void elements cannot be a ${AGENT_ELEMENT_ATTRIBUTE} region`
        : `a "${AGENT_ELEMENT_ATTRIBUTE}" region ("${handle}") has no closing tag the parser could ` +
          "locate — its content boundaries cannot be determined safely. Close the tag explicitly.";
      continue;
    }

    regions.push({
      handle,
      innerStart: location.startTag.endOffset,
      innerEnd: location.endTag.startOffset,
      ...(attributeValue(element, "data-agent-role") === undefined
        ? {}
        : { role: attributeValue(element, "data-agent-role") as string }),
      ...(attributeValue(element, "data-agent-label") === undefined
        ? {}
        : { label: attributeValue(element, "data-agent-label") as string }),
    });
  }

  if (locationProblem === undefined) {
    const rawMentions = html_.match(RAW_HANDLE_ATTRIBUTE_RE)?.length ?? 0;
    if (rawMentions > regions.length) {
      locationProblem =
        `the source mentions ${AGENT_ELEMENT_ATTRIBUTE} ${rawMentions} time(s) but only ` +
        `${regions.length} could be located in the parsed document — the parser's error-recovery ` +
        "rules likely dropped one entirely (a common cause: a table-only tag, such as <td>, used " +
        "outside a <table>). Rewrite the document so every tagged element sits in ordinary, " +
        "non-table-recovery document structure.";
    }
  }

  return locationProblem === undefined
    ? { regions, parseErrorReasons }
    : { regions, locationProblem, parseErrorReasons };
}

/**
 * Build the parse5-backed `HtmlRegionParser`. Stateless — a single instance is safe to share as a
 * module-level singleton across every call, per `./regions.js`'s injected-port contract.
 *
 * @returns a parser ready to hand to `createHtmlRegionTarget`.
 * @complexity 1 (delegates entirely to `analyzeDocument`)
 */
export function createParse5RegionParser(): HtmlRegionParser {
  return {
    findRegions(html_: string): readonly ParsedRegion[] {
      const { regions, locationProblem } = analyzeDocument(html_);
      if (locationProblem !== undefined) throw new Error(locationProblem);
      return regions;
    },

    checkWellFormed(html_: string): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
      const { locationProblem, parseErrorReasons } = analyzeDocument(html_);
      if (locationProblem !== undefined) return { ok: false, reason: locationProblem };
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
