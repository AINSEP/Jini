import { describe, expect, it, vi } from "vitest";
import { renderWidgetMediaImage, renderMediaWidget } from "../media.js";
import { renderWidgetEntrySummary, renderWidgetRecentEntries, renderWidgetSocialLinks } from "../social-entries.js";
import { renderWidgetPostContent } from "../post-content.js";
import { renderWidgetContactForm } from "../../contact-form-widget.js";
import type { ContactFormWidgetHost, WidgetDocRendering, WidgetEntriesHost, WidgetMediaHost, WidgetPostContentHost } from "../widget-render-contract.js";
import { renderFormCollection } from "../../../../../../forms/html-render.js";
import { isCollectionListLayout } from "../../../../../../entries/site/contracts.js";

/** Every host collaborator is a recording stub with a distinctive output, so each assertion proves
 *  the widget renderer routed through the INJECTED value rather than any built-in of its own. */
function mediaHost(events: string[] = []): WidgetMediaHost {
  return {
    media: {
      renderImageTag: (props) => `<stub-img src="${props.src}" responsive="${String(props.responsive)}"/>`,
      renderVideoTag: (props) => `<stub-${props.kind ?? "video"} src="${props.src}"/>`,
      mediaPublicPath: (args) => `/stub/${args.key}/${args.variant.kind}`,
      mediaUrlKey: (args) => `key(${args.id})`,
      plausibleMediaRefId: ({ value }) => (typeof value === "string" && /^[a-z0-9]+$/.test(value) ? value : undefined),
    },
    noMarkerAttributes: [],
    renderGallery: ({ renderRawHtml }) => renderRawHtml?.({ html: "<p/>", media: {} }) ?? "no-raw-html",
    renderMediaRawHtml: (_args, options) => { options?.report?.({ code: "stub-code", detail: "{}" }); return "<stub-raw/>"; },
    report: (event) => { events.push(event.code); },
  };
}

/** Distinctive class names: a widget that still emitted a built-in one would not match them. */
const ENTRIES_CLASSES = { socialList: "h-social", socialLink: "h-social-a", recentList: "h-recent", entrySummary: "h-entry", empty: "h-empty" };
const POST_CLASSES = { header: "h-post-head", meta: "h-post-meta", body: "h-post-body" };

