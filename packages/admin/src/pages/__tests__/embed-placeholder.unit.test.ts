// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { embedMarkerTarget, parseEmbedMarkerConfig } from "@jini-ai/cms/widgets/markers";
import { createEmbedPlaceholderDescriber, isProtectedEmbedElement } from "../lib/embed-placeholder.js";

/**
 * @file Bug A (2026-09-23 interactive-bugs plan, Slice A2): the admin's own half of the Interactive
 * tab's placeholder card. Ports every case from Jini's
 * `packages/admin/src/react/__tests__/components/InteractiveHtmlEditor.test.tsx`
 * (`describeEmbedPlaceholder`/`isProtectedEmbedElement`) so behavior that already shipped keeps
 * working, then adds the slug/typeKey/post-previews cases that Jini's adapter cannot answer because
 * it never imports the server's marker-target rule. Built on `@jini-ai/cms/widgets/markers`'s
 * `parseEmbedMarkerConfig`/`embedMarkerTarget` (Slice A1) instead of a third copy of either rule.
 */

const t = (key: string) => key;
/** The host injects the CMS marker readers; the test passes the real ones. */
const markerReaders = { parseEmbedMarkerConfig, embedMarkerTarget };

describe("plugin export cards", () => {
  const config = { type: "plugin", plugin: "jini/google-login", component: "sign-in-button", version: 1, props: { variant: "light" } };

  it.each([
    ["PLUGIN_DISABLED", "plugin off: visitors see your fallback"],
    ["host-unavailable", "sign-in not configured: visitors see your fallback"],
    ["ready", "configured: check Preview"],
    ["props-required", "configured: check Preview"],
    ["PLUGIN_UNAVAILABLE", "plugin unavailable: visitors see your fallback"],
  ])("shows host availability %s without trusting authored stamps", (availability, status) => {
    const describe_ = createEmbedPlaceholderDescriber({ t, ...markerReaders }, { pluginEmbeds: () => [{ plugin: config.plugin, component: config.component, displayName: "Google Login", availability }] });
    const el = markerElement(config);
    el.setAttribute("data-plugin", "forged");
    expect(describe_(el)).toEqual({ kindLabel: "Google Login", identityLabel: `sign-in-button — ${status}`,
      guidanceLabel: "Preview shows the current button or your fallback. Static exports always use your fallback." });
    expect(isProtectedEmbedElement(el)).toBe(true);
  });

  it("never claims readiness for a newly authored marker with no host result", () => {
    expect(createEmbedPlaceholderDescriber({ t, ...markerReaders })(markerElement(config))?.identityLabel).toBe("sign-in-button — check Preview for availability");
  });

  it("reads current injected readiness even when the canvas captures its callback once", () => {
    const row = { plugin: config.plugin, component: config.component, displayName: "Site sign-in", availability: "ready" };
    const describe_ = createEmbedPlaceholderDescriber({ t, ...markerReaders }, { pluginEmbeds: () => [row] });
    expect(describe_(markerElement(config))?.kindLabel).toBe("Site sign-in");
    expect(describe_(markerElement(config))?.identityLabel).toBe("sign-in-button — configured: check Preview");
    row.displayName = "Member sign-in";
    row.availability = "PLUGIN_DISABLED";
    expect(describe_(markerElement(config))?.kindLabel).toBe("Member sign-in");
    expect(describe_(markerElement(config))?.identityLabel).toBe("sign-in-button — plugin off: visitors see your fallback");
  });
});

function markerElement(config: unknown): Element {
  const el = document.createElement("div");
  el.setAttribute("data-embed-config", typeof config === "string" ? config : JSON.stringify(config));
  return el;
}

