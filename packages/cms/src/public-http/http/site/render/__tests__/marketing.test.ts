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

it("renders a left-media section with escaped lists and distinct action styles", () => {
  const html = section({
    props: {
      id: 'stories"today', side: "left", title: "Today <now>", eyebrow: "Local & live", lead: "Lead & intro",
      body: ["Line & detail"], bullets: ["One <two>"], media: { label: "Map" },
      actions: [{ href: "/today" }, { href: "/archive", label: "Past & present" }, null],
    },
    mediaPlaceholderClasses: { box: "frame", label: "caption" },
  });
  expect(html).toBe(
    '<section class="section section--media-left" id="stories&quot;today"><div class="wrap section__inner"><div class="section__text"><p class="eyebrow">Local &amp; live</p><h2 class="section__title">Today &lt;now&gt;</h2><p class="section__lead">Lead &amp; intro</p><p>Line &amp; detail</p><ul class="ticks"><li>One &lt;two&gt;</li></ul><div class="actions"><a class="btn btn--primary" href="/today">Learn more</a><a class="btn btn--ghost" href="/archive">Past &amp; present</a></div></div><div class="section__media"><figure class="frame" style="aspect-ratio:16 / 9"><span class="caption">Map</span></figure></div></div></section>',
  );
});

it("omits an empty announcement and gives a present link its default label", () => {
  expect(announcement({ props: { link: { href: "/offers" } } })).toBe("");
  expect(announcement({ props: { text: "News & notes", link: { href: "/offers" } } })).toBe(
    '<div class="topbar"><div class="wrap"><p class="topbar__text">News &amp; notes <a class="topbar__link" href="/offers">Learn more →</a></p></div></div>',
  );
});
