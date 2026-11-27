import { expect, it, vi } from "vitest";
import { renderHtmlPageBody } from "../page-body.js";
import type { WidgetRenderIR } from "../../../../../widgets/index.js";

it("retains unowned and keyless content and keeps duplicate occurrences independent", () => {
  const ir: WidgetRenderIR = { componentId: "post-content", props: { header: true } };
  const html = `<nav data-embed-config='{"type":"menu","id":"nav"}'>menu</nav><main data-embed-config='{"type":"content"}'>body</main><div data-embed-config='{"type":"content","id":"p","header":false}'></div><div data-embed-config='{"type":"content","id":"p","header":true}'></div>`;
  const rendered = renderHtmlPageBody({ html, resolved: new Map([["content", new Map([["p", ir]])]]), renderWidgetIr: ({ ir }) => `<b>${String(ir.props.header)}</b>`, postAuthorForHeader: () => "" });
  expect(rendered).toContain(`<nav data-embed-config='{"type":"menu","id":"nav"}'>menu</nav>`);
  expect(rendered).toContain(`<main data-embed-config='{"type":"content"}'>body</main>`);
  expect(rendered).toContain("<div><b>false</b></div><div><b>true</b></div>");
  expect(ir.props.header).toBe(true);
});

it("applies the byline only to the current content marker, preferring its authored id over slug", () => {
  const html = `<div data-embed-config='{"type":"content","id":"other","slug":"main"}'></div><div data-embed-config='{"type":"content","slug":"main"}'></div>`;
  const post = { id: "p-main", slug: "main", author: "M. Moon", showAuthor: true };
  const resolved = new Map([["content", new Map<string, WidgetRenderIR>([
    ["other", { componentId: "post-content", props: { title: "Another" } }],
    ["main", { componentId: "post-content", props: { title: "Current" } }],
  ])]]);
  const postAuthorForHeader = vi.fn<Parameters<typeof renderHtmlPageBody>[0]["postAuthorForHeader"]>(() => "<span>Credit M. Moon</span>");
  const renderWidgetIr: Parameters<typeof renderHtmlPageBody>[0]["renderWidgetIr"] = ({ ir }) => {
    expect(ir.componentId).toBe("post-content");
    return `<h1>${String(ir.props.title)}</h1>${String(ir.props.postAuthorByline ?? "")}`;
  };
  expect(renderHtmlPageBody({ html, resolved, renderWidgetIr, postAuthorForHeader }, { postAuthor: post })).toBe(
    "<div><h1>Another</h1></div><div><h1>Current</h1><span>Credit M. Moon</span></div>",
  );
  expect(postAuthorForHeader.mock.calls).toEqual([[{ html, post }]]);
});

it("drops missing widget occurrences but gives unresolved content a public placeholder", () => {
  const html = `<div data-embed-config='{"type":"widget","slug":"deleted-widget"}'></div><div data-embed-config='{"type":"content","id":"missing-post"}'></div>`;
  const renderWidgetIr = vi.fn<Parameters<typeof renderHtmlPageBody>[0]["renderWidgetIr"]>(() => "<span>Unavailable</span>");
  expect(renderHtmlPageBody({
    html, resolved: undefined, renderWidgetIr,
    postAuthorForHeader: () => { throw new Error("unexpected byline request"); },
  })).toBe("<div><span>Unavailable</span></div>");
  expect(renderWidgetIr.mock.calls).toEqual([[{ ir: { componentId: "widget-placeholder", props: {} } }]]);
});

it("retains canonical plugin stamps separately from unknown-plugin fallback", () => {
  const html = `<div data-embed-config='{"type":"plugin","plugin":"example/login","component":"button"}'>known fallback</div><div data-embed-config='{"type":"plugin","plugin":"unknown/login","component":"button"}'>unknown fallback</div>`;
  const rendered = renderHtmlPageBody({ html, resolved: undefined, renderWidgetIr: () => "wrong", postAuthorForHeader: () => "" });
  expect(rendered).toContain("known fallback");
  expect(rendered).toContain("unknown fallback");
  const stamped = renderHtmlPageBody({ html: `<div data-embed-config='{"type":"plugin","plugin":"example/login","component":"button"}'>fallback</div>`, resolved: new Map([["plugin", new Map([["plugin:1", { componentId: "plugin-export", props: { html: "<b>trusted</b>", plugin: "example/login", component: "button", version: 1, consent: "necessary" } }]])]]), renderWidgetIr: () => "wrong", postAuthorForHeader: () => "" });
  expect(stamped).toContain('data-plugin="example/login"');
  expect(stamped).toContain("<b>trusted</b>");
});

it("keeps forwarded media attributes and controls local to each occurrence of the same asset", () => {
  const ir: WidgetRenderIR = { componentId: "media-image", props: { assetId: "asset", controls: true } };
  const html = `<div class="tile" preload="none" controls="false" data-embed-config='{"type":"media","id":"asset"}'></div><div class="preview" preload="metadata" data-embed-config='{"type":"media","id":"asset"}'></div>`;
  const renderWidgetIr = vi.fn<Parameters<typeof renderHtmlPageBody>[0]["renderWidgetIr"]>(({ ir }) =>
    ir.props.controls ? "<video controls></video>" : "<video></video>");
  expect(renderHtmlPageBody({ html, resolved: new Map([["media", new Map([["asset", ir]])]]),
    renderWidgetIr, postAuthorForHeader: () => "" })).toBe(
    '<div class="tile"><video></video></div><div class="preview"><video controls></video></div>',
  );
  // Each occurrence gets its own IR; replacement order (last marker first) is not part of the contract.
  expect(renderWidgetIr).toHaveBeenCalledTimes(2);
  expect(renderWidgetIr.mock.calls).toEqual(expect.arrayContaining([
    [{ ir: { componentId: "media-image", props: { assetId: "asset", controls: false, markerAttributes: [{ name: "preload", value: "none" }] } } }],
    [{ ir: { componentId: "media-image", props: { assetId: "asset", controls: true, markerAttributes: [{ name: "preload", value: "metadata" }] } } }],
  ]));
  expect(ir.props).toEqual({ assetId: "asset", controls: true });
});