describe("widget renderers route through their injected host", () => {
  it("social-links, entry-summary and the recent-entries list/empty state emit the host's class names only", () => {
    const host = { classes: ENTRIES_CLASSES, renderEntryListStructuredData: () => "" } as unknown as WidgetEntriesHost;
    expect(renderWidgetSocialLinks({ props: { links: [{ platform: "P", url: "/u" }] }, host })).toBe('<ul class="h-social"><li><a class="h-social-a" href="/u">P</a></li></ul>');
    expect(renderWidgetEntrySummary({ props: { slug: "a-b", title: "T" }, host })).toBe('<li class="h-entry"><a href="/a-b">T</a></li>');
    const list = { componentId: "recent-entries", props: { layout: "list" }, children: [{ componentId: "x", props: { title: "T", href: null } }] };
    expect(renderWidgetRecentEntries({ ir: list, host: host as WidgetEntriesHost })).toBe('<ul class="h-recent"><li class="h-entry">T</li></ul>');
    expect(renderWidgetRecentEntries({ ir: { ...list, children: [] }, host: host as WidgetEntriesHost })).toBe('<ul class="h-recent"><li class="h-empty">No entries yet.</li></ul>');
  });

  it("post-content: header, meta and body class names come from the host", () => {
    const host: WidgetPostContentHost = { classes: POST_CLASSES, postDisplayDateIso: () => "ISO", formatDateLabel: () => "LBL" };
    const html = renderWidgetPostContent({ props: { title: "Hi", bodyJson: { type: "doc", content: [] }, updatedAt: "2020-01-01" }, docRendering: { renderDocNode: () => "<b/>", renderNodes: () => "" }, host });
    expect(html).toBe('<div class="h-post-head"><h1>Hi</h1><div class="h-post-meta"><time datetime="ISO">LBL</time></div></div><div class="h-post-body"><b/></div>');
  });

  it("media-image: tag renderer, URL key and path policy come from the host", () => {
    const html = renderWidgetMediaImage({ props: { assetId: "a1", transformName: "public", version: 2 }, host: mediaHost() });
    expect(html).toBe('<stub-img src="/stub/key(a1)/transform" responsive="false"/>');
    const video = renderWidgetMediaImage({ props: { assetId: "a1", contentType: "video/mp4" }, host: mediaHost() });
    expect(video).toBe('<stub-video src="/stub/key(a1)/original"/>');
  });

  it("media: the Raw HTML pipeline reports to the host's sink", () => {
    const events: string[] = [];
    const out = renderMediaWidget({ ir: { componentId: "media", props: {} }, docRendering: { renderDocNode: () => "", renderNodes: () => "" }, host: mediaHost(events) });
    expect(out).toBe("<stub-raw/>");
    expect(events).toEqual(["stub-code"]);
  });

  it("recent-entries: the host's entry-list attribute and layout vocabulary drive the card branch", () => {
    const seen: string[] = [];
    const host: WidgetEntriesHost = {
      renderEntryList: ({ attribute }: { attribute: string }) => { seen.push(attribute); return "<stub-list/>"; },
      renderEntryListStructuredData: () => "",
      isCollectionListLayout: ({ value }: { value: unknown }): boolean => value === "cards",
      collectionListFaqPage: "faq-page",
      entryListAttribute: "data-host-entry-list",
      classes: ENTRIES_CLASSES,
    } as unknown as WidgetEntriesHost;
    const out = renderWidgetRecentEntries({ ir: { componentId: "recent-entries", props: { layout: "cards" }, children: [{ componentId: "x", props: { title: "T" } }] }, host });
    expect(out).toBe("<stub-list/>");
    expect(seen).toEqual(["data-host-entry-list"]);
  });

  it("post-content: the host's date policy and label formatter produce the date line", () => {
    const host: WidgetPostContentHost = {
      classes: POST_CLASSES,
      postDisplayDateIso: () => "HOST-ISO",
      formatDateLabel: ({ iso }) => `label(${iso})`,
    };
    const html = renderWidgetPostContent({ props: { title: "Hi", bodyJson: { type: "doc", content: [] }, updatedAt: "2020-01-01" }, docRendering: { renderDocNode: () => "<b/>", renderNodes: () => "" }, host });
    expect(html).toContain('<time datetime="HOST-ISO">label(HOST-ISO)</time>');
  });

  it("contact-form: legacy class names, hooks, baseline style and occurrence id come from the host", () => {
    const host = {
      forms: {
        stampFormFieldMaxLengths: ({ html }: { html: string }) => html,
        renderFormSuccessSlot: ({ message }: { message: string }, options: { extraClasses: string }) => `<stub-success msg="${message}" extra="${options.extraClasses}"/>`,
        renderFormErrorSlot: ({ className }: { className: string }, options: { extraClasses: string }) => `<stub-error class="${className}" extra="${options.extraClasses}"/>`,
        fieldMaxChars: () => null,
        renderFormCollection: () => "",
        renderHtmlForm: () => "",
        renderHtmlFormBody: ({ hooks }: { hooks: { field: string } }, options: { idPrefix: string; fieldClass: string; submitLabel: string }) => `<stub-body hook="${hooks.field}" id="${options.idPrefix}" fc="${options.fieldClass}" submit="${options.submitLabel}"/>`,
        renderFormSchemaHash: () => "",
      },
      presentation: {
        formClass: "host-form", errorClass: "host-err", widgetClass: "h-widget", contactFormClass: "h-contact", successExtraClass: "h-ok", errorExtraClass: "h-bad",
        submitLabel: "Go", successMessageFallback: "Host thanks", baselineStyle: "<style>host</style>", rangeReadoutScript: "<script>host</script>",
        fieldClasses: { fieldClass: "host-field", fieldHelpClass: "h", errorClass: "e", fieldCheckboxClass: "c" },
        hooks: { field: "data-host-field", form: "f", success: "s", error: "e" },
      },
      newOccurrenceId: () => "OCC",
    } as unknown as ContactFormWidgetHost;
    const html = renderWidgetContactForm({ props: { slug: "s1", fields: [{ type: "range" }] }, host });
    expect(html.startsWith("<style>host</style>")).toBe(true);
    expect(html).toContain('<form class="h-widget host-form h-contact"');
    expect(html).toContain('<stub-error class="host-err" extra="h-bad"/>');
    expect(html).toContain('<stub-success msg="Host thanks" extra="h-ok"/>');
    expect(html).toContain('<stub-body hook="data-host-field" id="widget-contact-OCC" fc="host-field" submit="Go"/>');
    expect(html.endsWith("<script>host</script>")).toBe(true);
  });
});

