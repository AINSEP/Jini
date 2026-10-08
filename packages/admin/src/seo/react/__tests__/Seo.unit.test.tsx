import { Harness, render, screen, within } from "./harness/render.js";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Seo } from "../pages/SeoPage.js";
import type { SeoController } from "../hooks/use-seo.hooks.js";
import type { EntryPickerController } from "../hooks/use-entry-picker.hooks.js";
import type { SeoEntryPanelController } from "../hooks/use-seo-entry-panel.hooks.js";
import type { SeoEntrySectionController } from "../hooks/use-seo-entry-section.hooks.js";
import type { SitemapModalController } from "../hooks/use-sitemap-modal.hooks.js";
import { api, type AdminMedia, type AdminPost, type SeoEntryAnalysis, type SeoEntryMeta, type SeoSettings, type SeoSettingsPatch } from "./harness/api.js";

/**
 * @file `Seo` — the SEO settings screen (SPEC-008 §2.4/§2.5/§2.6, SPEC-037 REQ-06/07/08). Only
 * `Seo` itself is exported; `EntryPicker`, `AnalyzePanel`, `SeoEntryPanel`, `SeoEntrySection` are
 * internal. Each of the four declares its own `use*Hook` DI seam, but — same situation as
 * `Recovery.tsx`'s `RestoreFlow` and `Database.tsx`'s sections — the parent never threads a prop
 * through when it instantiates a child (`SeoEntrySection` renders `<EntryPicker .../>` and
 * `<SeoEntryPanel .../>` with no hook prop; `Seo` renders `<SeoEntrySection />` the same way). A
 * prior agent flagged these four as possibly untestable in isolation for exactly this reason.
 *
 * They ARE reachable: each hook module is mocked via a `vi.hoisted` ref (the same fallback seam
 * proven out for `Recovery.tsx`, `Database.tsx`, and `Collections.tsx`'s dialogs), giving full
 * control over every state without a real `fetch`. `AnalyzePanel` has no hook of its own — it only
 * takes `analysis` as a prop — so it's reached simply by giving `SeoEntryPanel`'s mocked controller
 * a non-null `analysis`.
 */

const { seoRef, entryPickerRef, seoEntryPanelRef, seoEntrySectionRef, sitemapModalRef } = vi.hoisted(() => ({
  seoRef: { current: null as unknown },
  entryPickerRef: { current: null as unknown },
  seoEntryPanelRef: { current: null as unknown },
  seoEntrySectionRef: { current: null as unknown },
  sitemapModalRef: { current: null as unknown },
}));

vi.mock("../hooks/use-seo.hooks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/use-seo.hooks.js")>();
  return { ...actual, useWiredSeo: () => seoRef.current };
});
vi.mock("../hooks/use-entry-picker.hooks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/use-entry-picker.hooks.js")>();
  return { ...actual, useWiredEntryPicker: () => entryPickerRef.current };
});
vi.mock("../hooks/use-seo-entry-panel.hooks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/use-seo-entry-panel.hooks.js")>();
  return { ...actual, useWiredSeoEntryPanel: () => seoEntryPanelRef.current };
});
vi.mock("../hooks/use-seo-entry-section.hooks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/use-seo-entry-section.hooks.js")>();
  return { ...actual, useSeoEntrySection: () => seoEntrySectionRef.current };
});
// `SitemapModal` is only ever rendered while `sitemapModalOpen` is true (`Seo.tsx`'s own
// conditional), but mounting it also mounts its real `useWiredSitemapModal` — which would fire a
// real `fetch("/sitemap.xml")` in this unit test. Mocked the same way the three hooks above are,
// so `Seo.unit.test.tsx` only ever asserts the dialog is present, never drives its own fetch/parse
// behavior (that lives in `SitemapModal.unit.test.tsx`, composed against `createFakeSitemapPort`).
vi.mock("../hooks/use-sitemap-modal.hooks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/use-sitemap-modal.hooks.js")>();
  return { ...actual, useWiredSitemapModal: () => sitemapModalRef.current };
});

const SETTINGS: SeoSettings = {
  titleTemplate: "%s | Site",
  defaultDescription: "A default description",
  defaultOgImage: "media:og1",
  twitterSite: "@site",
  defaultRobots: { noindex: false, nofollow: false },
  sitemapEnabled: true,
  robotsRules: [],
};

const RESOLVED: SeoEntryMeta = {
  title: "Entry title",
  description: "Entry description",
  canonical: "https://example.com/entry",
  robots: { noindex: false, nofollow: false },
  openGraph: { title: "OG title", description: "OG desc", type: "article", url: "https://example.com/entry", image: "og.png" },
  twitter: { card: "summary", title: "Twitter title", description: "Twitter desc", image: "tw.png" },
  jsonLd: [],
};

