import { expect, test } from "vitest";
import {
  liquidTemplateContextRoute,
  staticThemePagePreview,
  staticThemePartialPreview,
  templatedPreviewFailureResponse,
  templatedThemePagePreview,
  type PreviewableTheme,
  type TemplatedPreviewRenderInput,
} from "../theme-page-preview.js";

interface FakeTheme extends PreviewableTheme { readonly id: string }

const THEMES: readonly FakeTheme[] = [
  { id: "plain", manifest: { tier: "static" }, liquidTemplates: {} },
  { id: "shop", manifest: { tier: "templated" }, liquidTemplates: { home: "", entry: "", product: "", landing: "" } },
];
const findTheme = ({ themeId }: { themeId: string }) => THEMES.find((theme) => theme.id === themeId);
const staticDeps = {
  findTheme,
  renderStaticPage: ({ theme, pageId }: { theme: FakeTheme; pageId: string }) => (pageId === "index" ? `<html>${theme.id}</html>` : null),
  renderStaticPartial: ({ partialId }: { theme: FakeTheme; partialId: string }) => (partialId === "nav" ? "<nav></nav>" : null),
};
const SANDBOXED = [["Cache-Control", "no-store"], ["Content-Security-Policy", "sandbox allow-scripts allow-forms"]];

test("static page and partial previews render sandboxed and never cached", () => {
  expect(staticThemePagePreview({ themeId: "plain", pageId: "index", deps: staticDeps }))
    .toEqual({ status: 200, headers: SANDBOXED, type: "text/html", body: "<html>plain</html>" });
  expect(staticThemePartialPreview({ themeId: "plain", partialId: "nav", deps: staticDeps }))
    .toEqual({ status: 200, headers: SANDBOXED, type: "text/html", body: "<nav></nav>" });
});

test("static previews refuse an unknown theme, a non-static theme, and an unknown page or partial", () => {
  const refusal = (status: number, body: string) => ({ status, headers: [], type: "text/plain", body });
  expect(staticThemePagePreview({ themeId: "", pageId: "index", deps: staticDeps })).toEqual(refusal(404, "theme '' was not found"));
  expect(staticThemePartialPreview({ themeId: "shop", partialId: "nav", deps: staticDeps }))
    .toEqual(refusal(422, "theme 'shop' is a 'templated' theme; only static themes preview this way"));
  expect(staticThemePagePreview({ themeId: "plain", pageId: "about", deps: staticDeps }))
    .toEqual(refusal(404, "page 'about' was not found in theme 'plain'"));
  expect(staticThemePartialPreview({ themeId: "plain", partialId: "footer", deps: staticDeps }))
    .toEqual(refusal(404, "partial 'footer' was not found in theme 'plain'"));
});

test("a liquid file's own name picks its render context; entry and post share the post shape", () => {
  expect(["home", "products", "product", "post", "entry", "landing"].map((templateId) => liquidTemplateContextRoute({ templateId })))
    .toEqual(["home", "products", "product", "post", "post", null]);
});

type Input = TemplatedPreviewRenderInput<FakeTheme, string, string, string, string, string>;

function templatedDeps(calls: string[], rendered: Input[]) {
  return {
    findTheme,
    listPublishedPosts: async () => { calls.push("posts"); return { posts: ["first", "second"] }; },
    resolveWidgets: async ({ theme }: { theme: FakeTheme }, { post }: { post?: string | undefined }) => { calls.push("widgets"); return `w:${theme.id}:${post}`; },
    resolveMediaTransformVersions: async () => { calls.push("versions"); return "v"; },
    resolveMediaAssetMetadata: async ({ post }: { post: string | undefined }) => { calls.push("metadata"); return `m:${post}`; },
    resolveHtmlEmbeds: async ({ post }: { post: string | undefined }) => { calls.push("embeds"); return `e:${post}`; },
    resolveSiteTitle: async () => { calls.push("title"); return "Site"; },
    resolveSiteTimeZone: async () => { calls.push("zone"); return "UTC"; },
    renderSite: async (input: Input) => { calls.push("render"); rendered.push(input); return "<html>liquid</html>"; },
  };
}

test("a templated preview renders the selected file over the first published post, with products kept empty", async () => {
  const calls: string[] = []; const rendered: Input[] = [];
  const response = await templatedThemePagePreview({ themeId: "shop", templateId: "entry", deps: templatedDeps(calls, rendered) });
  expect(response).toEqual({ status: 200, headers: [["Cache-Control", "no-store"]], type: "html", body: "<html>liquid</html>" });
  expect(calls).toEqual(["posts", "widgets", "versions", "metadata", "embeds", "title", "zone", "render"]);
  expect(rendered).toEqual([{
    theme: THEMES[1], route: "post", siteTitle: "Site", timeZone: "UTC", posts: ["first", "second"], post: "first",
    products: [], product: undefined, widgets: "w:shop:first", mediaTransformVersions: "v", mediaAssetMetadata: "m:first",
    pageHtmlEmbeds: "e:first", liquidTemplateIdOverride: "entry",
  }]);
});

test("a non-post templated preview carries no post", async () => {
  const rendered: Input[] = [];
  await templatedThemePagePreview({ themeId: "shop", templateId: "product", deps: templatedDeps([], rendered) });
  expect(rendered[0]).toMatchObject({ route: "product", post: undefined, product: undefined, widgets: "w:shop:undefined" });
});

test("templated previews refuse before reading any content", async () => {
  const calls: string[] = [];
  const deps = templatedDeps(calls, []);
  const refusal = (status: number, body: string) => ({ status, headers: [], type: "text/plain", body });
  expect(await templatedThemePagePreview({ themeId: "none", templateId: "home", deps })).toEqual(refusal(404, "theme 'none' was not found"));
  expect(await templatedThemePagePreview({ themeId: "plain", templateId: "home", deps }))
    .toEqual(refusal(422, "theme 'plain' is a 'static' theme; only templated themes preview this way"));
  expect(await templatedThemePagePreview({ themeId: "shop", templateId: "products", deps }))
    .toEqual(refusal(404, "template 'products' was not found in theme 'shop'"));
  expect(await templatedThemePagePreview({ themeId: "shop", templateId: "landing", deps }))
    .toEqual(refusal(422, "template 'landing' has no recognized route shape and cannot be previewed here"));
  expect(calls).toEqual([]);
});

test("the failure answer names the reported error and nothing else", () => {
  expect(templatedPreviewFailureResponse({ errorId: "ERR-1" })).toEqual({
    status: 500, headers: [], type: "text/plain",
    body: "The preview could not be rendered. Reload the preview; if it keeps failing, report error ERR-1.",
  });
});