it("passes opted-out controls and normalized marker attributes to the original audio renderer", () => {
  const base = mediaHost();
  const mediaPublicPath = vi.fn<WidgetMediaHost["media"]["mediaPublicPath"]>(() => "/m/episode-7/original.mp3");
  const renderVideoTag = vi.fn<WidgetMediaHost["media"]["renderVideoTag"]>(() => '<audio src="/m/episode-7/original.mp3"></audio>');
  const renderImageTag = vi.fn<WidgetMediaHost["media"]["renderImageTag"]>(() => { throw new Error("unexpected image"); });
  const host: WidgetMediaHost = { ...base, media: { ...base.media, mediaPublicPath, renderVideoTag, renderImageTag,
    mediaUrlKey: ({ id, slug }) => {
      expect({ id, slug }).toEqual({ id: "a7", slug: "episode-7" });
      return "episode-7";
    },
  } };
  expect(renderWidgetMediaImage({ host, props: {
    assetId: "a7", slug: "episode-7", contentType: "audio/mpeg", width: 900, height: 600, cssClass: "clip",
    alt: "Episode 7", htmlAttributes: 'title="Episode"', controls: false, sha256: "abcdef012345",
    markerAttributes: [null, { name: false, value: "invalid" }, { name: "title", value: "Spoken story" }, { name: "loop", value: null }, { name: "ignored", value: 42 }],
  } })).toBe('<audio src="/m/episode-7/original.mp3"></audio>');
  expect(mediaPublicPath.mock.calls).toEqual([[{ key: "episode-7", sha256: "abcdef012345", variant: { kind: "original", contentType: "audio/mpeg" } }]]);
  expect(renderVideoTag.mock.calls).toEqual([[
    { kind: "audio", src: "/m/episode-7/original.mp3", fallbackText: "Your browser does not support the audio tag.", alt: "Episode 7",
      width: null, height: null, cssClass: "clip", htmlAttributes: 'title="Episode"', controls: false,
      markerAttributes: [{ name: "title", value: "Spoken story" }, { name: "loop", value: null }] },
    { captionsTrack: undefined },
  ]]);
  expect(renderImageTag).not.toHaveBeenCalled();
});

it("falls back without emitting a tag when an image transform version is not numeric", () => {
  const base = mediaHost();
  const host: WidgetMediaHost = { ...base, media: { ...base.media,
    mediaPublicPath: () => { throw new Error("unexpected public path"); },
    renderImageTag: () => { throw new Error("unexpected image tag"); },
    renderVideoTag: () => { throw new Error("unexpected playback tag"); },
  } };
  expect(renderWidgetMediaImage({ props: { assetId: "a7", transformName: "public", version: "2" }, host })).toBe(
    '<div class="widget widget-placeholder" aria-hidden="true"></div>',
  );
});

it("adapts legacy URL and managed gallery images to their respective renderers", () => {
  const base = mediaHost();
  const renderDocNode = vi.fn<WidgetDocRendering["renderDocNode"]>(() => '<img src="https://image.example.test/field.png" alt="Field"/>');
  const renderImageTag = vi.fn<WidgetMediaHost["media"]["renderImageTag"]>(({ src, responsive }) => `<img src="${src}" data-responsive="${String(responsive)}"/>`);
  const legacyImage = { src: "https://image.example.test/field.png", alt: "Field" };
  const managedImage = { mediaId: "a7", alt: "Ridge" };
  const config = { layout: "grid", images: [legacyImage, managedImage] };
  const record = { assetId: "a7", transformName: "public", version: 8 };
  const media = { a7: record };
  const host: WidgetMediaHost = { ...base, media: { ...base.media, renderImageTag },
    renderGallery: ({ config: issuedConfig, media: issuedMedia, renderImage }) => {
      expect(issuedConfig).toEqual({ layout: "grid", images: [
        { src: "https://image.example.test/field.png", alt: "Field" }, { mediaId: "a7", alt: "Ridge" },
      ] });
      expect(issuedMedia).toEqual({ a7: { assetId: "a7", transformName: "public", version: 8 } });
      return renderImage({ image: legacyImage, media: undefined }) +
        renderImage({ image: managedImage, media: record });
    },
  };
  expect(renderMediaWidget({
    ir: { componentId: "gallery", props: { config, media } }, host,
    docRendering: { renderDocNode, renderNodes: () => { throw new Error("unexpected inline nodes"); } },
  })).toBe('<img src="https://image.example.test/field.png" alt="Field"/><img src="/stub/key(a7)/transform" data-responsive="true"/>');
  expect(renderDocNode.mock.calls).toEqual([[{ node: { type: "image", attrs: { src: "https://image.example.test/field.png", alt: "Field" } } }]]);
  expect(renderImageTag.mock.calls).toEqual([[{
    src: "/stub/key(a7)/transform", alt: "Ridge", width: null, height: null, cssClass: null, htmlAttributes: null, markerAttributes: [], responsive: true,
  }]]);
});