const ANALYSIS: SeoEntryAnalysis = {
  entryId: "e1",
  score: 82,
  issues: [
    { code: "missing-alt", severity: "warning", message: "Image missing alt text", field: "body" },
    { code: "no-canonical", severity: "error", message: "No canonical URL set" },
  ],
  resolved: RESOLVED,
};

const POST: AdminPost = {
  id: "p1",
  workspaceId: "w1",
  kind: "post",
  title: "My Post",
  slug: "my-post",
  bodyJson: {},
  status: "published",
  updatedAt: "2026-08-01T00:00:00.000Z",
  version: 1,
};

function seoController(overrides: Partial<SeoController> = {}): SeoController {
  // `defaultOgImage` mirrors what `useSeo`'s own resync effect would derive from `settings` —
  // computed from `overrides.settings` when the test supplies one, so a test overriding `settings`
  // to omit `defaultOgImage` gets the same "" a real re-sync would produce without ALSO having to
  // override `defaultOgImage` itself. An explicit `overrides.defaultOgImage` still wins via the
  // trailing spread below.
  const settingsForDefault = overrides.settings !== undefined ? overrides.settings : SETTINGS;
  return {
    settings: SETTINGS,
    error: null,
    saving: false,
    notice: null,
    save: vi.fn(async () => {}),
    defaultOgImage: settingsForDefault?.defaultOgImage ?? "",
    setDefaultOgImage: vi.fn(),
    regenerateSitemap: vi.fn(async () => true),
    sitemapModalOpen: false,
    openSitemapModal: vi.fn(),
    closeSitemapModal: vi.fn(),
    // Matches what this screen got from a real, unmocked `useAdminLocale()` call before this
    // hook's own i18n pass (defaults to "en" synchronously).
    locale: "en",
    ...overrides,
  };
}

function mediaItem(overrides: Partial<AdminMedia> = {}): AdminMedia {
  return {
    id: "asset-1",
    workspaceId: "w1",
    title: "Sunset",
    slug: "sunset",
    alt: "A sunset over water",
    caption: "",
    credit: "",
    sha256: "abc",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    width: null,
    height: null,
    cssClass: null,
    htmlAttributes: null,
    contentType: "image/png",
    publicUrl: null,
    ...overrides,
  };
}

function entryPickerController(overrides: Partial<EntryPickerController> = {}): EntryPickerController {
  return { entries: [POST], error: null, ...overrides };
}

function seoEntryPanelController(overrides: Partial<SeoEntryPanelController> = {}): SeoEntryPanelController {
  const touched: Record<string, unknown> = (overrides.touched as Record<string, unknown>) ?? {};
  return {
    resolved: RESOLVED,
    analysis: null,
    loadError: null,
    saving: false,
    saveError: null,
    notice: null,
    fieldValue: ((key: string, resolvedValue: unknown) => (key in touched ? touched[key] : resolvedValue)) as SeoEntryPanelController["fieldValue"],
    setField: vi.fn(),
    save: vi.fn(async () => {}),
    touched: {},
    ...overrides,
  };
}

function seoEntrySectionController(overrides: Partial<SeoEntrySectionController> = {}): SeoEntrySectionController {
  return { entryId: "", setEntryId: vi.fn(), ...overrides };
}

/** Default {@link SitemapModalController} for `Seo.unit.test.tsx`'s own "does the dialog render at
 *  all" tests — a fixed `"ready"`/zero-entries snapshot, never a real fetch. Behavioral coverage of
 *  the modal's own fetch/parse/filter/toggle logic lives in `SitemapModal.unit.test.tsx`. */
function sitemapModalController(overrides: Partial<SitemapModalController> = {}): SitemapModalController {
  return {
    status: "ready",
    error: null,
    xmlText: "",
    entries: [],
    filteredEntries: [],
    filter: "",
    setFilter: vi.fn(),
    view: "table",
    setView: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  seoRef.current = seoController();
  entryPickerRef.current = entryPickerController();
  seoEntryPanelRef.current = seoEntryPanelController();
  seoEntrySectionRef.current = seoEntrySectionController();
  sitemapModalRef.current = sitemapModalController();
});

/**
 * `tabId` was added when this screen became three `?tab=` tabs (2026-09-06). It is the same value
 * `panels.tsx` threads in from the query string, and it defaults to `undefined` — which
 * `resolveSeoTabId` resolves to the first tab, "defaults" — so every test about the site-wide
 * settings form reads exactly as it did before and needed no change.
 *
 * The suites below that exercise the sitemap actions or the per-entry panel now pass the tab their
 * subject actually lives on. That is a real assertion, not just plumbing: passing nothing there
 * fails, which is the tab system doing its job (an unmounted panel is genuinely absent from the
 * DOM, not merely hidden — worth knowing, since a `[hidden]`-based tab implementation would leave
 * these queries passing whether the tabs worked or not).
 */
function renderSeo(overrides: Partial<SeoController> = {}, tabId?: string) {
  seoRef.current = seoController(overrides);
  return render(<Seo tabId={tabId} />);
}

