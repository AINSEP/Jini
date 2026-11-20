import { wrapListingItems } from "./html.js";
import { isAllowedHref, toAllowedHref } from "../navigation/href.js";
import { escapeHtml } from "@jini-ai/core/text";

/**
 * @file Pure entry-list renderer for the `{"type":"collection"}` static-tier marker (C3, plan lines
 * 168-191). Takes an already-fetched, already-formatted list of entries (C2's query result, reduced
 * to display values) and turns it into markup — cards, a plain list, or an operator-authored
 * template. Performs no I/O, no field-name humanization and no query logic; those live upstream
 * (`entries/public-list.ts`). Every entry value is attacker-shaped content (an operator's — or an
 * agent tool acting on an operator's behalf — free-text field value) that reaches every visitor of
 * the public site, so it is HTML-escaped on every path, matching this codebase's existing posture for
 * post-previews (`static-render.ts`'s `renderPostPreviewCard`) and menu links (`toAllowedHref`'s own doc).
 *
 * D1: entry pages are OFF. `href` is `EntryDisplayListPort`'s caller's already-resolved
 * `entryPublicHref(...)` result, which returns `null` while pages are off — a `null` href renders the
 * title as plain text, never a dead `<a>`.
 */

/** One already-formatted field value to show on a card/list item, or to fill a `{{fields.<name>}}`
 * template placeholder. `label` is already humanized by the caller ({@link humanizeFieldName} in
 * `entries/public-list.ts`); this module never derives a label from `name`. `kind` selects display
 * formatting — currently only `"boolean"` is special-cased (rendered as `"Yes"`/`"No"`); every other
 * kind is shown via `String(value)`. */
export interface EntryListFieldValue {
  readonly name: string;
  readonly label: string;
  readonly kind: string;
  readonly value: unknown;
}

/** One entry, already reduced to exactly what a card/list item or an author template can show.
 * `href` is `null` when entry pages are off (D1) or the entry has none — the title then renders as
 * plain text with no `<a>`. `dateIso`/`dateLabel` exist only for the `{{date}}` template placeholder;
 * neither the default card nor list markup shows a date (plan lines 176-178 name only the title and
 * the fields `<dl>`). */
export interface EntryListItem {
  readonly title: string;
  readonly href: string | null;
  readonly dateIso: string;
  readonly dateLabel: string;
  readonly fields: readonly EntryListFieldValue[];
}

/** Per-marker rendering knobs. `template`, when present, switches `renderEntryList` into
 * author-template mode: the built-in cards/list markup is skipped entirely and `template` is repeated
 * once per item with its placeholders substituted. `columns` only affects the cards grid's CSS
 * variable; it is ignored in list and template mode. `typeKey` names the collection's content type,
 * used only for the `entry-list--<key>` class. */
export interface EntryListRenderOptions {
  readonly template?: string;
  readonly columns: number;
  /** `accordion`/`carousel` (AW-7, 2026-10-04): an FAQ disclosure list and a horizontal scroll-snap
   *  track of cards — what a zero-code FAQ/testimonials plugin needs without shipping its own markup. */
  readonly layout: EntryListLayout;
  readonly typeKey: string;
  /** Opt-in schema.org block emitted after the list, in every mode (template mode included). Only
   *  `"faq-page"` exists: title = question, the item's displayed field values = answer. Opt-in
   *  rather than implied by `accordion`, because an accordion of anything else marked up as an FAQ
   *  would be false structured data. */
  readonly structuredData?: EntryListStructuredData;
  /** A see-more listing's key: the items sit between its sentinels, and the list wrapper (the marker
   *  element itself in template mode) is the `data-jini-listing` container batches append to. */
  readonly listingKey?: number;
}

/** Every built-in collection-list presentation. */
export type EntryListLayout = "cards" | "list" | "accordion" | "carousel";
/** Every structured-data block {@link renderEntryList} can emit. */
export type EntryListStructuredData = "faq-page";

/**
 * Format one field's value for display. Boolean fields are the one kind with dedicated formatting
 * (D9: `"Yes"`/`"No"` in English); every other kind falls back to `String(value)`, treating `null`/
 * `undefined` as an empty string rather than the literal text `"null"`/`"undefined"`.
 *
 * @complexity O(1).
 */
