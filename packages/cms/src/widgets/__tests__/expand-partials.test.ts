import { describe, expect, it } from "vitest";
import { expandPartials, type PartialSlotDescriptor } from "../markers/index.js";

const nav = `<div data-embed-config='{"type":"partial","id":"nav"}'>fallback</div>`;
const defaultSlots: Readonly<Record<string, PartialSlotDescriptor>> = { nav: { source: "nav.html" } };

describe("expandPartials", () => {
  it("uses supplied defaults only when slots are omitted", () => {
    const partials = { nav: "<nav>Main</nav>" };
    expect(expandPartials({ html: nav, theme: { partials, manifest: {} }, defaultSlots })).toBe("<nav>Main</nav>");
    expect(expandPartials({ html: nav, theme: { partials, manifest: { slots: {} } }, defaultSlots })).toBe(nav);
  });

  it("prefers an explicit variant mapping, then the filename convention", () => {
    const html = `<div data-embed-config='{"type":"partial","id":"nav","variant":"small"}'></div>`;
    const partials = { nav: "base", "nav-small": "convention", compact: "explicit" };
    expect(expandPartials({ html, theme: { partials, manifest: {
      slots: { nav: { source: "nav.html", variants: { small: "compact.html" } } },
    } }, defaultSlots })).toBe("explicit");
    expect(expandPartials({ html, theme: { partials, manifest: {} }, defaultSlots })).toBe("convention");
  });

  it("accepts extensionless slot keys without consuming targetless markers", () => {
    const variant = `<div data-embed-config='{"type":"partial","id":"nav","variant":"small"}'></div>`;
    const targetless = `<aside data-embed-config='{"type":"partial","slug":"nav"}'>Authored fallback</aside>`;
    const theme = { partials: { menu: '<nav>Full</nav>', "menu-small": '<nav>Small</nav>' }, manifest: { slots: { nav: { source: "menu" } } } };
    expect(expandPartials({ html: nav + variant + targetless, theme, defaultSlots })).toBe("<nav>Full</nav><nav>Small</nav>" + targetless);
  });

  it("retains undeclared fallback and unrelated markers", () => {
    const html = nav + `<div data-embed-config='{"type":"widget","id":"nav"}'>widget</div>`;
    expect(expandPartials({ html, theme: { partials: {}, manifest: { slots: {} } }, defaultSlots })).toBe(html);
  });

  it("collapses missing declared content and removes a bare wrapper", () => {
    expect(expandPartials({ html: nav, theme: { partials: {}, manifest: {} }, defaultSlots })).toBe("");
    expect(expandPartials({ html: nav, theme: { partials: { nav: "body" }, manifest: {} }, defaultSlots })).toBe("body");
  });

  it("keeps attributed wrappers while stripping their marker configuration", () => {
    const html = `<section class="wide" id="top" data-embed-config='{"type":"partial","id":"nav"}'></section>`;
    expect(expandPartials({ html, theme: { partials: { nav: "<nav>Main</nav>" }, manifest: {} }, defaultSlots }))
      .toBe('<section class="wide" id="top"><nav>Main</nav></section>');
  });

  it("leaves a nested inserted partial marker for a later pass", () => {
    const inner = `<div data-embed-config='{"type":"partial","id":"footer"}'></div>`;
    expect(expandPartials({ html: nav, theme: { partials: { nav: inner, footer: "footer" }, manifest: {
      slots: { ...defaultSlots, footer: { source: "footer.html" } },
    } }, defaultSlots })).toBe(inner);
  });

  it("leaves a self-reference inserted by a partial alone", () => {
    const self = `<div data-embed-config='{"type":"partial","id":"nav"}'></div>`;
    const partial = `<nav>${self}</nav>`;
    expect(expandPartials({ html: nav, theme: { partials: { nav: partial }, manifest: {} }, defaultSlots })).toBe(partial);
  });

  it("matches current-page IDs literally and only on an opted-in slot", () => {
    const html = `<div data-embed-config='{"type":"partial","id":"nav","current":"a.b"}'></div>`;
    const partial = '<a href="/wrong" data-nav-id="axb">Wrong</a><a href="/right" data-nav-id="a.b">Right</a>';
    expect(expandPartials({ html, theme: { partials: { nav: partial }, manifest: {
      slots: { nav: { source: "nav.html", honorsCurrentPage: true } },
    } }, defaultSlots })).toBe('<a href="/wrong" data-nav-id="axb">Wrong</a><a href="/right" data-nav-id="a.b" aria-current="page">Right</a>');
    expect(expandPartials({ html, theme: { partials: { nav: partial }, manifest: {} }, defaultSlots })).toBe(partial);
    expect(expandPartials({ html: nav, theme: { partials: { nav: partial }, manifest: {
      slots: { nav: { source: "nav.html", honorsCurrentPage: true } },
    } }, defaultSlots })).toBe(partial);
  });
});