/** The two site-wide tabs the sitemap and per-entry suites select, named so a reader does not have
 *  to match a bare string literal against `SEO_TAB_IDS`. */
const SITEMAP_TAB = "sitemap";
const ENTRIES_TAB = "entries";

describe("Seo — loading and error states", () => {
  it("shows a loading notice while settings is null and there is no error", () => {
    renderSeo({ settings: null, error: null });
    expect(screen.getByText("Loading SEO settings…")).toBeInTheDocument();
  });

  it("shows only the error notice when settings is still null and error is set", () => {
    renderSeo({ settings: null, error: "failed to load SEO settings" });
    expect(screen.getByText("failed to load SEO settings")).toBeInTheDocument();
  });

  it("shows an inline banner ABOVE the form once settings have loaded and a later error occurs", () => {
    renderSeo({ settings: SETTINGS, error: "failed to save SEO settings" });
    expect(screen.getByText("failed to save SEO settings")).toBeInTheDocument();
    // The <form> has no accessible name, so it carries no implicit ARIA "form" role — assert its
    // presence structurally instead.
    expect(document.querySelector("form.jini-seo-panel")).toBeInTheDocument();
  });

  it("shows the notice banner on success", () => {
    renderSeo({ notice: "Saved." });
    expect(screen.getByText("Saved.")).toBeInTheDocument();
  });
});

