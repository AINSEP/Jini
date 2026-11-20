import assert from "node:assert/strict";
import { test } from "vitest";

import {
  renderEntryList,
  withEntryListStyleOnce,
} from "../entry-list.js";
import type { EntryListItem, EntryListRenderOptions } from "../entry-list.js";

/**
 * @file Certifies C3's pure entry-list renderer (2026-09-23, plan lines 168-191): the collection
 * marker's cards/list/author-template markup, the escaping contract for every entry value, and the
 * once-only default-style injection. I/O-free by design — every test hands in an already-resolved
 * `EntryListItem[]`, matching the `static-render-post-previews.test.ts` convention for
 * `StaticPostPreview[]`. Entry pages are OFF (D1): a `null` href renders the title as plain text.
 */

function item(overrides: Partial<EntryListItem> = {}): EntryListItem {
  return {
    title: "Untitled",
    href: "/recipe/untitled",
    dateIso: "2026-09-01T00:00:00.000Z",
    dateLabel: "Sep 1, 2026",
    fields: [],
    ...overrides,
  };
}

function options(overrides: Partial<EntryListRenderOptions> = {}): EntryListRenderOptions {
  return { columns: 3, layout: "cards", typeKey: "recipe", ...overrides };
}

/** Narrows `renderEntryList`'s `string | undefined` result for tests that expect real markup back,
 * failing loudly (rather than via a non-null assertion) when a test's own setup produced no items. */
function assertRendered(html: string | undefined): string {
  assert.ok(html !== undefined, "expected renderEntryList to return markup, got undefined");
  return html;
}

test("renderEntryList: empty items gives undefined", () => {
  assert.equal(renderEntryList({ attribute: "data-test-entry-list", items: [], options: options() }), undefined);
});