it("rebuilds document resolution maps and uses an aligned authored title instead of the old title", () => {
  const titleText = { type: "text", text: "Authored title" };
  const bodyJson = { type: "doc", content: [{ type: "title", attrs: { textAlign: "center" }, content: [titleText] }] };
  const renderNodes = vi.fn<WidgetDocRendering["renderNodes"]>(() => "<strong>Authored title</strong>");
  const renderDocNode = vi.fn<WidgetDocRendering["renderDocNode"]>(() => "<p>Body</p>");
  const postDisplayDateIso = vi.fn<WidgetPostContentHost["postDisplayDateIso"]>(() => "2026-04-03T00:30:00Z");
  const formatDateLabel = vi.fn<WidgetPostContentHost["formatDateLabel"]>(() => "Apr 2 & evening");
  const host = { classes: POST_CLASSES, postDisplayDateIso, formatDateLabel };
  expect(renderWidgetPostContent({ host, docRendering: { renderDocNode, renderNodes }, props: {
    title: "Legacy title", bodyJson, publishAt: "2026-04-03T00:30:00Z", updatedAt: "2026-03-31T05:00:00Z",
    timeZone: "America/Los_Angeles", postAuthorByline: "<span>Ada</span>",
    inlineWidgets: { place: { componentId: "text", props: { body: "Inline" } }, malformed: { componentId: "text" } },
    mediaTransformVersions: { public: 8, invalid: "9" },
    mediaAssetMetadata: { a7: { width: 300, height: "400", contentType: "image/png", slug: "photo", sha256: "abcdef012345" }, bad: null },
  } })).toBe(
    '<div class="h-post-head"><h1 style="text-align:center"><strong>Authored title</strong></h1><div class="h-post-meta"><time datetime="2026-04-03T00:30:00Z">Apr 2 &amp; evening</time><span data-post-author-separator="">Ada</span></div></div><div class="h-post-body"><p>Body</p></div>',
  );
  expect(postDisplayDateIso.mock.calls).toEqual([[{ publishAt: "2026-04-03T00:30:00Z", updatedAt: "2026-03-31T05:00:00Z" }]]);
  expect(formatDateLabel.mock.calls).toEqual([[{ iso: "2026-04-03T00:30:00Z" }, { timeZone: "America/Los_Angeles" }]]);
  expect(renderNodes.mock.calls).toEqual([[{ nodes: [titleText], inlineResolved: new Map(), mediaTransformVersions: new Map(), mediaAssetMetadata: new Map(), depth: 0 }]]);
  expect(renderDocNode.mock.calls).toEqual([[{ node: bodyJson }, {
    inlineResolved: new Map([["place", { componentId: "text", props: { body: "Inline" } }]]), mediaTransformVersions: new Map([["public", 8]]),
    mediaAssetMetadata: new Map([["a7", { width: 300, height: null, cssClass: null, htmlAttributes: null, contentType: "image/png", slug: "photo", sha256: "abcdef012345" }]]),
  }]]);
});

it("renders only the document body when the post-content header is explicitly disabled", () => {
  const bodyJson = { type: "doc", content: [] };
  const renderDocNode = vi.fn<WidgetDocRendering["renderDocNode"]>(() => "<p>Body</p>");
  expect(renderWidgetPostContent({
    props: { title: "Hidden title", bodyJson, header: false, postAuthorByline: "<span>Hidden author</span>" },
    docRendering: { renderDocNode, renderNodes: () => { throw new Error("unexpected title nodes"); } },
    host: { classes: POST_CLASSES, postDisplayDateIso: () => "", formatDateLabel: () => { throw new Error("unexpected date"); } },
  })).toBe('<div class="h-post-body"><p>Body</p></div>');
  expect(renderDocNode.mock.calls).toEqual([[{ node: bodyJson }, { inlineResolved: new Map(), mediaTransformVersions: new Map(), mediaAssetMetadata: new Map() }]]);
});

