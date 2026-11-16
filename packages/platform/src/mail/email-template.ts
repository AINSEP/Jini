import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import { htmlToText, stripActiveHtml } from "../web/html-document.js";

/**
 * @file Email templates as plain HTML documents: `{{field}}` fill-ins, the template's own
 * declarations (subject and fields, read out of its HTML), and the two renders — the PREVIEW, which
 * keeps the template's scripts because a host shows it inside a sandboxed preview iframe, and the
 * SEND render, which is static HTML because mail clients strip script anyway and a message that
 * relied on it would arrive broken.
 *
 * Everything a template declares lives in its HTML, not in extra storage fields: the host keeps one
 * HTML body per template, and that body is the single source of truth an editor changes with
 * full-document writes.
 *
 * - Subject: the document's `<title>` (it may itself contain `{{field}}`s).
 * - Fields: `<meta name="email-fields" content="name=Ada, orderId">` — comma-separated names, each
 *   optionally `=sample` (the value a preview shows when the caller gives none).
 *
 * Pure, no I/O. Importing this entry needs the optional `parse5` peer (README.md).
 */

type ParentNode = DefaultTreeAdapterMap["parentNode"];
type ChildNode = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];

/** The `<meta name>` a template declares its fill-in fields with. */
export const EMAIL_FIELDS_META_NAME = "email-fields";

/** `{{ name }}` — a field name is an identifier, optionally dotted or dashed. */
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/** Tags a sent email never carries: embedded documents and plugins, on top of `stripActiveHtml`'s. */
const SEND_STRIPPED_TAGS: ReadonlySet<string> = new Set(["iframe", "object", "embed", "frame", "frameset", "applet", "base", "form", "link"]);
/** Script-bearing URL schemes; tested after removing the whitespace/control characters a browser ignores. */
const ACTIVE_URL = /^(?:javascript|vbscript):/i;

export interface EmailTemplateField {
  name: string;
  /** Shown by the preview when the caller gives no value for this field. */
  sample?: string;
}

export interface EmailTemplateDeclarations {
  /** The raw `<title>` text, placeholders unfilled; `""` when the template has none. */
  subject: string;
  fields: EmailTemplateField[];
}

export type EmailFieldValues = Readonly<Record<string, string>>;

export interface FilledText {
  text: string;
  /** Placeholders the values did not cover, in first-use order; each was rendered empty. */
  missingFields: string[];
}

/** The `{{field}}` names a string uses, de-duplicated in first-use order. */
export function placeholdersIn({ text }: { text: string }, _optional: Record<string, never> = {}): string[] {
  // PLACEHOLDER requires this capture; narrow it explicitly because indexed reads may be undefined.
  const names = [...text.matchAll(PLACEHOLDER)].map((match) => match[1]).filter((name): name is string => name !== undefined);
  return [...new Set(names)];
}

/** Escapes a value for HTML text AND quoted-attribute context. */
export function escapeHtml({ value }: { value: string }, _optional: Record<string, never> = {}): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Replaces every `{{field}}` with its value. An unknown field renders empty — never the literal
 * braces a recipient would see — and is reported so the caller can refuse or warn.
 * @param required.escape - Applied to every value: {@link escapeHtml} for HTML, identity for a subject.
 * @complexity O(n) in the text length.
 */
export function fillPlaceholders(
  { text, values, escape: escapeValue }: { text: string; values: EmailFieldValues; escape: (required: { value: string }) => string },
  _optional: Record<string, never> = {},
): FilledText {
  const missing = new Set<string>();
  const filled = text.replace(PLACEHOLDER, (_match, name: string) => {
    if (!Object.hasOwn(values, name)) {
      missing.add(name);
      return "";
    }
    // Own keys contain strings by contract; the default also makes the indexed read explicit.
    return escapeValue({ value: values[name] ?? "" });
  });
  return { text: filled, missingFields: [...missing] };
}

/** One `name` or `name=sample` entry; `null` for a malformed name, which is ignored. */
function parseFieldEntry({ entry }: { entry: string }, _options: Record<string, never> = {}): EmailTemplateField | null {
  const separator = entry.indexOf("=");
  const name = (separator === -1 ? entry : entry.slice(0, separator)).trim();
  if (!FIELD_NAME.test(name)) return null;
  if (separator === -1) return { name };
  return { name, sample: entry.slice(separator + 1).trim() };
}

/** The declared fields from a `content` attribute, first declaration of a name winning. */
export function parseFieldDeclarations({ content }: { content: string }, _optional: Record<string, never> = {}): EmailTemplateField[] {
  const byName = new Map<string, EmailTemplateField>();
  for (const entry of content.split(",")) {
    const field = parseFieldEntry({ entry: entry });
    if (field && !byName.has(field.name)) byName.set(field.name, field);
  }
  return [...byName.values()];
}

/** Writes a field list back into the `content` form {@link parseFieldDeclarations} reads. */
export function formatFieldDeclarations({ fields }: { fields: readonly EmailTemplateField[] }, _optional: Record<string, never> = {}): string {
  return fields.map((field) => (field.sample === undefined ? field.name : `${field.name}=${field.sample}`)).join(", ");
}