test("renderEntryList: title and field values are HTML-escaped in card markup", () => {
  const html = assertRendered(
    renderEntryList(
      { attribute: "data-test-entry-list", items: [
        item({
          title: "<script>alert(1)</script>",
          fields: [{ name: "summary", label: "Summary", kind: "text", value: '"quoted" & <b>bold</b>' }],
        }),
      ],
      options: options() },
    ),
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt;"));
});

test("renderEntryList: href null renders the title as plain text with no <a>", () => {
  const html = assertRendered(renderEntryList({ attribute: "data-test-entry-list", items: [item({ title: "No Link", href: null })], options: options() }));
  assert.ok(!html.includes("<a "));
  assert.ok(html.includes('<h3 class="entry-card__title">No Link</h3>'));
});

test("renderEntryList: a non-null href links the title", () => {
  const html = assertRendered(renderEntryList({ attribute: "data-test-entry-list", items: [item({ title: "Linked", href: "/recipe/linked" })], options: options() }));
  assert.ok(html.includes('<h3 class="entry-card__title"><a href="/recipe/linked">Linked</a></h3>'));
});

test("renderEntryList: boolean field values render as Yes/No", () => {
  const html = assertRendered(
    renderEntryList(
      { attribute: "data-test-entry-list", items: [
        item({
          fields: [
            { name: "vegetarian", label: "Vegetarian", kind: "boolean", value: true },
            { name: "spicy", label: "Spicy", kind: "boolean", value: false },
          ],
        }),
      ],
      options: options() },
    ),
  );
  assert.ok(html.includes("<dt>Vegetarian</dt><dd>Yes</dd>"));
  assert.ok(html.includes("<dt>Spicy</dt><dd>No</dd>"));
});

test("renderEntryList: cards layout wraps items in an entry-card inside the columned grid container, marked with data-test-entry-list (review fix 3a's style-scoping hook)", () => {
  const html = assertRendered(renderEntryList({ attribute: "data-test-entry-list", items: [item({ title: "A" })], options: options({ columns: 4 }) }));
  assert.ok(html.startsWith('<div class="entry-list entry-list--recipe" data-test-entry-list style="--entry-list-columns:4">'));
  assert.ok(html.includes('<article class="entry-card">'));
});

test("renderEntryList: list layout wraps items in an entry-list__item inside a ul, no columns style, marked with data-test-entry-list", () => {
  const html = assertRendered(renderEntryList({ attribute: "data-test-entry-list", items: [item({ title: "A" })], options: options({ layout: "list" }) }));
  assert.ok(html.startsWith('<ul class="entry-list entry-list--recipe entry-list--list" data-test-entry-list>'));
  assert.ok(html.includes('<li class="entry-list__item">'));
  assert.ok(!html.includes("--entry-list-columns"));
});

test("renderEntryList template mode: repeats the template once per item, no card markup added", () => {
  const html = renderEntryList(
    { attribute: "data-test-entry-list", items: [item({ title: "First" }), item({ title: "Second" })],
    options: options({ template: "<p>{{title}}</p>" }) },
  );
  assert.equal(html, "<p>First</p><p>Second</p>");
});

test("renderEntryList template mode: title/url/date/fields placeholders all resolve and escape", () => {
  const html = renderEntryList(
    { attribute: "data-test-entry-list", items: [
      item({
        title: "Tea & Cake",
        href: "/recipe/tea",
        dateLabel: "Sep 2, 2026",
        fields: [{ name: "serves", label: "Serves", kind: "text", value: 4 }],
      }),
    ],
    options: options({ template: '<a href="{{url}}">{{title}}</a><span>{{date}}</span><span>{{fields.serves}}</span>' }) },
  );
  assert.equal(html, '<a href="/recipe/tea">Tea &amp; Cake</a><span>Sep 2, 2026</span><span>4</span>');
});

test("renderEntryList template mode: a javascript: field value inside href= is neutralized via safeHref", () => {
  const html = renderEntryList(
    { attribute: "data-test-entry-list", items: [item({ fields: [{ name: "link", label: "Link", kind: "text", value: "javascript:alert(1)" }] })],
    options: options({ template: '<a href="{{fields.link}}">go</a>' }) },
  );
  assert.equal(html, '<a href="#">go</a>');
});



test("withEntryListStyleOnce: leaves html untouched when there is no [data-test-entry-list] wrapper", () => {
  const html = "<html><head></head><body>no lists here</body></html>";
  assert.equal(withEntryListStyleOnce({ attribute: "data-test-entry-list", style: "<style data-test-entry-list>.entry-list{display:grid}</style>", html }), html);
});

// ---------------------------------------------------------------------------
// Review fix 3a (2026-09-23): the style must be scoped to THIS module's own wrapper attribute,
// never a bare `.entry-list` class — a theme's unrelated `entry-list`-classed markup (declarative
// tier's own post/product index, `render.ts`'s `entryList`/`productEntryList`) must never trigger
// the collection card grid CSS just because it shares that one class name.
// ---------------------------------------------------------------------------

test("withEntryListStyleOnce: a theme's own unrelated .entry-list markup (no data-test-entry-list attribute) never triggers the style — the exact trap this fix closes", () => {
  const html =
    '<html><head></head><body><section class="entry-list entry-list--index"><div class="wrap">' +
    "<ol class=\"entries\"><li class=\"entry\">real post, not a collection card</li></ol></div></section></body></html>";
  assert.equal(withEntryListStyleOnce({ attribute: "data-test-entry-list", style: "<style data-test-entry-list>.entry-list{display:grid}</style>", html }), html, "a bare .entry-list class must never inject the collection card style");
});



// ---------------------------------------------------------------------------
// Template placeholder contexts (2026-09-23 review): every attribute context, not only
// double-quoted href/src, must keep an entry value from becoming script or a new attribute.
// ---------------------------------------------------------------------------

function linkItem(link: string): EntryListItem {
  return item({ fields: [{ name: "link", label: "Link", kind: "text", value: link }] });
}

function renderTemplate(template: string, entry: EntryListItem): string {
  return assertRendered(renderEntryList({ attribute: "data-test-entry-list", items: [entry], options: options({ template }) }));
}

test("renderEntryList template mode: a javascript: value in a SINGLE-quoted href is neutralized", () => {
  assert.equal(renderTemplate("<a href='{{fields.link}}'>go</a>", linkItem("javascript:alert(1)")), "<a href='#'>go</a>");
});

test("renderEntryList template mode: a javascript: value in an UNQUOTED href is neutralized", () => {
  assert.equal(renderTemplate("<a href={{fields.link}}>go</a>", linkItem("javascript:alert(1)")), "<a href=#>go</a>");
});

test("renderEntryList template mode: an unquoted attribute value cannot break out into a new attribute", () => {
  const viaUrl = renderTemplate("<a href={{fields.link}}>go</a>", linkItem("https://x.test onmouseover=alert(1)"));
  const viaTitle = renderTemplate("<a title={{title}}>go</a>", item({ title: "x onmouseover=alert(1)" }));
  for (const html of [viaUrl, viaTitle]) {
    assert.ok(!/\sonmouseover\s*=/i.test(html), `no event-handler attribute may appear: ${html}`);
  }
  assert.equal(viaTitle, "<a title=x&#32;onmouseover&#61;alert(1)>go</a>");
});

test("renderEntryList template mode: other URL attributes (action, formaction, poster) get the same scheme check", () => {
  const entry = linkItem("javascript:alert(1)");
  assert.equal(renderTemplate('<form action="{{fields.link}}"></form>', entry), '<form action="#"></form>');
  assert.equal(renderTemplate('<button formaction="{{fields.link}}">b</button>', entry), '<button formaction="#">b</button>');
  assert.equal(renderTemplate('<video poster="{{fields.link}}"></video>', entry), '<video poster="#"></video>');
});

test("renderEntryList template mode: placeholders inside on* handlers and srcdoc are dropped, not escaped", () => {
  const entry = item({ title: "');alert(1);('" });
  assert.equal(renderTemplate(`<button onclick="go('{{title}}')">b</button>`, entry), `<button onclick="go('')">b</button>`);
  const script = item({ title: "<script>alert(1)</script>" });
  assert.equal(renderTemplate('<iframe srcdoc="{{title}}"></iframe>', script), '<iframe srcdoc=""></iframe>');
});

test("renderEntryList template mode: a URL composed from an author prefix plus a placeholder keeps working", () => {
  const entry = item({ fields: [{ name: "id", label: "Id", kind: "text", value: "a b&c" }] });
  assert.equal(renderTemplate('<a href="https://x.test/{{fields.id}}">go</a>', entry), '<a href="https://x.test/a b&amp;c">go</a>');
});

test("renderEntryList template mode: a substituted value is never re-expanded as a placeholder", () => {
  const entry = item({ title: "T", href: "/r/{{title}}" });
  assert.equal(renderTemplate('<a href="{{url}}">{{url}}</a>', entry), '<a href="/r/{{title}}">/r/{{title}}</a>');
});

test("renderEntryList template mode: author-literal attribute values without placeholders are left exactly as written", () => {
  const entry = item();
  assert.equal(renderTemplate('<a href="docs/x?a=1&amp;b=2" onclick="track()">{{title}}</a>', entry), '<a href="docs/x?a=1&amp;b=2" onclick="track()">Untitled</a>');
});

test("list layout: an item without fields renders no empty <dl>", () => {
  const html = assertRendered(renderEntryList({ attribute: "data-test-entry-list", items: [item({ title: "Bare" })], options: options({ layout: "list" }) }));
  assert.match(html, /<li class="entry-list__item"><h3 class="entry-card__title"><a href="\/recipe\/untitled">Bare<\/a><\/h3><\/li>/);
  assert.doesNotMatch(html, /<dl/);
});

test("template placeholders: a null url, an absent field and an unknown key all resolve to empty text", () => {
  const html = assertRendered(renderEntryList(
    { attribute: "data-test-entry-list", items: [item({ title: "T", href: null, fields: [{ name: "serves", label: "Serves", kind: "number", value: 4 }] })],
    options: options({ template: "<p>[{{url}}][{{fields.missing}}][{{nope}}][{{fields.serves}}][{{date}}]</p>" }) }
  ));
  assert.equal(html, "<p>[][][][4][Sep 1, 2026]</p>");
});

test("template: a placeholder in an attribute-name position gets the unquoted-attribute encoding", () => {
  const html = assertRendered(renderEntryList({ attribute: "data-test-entry-list", items: [item({ title: 'a b"c' })], options: options({ template: "<div {{title}} class=x>{{title}}</div>" }) }));
  assert.doesNotMatch(html, /<div a b"c/, "the title cannot inject a new attribute");
  assert.match(html, /<div [^ >]+ class=x>a b&quot;c<\/div>/);
});

test("a see-more listing key wraps template items and marks the built-in list wrapper", () => {
  const items = [item({ title: "One" })];
  const templated = assertRendered(renderEntryList({ attribute: "data-test-entry-list", items, options: options({ template: "<i>{{title}}</i>", listingKey: 1 }) }));
  assert.match(templated, /data-jini-listing|1/);
  assert.match(templated, /<i>One<\/i>/);
  const builtIn = assertRendered(renderEntryList({ attribute: "data-test-entry-list", items, options: options({ layout: "list", listingKey: 1 }) }));
  assert.match(builtIn, /<ul class="entry-list entry-list--recipe entry-list--list" data-test-entry-list data-jini-listing="1">/);
});

test("list layout: an item with fields renders its <dl>", () => {
  const html = assertRendered(renderEntryList({ attribute: "data-test-entry-list", items: [item({ fields: [{ name: "serves", label: "Serves", kind: "number", value: 2 }] })], options: options({ layout: "list" }) }));
  assert.match(html, /<li class="entry-list__item">.*<dl class="entry-card__fields">.*Serves.*2.*<\/dl><\/li>/);
});

test("withEntryListStyleOnce: a page with an entry list but no </head> is left untouched", () => {
  const html = '<body><div data-test-entry-list class="entry-list"></div></body>';
  assert.equal(withEntryListStyleOnce({ attribute: "data-test-entry-list", style: "<style data-test-entry-list>.entry-list{display:grid}</style>", html }), html);
});

{
/**
 * @file AW-7 Tier 1 (2026-10-04): the `accordion` and `carousel` collection-list layouts and the
 * opt-in FAQPage JSON-LD a zero-code Testimonials + FAQ plugin needs from core. The existing
 * cards/list/template contract lives in `entry-list-render.test.ts`.
 */

function faq(title: string, answer: unknown): EntryListItem {
  return { title, href: null, dateIso: "2026-10-01T00:00:00.000Z", dateLabel: "Oct 1, 2026", fields: [{ name: "answer", label: "Answer", kind: "text", value: answer }] };
}

function options(overrides: Partial<EntryListRenderOptions> = {}): EntryListRenderOptions {
  return { columns: 3, layout: "accordion", typeKey: "faq", ...overrides };
}

function jsonLd(html: string): unknown {
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  return match ? JSON.parse(match[1] as string) : undefined;
}

test("accordion: one <details> per entry, title as the summary, unlabeled field values as the body", () => {
  const html = renderEntryList({ attribute: "data-test-entry-list", items: [faq("Do you ship abroad?", "Yes, to 40 countries.")], options: options() });
  assert.equal(
    html,
    '<div class="entry-list entry-list--faq entry-list--accordion" data-test-entry-list>' +
      '<details class="entry-accordion__item"><summary class="entry-accordion__question">Do you ship abroad?</summary>' +
      '<div class="entry-accordion__answer"><p class="entry-accordion__field entry-accordion__field--answer">Yes, to 40 countries.</p></div></details>' +
      "</div>"
  );
});

test("accordion: escapes every value and skips empty fields", () => {
  const item: EntryListItem = { ...faq("<b>Q</b>", "<script>x</script>"), fields: [{ name: "answer", label: "A", kind: "text", value: "<script>x</script>" }, { name: "note", label: "N", kind: "text", value: null }] };
  const html = renderEntryList({ attribute: "data-test-entry-list", items: [item], options: options() }) as string;
  assert.ok(html.includes("&lt;b&gt;Q&lt;/b&gt;"));
  assert.ok(html.includes("&lt;script&gt;x&lt;/script&gt;"));
  assert.ok(!html.includes("entry-accordion__field--note"));
});

test("carousel: the card markup inside a horizontal, keyboard-scrollable track", () => {
  const html = renderEntryList({ attribute: "data-test-entry-list", items: [faq("Ada", "Great service")], options: options({ layout: "carousel", typeKey: "testimonial" }) });
  assert.equal(
    html,
    '<div class="entry-list entry-list--testimonial entry-list--carousel" data-test-entry-list tabindex="0">' +
      '<article class="entry-card"><h3 class="entry-card__title">Ada</h3><dl class="entry-card__fields"><dt>Answer</dt><dd>Great service</dd></dl></article>' +
      "</div>"
  );
});



test("faq-page structured data: one FAQPage block after the list, title = question, field values = answer", () => {
  const html = renderEntryList({ attribute: "data-test-entry-list", items: [faq("Q1", "A1"), faq("Q2", 42)], options: options({ structuredData: "faq-page" }) }) as string;
  assert.ok(html.startsWith('<div class="entry-list entry-list--faq entry-list--accordion"'));
  assert.deepEqual(jsonLd(html), {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      { "@type": "Question", name: "Q1", acceptedAnswer: { "@type": "Answer", text: "A1" } },
      { "@type": "Question", name: "Q2", acceptedAnswer: { "@type": "Answer", text: "42" } },
    ],
  });
});

test("faq-page structured data: entries with no answer text are left out; none left means no block", () => {
  const html = renderEntryList({ attribute: "data-test-entry-list", items: [faq("Q1", ""), faq("Q2", "A2")], options: options({ structuredData: "faq-page" }) }) as string;
  assert.deepEqual((jsonLd(html) as { mainEntity: unknown[] }).mainEntity.length, 1);
  const none = renderEntryList({ attribute: "data-test-entry-list", items: [faq("Q1", null)], options: options({ structuredData: "faq-page" }) }) as string;
  assert.equal(jsonLd(none), undefined);
});

test("faq-page structured data cannot break out of its <script>", () => {
  const html = renderEntryList({ attribute: "data-test-entry-list", items: [faq("</script><script>alert(1)</script>", "a")], options: options({ structuredData: "faq-page" }) }) as string;
  assert.equal(html.match(/<\/script>/g)?.length, 1);
  assert.ok(html.includes("\\u003c/script>"));
});

test("faq-page structured data also follows an author template", () => {
  const html = renderEntryList({ attribute: "data-test-entry-list", items: [faq("Q1", "A1")], options: options({ template: "<p>{{title}}</p>", structuredData: "faq-page" }) }) as string;
  assert.ok(html.startsWith("<p>Q1</p>"));
  assert.equal((jsonLd(html) as { mainEntity: unknown[] }).mainEntity.length, 1);
});

test("boolean answers use the same Yes/No display as the visible list", () => {
  const item: EntryListItem = { ...faq("Open on Sundays?", true), fields: [{ name: "open", label: "Open", kind: "boolean", value: true }] };
  const html = renderEntryList({ attribute: "data-test-entry-list", items: [item], options: options({ structuredData: "faq-page" }) }) as string;
  assert.ok(html.includes(">Yes</p>"));
  assert.equal((jsonLd(html) as { mainEntity: Array<{ acceptedAnswer: { text: string } }> }).mainEntity[0]?.acceptedAnswer.text, "Yes");
});
}

test("the host wrapper attribute gates style insertion and style is inserted once", () => {
  const attribute = "data-test-entry-list";
  const style = "<style data-test-entry-list>.entry-list{display:grid}</style>";
  const list = assertRendered(renderEntryList({ items: [item()], options: options(), attribute }));
  assert.ok(list.includes(attribute));
  const html = `<html><head></head><body>${list}</body></html>`;
  const once = withEntryListStyleOnce({ html, attribute, style });
  assert.equal(once.split(style).length - 1, 1);
  assert.equal(withEntryListStyleOnce({ html: once, attribute, style }), once);
  const withoutWrapper = "<html><head></head><body></body></html>";
  assert.equal(withEntryListStyleOnce({ html: withoutWrapper, attribute, style }), withoutWrapper);
});
