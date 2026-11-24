import { describe, expect, it } from "vitest";
import { renderWidgetMediaImage, renderMediaWidget } from "../media.js";
import { renderWidgetEntrySummary, renderWidgetRecentEntries, renderWidgetSocialLinks } from "../social-entries.js";
import { renderWidgetPostContent } from "../post-content.js";
import { renderWidgetContactForm } from "../../contact-form-widget.js";
import type { ContactFormWidgetHost, WidgetEntriesHost, WidgetMediaHost, WidgetPostContentHost } from "../widget-render-contract.js";

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