describe("Seo — tabs", () => {
  it("renders the three tabs, with Site defaults selected for an absent ?tab=", () => {
    renderSeo();
    expect(screen.getByRole("tab", { name: /Site defaults/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Sitemap/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /Pages & posts/ })).toHaveAttribute("aria-selected", "false");
  });

  it("selects the tab named by ?tab=", () => {
    renderSeo({}, SITEMAP_TAB);
    expect(screen.getByRole("tab", { name: /Sitemap/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Site defaults/ })).toHaveAttribute("aria-selected", "false");
  });

  it("falls back to Site defaults for an unrecognized ?tab= rather than rendering a blank panel", () => {
    renderSeo({}, "not-a-real-tab");
    expect(screen.getByRole("tab", { name: /Site defaults/ })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector("form.jini-seo-panel")).toBeInTheDocument();
  });

  it("mounts ONLY the active tab's panel — an inactive panel is absent from the DOM, not hidden", () => {
    renderSeo();
    // Site defaults is up: its form is present, and neither other panel's content exists at all.
    expect(document.querySelector("form.jini-seo-panel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regenerate sitemap" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Entry" })).not.toBeInTheDocument();
  });

  it("keeps every defaults field inside ONE form, so an uncontrolled FormData submit cannot lose one", () => {
    // The reason the grouping is expressed as field-group headings inside one tab rather than as
    // three tabs: `SeoDefaultsTab` reads `new FormData(e.currentTarget)` on submit, and an input on
    // an unmounted panel would simply be absent from that payload. Pins all seven names together.
    renderSeo();
    const form = document.querySelector("form.jini-seo-panel") as HTMLFormElement;
    const names = [...form.querySelectorAll("input[name], textarea[name], select[name]")].map((el) => el.getAttribute("name"));
    expect(names).toEqual([
      "titleTemplate",
      "defaultDescription",
      "defaultOgImage",
      "twitterSite",
      "noindex",
      "nofollow",
      "sitemapEnabled",
    ]);
  });

  it("the Sitemap tab reports whether a sitemap is published at all, rather than duplicating the switch", () => {
    renderSeo({ settings: { ...SETTINGS, sitemapEnabled: false } }, SITEMAP_TAB);
    expect(screen.getByText("This site does not publish a sitemap. Turn it on under Site defaults.")).toBeInTheDocument();
    // The control itself stays on the defaults form — exactly one switch on the screen.
    expect(screen.queryByLabelText("Sitemap enabled")).not.toBeInTheDocument();
  });

  it("every tab panel carries a heading, so a screen reader navigating by heading is not left with H1 alone", () => {
    // `role="tab"` buttons are not in the heading list, so a panel's own <h2> is the only structure
    // a heading-navigating reader gets below the page title.
    renderSeo();
    expect(document.querySelectorAll("h2").length).toBeGreaterThan(0);

    renderSeo({}, SITEMAP_TAB);
    expect(screen.getByRole("heading", { name: "Cached sitemap" })).toBeInTheDocument();

    renderSeo({}, ENTRIES_TAB);
    expect(screen.getByRole("heading", { name: "Per-entry SEO" })).toBeInTheDocument();
  });
});

describe("Seo — defaults form", () => {
  it("pre-fills every field from settings", () => {
    renderSeo();
    expect(screen.getByLabelText(/Title template/)).toHaveValue("%s | Site");
    expect(screen.getByLabelText("Default meta description")).toHaveValue("A default description");
    const image = screen.getByLabelText(/Default Open Graph/);
    expect(image).toHaveValue("Selected image");
    expect(new FormData(image.closest('form')!).getAll('defaultOgImage')).toEqual(['media:og1']);
    expect(screen.getByLabelText("Twitter @site handle")).toHaveValue("@site");
    expect(screen.getByRole("checkbox", { name: "Default noindex" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Default nofollow" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Sitemap enabled" })).toBeChecked();
  });

  it("falls back to empty strings for optional fields the settings omit", () => {
    renderSeo({
      settings: { titleTemplate: "%s", defaultRobots: { noindex: false, nofollow: false }, sitemapEnabled: false, robotsRules: [] },
    });
    expect(screen.getByLabelText("Default meta description")).toHaveValue("");
    expect(screen.getByLabelText(/Default Open Graph/)).toHaveValue("");
    expect(screen.getByLabelText("Twitter @site handle")).toHaveValue("");
  });

  it("submitting the form calls save with FormData parsed into a SeoSettings patch", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (_patch: SeoSettingsPatch) => {});
    renderSeo({ save });
    await user.clear(screen.getByLabelText("Default meta description"));
    await user.type(screen.getByLabelText("Default meta description"), "An edited description");
    await user.clear(screen.getByLabelText("Twitter @site handle"));
    await user.type(screen.getByLabelText("Twitter @site handle"), "@updated");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(save).toHaveBeenCalledWith({
      titleTemplate: "%s | Site",
      defaultDescription: "An edited description",
      defaultOgImage: "media:og1",
      twitterSite: "@updated",
      defaultRobots: { noindex: false, nofollow: false },
      sitemapEnabled: true,
    });
  });

  it("submitting with the robots checkboxes checked sends noindex/nofollow true", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (_patch: SeoSettingsPatch) => {});
    renderSeo({ save });
    await user.click(screen.getByRole("checkbox", { name: "Default noindex" }));
    await user.click(screen.getByRole("checkbox", { name: "Default nofollow" }));
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    const patch = save.mock.calls.at(-1)![0];
    expect(patch.defaultRobots).toEqual({ noindex: true, nofollow: true });
  });

  // Was "submits blank optional fields as undefined, not empty strings", pinning the behavior a
  // 2026-09-06 review found to be the bug: `setSeoSettings` is a MERGE (`buildScalarWrites` skips
  // every `undefined` key), so an omitted field means UNCHANGED, and an operator who emptied
  // "Default meta description" to remove it saw it come straight back. `null` is the server's
  // documented clear sentinel for these three (`SEO_DEFINITIONS`, `apps/website/src/features/seo/
  // settings.ts`) and is what an emptied box now sends.
  it("submits blank optional fields as null — the server's clear sentinel — not undefined, which would mean 'leave unchanged'", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (_patch: SeoSettingsPatch) => {});
    renderSeo({
      settings: { titleTemplate: "%s", defaultRobots: { noindex: false, nofollow: false }, sitemapEnabled: false, robotsRules: [] },
      save,
    });
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    const patch = save.mock.calls.at(-1)![0];
    expect(patch.defaultDescription).toBeNull();
    expect(patch.defaultOgImage).toBeNull();
    expect(patch.twitterSite).toBeNull();
    // `JSON.stringify` drops `undefined` keys and keeps `null` ones, so this is the assertion that
    // actually distinguishes "clear" from "unchanged" on the wire.
    expect(Object.keys(JSON.parse(JSON.stringify(patch)))).toEqual(
      expect.arrayContaining(["defaultDescription", "defaultOgImage", "twitterSite"])
    );
  });

  it("a filled optional field still submits its string, so clearing is opt-in per box", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (_patch: SeoSettingsPatch) => {});
    renderSeo({ save });
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    const patch = save.mock.calls.at(-1)![0];
    expect(patch.defaultDescription).toBe("A default description");
    expect(patch.twitterSite).toBe("@site");
  });

  it("submits an emptied titleTemplate as '', NOT the '%s' fallback — FormData.get() returns '' for a present-but-empty field, never null, so the `?? \"%s\"` fallback is unreachable through the real form", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (_patch: SeoSettingsPatch) => {});
    renderSeo({ save });
    await user.clear(screen.getByLabelText(/Title template/));
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    const patch = save.mock.calls.at(-1)![0];
    expect(patch.titleTemplate).toBe("");
  });

  it("shows 'Saving…' and disables the submit button while saving", () => {
    renderSeo({ saving: true });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });
});

