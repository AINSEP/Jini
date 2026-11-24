import { maskNonRenderableRegions } from "../widgets/markers/marker.js";

/**
 * @file Finds page markup that is hidden until a script reveals it — and so is hidden for good on a
 * host page.
 *
 * Why: markup copied from another site keeps the source's scroll-reveal start state (Webflow and
 * Framer write `style="opacity:0"`, AOS/SAL/WOW.js add attributes or classes, hand-rolled sites ship
 * `.reveal { opacity: 0 }`), but never the script that flips it, because page HTML runs no source
 * script. The result is invisible or washed-out content that looks like a styling bug (Luvira
 * import, 2026-10-08). The page tools still write the markup — a hidden element can be deliberate —
 * and return these findings as a warning so the model fixes them on its next turn.
 *
 * PURE: string in, findings out. A tolerant scan over markup the assistant just wrote, not an HTML
 * parser; comments and raw-text elements are masked first through the shared widget-marker mask.
 */

/** Findings listed before the rest are summarised as a count. */
export const MAX_REVEAL_FINDINGS = 10;

const START_TAG = /<([a-z][a-z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTRIBUTE_NAME = /([^\s=/>"']+)/g;
const ATTRIBUTE_VALUE = /\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/y;
/** Exactly zero opacity or `visibility: hidden` — `opacity: 0.5` is a design choice, not hidden. */
const ZERO_OPACITY = /^\s*(opacity\s*:\s*0(?:\.0+)?%?)\s*(?:!important\s*)?$/i;
const HIDDEN_VISIBILITY = /^\s*(visibility\s*:\s*hidden)\s*(?:!important\s*)?$/i;
/** Attributes only scroll-reveal libraries write (AOS, SAL, ScrollReveal). */
const REVEAL_ATTRIBUTES: readonly string[] = ["data-aos", "data-sal", "data-sr-id"];
/** Classes only scroll-reveal libraries need (WOW.js hides `.wow` until it runs). */
const REVEAL_CLASSES: readonly string[] = ["wow"];
/** A hidden `<style>` rule is reported only for reveal-named selectors: a hover overlay at opacity 0 is ordinary. */
const REVEAL_SELECTOR = /reveal|fade|animate|aos|wow|in-?view|appear|scroll|sal-/i;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const KEYFRAMES_BLOCK = /@(?:-[a-z]+-)?keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi;

function readAttributes({ raw }: { raw: string }, _optional: Record<string, never> = {}): Map<string, string> {
  const attributes = new Map<string, string>();
  ATTRIBUTE_NAME.lastIndex = 0;
  for (let name = ATTRIBUTE_NAME.exec(raw); name; name = ATTRIBUTE_NAME.exec(raw)) {
    ATTRIBUTE_VALUE.lastIndex = ATTRIBUTE_NAME.lastIndex;
    const value = ATTRIBUTE_VALUE.exec(raw);
    if (value) ATTRIBUTE_NAME.lastIndex = ATTRIBUTE_VALUE.lastIndex;
    attributes.set(name[1]!.toLowerCase(), value?.[1] ?? value?.[2] ?? value?.[3] ?? "");
  }
  return attributes;
}

function hidingDeclaration({ declarations }: { declarations: string }, _optional: Record<string, never> = {}): string | undefined {
  for (const declaration of declarations.trim().split(";")) {
    const hidden = ZERO_OPACITY.exec(declaration) ?? HIDDEN_VISIBILITY.exec(declaration);
    if (hidden) return hidden[1];
  }
  return undefined;
}

/** The one reason this element is hidden until a script runs, or `undefined`. */
function elementReason({ attributes }: { attributes: Map<string, string> }, _optional: Record<string, never> = {}): string | undefined {
  const inline = hidingDeclaration({ declarations: attributes.get("style") ?? "" });
  if (inline !== undefined) return `inline style ${inline}`;
  const attribute = REVEAL_ATTRIBUTES.find((name) => attributes.has(name));
  if (attribute !== undefined) return `${attribute} (a scroll-reveal library attribute)`;
  const classes = (attributes.get("class") ?? "").split(/\s+/);
  const revealClass = REVEAL_CLASSES.find((name) => classes.includes(name));
  return revealClass === undefined ? undefined : `class "${revealClass}" (a scroll-reveal library class)`;
}

function elementFindings({ html }: { html: string }, _optional: Record<string, never> = {}): string[] {
  const findings: string[] = [];
  for (const match of maskNonRenderableRegions({ html }).matchAll(START_TAG)) {
    const attributes = readAttributes({ raw: match[2]! });
    const reason = elementReason({ attributes });
    if (reason === undefined) continue;
    const className = attributes.get("class");
    const classAttribute = className ? ` class="${className}"` : "";
    findings.push(`<${match[1]!.toLowerCase()}${classAttribute}> has ${reason}`);
  }
  return findings;
}

function cssRuleFindings({ css }: { css: string }, _optional: Record<string, never> = {}): string[] {
  const findings: string[] = [];
  const parts = css.split(/([{}])/);
  for (let i = 1; i + 2 < parts.length; i += 2) {
    if (parts[i] !== "{" || parts[i + 2] !== "}" || parts[i - 1] === "") continue;
    const selector = parts[i - 1]!.trim().replace(/\s+/g, " ");
    const hidden = hidingDeclaration({ declarations: parts[i + 1]! });
    if (hidden !== undefined && !selector.startsWith("@") && REVEAL_SELECTOR.test(selector)) findings.push(`<style> rule "${selector}" sets ${hidden}`);
  }
  return findings;
}

function styleRuleFindings({ html }: { html: string }, _optional: Record<string, never> = {}): string[] {
  const findings: string[] = [];
  for (const block of html.replace(HTML_COMMENT, "").matchAll(STYLE_BLOCK)) {
    const css = block[1]!.replace(CSS_COMMENT, "").replace(KEYFRAMES_BLOCK, "");
    findings.push(...cssRuleFindings({ css }));
  }
  return findings;
}

/**
 * Lists every element (and every reveal-named `<style>` rule) that stays hidden without the source
 * site's reveal script, element findings in document order, then style rules.
 * @param required.html - Page HTML or a region fragment.
 * @returns Human-readable findings, at most {@link MAX_REVEAL_FINDINGS} plus a trailing "...and N more."; empty when clean.
 * @complexity O(n) in the markup length.
 */
export function findScriptRevealedContent({ html }: { html: string }, _optional: {} = {}): readonly string[] {
  const findings = [...elementFindings({ html }), ...styleRuleFindings({ html })];
  if (findings.length <= MAX_REVEAL_FINDINGS) return findings;
  return [...findings.slice(0, MAX_REVEAL_FINDINGS), `...and ${findings.length - MAX_REVEAL_FINDINGS} more.`];
}

/**
 * The model-facing warning for a write whose markup has findings, or `undefined` when it has none.
 * @complexity O(n) in the markup length.
 */
export function describeScriptRevealedContent({ html }: { html: string }, _optional: {} = {}): string | undefined {
  const findings = findScriptRevealedContent({ html });
  if (findings.length === 0) return undefined;
  return (
    "Written, but some of this markup stays invisible: it is hidden until a scroll-reveal script runs, and no " +
    "page script on this site reveals it. Remove the hiding style, attribute or class (or set the element's " +
    `visible state) and write it again: ${findings.join("; ")}`
  );
}
