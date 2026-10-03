/// <reference lib="dom" />
/**
 * @file `collectPageStructure` — the function that runs INSIDE the page, serialized across to
 * Chromium by `page.evaluate` in `playwright-browser.ts`.
 *
 * ---------------------------------------------------------------------------
 * Read this before editing: this function has no scope
 * ---------------------------------------------------------------------------
 * Playwright serializes the function source and evaluates it in the browser. It therefore CANNOT
 * reference anything outside its own body — no import, no module-level constant, no helper declared
 * beside it in this file. Every helper it uses is nested inside it. That is not a style choice and
 * a "cleanup" that hoists a helper out will fail at runtime, in the browser, with a
 * `ReferenceError` no typechecker can see.
 *
 * Its return value crosses a structured-clone boundary, so it may only contain JSON-ish values:
 * no DOM nodes, no functions, no `undefined` in object positions.
 *
 * ---------------------------------------------------------------------------
 * What it does and does not read
 * ---------------------------------------------------------------------------
 * It reads structure: landmarks, heading levels, image alt text, how form controls are labelled,
 * and colour pairs. It never reads a form control's `.value`, and it never reads
 * `document.cookie` — cookies come from the browser context's own jar in the adapter, where the
 * value can be dropped rather than copied.
 *
 * The contrast numbers are SAMPLES over a bounded set of text-bearing elements, not a full-page
 * audit. `AccessibilityEvidence.truncated` names every category that hit its cap so a report can
 * never read a sample as a census.
 */
import type { AccessibilityEvidence } from "./browser-port.js";

export interface PageStructureLimits {
  readonly maxTextExcerptChars: number;
  readonly maxNodesPerCategory: number;
  readonly maxContrastSamples: number;
  readonly collectAccessibility: boolean;
}

export interface PageStructureCapture {
  readonly title: string;
  readonly lang: string | null;
  readonly textExcerpt: string;
  readonly textTruncated: boolean;
  readonly accessibility: AccessibilityEvidence;
}

/**
 * Walks the rendered document and returns the structural evidence the compliance skill cites.
 *
 * Runs in the browser. See this file's header for the constraints that implies.
 *
 * @param limits - Per-category caps, passed in rather than hardcoded so the collector's single
 * `SITE_EVIDENCE_LIMITS` constant is the only place any bound is defined.
 * @complexity O(n) in rendered element count, with every output list capped by `limits`.
 */