describe("createEmbedPlaceholderDescriber", () => {
  const describe_ = createEmbedPlaceholderDescriber({ t, ...markerReaders });

  it("returns undefined for an element with no data-embed-config at all", () => {
    const el = document.createElement("div");
    expect(describe_(el)).toBeUndefined();
  });

  it("identifies a legacy placeholder by its authored element id", () => {
    const el = document.createElement("div");
    el.setAttribute("data-widget-embed", "contact-form");
    el.id = "contact-slot";

    expect(describe_(el)).toEqual({ kindLabel: "Content", identityLabel: "#contact-slot" });
  });

  it("keeps a safe generic card when data-embed-config is not valid JSON", () => {
    const el = markerElement("{not json");
    expect(describe_(el)).toEqual({ kindLabel: "Content", identityLabel: "no id set" });
  });

  it("keeps a safe generic card when data-embed-config parses but is not an object", () => {
    const el = markerElement('"just a string"');
    expect(describe_(el)).toEqual({ kindLabel: "Content", identityLabel: "no id set" });
  });

  it("keeps a safe generic card when the config object has no type", () => {
    const el = markerElement({ id: "abc" });
    expect(describe_(el)).toEqual({ kindLabel: "Content", identityLabel: "no id set" });
  });

  it("the owner's exact marker: a widget by slug gives Widget / slug contact-form", () => {
    const el = markerElement({ type: "widget", slug: "contact-form" });
    expect(describe_(el)).toEqual({ kindLabel: "Widget", identityLabel: "slug contact-form" });
  });

  it("media, post and content resolve identity by slug too", () => {
    expect(describe_(markerElement({ type: "media", slug: "hero-video" }))).toEqual({
      kindLabel: "Media",
      identityLabel: "slug hero-video",
    });
    expect(describe_(markerElement({ type: "post", slug: "hello-world" }))).toEqual({
      kindLabel: "Post",
      identityLabel: "slug hello-world",
    });
    expect(describe_(markerElement({ type: "content", slug: "about" }))).toEqual({
      kindLabel: "Content",
      identityLabel: "slug about",
    });
  });

  it("collection resolves identity by typeKey, labeled Collection", () => {
    const el = markerElement({ type: "collection", typeKey: "recipes" });
    expect(describe_(el)).toEqual({ kindLabel: "Collection", identityLabel: "typeKey recipes" });
  });

  it("a menu with only slug gives no id set — menu never resolves by slug", () => {
    const el = markerElement({ type: "menu", slug: "x" });
    expect(describe_(el)).toEqual({ kindLabel: "Menu", identityLabel: "no id set" });
  });

  it("a menu with an id resolves normally", () => {
    const el = markerElement({ type: "menu", id: "main" });
    expect(describe_(el)).toEqual({ kindLabel: "Menu", identityLabel: "id main" });
  });

  it("post-previews gets an identity line that is never 'no id set'", () => {
    const el = markerElement({ type: "post-previews" });
    const result = describe_(el);
    expect(result?.kindLabel).toBe("Post previews");
    expect(result?.identityLabel).not.toBe("no id set");
    expect(result?.identityLabel).toBe("Latest posts");
  });

  it("post-previews shows the marker's limit when present", () => {
    const el = markerElement({ type: "post-previews", limit: 6 });
    expect(describe_(el)?.identityLabel).toBe("Latest posts (6)");
  });

  it("name still wins over everything else, including a present id/slug/typeKey", () => {
    const el = markerElement({ type: "widget", id: "w-1", slug: "contact-form", name: "newsletter-signup" });
    expect(describe_(el)).toEqual({ kindLabel: "Widget", identityLabel: "newsletter-signup" });
  });

  it("id wins over slug when both are present", () => {
    const el = markerElement({ type: "widget", id: "abc", slug: "x" });
    expect(describe_(el)?.identityLabel).toBe("id abc");
  });

  it("shows 'no id set' when neither name nor a usable target key is present", () => {
    const el = markerElement({ type: "content" });
    expect(describe_(el)).toEqual({ kindLabel: "Content", identityLabel: "no id set" });
  });

  it("does not truncate a target value at or under 32 characters", () => {
    const value = "x".repeat(32);
    const el = markerElement({ type: "widget", slug: value });
    expect(describe_(el)?.identityLabel).toBe(`slug ${value}`);
  });

  it("truncates a target value longer than 32 characters with an ellipsis", () => {
    const value = "x".repeat(40);
    const el = markerElement({ type: "widget", slug: value });
    expect(describe_(el)?.identityLabel).toBe(`slug ${"x".repeat(32)}…`);
  });

  it.each([
    ["media", "Media"],
    ["widget", "Widget"],
    ["post", "Post"],
    ["content", "Content"],
  ])("labels the page-body-reachable type %s as %s", (type, expected) => {
    const el = markerElement({ type, id: "x" });
    expect(describe_(el)?.kindLabel).toBe(expected);
  });

  it.each([
    ["partial", "Partial"],
    ["menu", "Menu"],
  ])("labels the theme-only type %s as %s, defensively", (type, expected) => {
    const el = markerElement({ type, id: "x" });
    expect(describe_(el)?.kindLabel).toBe(expected);
  });

  it("labels every media marker Media regardless of image vs video", () => {
    expect(describe_(markerElement({ type: "media", id: "hero-photo.jpg" }))?.kindLabel).toBe("Media");
    expect(describe_(markerElement({ type: "media", id: "5da45f84-1803-4493-bfd6-ee08bd1dba2c" }))?.kindLabel).toBe("Media");
  });

  it("title-cases an unrecognized future type rather than dropping it", () => {
    const el = markerElement({ type: "gallery", id: "g1" });
    expect(describe_(el)?.kindLabel).toBe("Gallery");
  });

  it("an unknown type never claims a slug resolves — target key stays id-only", () => {
    expect(describe_(markerElement({ type: "mystery", slug: "x" }))?.identityLabel).toBe("no id set");
    expect(describe_(markerElement({ type: "mystery", id: "x" }))?.identityLabel).toBe("id x");
  });

  it("never throws for a completely unrecognized type and still returns a full descriptor", () => {
    const el = markerElement({ type: "some-future-marketplace-type", id: "x1" });
    expect(() => describe_(el)).not.toThrow();
    expect(describe_(el)).toEqual({ kindLabel: "Some-future-marketplace-type", identityLabel: "id x1" });
  });

  it("matches type case-insensitively, same as the server-side scanner", () => {
    const el = markerElement({ type: "Media", id: "m1" });
    expect(describe_(el)?.kindLabel).toBe("Media");
  });
});

describe("isProtectedEmbedElement", () => {
  it("is true for the legacy data-embed-type/data-widget-embed/data-form-embed attributes", () => {
    for (const attr of ["data-embed-type", "data-widget-embed", "data-form-embed"]) {
      const el = document.createElement("div");
      el.setAttribute(attr, "x");
      expect(isProtectedEmbedElement(el)).toBe(true);
    }
  });

  it("is true for a current data-embed-config marker, so an embed is never text-editable or dropped into", () => {
    const el = markerElement({ type: "widget", id: "x" });
    expect(isProtectedEmbedElement(el)).toBe(true);
  });

  it("is true for the non-DOM node shape GrapesJS's isComponent can pass, carrying data-embed-config", () => {
    const node = { attributes: { "data-embed-config": '{"type":"widget","id":"x"}' } } as unknown as Element;
    expect(isProtectedEmbedElement(node)).toBe(true);
  });

  it("is false for an ordinary element with none of the marker attributes", () => {
    const el = document.createElement("div");
    expect(isProtectedEmbedElement(el)).toBe(false);
  });
});
