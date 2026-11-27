import { expect, it } from "vitest";
import type { AdminMenuItem } from "../api/menus-api.types.js";
import { menuAuthoringForSave, menuHtmlEmbed, menuHtmlStarter } from "../html-rules.js";

it("quotes an apostrophe in the embed slug without ending the config attribute", () => {
  expect(menuHtmlEmbed({ slug: "owner's-menu" })).toBe(
    `<div data-embed-config='{"type":"menu","id":"owner&#39;s-menu","mode":"html"}'></div>`,
  );
});

it("starts a completely empty menu with a Home link", () => {
  expect(menuHtmlStarter({ items: [] })).toBe('<a href="/">Home</a>');
});

it("keeps flat links unwrapped, selects their best available href and escapes both link text and attributes", () => {
  const page = { kind: "entryRef" as const, lastKnownHref: "/about" };
  const items: AdminMenuItem[] = [
    { id: "one", label: "A&B <C> \"D\" 'E'", target: { kind: "url", href: '/search?q="tea"&p=2' } },
    { id: "two", label: "About", target: page, children: [] },
    { id: "three", target: { kind: "route", route: "/help" } },
  ];
  expect(menuHtmlStarter({ items })).toBe([
    '<a href="/search?q=&quot;tea&quot;&amp;p=2">A&amp;B &lt;C&gt; &quot;D&quot; &#39;E&#39;</a>',
    '<a href="/about">About</a>',
    '<a href="#"></a>',
  ].join("\n"));
});

it("preserves sibling order and emits theme depth hooks only on the appropriate nested items", () => {
  const items: AdminMenuItem[] = [
    { id: "one", label: "Home", target: { kind: "url", href: "/" } },
    { id: "two", label: "Shop", target: { kind: "url", href: "/shop" }, children: [
      { id: "sale", label: "Sale", target: { kind: "url", href: "/sale" } },
    ] },
    { id: "three", label: "News", target: { kind: "url", href: "/news" } },
  ];
  expect(menuHtmlStarter({ items })).toBe([
    '<ul class="menu-list depth-0">',
    '  <li class="menu-item depth-0"><a href="/">Home</a></li>',
    '  <li class="menu-item depth-0 has-children"><a href="/shop">Shop</a>',
    '    <ul class="menu-list depth-1">',
    '      <li class="menu-item depth-1"><a href="/sale">Sale</a></li>',
    '    </ul>',
    '  </li>',
    '  <li class="menu-item depth-0"><a href="/news">News</a></li>',
    '</ul>',
  ].join("\n"));
});

it.each([
  { mode: "html", storedMode: "items", expected: { mode: "html", html: "<nav>Fresh</nav>" } },
  { mode: "items", storedMode: "html", expected: { mode: "items" } },
  { mode: "items", storedMode: "items", expected: {} },
  { mode: "items", storedMode: undefined, expected: {} },
] as const)("saves $mode authoring over $storedMode without rewriting inactive HTML", ({ mode, storedMode, expected }) => {
  expect(menuAuthoringForSave({ mode, storedMode, html: "<nav>Fresh</nav>" })).toStrictEqual(expected);
});