describe("Seo — default OG image (MediaRefField)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("typing directly into a URL field still calls setDefaultOgImage", async () => {
    const user = userEvent.setup();
    const setDefaultOgImage = vi.fn();
    renderSeo({ defaultOgImage: "https://images.example/cover.png", setDefaultOgImage });
    await user.type(screen.getByLabelText(/Default Open Graph/), "x");
    expect(setDefaultOgImage).toHaveBeenCalledWith("https://images.example/cover.pngx");
  });

  it("has no Remove control while empty, and shows one once a value is set", () => {
    const { rerender } = renderSeo({ defaultOgImage: "" });
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();

    seoRef.current = seoController({ defaultOgImage: "asset-1:public" });
    rerender(<Harness><Seo /></Harness>);
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  // readable-slugs S5b: buildMediaRef prefers the slug — id and slug are distinct here so a passing
  // assertion proves the SLUG was used, not just any field.
  it("Choose image opens the real media picker; selecting an asset calls setDefaultOgImage with the EXACT '{slug}:public' ref", async () => {
    vi.spyOn(api, "listMedia").mockResolvedValue({ media: [mediaItem({ id: "asset-7", slug: "asset-7-slug" })] });
    const user = userEvent.setup();
    const setDefaultOgImage = vi.fn();
    renderSeo({ defaultOgImage: "", setDefaultOgImage });

    await user.click(screen.getByRole("button", { name: "Choose image" }));
    await user.click(await screen.findByTitle("Sunset"));

    expect(setDefaultOgImage).toHaveBeenCalledTimes(1);
    expect(setDefaultOgImage).toHaveBeenCalledWith("asset-7-slug:public");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Remove calls setDefaultOgImage('')", async () => {
    const user = userEvent.setup();
    const setDefaultOgImage = vi.fn();
    renderSeo({ defaultOgImage: "asset-1:public", setDefaultOgImage });

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(setDefaultOgImage).toHaveBeenCalledWith("");
  });

  it("renders a preview thumbnail resolved off the current defaultOgImage value", () => {
    renderSeo({ defaultOgImage: "asset-1:public" });
    expect(screen.getByAltText(/Default Open Graph.*preview/)).toHaveAttribute(
      "src",
      expect.stringContaining("/media/asset-1/original"),
    );
  });
});

describe("Seo — sitemap regenerate", () => {
  it("clicking Regenerate sitemap calls regenerateSitemap", async () => {
    const user = userEvent.setup();
    const regenerateSitemap = vi.fn(async () => true);
    renderSeo({ regenerateSitemap }, SITEMAP_TAB);
    await user.click(screen.getByRole("button", { name: "Regenerate sitemap" }));
    expect(regenerateSitemap).toHaveBeenCalledTimes(1);
  });

  it("shows 'Working…' and disables the button while saving is true", () => {
    renderSeo({ saving: true }, SITEMAP_TAB);
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  });
});

