import { describe, expect, it } from "vitest";
import { normalizeLegacyWidgetMarkers } from "../html/legacy-widget-markers.js";

const normalize = (html: string): string => normalizeLegacyWidgetMarkers({ html });

describe("normalizeLegacyWidgetMarkers", () => {
  it("returns html without any data-embed-type text untouched", () => {
    expect(normalize("<div data-embed-id=w1>x</div>")).toBe("<div data-embed-id=w1>x</div>");
  });

  it("rewrites a widget type+id pair into a JSON config and drops the id with its leading whitespace", () => {
    expect(normalize(`<div class="a" data-embed-type="widget"   data-embed-id="w1">x</div>`))
      .toBe(`<div class="a" data-embed-config='{"type":"widget","id":"w1"}'>x</div>`);
  });

  it("omits id from the config when the marker has no data-embed-id", () => {
    expect(normalize(`<div data-embed-type="widget"></div>`)).toBe(`<div data-embed-config='{"type":"widget"}'></div>`);
  });

  it("only drops the legacy attributes when a data-embed-config is already authored", () => {
    expect(normalize(`<div data-embed-type="widget" data-embed-id="old" data-embed-config='{"id":"new"}'></div>`))
      .toBe(`<div  data-embed-config='{"id":"new"}'></div>`);
  });

  it("drops a data-embed-id that precedes data-embed-type", () => {
    expect(normalize(`<i data-embed-id=a data-embed-type=widget></i>`)).toBe(`<i data-embed-config='{"type":"widget","id":"a"}'></i>`);
  });

  it("matches the widget type value case-insensitively", () => {
    expect(normalize(`<div DATA-EMBED-TYPE="WIDGET"></div>`)).toBe(`<div data-embed-config='{"type":"widget"}'></div>`);
  });

  it("leaves non-widget embed types alone", () => {
    expect(normalize(`<div data-embed-type="post" data-embed-id="p1"></div>`)).toBe(`<div data-embed-type="post" data-embed-id="p1"></div>`);
  });

  it("ignores data-embed-type text inside comments and script", () => {
    const html = `<!-- <div data-embed-type="widget"></div> --><script>"data-embed-type=widget"</script>`;
    expect(normalize(html)).toBe(html);
  });

  it("escapes quote and ampersand in the id with JSON unicode escapes", () => {
    expect(normalize(`<div data-embed-type="widget" data-embed-id="a&apos;b&amp;c"></div>`))
      .toBe(`<div data-embed-config='{"type":"widget","id":"a\\u0027b\\u0026c"}'></div>`);
  });

  it("rewrites nested markers in one pass", () => {
    expect(normalize(`<div data-embed-type=widget data-embed-id=o><p data-embed-type=widget data-embed-id=i></p></div>`))
      .toBe(`<div data-embed-config='{"type":"widget","id":"o"}'><p data-embed-config='{"type":"widget","id":"i"}'></p></div>`);
  });

  it("skips parser-cloned elements that carry no source location (adoption agency)", () => {
    expect(normalize(`<b data-embed-type=widget data-embed-id=a><p>x</b>y</p>`))
      .toBe(`<b data-embed-config='{"type":"widget","id":"a"}'><p>x</b>y</p>`);
  });

  it("applies each source edit once when a reconstructed formatting element shares its source location", () => {
    // parse5 reconstructs <b> inside the second <p> with the SAME attribute locations; duplicate
    // ranges must be applied once so the authored markup remains intact.
    expect(normalize(`<p><b data-embed-type=widget>1<p>2`))
      .toBe(`<p><b data-embed-config='{"type":"widget"}'>1<p>2`);
  });
});
