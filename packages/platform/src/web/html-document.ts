import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import { firstDistinct } from "./first-distinct.js";

/**
 * @file One parse5 pass over an UNTRUSTED public HTML page: page facts (title, description, lang,
 * meta), absolute links/images/stylesheets, visible text and a script-free HTML copy. Vendor-neutral
 * and host-free, shared by public-page readers.
 */

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export interface PageLink { href: string; text: string; internal: boolean }
export interface PageImage { src: string; alt: string }
export interface HtmlDocumentFacts {
  title?: string;
  description?: string;
  lang?: string;
  links: PageLink[];
  linksTruncated: boolean;
  images: PageImage[];
  imagesTruncated: boolean;
  stylesheets: string[];
  meta: Record<string, string>;
}

export const MAX_LINKS = 500;
export const MAX_IMAGES = 300;
const MAX_STYLESHEETS = 100;
const MAX_META = 60;
const MAX_LINK_TEXT = 200;
const MAX_META_VALUE = 500;
export const LINK_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:", "mailto:", "tel:"]);
export const ASSET_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);
/** Never visible and never page content; removed from the text and the returned HTML copy. */
const STRIPPED = new Set(["script", "noscript", "template"]);
/** Not visible text either, but `style` stays in the HTML copy because theming needs it. */
const INVISIBLE = new Set([...STRIPPED, "style", "head", "svg", "iframe", "object", "canvas"]);
const BLOCKS = new Set(["address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "td", "th", "tr", "ul"]);
/** `meta name=` keys worth returning; every `og:*` property is returned as well. */
const META_NAMES = new Set(["generator", "theme-color", "author", "keywords", "twitter:title", "twitter:description", "twitter:image", "application-name"]);

export function attr({ element, name }: { element: Element; name: string }, _optional: Record<string, never> = {}): string | undefined {
  return element.attrs.find(a => a.name === name)?.value;
}

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

/** Iterative pre-order walk: deeply nested hostile HTML cannot overflow the stack. O(nodes). */
function* walk(root: Node): Generator<Node> {
  const pending: Node[] = [root];
  while (pending.length) {
    const node = pending.pop()!;
    yield node;
    // Read after the yield on purpose: stripActiveHtml filters childNodes in between.
    const children = "childNodes" in node ? node.childNodes : [];
    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]!);
  }
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function textOf(root: Node): string {
  const parts: string[] = [];
  for (const node of walk(root)) if (node.nodeName === "#text" && "value" in node) parts.push(node.value);
  return collapse(parts.join(" "));
}

/** Resolves against `base`; drops fragment-only, unparseable and other-protocol values, and fragments. */
export function absolute({ raw, base, protocols }: { raw: string | undefined; base: string; protocols: ReadonlySet<string> }, _optional: Record<string, never> = {}): string | undefined {
  const value = raw?.trim();
  if (!value || value.startsWith("#")) return undefined;
  let url: URL;
  try { url = new URL(value, base); } catch { return undefined; }
  if (!protocols.has(url.protocol)) return undefined;
  if (url.protocol === "http:" || url.protocol === "https:") url.hash = "";
  return url.href;
}

function siteHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function isInternal(href: string, pageHost: string): boolean {
  const url = new URL(href);
  return (url.protocol === "http:" || url.protocol === "https:") && siteHost(url.hostname) === pageHost;
}

function linkText(anchor: Element): string {
  const text = textOf(anchor) || attr({ element: anchor, name: "aria-label" }) || attr({ element: anchor, name: "title" }) || "";
  if (text) return collapse(text).slice(0, MAX_LINK_TEXT);
  for (const node of walk(anchor)) if (isElement(node) && node.tagName === "img") return collapse(attr({ element: node, name: "alt" }) ?? "").slice(0, MAX_LINK_TEXT);
  return "";
}

/** First usable image URL: lazy loaders park the real one in `data-src` behind a `data:` placeholder. */
export function imageSource({ img }: { img: Element }, _optional: Record<string, never> = {}): string | undefined {
  const src = attr({ element: img, name: "src" });
  if (src && !src.trim().startsWith("data:")) return src;
  return attr({ element: img, name: "data-src" }) ?? attr({ element: img, name: "data-lazy-src" }) ?? attr({ element: img, name: "srcset" })?.trim().split(/\s+/)[0];
}

interface RawFacts { anchors: Element[]; images: Element[]; linkTags: Element[]; metas: Element[]; title?: Element; html?: Element; base?: string | undefined }

/** A Map, not an object literal, so tag names such as `constructor` never hit Object.prototype. */
const COLLECTED: ReadonlyMap<string, "anchors" | "images" | "linkTags" | "metas"> = new Map<string, "anchors" | "images" | "linkTags" | "metas">([["a", "anchors"], ["img", "images"], ["link", "linkTags"], ["meta", "metas"]]);

function collect(document: Node): RawFacts {
  const raw: RawFacts = { anchors: [], images: [], linkTags: [], metas: [] };
  for (const node of walk(document)) {
    if (isElement(node)) collectElement(raw, node);
  }
  return raw;
}

function collectElement(raw: RawFacts, node: Element): void {
  const list = COLLECTED.get(node.tagName);
  if (list) {
    raw[list].push(node);
    return;
  }
  if (node.tagName === "title" || node.tagName === "html") {
    raw[node.tagName] ??= node;
    return;
  }
  // The first base WITH an href wins, as in browsers.
  if (node.tagName === "base") raw.base ??= attr({ element: node, name: "href" });
}

/** Meta keys whose values are URLs and are returned absolute. */
const URL_META: ReadonlySet<string> = new Set(["og:image", "og:url", "twitter:image"]);
/** `<link rel>` tokens copied into meta, in emission order, under their meta key. */
const LINK_META: ReadonlyArray<readonly [rel: string, key: string]> = [["canonical", "canonical"], ["icon", "favicon"], ["apple-touch-icon", "apple-touch-icon"]];

function readMeta(raw: RawFacts, base: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const element of raw.metas) {
    const entry = metaTagEntry({ element, base });
    if (entry) putMeta({ meta, key: entry[0], value: entry[1] });
  }
  for (const element of raw.linkTags) {
    const rels = relTokens({ element });
    const href = absolute({ raw: attr({ element, name: "href" }), base, protocols: ASSET_PROTOCOLS });
    for (const [rel, key] of LINK_META) if (rels.includes(rel)) putMeta({ meta, key, value: href });
  }
  return meta;
}