describe("Seo — View sitemap modal", () => {
  it("does not render the sitemap modal when sitemapModalOpen is false", () => {
    renderSeo({ sitemapModalOpen: false }, SITEMAP_TAB);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clicking View sitemap calls openSitemapModal", async () => {
    const user = userEvent.setup();
    const openSitemapModal = vi.fn();
    renderSeo({ openSitemapModal }, SITEMAP_TAB);
    await user.click(screen.getByRole("button", { name: "View sitemap" }));
    expect(openSitemapModal).toHaveBeenCalledTimes(1);
  });

  it("renders the sitemap modal when sitemapModalOpen is true", () => {
    renderSeo({ sitemapModalOpen: true }, SITEMAP_TAB);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("SeoEntrySection / EntryPicker", () => {
  it("renders the EntryPicker with no entry selected initially", () => {
    renderSeo({}, ENTRIES_TAB);
    expect(screen.getByRole("combobox", { name: "Entry" })).toHaveValue("");
    expect(screen.queryByText("Per-entry overrides")).not.toBeInTheDocument();
  });

  it("EntryPicker: keeps the 'Entry' caption as a real label but stops painting it", () => {
    // Owner asked for the visible word gone ("you can actually just get rid of 'Entry'") — the
    // placeholder option already says "Choose an entry…". The accessible name is NOT allowed to go
    // with it: a select whose only text is a placeholder option has no name at all, which is the
    // exact defect a previous accessibility pass found on `MenuEditor.tsx`'s target-kind select.
    // Both halves are asserted together, because either one alone still passes on the old markup
    // (name-only was already green before the caption was hidden) or on a broken one (hidden-only
    // would pass on a `<span>` with no label around it).
    renderSeo({}, ENTRIES_TAB);
    const select = screen.getByRole("combobox", { name: "Entry" });
    const caption = screen.getByText("Entry");
    expect(caption).toHaveClass("jini-visually-hidden");
    expect(caption.closest("label")).toContainElement(select);
  });

  it("EntryPicker: shows a loading notice while entries is null", () => {
    entryPickerRef.current = entryPickerController({ entries: null });
    renderSeo({}, ENTRIES_TAB);
    expect(screen.getByText("Loading entries…")).toBeInTheDocument();
  });

  it("EntryPicker: shows its own error instead of the select", () => {
    entryPickerRef.current = entryPickerController({ entries: null, error: "failed to load entries" });
    renderSeo({}, ENTRIES_TAB);
    expect(screen.getByText("failed to load entries")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("EntryPicker: lists each entry as '{title} ({status})'", () => {
    renderSeo({}, ENTRIES_TAB);
    expect(screen.getByRole("option", { name: "My Post (published)" })).toBeInTheDocument();
  });

  it("changing the picker calls setEntryId", async () => {
    const user = userEvent.setup();
    const setEntryId = vi.fn();
    seoEntrySectionRef.current = seoEntrySectionController({ setEntryId });
    renderSeo({}, ENTRIES_TAB);
    await user.selectOptions(screen.getByRole("combobox", { name: "Entry" }), "p1");
    expect(setEntryId).toHaveBeenCalledWith("p1");
  });

  it("SeoEntryPanel is not rendered when entryId is blank", () => {
    seoEntrySectionRef.current = seoEntrySectionController({ entryId: "" });
    renderSeo({}, ENTRIES_TAB);
    expect(screen.queryByText("Per-entry overrides")).not.toBeInTheDocument();
  });

  it("SeoEntryPanel renders once entryId is set", () => {
    seoEntrySectionRef.current = seoEntrySectionController({ entryId: "p1" });
    renderSeo({}, ENTRIES_TAB);
    expect(screen.getByText("Per-entry overrides")).toBeInTheDocument();
  });
});

describe("SeoEntryPanel", () => {
  function renderPanel(overrides: Partial<SeoEntryPanelController> = {}) {
    seoEntrySectionRef.current = seoEntrySectionController({ entryId: "p1" });
    seoEntryPanelRef.current = seoEntryPanelController(overrides);
    renderSeo({}, ENTRIES_TAB);
  }

  it("shows a loading notice while resolved is null and there is no loadError", () => {
    renderPanel({ resolved: null });
    expect(screen.getByText("Loading entry SEO…")).toBeInTheDocument();
  });

  it("shows only the load error when loadError is set", () => {
    renderPanel({ resolved: null, loadError: "failed to load entry SEO data" });
    expect(screen.getByText("failed to load entry SEO data")).toBeInTheDocument();
    expect(screen.queryByText("Per-entry overrides")).not.toBeInTheDocument();
  });

  it("pre-fills every field from the resolved (effective) meta", () => {
    renderPanel();
    expect(screen.getByLabelText("Title")).toHaveValue("Entry title");
    expect(screen.getByLabelText("Description")).toHaveValue("Entry description");
    expect(screen.getByLabelText("Canonical URL")).toHaveValue("https://example.com/entry");
    expect(screen.getByRole("checkbox", { name: "Noindex" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Nofollow" })).not.toBeChecked();
    expect(screen.getByLabelText("OG title")).toHaveValue("OG title");
    expect(screen.getByLabelText("OG description")).toHaveValue("OG desc");
    expect(screen.getByLabelText(/OG image/)).toHaveValue("og.png");
    expect(screen.getByLabelText("Twitter title")).toHaveValue("Twitter title");
    expect(screen.getByLabelText("Twitter description")).toHaveValue("Twitter desc");
    expect(screen.getByLabelText("Twitter image")).toHaveValue("tw.png");
  });

  it("falls back to '' for optional resolved fields the entry omits", () => {
    const { description: _description, ...resolved } = RESOLVED;
    const { description: _ogDescription, image: _ogImage, ...openGraph } = RESOLVED.openGraph;
    const { description: _twitterDescription, image: _twitterImage, ...twitter } = RESOLVED.twitter;
    renderPanel({
      resolved: { ...resolved, openGraph, twitter },
    });
    expect(screen.getByLabelText("Description")).toHaveValue("");
    expect(screen.getByLabelText("OG description")).toHaveValue("");
    expect(screen.getByLabelText(/OG image/)).toHaveValue("");
  });

  it("typing in the Title field calls setField('title', value)", async () => {
    const user = userEvent.setup();
    const setField = vi.fn();
    renderPanel({ setField });
    await user.type(screen.getByLabelText("Title"), "x");
    expect(setField).toHaveBeenCalledWith("title", "Entry titlex");
  });

  it("toggling Noindex calls setField('noindex', checked)", async () => {
    const user = userEvent.setup();
    const setField = vi.fn();
    renderPanel({ setField });
    await user.click(screen.getByRole("checkbox", { name: "Noindex" }));
    expect(setField).toHaveBeenCalledWith("noindex", true);
  });

  it("toggling Nofollow calls setField('nofollow', checked)", async () => {
    const user = userEvent.setup();
    const setField = vi.fn();
    renderPanel({ setField });
    await user.click(screen.getByRole("checkbox", { name: "Nofollow" }));
    expect(setField).toHaveBeenCalledWith("nofollow", true);
  });

  it("typing in Description calls setField('description', value)", async () => {
    const user = userEvent.setup();
    const setField = vi.fn();
    renderPanel({ setField });
    await user.type(screen.getByLabelText("Description"), "x");
    expect(setField).toHaveBeenCalledWith("description", "Entry descriptionx");
  });

  it("typing in Canonical URL calls setField('canonical', value)", async () => {
    const user = userEvent.setup();
    const setField = vi.fn();
    renderPanel({ setField });
    await user.type(screen.getByLabelText("Canonical URL"), "x");
    expect(setField).toHaveBeenCalledWith("canonical", "https://example.com/entryx");
  });

  it("typing in OG title calls setField('ogTitle', value)", async () => {
    const user = userEvent.setup();
    const setField = vi.fn();
    renderPanel({ setField });
    await user.type(screen.getByLabelText("OG title"), "x");
    expect(setField).toHaveBeenCalledWith("ogTitle", "OG titlex");
  });

  it("typing in OG description calls setField('ogDescription', value)", async () => {
    const user = userEvent.setup();
    const setField = vi.fn();
    renderPanel({ setField });
    await user.type(screen.getByLabelText("OG description"), "x");
    expect(setField).toHaveBeenCalledWith("ogDescription", "OG descx");
  });

  it("typing in OG image calls setField('ogImage', value)", async () => {
    const user = userEvent.setup();
    const setField = vi.fn();
    renderPanel({ setField });
    await user.type(screen.getByLabelText("OG image"), "x");
    expect(setField).toHaveBeenCalledWith("ogImage", "og.pngx");
  });

  it("typing in Twitter title calls setField('twitterTitle', value)", async () => {
    const user = userEvent.setup();
    const setField = vi.fn();
    renderPanel({ setField });
    await user.type(screen.getByLabelText("Twitter title"), "x");
    expect(setField).toHaveBeenCalledWith("twitterTitle", "Twitter titlex");
  });

  it("typing in Twitter description calls setField('twitterDescription', value)", async () => {
    const user = userEvent.setup();
    const setField = vi.fn();
    renderPanel({ setField });
    await user.type(screen.getByLabelText("Twitter description"), "x");
    expect(setField).toHaveBeenCalledWith("twitterDescription", "Twitter descx");
  });

  it("typing in Twitter image calls setField('twitterImage', value)", async () => {
    const user = userEvent.setup();
    const setField = vi.fn();
    renderPanel({ setField });
    await user.type(screen.getByLabelText("Twitter image"), "x");
    expect(setField).toHaveBeenCalledWith("twitterImage", "tw.pngx");
  });

  it("every text/textarea field falls back to '' when fieldValue() itself returns undefined (e.g. setField(key, undefined) was called)", () => {
    renderPanel({ fieldValue: (() => undefined) as SeoEntryPanelController["fieldValue"] });
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("");
    expect(screen.getByLabelText("Canonical URL")).toHaveValue("");
    expect(screen.getByLabelText("OG title")).toHaveValue("");
    expect(screen.getByLabelText("OG description")).toHaveValue("");
    expect(screen.getByLabelText("OG image")).toHaveValue("");
    expect(screen.getByLabelText("Twitter title")).toHaveValue("");
    expect(screen.getByLabelText("Twitter description")).toHaveValue("");
    expect(screen.getByLabelText("Twitter image")).toHaveValue("");
  });

  it("the checkbox reflects fieldValue() falling back to false when neither touched nor resolved sets it", () => {
    renderPanel({
      resolved: { ...RESOLVED, robots: { noindex: undefined as unknown as boolean, nofollow: false } },
      fieldValue: ((key: string) => (key === "noindex" ? undefined : false)) as SeoEntryPanelController["fieldValue"],
    });
    expect(screen.getByRole("checkbox", { name: "Noindex" })).not.toBeChecked();
  });

  it("shows the save error as role=alert", () => {
    renderPanel({ saveError: "failed to save SEO overrides" });
    expect(screen.getByRole("alert")).toHaveTextContent("failed to save SEO overrides");
  });

  it("shows the notice banner on successful save", () => {
    renderPanel({ notice: "Saved." });
    expect(screen.getByText("Saved.")).toBeInTheDocument();
  });

  it("'Save overrides' is disabled when nothing has been touched yet", () => {
    renderPanel({ touched: {} });
    expect(screen.getByRole("button", { name: "Save overrides" })).toBeDisabled();
  });

  it("'Save overrides' is enabled once at least one field is touched", () => {
    renderPanel({ touched: { title: "x" } });
    expect(screen.getByRole("button", { name: "Save overrides" })).toBeEnabled();
  });

  it("shows 'Saving…' and disables the button while saving, even if touched", () => {
    renderPanel({ touched: { title: "x" }, saving: true });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("clicking 'Save overrides' calls save()", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => {});
    renderPanel({ touched: { title: "x" }, save });
    await user.click(screen.getByRole("button", { name: "Save overrides" }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not render AnalyzePanel when analysis is null", () => {
    renderPanel({ analysis: null });
    expect(screen.queryByText("Analysis")).not.toBeInTheDocument();
  });
});

describe("SeoEntryPanel — OG/Twitter image pickers (MediaRefField)", () => {
  // The top-level defaults form's OWN "Choose image"/preview (`defaultOgImage`) renders
  // simultaneously with these two — three "Choose image" buttons are on screen at once here — so
  // every assertion below is scoped `within` the specific field's own `.media-ref-field` container
  // (found via its label, same as `MediaRefField.unit.test.tsx`'s single-field tests do
  // unscoped, since that suite never has more than one field mounted at a time).
  function renderPanel(overrides: Partial<SeoEntryPanelController> = {}) {
    seoEntrySectionRef.current = seoEntrySectionController({ entryId: "p1" });
    seoEntryPanelRef.current = seoEntryPanelController(overrides);
    renderSeo({}, ENTRIES_TAB);
  }

  function fieldContainer(labelText: string): HTMLElement {
    const container = screen.getByLabelText(labelText).closest(".jini-media-ref-field");
    if (!(container instanceof HTMLElement)) throw new Error(`no .jini-media-ref-field ancestor for "${labelText}"`);
    return container;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // readable-slugs S5b: buildMediaRef now prefers the slug over the id — each item below sets both
  // to distinct values so a passing assertion proves the SLUG was used, not just any field.
  it("selecting an asset for OG image calls setField('ogImage', the EXACT '{slug}:public' ref)", async () => {
    vi.spyOn(api, "listMedia").mockResolvedValue({ media: [mediaItem({ id: "asset-og", slug: "asset-og-slug" })] });
    const user = userEvent.setup();
    const setField = vi.fn();
    renderPanel({ setField });

    await user.click(within(fieldContainer("OG image")).getByRole("button", { name: "Choose image" }));
    await user.click(await screen.findByTitle("Sunset"));

    expect(setField).toHaveBeenCalledWith("ogImage", "asset-og-slug:public");
  });

  it("selecting an asset for Twitter image calls setField('twitterImage', the EXACT '{slug}:public' ref)", async () => {
    vi.spyOn(api, "listMedia").mockResolvedValue({ media: [mediaItem({ id: "asset-tw", slug: "asset-tw-slug" })] });
    const user = userEvent.setup();
    const setField = vi.fn();
    renderPanel({ setField });

    await user.click(within(fieldContainer("Twitter image")).getByRole("button", { name: "Choose image" }));
    await user.click(await screen.findByTitle("Sunset"));

    expect(setField).toHaveBeenCalledWith("twitterImage", "asset-tw-slug:public");
  });

  it("Remove on the OG image field calls setField('ogImage', '')", async () => {
    const user = userEvent.setup();
    const setField = vi.fn();
    renderPanel({ setField, resolved: { ...RESOLVED, openGraph: { ...RESOLVED.openGraph, image: "asset-1:public" } } });

    await user.click(within(fieldContainer("OG image")).getByRole("button", { name: "Remove" }));

    expect(setField).toHaveBeenCalledWith("ogImage", "");
  });
});

describe("AnalyzePanel (reached via SeoEntryPanel's analysis)", () => {
  function renderWithAnalysis(analysis: SeoEntryAnalysis | null) {
    seoEntrySectionRef.current = seoEntrySectionController({ entryId: "p1" });
    seoEntryPanelRef.current = seoEntryPanelController({ analysis });
    renderSeo({}, ENTRIES_TAB);
  }

  it("renders the score", () => {
    renderWithAnalysis(ANALYSIS);
    expect(screen.getByText("82")).toBeInTheDocument();
  });

  it("shows 'No issues.' when the issue list is empty", () => {
    renderWithAnalysis({ ...ANALYSIS, issues: [] });
    expect(screen.getByText("No issues.")).toBeInTheDocument();
  });

  it("renders issues sorted error-first (via sortIssuesBySeverity)", () => {
    renderWithAnalysis(ANALYSIS);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("no-canonical");
    expect(items[1]).toHaveTextContent("missing-alt");
  });

  it("shows the field name in parens when an issue has one, omits it when not", () => {
    renderWithAnalysis(ANALYSIS);
    expect(screen.getByText("(body)")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    // no-canonical has no `field` — its own list item text should not contain a parenthetical.
    expect(items.find((li) => li.textContent?.includes("no-canonical"))?.textContent).not.toMatch(/\(.*\)/);
  });

  it("maps severity to the matching status class: error->failure, warning->unavailable, info->success", () => {
    renderWithAnalysis({
      ...ANALYSIS,
      issues: [
        { code: "e", severity: "error", message: "m" },
        { code: "w", severity: "warning", message: "m" },
        { code: "i", severity: "info", message: "m" },
      ],
    });
    expect(screen.getByText("e").closest("li")?.querySelector(".jini-status")).toHaveClass("jini-status-failure");
    expect(screen.getByText("w").closest("li")?.querySelector(".jini-status")).toHaveClass("jini-status-unavailable");
    expect(screen.getByText("i").closest("li")?.querySelector(".jini-status")).toHaveClass("jini-status-success");
  });
});