function formatFieldValue(field: EntryListFieldValue): string {
  if (field.kind === "boolean") return field.value ? "Yes" : "No";
  return field.value === null || field.value === undefined ? "" : String(field.value);
}

/** One field row inside a card/list item's `<dl>`, escaped for plain HTML content (not a template). */
function renderFieldRow(field: EntryListFieldValue): string {
  return `<dt>${escapeHtml({ text: field.label })}</dt><dd>${escapeHtml({ text: formatFieldValue(field) })}</dd>`;
}

/** The title element shared by cards and list items: linked only when `href` is non-null (D1). */
function renderTitle({ item, tag }: { item: EntryListItem; tag: "h3" }, _optional = {}): string {
  const title = escapeHtml({ text: item.title });
  const inner = item.href === null ? title : `<a href="${escapeHtml({ text: toAllowedHref({ rawHref: item.href }) })}">${title}</a>`;
  return `<${tag} class="entry-card__title">${inner}</${tag}>`;
}

/** One card: title (optionally linked) plus a `<dl>` of its fields, omitted entirely when there are
 * none — matching the empty-`fields` case producing no empty `<dl></dl>`. */
function renderCard(item: EntryListItem): string {
  const fields = item.fields.length === 0 ? "" : `<dl class="entry-card__fields">${item.fields.map(renderFieldRow).join("")}</dl>`;
  return `<article class="entry-card">${renderTitle({ item, tag: "h3" })}${fields}</article>`;
}

/** One list item: same title/fields content as a card, without the `<article>`/card wrapper. */
function renderListItem(item: EntryListItem): string {
  const fields = item.fields.length === 0 ? "" : `<dl class="entry-card__fields">${item.fields.map(renderFieldRow).join("")}</dl>`;
  return `<li class="entry-list__item">${renderTitle({ item, tag: "h3" })}${fields}</li>`;
}

/** An item's displayed field values that are not empty, formatted the way the visible list shows them. */
function nonEmptyFieldValues(item: EntryListItem): Array<{ readonly field: EntryListFieldValue; readonly text: string }> {
  return item.fields.map((field) => ({ field, text: formatFieldValue(field) })).filter((entry) => entry.text !== "");
}

/** One accordion entry: a native `<details>` (keyboard- and screen-reader-operable with no script),
 * the title as its `<summary>` and each non-empty field value as an unlabeled paragraph — an FAQ
 * answer reads as prose, not as a "Answer: ..." definition list. Titles are never linked here: the
 * summary itself is the toggle. */
function renderAccordionItem(item: EntryListItem): string {
  const body = nonEmptyFieldValues(item)
    .map(({ field, text }) => `<p class="entry-accordion__field entry-accordion__field--${escapeHtml({ text: field.name })}">${escapeHtml({ text })}</p>`)
    .join("");
  return `<details class="entry-accordion__item"><summary class="entry-accordion__question">${escapeHtml({ text: item.title })}</summary><div class="entry-accordion__answer">${body}</div></details>`;
}

/**
 * A schema.org `FAQPage` block for the items that have answer text (Google ignores a Question with no
 * accepted answer, and an empty `mainEntity` is invalid), or `""` when none do. Serialized with
 * `JSON.stringify` and `<` escaped — the same breakout guard as `page-head.ts`'s `serializeJsonLd`.
 *
 * @complexity O(n · f) over items and their displayed fields.
 */
function renderFaqPageJsonLd(items: readonly EntryListItem[]): string {
  const mainEntity = items
    .map((item) => ({ name: item.title, text: nonEmptyFieldValues(item).map((entry) => entry.text).join("\n") }))
    .filter((question) => question.text !== "")
    .map((question) => ({ "@type": "Question", name: question.name, acceptedAnswer: { "@type": "Answer", text: question.text } }));
  if (mainEntity.length === 0) return "";
  const data = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

/** Resolves one `{{...}}` template placeholder's RAW (unescaped) text for `item`. Unknown
 * placeholders — including a `{{fields.<name>}}` naming a field this entry doesn't carry — resolve to
 * `""` rather than throwing, so one theme's differently-shaped entries never break another's template.
 */
function resolvePlaceholderRawValue({ key, item }: { key: string; item: EntryListItem }, _optional = {}): string {
  if (key === "title") return item.title;
  if (key === "url") return item.href ?? "";
  if (key === "date") return item.dateLabel;
  if (key.startsWith("fields.")) {
    const field = item.fields.find((candidate) => candidate.name === key.slice("fields.".length));
    return field === undefined ? "" : formatFieldValue(field);
  }
  return "";
}

const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z0-9_.]+)\}\}/g;