function isElement(node: ChildNode | ParentNode): node is Element {
  return "tagName" in node;
}

function attribute({ element, name }: { element: Element; name: string }, _options: Record<string, never> = {}): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

/** Every element under `root`, in document order (so "the first `<title>`" means the first one written). */
function* elementsIn(root: ParentNode, _options: Record<string, never> = {}): Generator<Element> {
  const pending: ParentNode[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    // Array length checks do not narrow pop() or indexed reads under the desktop config.
    if (node === undefined) continue;
    if (isElement(node)) yield node;
    queueChildParents({ node, pending });
  }
}

/** Reverse insertion preserves document order on the traversal's stack. */
function queueChildParents({ node, pending }: { node: ParentNode; pending: ParentNode[] }, _options = {}): void {
  for (let i = node.childNodes.length - 1; i >= 0; i--) {
    const child = node.childNodes[i];
    if (child !== undefined && "childNodes" in child) pending.push(child);
  }
}

function textOf(element: Element, _options: Record<string, never> = {}): string {
  return element.childNodes.map((child) => ("value" in child && child.nodeName === "#text" ? child.value : "")).join("");
}

function isFieldsMeta(element: Element, _options: Record<string, never> = {}): boolean {
  return element.tagName === "meta" && attribute({ element: element, name: "name" })?.toLowerCase() === EMAIL_FIELDS_META_NAME;
}

/**
 * Reads a template's subject (`<title>`) and declared fields (`<meta name="email-fields">`).
 * @complexity O(nodes).
 */
export function readTemplateDeclarations({ html }: { html: string }, _optional: Record<string, never> = {}): EmailTemplateDeclarations {
  let subject: string | undefined;
  let fields: EmailTemplateField[] = [];
  let fieldsDeclared = false;
  for (const element of elementsIn(parse(html))) {
    // HTML namespace only: an inline `<svg><title>` is an image's tooltip, not the subject.
    if (element.tagName === "title" && element.namespaceURI === HTML_NAMESPACE && subject === undefined) subject = textOf(element).trim();
    if (isFieldsMeta(element) && !fieldsDeclared) {
      fieldsDeclared = true;
      fields = parseFieldDeclarations({ content: attribute({ element: element, name: "content" }) ?? "" });
    }
  }
  return { subject: subject ?? "", fields };
}

/** Placeholders used in the HTML (subject included) that the template never declared. */
export function undeclaredFieldsIn({ html, declarations }: { html: string; declarations: EmailTemplateDeclarations }, _optional: Record<string, never> = {}): string[] {
  const declared = new Set(declarations.fields.map((field) => field.name));
  return placeholdersIn({ text: html }).filter((name) => !declared.has(name));
}

/** True when an attribute value would run script once a browser normalizes it as a URL. Tested on
 * every attribute, not only `href`/`src`, the same breadth `stripActiveHtml` applies. */
function isActiveUrl({ value }: { value: string }, _options: Record<string, never> = {}): boolean {
  // Browsers drop ASCII tab/newline anywhere in a URL and leading C0 controls/space, so
  // `java\nscript:` is still script; `stripActiveHtml`'s own test only trims leading whitespace.
  const normalized = value.split("").filter(character => character.charCodeAt(0) > 0x20).join("");
  return ACTIVE_URL.test(normalized) || (/^data:/i.test(normalized) && !/^data:image\/[^;,]+[;,]/i.test(normalized));
}

/** Static mail excludes navigation instructions, form submissions and external stylesheets. */
function stripMailElement({ child }: { child: ChildNode }, _optional: Record<string, never> = {}): boolean {
  if (!isElement(child)) return false;
  if (SEND_STRIPPED_TAGS.has(child.tagName) || isFieldsMeta(child)) return true;
  return child.tagName === "meta" && attribute({ element: child, name: "http-equiv" }) !== undefined;
}

/** Second, email-specific pass after `stripActiveHtml`: embeds, obfuscated script URLs, the fields meta. */
function stripForMail(root: ParentNode, _options: Record<string, never> = {}): void {
  for (const node of elementsIn(root)) {
    node.childNodes = node.childNodes.filter((child) => !stripMailElement({ child }));
    node.attrs = node.attrs.filter((attr) => !isActiveUrl({ value: attr.value }));
  }
}

/**
 * The static HTML a mail client receives: `<script>`/`<noscript>`/`<template>`, comments, inline
 * `on*` handlers and `javascript:` URLs removed (the shared `stripActiveHtml` policy), then
 * `<iframe>`/`<object>`/`<embed>` (and their legacy kin), obfuscated script URLs and the template's
 * own field declarations. Navigation/form/link elements and non-image data URLs are removed.
 * Inline styles and classes survive: email layout depends on them.
 *
 * Known cost: comments are removed, so Outlook `<!--[if mso]>` conditional blocks do not survive.
 * @complexity O(nodes), two parses.
 */