/** First value per key wins; the entry count and each value are capped. */
function putMeta({ meta, key, value }: { meta: Record<string, string>; key: string; value: string | undefined }, _optional: Record<string, never> = {}): void {
  if (value === undefined || key in meta || Object.keys(meta).length >= MAX_META) return;
  meta[key] = collapse(value).slice(0, MAX_META_VALUE);
}

function metaKey({ property, name }: { property: string | undefined; name: string | undefined }): string | undefined {
  if (property?.startsWith("og:")) return property;
  return name && META_NAMES.has(name) ? name : undefined;
}

/** Every `og:*` property, or an allowlisted `name`; URL-valued keys are resolved. */
function metaTagEntry({ element, base }: { element: Element; base: string }, _optional: Record<string, never> = {}): [key: string, value: string | undefined] | undefined {
  const property = attr({ element, name: "property" })?.toLowerCase();
  const name = attr({ element, name: "name" })?.toLowerCase();
  const key = metaKey({ property, name });
  if (key === undefined) return undefined;
  const content = attr({ element, name: "content" });
  return [key, URL_META.has(key) ? absolute({ raw: content, base, protocols: ASSET_PROTOCOLS }) : content];
}

function relTokens({ element }: { element: Element }, _optional: Record<string, never> = {}): string[] {
  return (attr({ element, name: "rel" }) ?? "").toLowerCase().split(/\s+/);
}

function readLinks(anchors: Element[], base: string, pageHost: string): { links: PageLink[]; truncated: boolean } {
  const { picked, truncated } = firstDistinct({
    items: anchors,
    max: MAX_LINKS,
    keyOf: (anchor) => absolute({ raw: attr({ element: anchor, name: "href" }), base, protocols: LINK_PROTOCOLS }),
  });
  const links = picked.map(([href, anchor]) => ({ href, text: linkText(anchor), internal: isInternal(href, pageHost) }));
  return { links, truncated };
}

function readImages(images: Element[], base: string): { images: PageImage[]; truncated: boolean } {
  const { picked, truncated } = firstDistinct({
    items: images,
    max: MAX_IMAGES,
    keyOf: (img) => absolute({ raw: imageSource({ img }), base, protocols: ASSET_PROTOCOLS }),
  });
  const out: PageImage[] = picked.map(([src, img]) => ({ src, alt: collapse(attr({ element: img, name: "alt" }) ?? "") }));
  return { images: out, truncated };
}