export function collectPageStructure(limits: PageStructureLimits): PageStructureCapture {
  const truncated: string[] = [];

  /** Whether `current` should end the selector walk, and if so, the segment to use: `html`/`body`
   *  by tag, or any ancestor's own `id`. Nested (not module-scope) alongside every other helper here
   *  — see this file's header for why that is not optional. */
  function terminalSegment(current: Element): string | null {
    const tag = current.tagName.toLowerCase();
    if (tag === "html" || tag === "body") return tag;
    if (current.id) return `#${CSS.escape(current.id)}`;
    return null;
  }

  /** The `tag` or `tag:nth-of-type(n)` segment for `current` among its siblings under `parent`. */
  function siblingSegment(current: Element, parent: Element): string {
    const tag = current.tagName.toLowerCase();
    const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
    return siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag;
  }

  /** A short, re-checkable CSS path for one element. Prefers an `id` (stable and readable), then a
   *  bounded `nth-of-type` chain. The path is a CITATION — a human must be able to paste it into
   *  devtools and land on the same element — so readability beats theoretical uniqueness. */
  function selectorFor(element: Element): string {
    if (element.id) return `#${CSS.escape(element.id)}`;

    const parts: string[] = [];
    let current: Element | null = element;
    let depth = 0;
    while (current && current.nodeType === 1 && depth < 5) {
      const terminal = terminalSegment(current);
      if (terminal !== null) {
        parts.unshift(terminal);
        break;
      }
      const parent: Element | null = current.parentElement;
      if (!parent) {
        parts.unshift(current.tagName.toLowerCase());
        break;
      }
      parts.unshift(siblingSegment(current, parent));
      current = parent;
      depth += 1;
    }
    return parts.join(" > ");
  }

  function textOf(element: Element, max: number): string {
    const raw = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    return raw.length > max ? `${raw.slice(0, max)}…` : raw;
  }

  // Each of the following is one accessible-name STRATEGY, tried in the order the accessible-name
  // computation spec prefers: `aria-label`, then `aria-labelledby`, then an explicit `<label for>`,
  // then a wrapping `<label>`, then `title`. Each returns `null` to fall through to the next; the
  // order and every reject/accept condition are unchanged from the pre-split function.
  function accessibleNameFromAriaLabel(element: Element): { name: string; source: string } | null {
    const ariaLabel = element.getAttribute("aria-label");
    return ariaLabel?.trim() ? { name: ariaLabel.trim(), source: "aria-label" } : null;
  }

  function accessibleNameFromAriaLabelledBy(element: Element): { name: string; source: string } | null {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (!labelledBy) return null;
    const names = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node !== null)
      .map((node) => textOf(node, 120))
      .filter((value) => value.length > 0);
    return names.length > 0 ? { name: names.join(" "), source: "aria-labelledby" } : null;
  }

  function accessibleNameFromLabelFor(element: Element): { name: string; source: string } | null {
    if (!element.id) return null;
    const forLabel = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (!forLabel) return null;
    const value = textOf(forLabel, 120);
    return value ? { name: value, source: "label-for" } : null;
  }

  function accessibleNameFromLabelWrap(element: Element): { name: string; source: string } | null {
    const wrapping = element.closest("label");
    if (!wrapping) return null;
    const value = textOf(wrapping, 120);
    return value ? { name: value, source: "label-wrap" } : null;
  }

  function accessibleNameFromTitle(element: Element): { name: string; source: string } | null {
    const title = element.getAttribute("title");
    return title?.trim() ? { name: title.trim(), source: "title" } : null;
  }

  function accessibleNameOf(element: Element): { name: string | null; source: string } {
    const strategies = [
      accessibleNameFromAriaLabel,
      accessibleNameFromAriaLabelledBy,
      accessibleNameFromLabelFor,
      accessibleNameFromLabelWrap,
      accessibleNameFromTitle,
    ];
    for (const strategy of strategies) {
      const found = strategy(element);
      if (found) return found;
    }
    return { name: null, source: "none" };
  }

  function capped<T>(items: T[], category: string): T[] {
    if (items.length > limits.maxNodesPerCategory) {
      truncated.push(category);
      return items.slice(0, limits.maxNodesPerCategory);
    }
    return items;
  }

  // --- landmarks -----------------------------------------------------------
  const LANDMARK_SELECTOR = "header,nav,main,aside,footer,form,section,[role]";
  const IMPLICIT_ROLES: Record<string, string> = {
    HEADER: "banner",
    NAV: "navigation",
    MAIN: "main",
    ASIDE: "complementary",
    FOOTER: "contentinfo",
    FORM: "form",
    SECTION: "region",
  };

  function collectLandmarks() {
    const out: { role: string; selector: string; accessibleName: string | null }[] = [];
    for (const element of Array.from(document.querySelectorAll(LANDMARK_SELECTOR))) {
      const explicit = element.getAttribute("role");
      const role = explicit?.trim() ? explicit.trim() : (IMPLICIT_ROLES[element.tagName] ?? "");
      if (!role) continue;
      out.push({ role, selector: selectorFor(element), accessibleName: accessibleNameOf(element).name });
    }
    return capped(out, "landmarks");
  }

  // --- headings ------------------------------------------------------------
  function collectHeadings() {
    const out: { level: number; selector: string; text: string }[] = [];
    for (const element of Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']"))) {
      const tagLevel = /^H([1-6])$/.exec(element.tagName);
      const ariaLevel = element.getAttribute("aria-level");
      const level = tagLevel ? Number(tagLevel[1]) : ariaLevel ? Number(ariaLevel) : 0;
      if (!Number.isFinite(level) || level === 0) continue;
      out.push({ level, selector: selectorFor(element), text: textOf(element, 160) });
    }
    return capped(out, "headings");
  }

  // --- images --------------------------------------------------------------
  function collectImages() {
    const out: { selector: string; src: string; alt: string | null; ariaHidden: boolean }[] = [];
    for (const element of Array.from(document.querySelectorAll("img"))) {
      const image = element as HTMLImageElement;
      out.push({
        selector: selectorFor(image),
        // `getAttribute` rather than `.src`: the authored value is what a reviewer will look for in
        // the template, and `.src` would resolve it against the document, changing the citation.
        src: image.getAttribute("src") ?? "",
        alt: image.hasAttribute("alt") ? image.getAttribute("alt") : null,
        ariaHidden: image.getAttribute("aria-hidden") === "true",
      });
    }
    return capped(out, "images");
  }

  // --- form controls -------------------------------------------------------
  function collectFormControls() {
    const out: {
      selector: string;
      tag: string;
      type: string | null;
      name: string | null;
      accessibleName: string | null;
      labelSource: string;
      required: boolean;
    }[] = [];
    for (const element of Array.from(document.querySelectorAll("input,select,textarea"))) {
      const type = element.getAttribute("type");
      // A hidden input has no rendered presence and no labelling obligation; including it would pad
      // every finding list with noise a reviewer then has to filter out by hand.
      if (element.tagName === "INPUT" && type === "hidden") continue;
      const { name, source } = accessibleNameOf(element);
      out.push({
        selector: selectorFor(element),
        tag: element.tagName.toLowerCase(),
        type,
        name: element.getAttribute("name"),
        accessibleName: name,
        labelSource: source,
        required: element.hasAttribute("required") || element.getAttribute("aria-required") === "true",
      });
    }
    return capped(out, "formControls");
  }

  // --- contrast ------------------------------------------------------------
  function parseColor(value: string): [number, number, number, number] | null {
    const match = /^rgba?\(([^)]+)\)$/.exec(value.trim());
    if (!match) return null;
    const parts = (match[1] as string).split(/[,\s/]+/).filter((part) => part.length > 0).map(Number);
    const [r, g, b] = parts;
    if (r === undefined || g === undefined || b === undefined) return null;
    const alpha = parts.length > 3 ? (parts[3] as number) : 1;
    return [r, g, b, alpha];
  }

  function relativeLuminance([r, g, b]: [number, number, number, number]): number {
    const channel = (raw: number): number => {
      const c = raw / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  function composite(fg: [number, number, number, number], bg: [number, number, number, number]): [number, number, number, number] {
    const alpha = fg[3];
    return [fg[0] * alpha + bg[0] * (1 - alpha), fg[1] * alpha + bg[1] * (1 - alpha), fg[2] * alpha + bg[2] * (1 - alpha), 1];
  }

  /** Composite translucent backgrounds from the outermost ancestor onto a white fallback.
   * Images and gradients remain outside this bounded colour-pair sample. */
  function effectiveBackground(element: Element): string {
    const layers: Array<[number, number, number, number]> = [];
    let current: Element | null = element;
    while (current) {
      const parsed = parseColor(getComputedStyle(current).backgroundColor);
      if (parsed && parsed[3] > 0) {
        layers.push(parsed);
        if (parsed[3] === 1) break;
      }
      current = current.parentElement;
    }
    let background: [number, number, number, number] = [255, 255, 255, 1];
    for (const layer of layers.reverse()) background = composite(layer, background);
    return `rgb(${background[0]}, ${background[1]}, ${background[2]})`;
  }

  const CONTRAST_CANDIDATE_SELECTOR = "p,li,a,button,h1,h2,h3,h4,h5,h6,label,span,td,th";

  type ContrastSample = {
    selector: string;
    foreground: string;
    background: string;
    ratio: number;
    fontSizePx: number;
    fontWeight: number;
  };

  /** Only leaf-ish text with real content: a wrapper repeats its children's colours and would crowd
   *  the sample set with duplicates of the same real pair. */
  function hasOwnSampleableText(element: Element): boolean {
    const text = (element.textContent ?? "").trim();
    if (text.length === 0) return false;
    return !element.querySelector(CONTRAST_CANDIDATE_SELECTOR);
  }

  function isRenderedVisible(element: Element, style: CSSStyleDeclaration): boolean {
    if (style.visibility === "hidden" || style.display === "none") return false;
    // display is not inherited: a hidden subtree's child can still compute display:block.
    let ancestor = element.parentElement;
    while (ancestor) {
      if (getComputedStyle(ancestor).display === "none") return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  }

  /** Computes one contrast sample for an element already known to be sampleable and visible, or
   *  `null` when its colours cannot be parsed.
   *
   *  INVARIANT: `bg` can never actually be null, only `fg` can. `background` comes from
   *  `effectiveBackground`, which has exactly two return paths: an ancestor's `backgroundColor`
   *  that `parseColor` has ALREADY parsed successfully (that is what `parsed[3] > 0` requires), or
   *  the hardcoded fallback literal `"rgb(255, 255, 255)"`, which trivially matches `parseColor`'s
   *  own regex. So `parseColor(effectiveBackground(element))` is guaranteed non-null. `fg`, by
   *  contrast, comes straight from the browser's own `style.color` serialization, which is not
   *  guaranteed to be `rgb()`/`rgba()` syntax (e.g. newer CSS Color 4 syntaxes some engines may
   *  report) — that is the one this guard exists to catch.
   *
   *  Kept as `!fg || !bg` (not narrowed to `!fg`) deliberately: this file's header forbids hoisting
   *  helpers out of `collectPageStructure`'s closure for serialization across the Playwright
   *  `page.evaluate` boundary (see file header), so there is no seam here that would let a test
   *  inject an unparseable `effectiveBackground` result without changing `effectiveBackground`'s own
   *  behavior. Removing the `!bg` half would encode "we are certain this never happens" as an
   *  assumption baked into the return type instead of a runtime check — if `effectiveBackground`'s
   *  fallback literal is ever changed to something not always parseable, this guard is what keeps a
   *  malformed sample from reaching `relativeLuminance` instead of failing loudly. */
  function contrastSampleFor(element: Element, style: CSSStyleDeclaration): ContrastSample | null {
    const foreground = style.color;
    const background = effectiveBackground(element);
    const fg = parseColor(foreground);
    const bg = parseColor(background);
    if (!fg || !bg) {
      truncated.push("contrastSamples:unparsed-colour");
      return null;
    }

    const l1 = relativeLuminance(composite(fg, bg));
    const l2 = relativeLuminance(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

    return {
      selector: selectorFor(element),
      foreground,
      background,
      ratio: Math.round(ratio * 100) / 100,
      fontSizePx: Math.round(parseFloat(style.fontSize) * 10) / 10,
      fontWeight: Number(style.fontWeight) || 400,
    };
  }

  function collectContrastSamples() {
    const out: ContrastSample[] = [];

    const candidates = Array.from(document.querySelectorAll(CONTRAST_CANDIDATE_SELECTOR));
    for (const element of candidates) {
      if (out.length >= limits.maxContrastSamples) {
        truncated.push("contrastSamples");
        break;
      }
      if (!hasOwnSampleableText(element)) continue;

      const style = getComputedStyle(element);
      if (!isRenderedVisible(element, style)) continue;

      const sample = contrastSampleFor(element, style);
      if (sample) out.push(sample);
    }
    return out;
  }

  // --- document ------------------------------------------------------------
  const bodyText = (document.body?.innerText ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const textTruncated = bodyText.length > limits.maxTextExcerptChars;

  const accessibility: AccessibilityEvidence = limits.collectAccessibility
    ? {
        landmarks: collectLandmarks(),
        headings: collectHeadings(),
        images: collectImages(),
        formControls: collectFormControls(),
        contrastSamples: collectContrastSamples(),
        truncated: Array.from(new Set(truncated)),
      }
    : { landmarks: [], headings: [], images: [], formControls: [], contrastSamples: [], truncated: ["not-collected"] };

  return {
    title: document.title,
    lang: document.documentElement.getAttribute("lang"),
    textExcerpt: textTruncated ? bodyText.slice(0, limits.maxTextExcerptChars) : bodyText,
    textTruncated,
    accessibility,
  };
}
