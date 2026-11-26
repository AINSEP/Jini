import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { keepImportedCodeOff, pageBodyMayRunScript, unrecognisedThemes, type KeepOffHost, type KeepOffStore } from "../import-keep-off.js";

/** A neutral sanitizer: `<script` is dropped as `script`, `<mark` as the inert `mark`, `<blink` as `blink`. */
const host: KeepOffHost = {
  sanitizePageHtml: ({ html }, { reportDrops }) => {
    const dropped: Record<string, number> = {};
    for (const tag of ["script", "mark", "blink"]) if (html.includes(`<${tag}`)) dropped[tag] = 1;
    reportDrops({ dropped });
  },
  noThemeId: "none",
  notices: {
    setAside: ({ fallback }) => `aside:${fallback}`,
    themeKeptOff: ({ themeId }) => `theme-off:${themeId}`,
    pageDrafted: ({ title }) => `page:${title}`,
    morePagesDrafted: {
      singular: ({ count }) => `more-pages:${count}`,
      plural: ({ count }) => `more-pages:${count}`,
    },
    menuKeptOff: ({ title, id }) => `menu:${title}:${id}`,
    moreMenusKeptOff: ({ count }) => `more-menus:${count}`,
    formDisabled: ({ name, id }) => `form:${name}:${id}`,
    moreFormsDisabled: ({ count }) => `more-forms:${count}`,
  },
};

function store(seed: { themes?: string[]; pages?: { id: number; title: string; bodyHtml: string | null }[]; menus?: { id: number; title: string; docJson: string }[]; forms?: { id: number; name: string; fieldsJson: string }[] }) {
  const log = { reassigned: [] as { from: string; to: string }[], drafted: [] as unknown[], menuDocs: [] as { id: unknown; docJson: string }[], disabled: [] as unknown[], closed: 0 };
  const s: KeepOffStore = {
    activeThemeIds: async () => seed.themes ?? [],
    reassignActiveTheme: async r => { log.reassigned.push(r); },
    publishedHtmlPages: async () => seed.pages ?? [],
    draftPage: async ({ id }) => { log.drafted.push(id); },
    menus: async () => seed.menus ?? [],
    setMenuDoc: async r => { log.menuDocs.push(r); },
    forms: async () => seed.forms ?? [],
    disableForm: async ({ id }) => { log.disabled.push(id); },
    close: async () => { log.closed++; },
  };
  return { s, log };
}
const run = (s: KeepOffStore, over: Partial<Parameters<typeof keepImportedCodeOff>[0]> = {}) =>
  keepImportedCodeOff({ dbPath: "x.db", fallback: "base", liveThemes: new Set(), unrecognised: new Set(), setAside: false, openStore: () => s, host, ...over });

describe("pageBodyMayRunScript", () => {
  it("is false for plain markup and for drops the inert list allows (mutation: drop-inert-allowlist)", () => {
    expect(pageBodyMayRunScript({ html: "<p>hi</p>", host })).toBe(false);
    expect(pageBodyMayRunScript({ html: "<p><mark>hi</mark></p>", host })).toBe(false);
  });
  it("is true when the sanitizer drops anything else", () => {
    expect(pageBodyMayRunScript({ html: "<script>1</script>", host })).toBe(true);
    expect(pageBodyMayRunScript({ html: "<blink>1</blink>", host })).toBe(true);
  });
  it("is true when an attribute value holds markup or an escape (mutation: skip-attribute-markup-check)", () => {
    expect(pageBodyMayRunScript({ html: '<a title="&lt;b&gt;x">y</a>', host })).toBe(true);
    expect(pageBodyMayRunScript({ html: '<a title="a\\b">y</a>', host })).toBe(true);
  });
});

