import { expect, it } from "vitest";
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

it("retains canonical plugin stamps separately from unknown-plugin fallback", () => {
  const html = `<div data-embed-config='{"type":"plugin","plugin":"example/login","component":"button"}'>known fallback</div><div data-embed-config='{"type":"plugin","plugin":"unknown/login","component":"button"}'>unknown fallback</div>`;
  const rendered = renderHtmlPageBody({ html, resolved: undefined, renderWidgetIr: () => "wrong", postAuthorForHeader: () => "" });
  expect(rendered).toContain("known fallback");
  expect(rendered).toContain("unknown fallback");
  const stamped = renderHtmlPageBody({ html: `<div data-embed-config='{"type":"plugin","plugin":"example/login","component":"button"}'>fallback</div>`, resolved: new Map([["plugin", new Map([["plugin:1", { componentId: "plugin-export", props: { html: "<b>trusted</b>", plugin: "example/login", component: "button", version: 1, consent: "necessary" } }]])]]), renderWidgetIr: () => "wrong", postAuthorForHeader: () => "" });
  expect(stamped).toContain('data-plugin="example/login"');
  expect(stamped).toContain("<b>trusted</b>");
});