/** One pass over a template: an opening tag (quote-aware, so a `>` inside a quoted attribute value
 * does not end it) or a text-context placeholder. Matching both in ONE `replace` pass means a
 * substituted value is never rescanned, so a value that itself contains `{{...}}` is never re-expanded. */
const QUOTED_VALUE_SOURCE = `"[^"]*"|'[^']*'`;
const PLACEHOLDER_SOURCE = String.raw`\{\{([a-zA-Z0-9_.]+)\}\}`;
const TEMPLATE_TAG_OR_PLACEHOLDER = new RegExp(`<[a-zA-Z][^>"']*(?:(?:${QUOTED_VALUE_SOURCE})[^>"']*)*>|${PLACEHOLDER_SOURCE}`, "g");

/** Inside one opening tag: a `name=value` attribute (double-, single- or un-quoted value) or a
 * placeholder standing in an attribute-name position. */
const TAG_ATTRIBUTE_OR_PLACEHOLDER = new RegExp(
  String.raw`([^\s"'=<>/\x60]+)(\s*=\s*)(${QUOTED_VALUE_SOURCE}|[^\s"'=<>\x60]+)|${PLACEHOLDER_SOURCE}`,
  "g"
);

/** Attributes whose value a browser follows or loads as a URL, so an entry value placed in one gets
 * the {@link isAllowedHref} scheme allowlist. */
const URL_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set(["href", "src", "action", "formaction", "poster", "cite", "background", "data", "xlink:href"]);

/** Non-global twin of {@link PLACEHOLDER_PATTERN} for a stateless "does this contain one" test. */
const HAS_PLACEHOLDER = /\{\{[a-zA-Z0-9_.]+\}\}/;

type PlaceholderEscape = (raw: string) => string;

/** Substitutes every `{{...}}` placeholder in `text` with its resolved raw value for `item`, each
 * passed through `transform` before insertion. One `replace` pass, so inserted text is never rescanned. */
function substitutePlaceholders({ text, item, transform }: { text: string; item: EntryListItem; transform: PlaceholderEscape }, _optional = {}): string {
  return text.replace(PLACEHOLDER_PATTERN, (_match, key: string) => transform(resolvePlaceholderRawValue({ key, item })));
}

/** Entity-encodes the characters that end or split an UNQUOTED attribute value (whitespace, `=`,
 * backtick) on top of {@link escapeHtml}, so an entry value there cannot start a second attribute. */