export function sanitizeEmailHtml({ html }: { html: string }, _optional: Record<string, never> = {}): string {
  const document = parse(stripActiveHtml({ html }));
  stripForMail(document);
  return serialize(document);
}

/** A visible ` (url)` after a link whose text is not already its URL, so the text part keeps links. */
function annotateLinks(root: ParentNode, _options: Record<string, never> = {}): void {
  for (const element of elementsIn(root)) {
    const href = element.tagName === "a" ? attribute({ element: element, name: "href" })?.trim() : undefined;
    if (!href || !/^(?:https?:|mailto:)/i.test(href) || textOf(element).trim() === href) continue;
    element.childNodes.push({ nodeName: "#text", value: ` (${href.replace(/^mailto:/i, "")})`, parentNode: element } as ChildNode);
  }
}

/**
 * The plain-text alternative: the shared `htmlToText` (one line per block; head, scripts and styles
 * omitted), with each link's URL written after its text so a text-only reader can still follow it.
 * @complexity O(nodes).
 */
export function emailHtmlToText({ html }: { html: string }, _optional: Record<string, never> = {}): string {
  const document = parse(html);
  annotateLinks(document);
  return htmlToText({ html: serialize(document) });
}

/** A subject is one header line: fill raw (it is not HTML) and fold any line break a value carried. */
function renderSubject({ subject, values }: { subject: string; values: EmailFieldValues }, _options: Record<string, never> = {}): FilledText {
  const filled = fillPlaceholders({ text: subject, values, escape: ({ value }) => value });
  return { text: filled.text.replace(/[\r\n]+/g, " ").trim(), missingFields: filled.missingFields };
}

export interface RenderedEmail {
  subject: string;
  html: string;
  /** Placeholders no value covered, subject and body together; each rendered empty. */
  missingFields: string[];
}

function renderWith({ html, values }: { html: string; values: EmailFieldValues }, _options: Record<string, never> = {}): RenderedEmail {
  const declarations = readTemplateDeclarations({ html });
  const subject = renderSubject({ subject: declarations.subject, values: values });
  const body = fillPlaceholders({ text: html, values, escape: escapeHtml });
  return { subject: subject.text, html: body.text, missingFields: [...new Set([...subject.missingFields, ...body.missingFields])] };
}

/** The values a preview renders with: declared samples, overridden by whatever the caller gave. */
export function previewValues(
  { declarations, values }: { declarations: EmailTemplateDeclarations; values: EmailFieldValues },
  _optional: Record<string, never> = {},
): Record<string, string> {
  const samples = declarations.fields.flatMap((field) => (field.sample === undefined ? [] : [[field.name, field.sample] as const]));
  return { ...Object.fromEntries(samples), ...values };
}

/**
 * The preview render. Scripts are KEPT: show the result only in an iframe sandboxed without
 * `allow-same-origin`, so they run in an opaque origin.
 * @complexity O(n) in the template length.
 */
export function renderEmailPreview({ html, values }: { html: string; values: EmailFieldValues }, _optional: Record<string, never> = {}): RenderedEmail {
  const declarations = readTemplateDeclarations({ html });
  return renderWith({ html: html, values: previewValues({ declarations, values }) });
}

export interface SendableEmail extends RenderedEmail {
  /** The plain-text alternative, derived from the sanitized HTML. */
  text: string;
}

/**
 * Template + values -> the `subject`/`html`/`text` an `OutboundEmail` carries. Values are filled
 * BEFORE sanitizing, so a value that smuggles a `javascript:` URL into an `href="{{url}}"` is
 * removed with everything else. Samples are never used: a sent email shows only real values.
 * @complexity O(n) in the template length.
 */
export function renderEmailForSend({ html, values }: { html: string; values: EmailFieldValues }, _optional: Record<string, never> = {}): SendableEmail {
  const rendered = renderWith({ html: html, values: values });
  const safeHtml = sanitizeEmailHtml({ html: rendered.html });
  return { subject: rendered.subject, html: safeHtml, text: emailHtmlToText({ html: safeHtml }), missingFields: rendered.missingFields };
}

/** The starter body a template is born with when its creator gives no HTML. */
export function emailTemplateSkeleton(
  { subject, fields }: { subject: string; fields: readonly EmailTemplateField[] },
  _optional: Record<string, never> = {},
): string {
  const meta = fields.length > 0 ? `\n<meta name="${EMAIL_FIELDS_META_NAME}" content="${escapeHtml({ value: formatFieldDeclarations({ fields }) })}">` : "";
  // Guard the first field itself so an empty list keeps its plain greeting.
  const firstField = fields[0];
  const greeting = firstField === undefined ? "Hello," : `Hello {{${firstField.name}}},`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${meta}
<title>${escapeHtml({ value: subject })}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
<tr><td align="center" style="padding:24px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;">
<tr><td style="padding:32px;font-size:16px;line-height:1.5;">
<p>${greeting}</p>
<p></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}