describe("keepImportedCodeOff", () => {
  it("moves unrecognised active themes to the fallback, never the no-theme id or an own theme (mutation: skip-no-theme-guard)", async () => {
    const { s, log } = store({ themes: ["none", "base", "mine", "foreign"] });
    const notices = await run(s, { liveThemes: new Set(["themes/static/mine", "__x"]), unrecognised: new Set(["foreign"]) });
    expect(notices).toEqual(["theme-off:foreign"]);
    expect(log.reassigned).toEqual([{ from: "foreign", to: "base" }]);
  });
  it("moves a theme that is neither own nor recognised to the fallback without a notice", async () => {
    const { s, log } = store({ themes: ["stranger"] });
    expect(await run(s)).toEqual([]);
    expect(log.reassigned).toEqual([{ from: "stranger", to: "base" }]);
  });
  it("drafts only pages that may run script and prepends the set-aside notice", async () => {
    const { s, log } = store({ pages: [{ id: 1, title: "ok", bodyHtml: "<p>a</p>" }, { id: 2, title: "bad", bodyHtml: "<script>1</script>" }, { id: 3, title: "none", bodyHtml: null }] });
    expect(await run(s, { setAside: true })).toEqual(["aside:base", "page:bad"]);
    expect(log.drafted).toEqual([2]);
  });
  it("caps page notices at 20 with one summary line (mutation: drop-notice-cap)", async () => {
    const pages = Array.from({ length: 22 }, (_, i) => ({ id: i, title: `t${i}`, bodyHtml: "<script>1</script>" }));
    const { s, log } = store({ pages });
    const notices = await run(s);
    expect(notices).toHaveLength(21);
    expect(notices.at(-1)).toBe("more-pages:2");
    expect(log.drafted).toHaveLength(22);
  });
  it("truncates long titles to 80 characters", async () => {
    const { s } = store({ pages: [{ id: 1, title: "x".repeat(100), bodyHtml: "<script>1</script>" }] });
    expect(await run(s)).toEqual([`page:${"x".repeat(80)}`]);
  });
  it("selects singular and plural summary formatters before passing the count", async () => {
    const notices = { ...host.notices, morePagesDrafted: {
      singular: ({ count }: { count: number }) => `${count} more page holds its own code and was imported as a draft.`,
      plural: ({ count }: { count: number }) => `${count} more pages hold their own code and were imported as drafts.`,
    } };
    for (const count of [21, 22]) {
      const { s } = store({ pages: Array.from({ length: count }, (_, id) => ({ id, title: `t${id}`, bodyHtml: "<script>1</script>" })) });
      const result = await run(s, { host: { ...host, notices } });
      expect(result.at(-1)).toBe(count === 21 ? "1 more page holds its own code and was imported as a draft." : "2 more pages hold their own code and were imported as drafts.");
    }
  });
  it("closes once when drafting a page fails without scanning menus or forms", async () => {
    const { s, log } = store({ pages: [{ id: 1, title: "bad", bodyHtml: "<script>1</script>" }] });
    s.draftPage = async () => { throw new Error("draft failed"); };
    s.menus = async () => { throw new Error("menus reached"); };
    s.forms = async () => { throw new Error("forms reached"); };
    await expect(run(s)).rejects.toThrow("draft failed");
    expect(log.closed).toBe(1);
  });
  it("switches html-mode menus with script to items mode, skips invalid JSON and other modes", async () => {
    const html = (h: string) => JSON.stringify({ mode: "html", html: h });
    const { s, log } = store({ menus: [{ id: 1, title: "m1", docJson: html("<script>1</script>") }, { id: 2, title: "m2", docJson: html("<p>a</p>") }, { id: 3, title: "m3", docJson: "not json" }, { id: 4, title: "m4", docJson: JSON.stringify({ mode: "items" }) }] });
    expect(await run(s)).toEqual(["menu:m1:1"]);
    expect(log.menuDocs).toEqual([{ id: 1, docJson: JSON.stringify({ mode: "items", html: "<script>1</script>" }) }]);
  });
  it("disables html-mode forms with script but tolerates inert form hints", async () => {
    const f = (h: string) => JSON.stringify({ mode: "html", html: h });
    const { s, log } = store({ forms: [{ id: 1, name: "f1", fieldsJson: f("<script>1</script>") }, { id: 2, name: "f2", fieldsJson: f("<fieldset><legend>x</legend><input maxlength=3></fieldset>") }] });
    expect(await run(s)).toEqual(["form:f1:1"]);
    expect(log.disabled).toEqual([1]);
  });
  it("caps menu and form summaries and always closes the store (mutation: skip-close)", async () => {
    const bad = JSON.stringify({ mode: "html", html: "<script>1</script>" });
    const menus = Array.from({ length: 21 }, (_, id) => ({ id, title: "m", docJson: bad }));
    const forms = Array.from({ length: 21 }, (_, id) => ({ id, name: "f", fieldsJson: bad }));
    const { s, log } = store({ menus, forms });
    const notices = await run(s);
    expect(notices).toContain("more-menus:1");
    expect(notices).toContain("more-forms:1");
    expect(log.closed).toBe(1);
    const failing = store({}); failing.s.activeThemeIds = async () => { throw new Error("db"); };
    await expect(run(failing.s)).rejects.toThrow("db");
    expect(failing.log.closed).toBe(1);
  });
});

describe("unrecognisedThemes", () => {
  it("lists live theme ids whose files differ from or are missing in the site's own copy", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "keepoff-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keepoff-"));
    try {
      for (const [base, rel, text] of [[root, "themes/static/same/a.css", "1"], [dir, "themes/static/same/a.css", "1"], [root, "themes/static/diff/a.css", "1"], [dir, "themes/static/diff/a.css", "2"], [root, "themes/static/gone/a.css", "1"], [root, "themes/code/code1/a.js", "1"], [root, "themes/declarative/other/a.css", "1"]] as const) {
        fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
        fs.writeFileSync(path.join(base, rel), text);
      }
      const files = ["themes/static/same/a.css", "themes/static/diff/a.css", "themes/static/gone/a.css", "themes/code/code1/a.js", "themes/declarative/other/a.css", "media/x.png"];
      const live = new Set(["static/same", "static/diff", "static/gone", "code/code1"]);
      expect([...unrecognisedThemes({ root, dir, files, liveThemes: live })].sort()).toEqual(["diff", "gone"]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