function escapeForUnquotedAttribute({ raw }: { raw: string }, _optional = {}): string {
  return escapeHtml({ text: raw }).replace(/[\s=`]/g, (char) => `&#${char.codePointAt(0)};`);
}

/**
 * A URL attribute's value with its placeholders filled. The COMPOSED url (author text plus raw entry
 * values) must pass {@link isAllowedHref}, else the whole value becomes `#` — checking the composed value,
 * not each placeholder alone, keeps `https://x.test/{{fields.id}}` working while still catching an
 * entry value that sets the scheme. The author's own literal text is never re-escaped.
 *
 * @complexity O(n) over the value's length (two placeholder passes).
 */
function renderUrlAttributeValue({ value, item, escapeValue }: { value: string; item: EntryListItem; escapeValue: PlaceholderEscape }, _optional = {}): string {
  const composed = substitutePlaceholders({ text: value, item, transform: (raw) => raw });
  if (!isAllowedHref({ rawHref: composed })) return "#";
  return substitutePlaceholders({ text: value, item, transform: escapeValue });
}

/**
 * One `name=value` attribute of an opening tag, placeholders filled by context: dropped inside an
 * `on*` handler or `srcdoc` (both re-parse the entity-decoded value as script/HTML, so escaping
 * cannot make an entry value safe there), scheme-checked in a {@link URL_ATTRIBUTE_NAMES} attribute,
 * HTML-escaped otherwise — with the extra unquoted-value encoding when the author left it unquoted.
 * An attribute with no placeholder is returned exactly as the author wrote it.
 *
 * @complexity O(n) over the attribute's length.
 */
function renderTemplateAttribute({ attribute, item }: { attribute: { name: string; equals: string; value: string }; item: EntryListItem }, _optional = {}): string {
  const { name, equals, value } = attribute;
  const quote = value.startsWith('"') || value.startsWith("'") ? value.charAt(0) : "";
  const inner = quote === "" ? value : value.slice(1, -1);
  const escapeValue: PlaceholderEscape = quote === "" ? (raw: string) => escapeForUnquotedAttribute({ raw }) : (raw: string) => escapeHtml({ text: raw });
  return `${name}${equals}${quote}${fillAttributeValue({ lowerName: name.toLowerCase(), inner, item, escapeValue })}${quote}`;
}

/** {@link renderTemplateAttribute}'s per-name rule, split out to keep each function's branching small. */
function fillAttributeValue({ lowerName, inner, item, escapeValue }: { lowerName: string; inner: string; item: EntryListItem; escapeValue: PlaceholderEscape }, _optional = {}): string {
  if (lowerName.startsWith("on") || lowerName === "srcdoc") return substitutePlaceholders({ text: inner, item, transform: () => "" });
  if (URL_ATTRIBUTE_NAMES.has(lowerName) && HAS_PLACEHOLDER.test(inner)) return renderUrlAttributeValue({ value: inner, item, escapeValue });
  return substitutePlaceholders({ text: inner, item, transform: escapeValue });
}

/** Fills one opening tag's placeholders attribute by attribute ({@link renderTemplateAttribute}); a
 * placeholder in an attribute-name position gets the unquoted-value encoding. @complexity O(n). */
function renderTemplateTag({ tag, item }: { tag: string; item: EntryListItem }, _optional = {}): string {
  return tag.replace(
    TAG_ATTRIBUTE_OR_PLACEHOLDER,
    // `name` is typed `string` with no `?? ""` fallback: TAG_ATTRIBUTE_OR_PLACEHOLDER's two
    // alternatives are exclusive, and the attribute alternative (the only one leaving `key`
    // undefined) always captures group 1, so `name` is defined whenever it is read.
    (_match, name: string, equals: string, value: string, key: string | undefined) =>
      key === undefined ? renderTemplateAttribute({ attribute: { name, equals, value }, item }) : escapeForUnquotedAttribute({ raw: resolvePlaceholderRawValue({ key, item }) })
  );
}

/**
 * Renders one item through an operator-authored `template` string. Entry values are attacker-shaped
 * (see this file's header), so each placeholder is filled for the context it lands in: text is
 * HTML-escaped; inside a tag, {@link renderTemplateTag} applies the attribute rules (URL scheme check
 * for every URL attribute and quote style, dropped inside `on*`/`srcdoc`, unquoted values cannot
 * break out). No host card/list markup is added around the template's own content.
 *
 * @complexity O(n) over `template`'s length — one pass, plus one pass per opening tag over that tag.
 */
function renderTemplateItem({ template, item }: { template: string; item: EntryListItem }, _optional = {}): string {
  return template.replace(TEMPLATE_TAG_OR_PLACEHOLDER, (match, key: string | undefined) =>
    key === undefined ? renderTemplateTag({ tag: match, item }) : escapeHtml({ text: resolvePlaceholderRawValue({ key, item }) })
  );
}

/**
 * Renders a resolved, already-visibility-filtered list of entries into markup for the `collection`
 * static-tier marker: either the built-in cards/list presentation, or `options.template` repeated
 * once per item when present (author-template mode; `options.columns`/`options.layout` are then
 * ignored). Mirrors {@link injectPostPreviewsEmbeds}'s own "no data ⇒ nothing to substitute" contract:
 * an empty `items` returns `undefined` so the marker's caller can leave the theme's own authored
 * fallback content untouched instead of splicing in an empty container.
 *
 * @returns the rendered markup, or `undefined` when `items` is empty.
 * @complexity O(n · f) over the number of items and each item's field count; template mode is
 * O(n · t) over each item's template-length substitution pass instead.
 */
export function renderEntryList({ items, options, attribute }: { items: readonly EntryListItem[]; options: EntryListRenderOptions; attribute: string }, _optional: Record<string, never> = {}): string | undefined {
  if (items.length === 0) return undefined;
  return renderEntryListBody(items, options, attribute) + renderEntryListStructuredData({ items }, options);
}

/**
 * The opt-in structured-data block for `items` (`""` when none is requested or none applies).
 * Exported for a caller that renders its own list markup — the `recent-entries` widget's legacy
 * `list` layout — so it still emits the JSON-LD it was asked for.
 *
 * @complexity O(n · f) over items and their displayed fields.
 */
export function renderEntryListStructuredData({ items }: { items: readonly EntryListItem[] }, options: Pick<EntryListRenderOptions, "structuredData"> = {}): string {
  return options.structuredData === "faq-page" ? renderFaqPageJsonLd(items) : "";
}

/** {@link renderEntryList}'s markup half, one branch per presentation. @complexity O(n · f). */
function renderEntryListBody(items: readonly EntryListItem[], options: EntryListRenderOptions, attribute: string): string {
  const key = options.listingKey;
  const wrap = ({ html }: { html: string }, _optional = {}) => (key === undefined ? html : wrapListingItems({ key, items: html }));
  if (options.template !== undefined) {
    return wrap({ html: items.map((item) => renderTemplateItem({ template: options.template as string, item })).join("") });
  }
  const typeClass = escapeHtml({ text: options.typeKey });
  const marker = key === undefined ? attribute : `${attribute} data-jini-listing="${key}"`;
  if (options.layout === "list") {
    return `<ul class="entry-list entry-list--${typeClass} entry-list--list" ${marker}>${wrap({ html: items.map(renderListItem).join("") })}</ul>`;
  }
  if (options.layout === "accordion") {
    return `<div class="entry-list entry-list--${typeClass} entry-list--accordion" ${marker}>${wrap({ html: items.map(renderAccordionItem).join("") })}</div>`;
  }
  if (options.layout === "carousel") {
    // `tabindex="0"`: an overflowing scroll container must be focusable or keyboard users cannot
    // scroll it (WCAG 2.1.1).
    return `<div class="entry-list entry-list--${typeClass} entry-list--carousel" ${marker} tabindex="0">${wrap({ html: items.map(renderCard).join("") })}</div>`;
  }
  return (
    `<div class="entry-list entry-list--${typeClass}" ${marker} style="--entry-list-columns:${options.columns}">` +
    `${wrap({ html: items.map(renderCard).join("") })}</div>`
  );
}

/**
 * Inserts the host's style once before `</head>`, only when `html` actually contains
 * the host's wrapper attribute (no wasted style block on a page with no collection/cards
 * list) and doesn't already carry the style tag (idempotent across repeated calls, multiple
 * collection markers, or multiple call sites on one page — see {@link withEntryListStyleOnce}'s own
 * callers). Two independent checks on purpose (review fix 3a): the FIRST looks for the wrapper
 * attribute {@link renderEntryList} itself emits, never the bare `entry-list` class — a theme's own,
 * unrelated `.entry-list`-classed markup (e.g. `render.ts`'s declarative post/product index) must
 * never trigger this on its own. The SECOND looks for the exact `<style ${attribute}>` open
 * tag, not just the bare attribute name, because after the first injection the wrapper's own copy of
 * that attribute would otherwise make a same-string check trivially true even before the style tag
 * itself exists.
 *
 * @returns `html` unchanged when there is no host wrapper attribute, the style is already
 * present, or there is no `</head>` to insert before; otherwise `html` with the style spliced in.
 * @complexity O(n) over `html`'s length for the two substring scans plus the slice/concat.
 */
export function withEntryListStyleOnce({ html, attribute, style }: { html: string; attribute: string; style: string }, _optional = {}): string {
  if (!html.includes(attribute)) return html;
  if (html.includes(`<style ${attribute}>`)) return html;
  const headCloseIndex = html.indexOf("</head>");
  if (headCloseIndex === -1) return html;
  return `${html.slice(0, headCloseIndex)}${style}${html.slice(headCloseIndex)}`;
}