it("forwards normalized FAQ fields and layout to the host card renderer and renders its empty fallback", () => {
  const renderEntryList = vi.fn<WidgetEntriesHost["renderEntryList"]>(({ items }) => items.length === 1 ? "<section>Cards</section>" : undefined);
  const host: WidgetEntriesHost = {
    renderEntryList, renderEntryListStructuredData: () => { throw new Error("unexpected list JSON-LD"); },
    isCollectionListLayout, collectionListFaqPage: "faq-page", entryListAttribute: "data-host-list", classes: ENTRIES_CLASSES,
  };
  const ir = { componentId: "recent-entries", props: { layout: "accordion", typeKey: "faqs", columns: 2, structuredData: "faq-page" } };
  expect(renderWidgetRecentEntries({ host, ir: { ...ir, children: [{
    componentId: "entry-summary", props: {
      title: "Question #7", href: "/faq/question-7", dateIso: "2026-04-02", dateLabel: "April 2",
      fields: [{ name: "answer", label: "Response", kind: "text", value: "Seven" }],
    },
  }] } })).toBe("<section>Cards</section>");
  expect(renderWidgetRecentEntries({ host, ir })).toBe('<ul class="h-recent"><li class="h-empty">No entries yet.</li></ul>');
  expect(renderEntryList.mock.calls).toEqual([
    [{ attribute: "data-host-list", options: { layout: "accordion", typeKey: "faqs", columns: 2, structuredData: "faq-page" },
      items: [{ title: "Question #7", href: "/faq/question-7", dateIso: "2026-04-02", dateLabel: "April 2",
        fields: [{ name: "answer", label: "Response", kind: "text", value: "Seven" }] }] }],
    [{ attribute: "data-host-list", options: { layout: "accordion", typeKey: "faqs", columns: 2, structuredData: "faq-page" }, items: [] }],
  ]);
});

it("stamps authored HTML form fields and allocates a distinct ID prefix for each occurrence", () => {
  const presentation: ContactFormWidgetHost["presentation"] = {
    formClass: "h-form", errorClass: "h-error", widgetClass: "h-widget", contactFormClass: "h-contact",
    successExtraClass: "h-success", errorExtraClass: "h-failure", submitLabel: "Send",
    successMessageFallback: "Host thanks", baselineStyle: "<style>base</style>", rangeReadoutScript: "<script>range</script>",
    fieldClasses: { fieldClass: "h-field", fieldHelpClass: "h-help", errorClass: "h-inline-error", fieldCheckboxClass: "h-check" },
    hooks: { field: "data-h-field", form: "data-h-form", success: "data-h-success", error: "data-h-error" },
  };
  const renderHtmlForm = vi.fn<ContactFormWidgetHost["forms"]["renderHtmlForm"]>((_required, options) => `<form id="${options?.idPrefix}"></form>`);
  const stampFormFieldMaxLengths = vi.fn<ContactFormWidgetHost["forms"]["stampFormFieldMaxLengths"]>(({ html }) => `${html}<b>Stamped limits</b>`);
  const newOccurrenceId = vi.fn<() => string>(() => { throw new Error("unexpected occurrence"); }).mockReturnValueOnce("first").mockReturnValueOnce("second");
  const fieldMaxChars: ContactFormWidgetHost["forms"]["fieldMaxChars"] = () => 120;
  const unexpected = () => { throw new Error("unexpected form mode"); };
  const host: ContactFormWidgetHost = { presentation, newOccurrenceId, forms: {
    stampFormFieldMaxLengths, fieldMaxChars, renderHtmlForm, renderFormCollection: unexpected,
    renderFormSuccessSlot: unexpected, renderFormErrorSlot: unexpected, renderHtmlFormBody: unexpected, renderFormSchemaHash: unexpected,
  } };
  const fields = [{ id: "message", label: "Message", type: "text", required: true }];
  const html = '<input name="message">';
  const props = { slug: "request/quote", mode: "html", fields, html, schemaHash: "rev-7", successMessage: "Saved by Atlas" };
  expect(renderWidgetContactForm({ props, host })).toBe('<style>base</style><form id="widget-contact-first"></form><b>Stamped limits</b>');
  const { successMessage: _message, ...withoutMessage } = props;
  expect(renderWidgetContactForm({ props: withoutMessage, host })).toBe('<style>base</style><form id="widget-contact-second"></form><b>Stamped limits</b>');
  const formArgs = { slug: "request/quote", action: "/forms/request%2Fquote/submit", hooks: presentation.hooks, fields };
  const formOptions = { html, schemaHash: "rev-7", className: "h-form", ...presentation.fieldClasses };
  expect(renderHtmlForm.mock.calls).toEqual([
    [formArgs, { ...formOptions, idPrefix: "widget-contact-first", successMessage: "Saved by Atlas" }],
    [formArgs, { ...formOptions, idPrefix: "widget-contact-second", successMessage: "Host thanks" }],
  ]);
  expect(stampFormFieldMaxLengths.mock.calls).toEqual([
    [{ html: '<form id="widget-contact-first"></form>', fields, fieldMaxChars }],
    [{ html: '<form id="widget-contact-second"></form>', fields, fieldMaxChars }],
  ]);
  expect(renderWidgetContactForm({ props: {}, host })).toBe('<div class="widget widget-placeholder" aria-hidden="true"></div>');
  expect(newOccurrenceId.mock.calls).toEqual([[], []]);
});