function readStylesheets(linkTags: Element[], base: string): string[] {
  const out = new Set<string>();
  for (const element of linkTags) {
    const href = absolute({ raw: attr({ element, name: "href" }), base, protocols: ASSET_PROTOCOLS });
    if (relTokens({ element }).includes("stylesheet") && href && out.size < MAX_STYLESHEETS) out.add(href);
  }
  return [...out];
}

/**
 * Extracts page facts. Relative URLs resolve against `<base href>` (itself resolved against the page
 * URL) so links match what a browser would follow.
 * @param required.html - Decoded page source; untrusted.
 * @param required.pageUrl - The final URL the HTML was served from (after redirects).
 * @returns Facts with every URL absolute; links deduped (fragment-free) and capped at {@link MAX_LINKS},
 *   images at {@link MAX_IMAGES}; `internal` ignores a leading `www.`.
 * @complexity O(nodes) plus O(anchor subtree) per anchor for its text.
 */
export function readHtmlDocument({ html, pageUrl }: { html: string; pageUrl: string }, _optional: Record<string, never> = {}): HtmlDocumentFacts {
  const document = parse(html);
  const raw = collect(document);
  const base = absolute({ raw: raw.base, base: pageUrl, protocols: ASSET_PROTOCOLS }) ?? pageUrl;
  const pageHost = siteHost(new URL(pageUrl).hostname);
  const links = readLinks(raw.anchors, base, pageHost);
  const images = readImages(raw.images, base);
  return {
    ...headFacts({ raw }),
    links: links.links, linksTruncated: links.truncated,
    images: images.images, imagesTruncated: images.truncated,
    stylesheets: readStylesheets(raw.linkTags, base),
    meta: readMeta(raw, base),
  };
}

/** Title, description and lang; empty ones are absent keys. */
function headFacts({ raw }: { raw: RawFacts }, _optional: Record<string, never> = {}): Pick<HtmlDocumentFacts, "title" | "description" | "lang"> {
  const description = raw.metas.find(m => attr({ element: m, name: "name" })?.toLowerCase() === "description");
  const facts = {
    title: raw.title ? textOf(raw.title) : "",
    description: description ? collapse(attr({ element: description, name: "content" }) ?? "") : "",
    // parse5 always synthesizes the <html> element, so collect() always finds one.
    lang: attr({ element: raw.html!, name: "lang" })?.trim(),
  };
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value));
}

/**
 * Visible text with one line per block element; scripts, styles, `<head>`, SVG and embeds omitted.
 * @complexity O(nodes).
 */
export function htmlToText({ html }: { html: string }, _optional: Record<string, never> = {}): string {
  const pending: Array<Node | "\n"> = [parse(html)];
  const out: string[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    if (node === "\n") out.push("\n");
    else visitText({ node, pending, out });
  }
  return out.join("").split("\n").map(line => line.replace(/[^\S\n]+/g, " ").trim()).filter(Boolean).join("\n");
}

/** Emits a text node, or schedules a visible node's children, bracketed by newlines for blocks. */
function visitText({ node, pending, out }: { node: Node; pending: Array<Node | "\n">; out: string[] }, _optional: Record<string, never> = {}): void {
  if (isElement(node) && INVISIBLE.has(node.tagName)) return;
  if (node.nodeName === "#text" && "value" in node) { out.push(node.value); return; }
  if (!("childNodes" in node)) return;
  if (isElement(node) && BLOCKS.has(node.tagName)) { out.push("\n"); pending.push("\n"); }
  for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]!);
}

/**
 * The page HTML with `<script>`, `<noscript>`, `<template>`, comments, `on*` handler attributes and
 * `javascript:` attribute values removed (styles and classes kept: theming needs them). Re-serialized by parse5, so it is well-formed rather than byte-identical.
 * @complexity O(nodes).
 */
export function stripActiveHtml({ html }: { html: string }, _optional: Record<string, never> = {}): string {
  const document = parse(html);
  for (const node of walk(document)) {
    if (!("childNodes" in node)) continue;
    const parent = node as Node & { childNodes: Node[] };
    parent.childNodes = parent.childNodes.filter(child => child.nodeName !== "#comment" && !(isElement(child) && STRIPPED.has(child.tagName)));
    // Inert copy: an agent may paste this into a page, so handlers and script URLs never survive.
    if (isElement(node)) node.attrs = node.attrs.filter(a => !/^on/i.test(a.name) && !/^\s*javascript:/i.test(a.value));
  }
  return serialize(document);
}
