// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { useCmsSidebarLabelTooltips } from "../use-cms-sidebar-label-tooltips.hooks.js";

/** The host markup this test mirrors: its sidebar links and its one item with its own tooltip. */
const ITEM = "a.cms-item";
const OWNS_TITLE = ({ link }: { link: Element }) => link.getAttribute("href")?.endsWith("/sites") ?? false;

/** L13 Stryker: the whole hook (lines 7–33) had no test. */

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function mountNav(id = "admin-sidebar") {
  const nav = document.createElement("nav");
  nav.id = id;
  nav.innerHTML = [
    `<a class="cms-item" href="/posts" title="Rail: Posts"><span>Posts</span></a>`,
    `<a class="cms-item" href="/pages"><span>Pages</span></a>`,
    `<a class="cms-item" href="/admin/sites" title="Rail: Sites"><span>Sites</span></a>`,
    `<a class="cms-item" href="/empty" title="kept"><span></span></a>`,
    `<a class="other" href="/x" title="untouched"><span>Other</span></a>`,
  ].join("");
  document.body.append(nav);
  return nav;
}
const titles = (nav: HTMLElement) => [...nav.querySelectorAll("a")].map(a => a.getAttribute("title"));

afterEach(() => { document.body.innerHTML = ""; });

test("expanded CMS labels get their full text as the title; Sites and empty labels are left to their owners", () => {
  const nav = mountNav();
  renderHook(() => useCmsSidebarLabelTooltips({ itemSelector: ITEM }, { ownsTitle: OWNS_TITLE }));
  expect(titles(nav)).toEqual(["Posts", "Pages", null, "kept", "untouched"]);
});

test("a relabel or a new row is picked up without remounting", async () => {
  const nav = mountNav();
  renderHook(() => useCmsSidebarLabelTooltips({ itemSelector: ITEM }, { ownsTitle: OWNS_TITLE }));
  nav.querySelector('a[href="/posts"] span')!.textContent = "Beiträge";
  nav.insertAdjacentHTML("beforeend", `<a class="cms-item" href="/media"><span>Media</span></a>`);
  await flush();
  expect(nav.querySelector('a[href="/posts"]')!.getAttribute("title")).toBe("Beiträge");
  expect(nav.querySelector('a[href="/media"]')!.getAttribute("title")).toBe("Media");
});

test("unmount restores each original title — removing ones that had none — and stops observing", async () => {
  const nav = mountNav();
  const hook = renderHook(() => useCmsSidebarLabelTooltips({ itemSelector: ITEM }, { ownsTitle: OWNS_TITLE }));
  hook.unmount();
  expect(titles(nav)).toEqual(["Rail: Posts", null, null, "kept", "untouched"]);
  nav.querySelector('a[href="/pages"] span')!.textContent = "Changed";
  await flush();
  expect(nav.querySelector('a[href="/pages"]')!.getAttribute("title")).toBeNull();
});

test("a custom nav id and document are honoured; a missing nav is a no-op", () => {
  const nav = mountNav("other-nav");
  renderHook(() => useCmsSidebarLabelTooltips({ navId: "missing", itemSelector: ITEM }, { doc: document }));
  expect(titles(nav)).toEqual(["Rail: Posts", null, "Rail: Sites", "kept", "untouched"]);
  renderHook(() => useCmsSidebarLabelTooltips({ navId: "other-nav", itemSelector: ITEM }, { doc: document }));
  expect(titles(nav)[0]).toBe("Posts");
});

test("only the host's own items are touched, and only the host's exception keeps no title", () => {
  const nav = mountNav("admin-sidebar");
  renderHook(() => useCmsSidebarLabelTooltips({ itemSelector: "a.not-in-this-markup" }));
  expect(titles(nav)).toEqual(["Rail: Posts", null, "Rail: Sites", "kept", "untouched"]);
});