it("collection-backed forms send authored HTML only in HTML mode and keep embed consent opt-in", () => {
  const presentation: ContactFormWidgetHost["presentation"] = {
    formClass: "h-form", errorClass: "h-error", widgetClass: "h-widget", contactFormClass: "h-contact",
    successExtraClass: "h-success", errorExtraClass: "h-failure", submitLabel: "Send",
    successMessageFallback: "Thanks", baselineStyle: "<style>base</style>", rangeReadoutScript: "<script>range</script>",
    fieldClasses: { fieldClass: "h-field", fieldHelpClass: "h-help", errorClass: "h-inline-error", fieldCheckboxClass: "h-check" },
    hooks: { field: "data-h-field", form: "data-h-form", success: "data-h-success", error: "data-h-error" },
  };
  const collection = vi.fn(renderFormCollection);
  const notLocalForm = () => { throw new Error("provider owns this collection"); };
  const host: ContactFormWidgetHost = { presentation, newOccurrenceId: () => "collection", forms: {
    renderFormCollection: collection, stampFormFieldMaxLengths: notLocalForm, fieldMaxChars: notLocalForm,
    renderFormSuccessSlot: notLocalForm, renderFormErrorSlot: notLocalForm, renderHtmlFormBody: notLocalForm,
    renderHtmlForm: notLocalForm, renderFormSchemaHash: notLocalForm,
  } };
  const fields = [{ id: "answer", label: "Answer", type: "text", required: true }];
  const capabilities = { answers: "provider", validation: "browser", spamProtection: "provider" };
  const plan = { kind: "post" as const, external: true, action: "https://forms.example.test/submit", capabilities };
  const html = '<input name="answer">';
  const props = { slug: "office", fields, html, collectionPlan: plan };
  expect(renderWidgetContactForm({ props: { ...props, mode: "html" }, host })).toBe(
    '<style>base</style><form method="post" action="https://forms.example.test/submit" data-form-provider="external" class="h-form"><input name="answer"></form>',
  );
  expect(renderWidgetContactForm({ props: { ...props, mode: "builder" }, host })).toContain('id="widget-contact-collection-answer"');
  expect(collection.mock.calls.slice(0, 2)).toEqual([
    [{ slug: "office", fields, hooks: presentation.hooks, plan }, { ...presentation.fieldClasses, html, className: "h-form", idPrefix: "widget-contact-collection", consentOff: false }],
    [{ slug: "office", fields, hooks: presentation.hooks, plan }, { ...presentation.fieldClasses, className: "h-form", idPrefix: "widget-contact-collection", consentOff: false }],
  ]);
  const embed = { kind: "embed", title: "Intake", url: "https://forms.example.test/embed", consent: ["functional"], capabilities };
  expect(renderWidgetContactForm({ props: { ...props, collectionPlan: embed }, host })).toContain('<iframe data-src="https://forms.example.test/embed"');
  expect(renderWidgetContactForm({ props: { ...props, collectionPlan: embed, collectionConsentOff: true }, host }))
    .toContain('<iframe src="https://forms.example.test/embed"');
});
