import { expect, it } from "vitest";
import { hero, section, announcement, ctaBand, featureGrid } from "../components/marketing.js";

it("refuses disallowed action hrefs while using supplied media classes", () => {
  const mediaPlaceholderClasses = { box: "host-box", label: "host-label" };
  const props = { title: "<Title>", media: { label: "<Image>" }, actions: [{ href: "javascript:alert(1)", label: "<Go>" }] };
  const html = hero({ props, mediaPlaceholderClasses });
  expect(html).not.toContain("javascript:"); expect(html).toContain('href="#"');
  expect(html).toContain('class="host-box"'); expect(html).toContain('class="host-label"');
  expect(html).toContain("&lt;Title&gt;"); expect(html).toContain("&lt;Go&gt;");
  expect(section({ props, mediaPlaceholderClasses })).toContain('class="host-box"');
  expect(ctaBand({ props })).not.toContain("javascript:");
  expect(announcement({ props: { text: "Hello", link: { href: "javascript:alert(1)", label: "Go" } } })).not.toContain("javascript:");
  expect(featureGrid({ props: { items: [{ title: "<Card>", body: "<Body>" }] } })).toContain("&lt;Card&gt;");
});
