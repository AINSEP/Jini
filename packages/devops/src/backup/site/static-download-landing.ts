import { escapeHtml } from "@jini-ai/core/text";

/** Host-supplied HTML-to-plain-text decoder (entity decoding included); the backup package owns no HTML parser. */
export type ExtractPlainText = (required: { html: string }) => string;

/** One delivered page of one exported theme, as the landing page lists it. */
export interface LandingPage { href: string; title: string; label: string }
/** One exported theme folder (`sites/<folder>/`) and its delivered pages. */
export interface LandingTheme { title: string; folder: string; active: boolean; pages: readonly LandingPage[] }

const TITLE_LIMIT = 120;

/** The page's own <title>, decoded to plain text; falls back to its path label. */
function pageTitle({ html, label, extractPlainText }: { html: string; label: string; extractPlainText: ExtractPlainText }, _options = {}): string {
  // Comments first: a theme template comment may mention a <title> tag (the privacy template does).
  const raw = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html.replace(/<!--[\s\S]*?-->/g, ""))?.[1] ?? "";
  const text = extractPlainText({ html: raw }).replace(/\s+/g, " ").trim();
  if (!text) return label;
  return text.length > TITLE_LIMIT ? text.slice(0, TITLE_LIMIT - 1) + "…" : text;
}

/** "sites/x/about/index.html" → "/about/"; a theme's home is "/". */
function pageLabel({ file, folder }: { file: string; folder: string }, _options = {}): string {
  const relative = file.slice(`sites/${folder}/`.length);
  return "/" + relative.replace(/(?:^|\/)index\.html$/i, match => (match.startsWith("/") ? "/" : ""));
}

/** Relative hrefs survive spaces, `#` and `?` in delivered names; folders stay plain segments. */
function relativeHref({ file }: { file: string }, _options = {}): string {
  return file.split("/").map(segment => encodeURIComponent(segment)).join("/");
}

/**
 * The delivered pages of one theme, home first, then by path. Skips the error page and redirect stubs.
 * @complexity O(pages log pages + page bytes scanned for <title>), no effects.
 */
export function landingPages({ files, folder, skip, extractPlainText }: { files: readonly { path: string; content: Buffer }[]; folder: string; skip: ReadonlySet<string>; extractPlainText: ExtractPlainText }, _options = {}): LandingPage[] {
  const root = `sites/${folder}/`;
  const pages = files.filter(file => file.path.startsWith(root) && /\.html$/i.test(file.path)
    && file.path !== root + "404.html" && !skip.has(file.path)).map(file => {
    const label = pageLabel({ file: file.path, folder });
    return { href: relativeHref({ file: file.path }), label, title: pageTitle({ html: file.content.toString(), label, extractPlainText }) };
  });
  return withoutSharedSuffix({ pages }).sort((a, b) => (a.label === "/" ? -1 : b.label === "/" ? 1 : a.label.localeCompare(b.label)));
}

/** "About | Studio", "Blog | Studio" → "About", "Blog": a suffix every page repeats is noise in a list. */
function withoutSharedSuffix({ pages }: { pages: LandingPage[] }, _options = {}): LandingPage[] {
  const suffix = /\s[|–—-]\s[^|–—]+$/.exec(pages[0]?.title ?? "")?.[0];
  if (!suffix || pages.length < 2 || pages.some(page => !page.title.endsWith(suffix) || page.title.length === suffix.length)) return pages;
  return pages.map(page => ({ ...page, title: page.title.slice(0, -suffix.length) }));
}

/** Inputs of the download's root landing page: the site's display name, the optional "exported on" words and every theme card. */
export interface LandingPageInput { siteName: string; exportedWords?: string | undefined; themes: readonly LandingTheme[] }

/**
 * Host-supplied renderer of the root landing page. The page is the host's exported HTML (its markup, CSS and class
 * names are pinned byte for byte by the host), so the layout owns only the page list and never a template of its own.
 * It must escape every name and title and keep hrefs as the plain relative paths it is given.
 */
export type LandingRenderer = (required: LandingPageInput) => Buffer;

/** Root entry file of every static download and repository commit (formerly "Open website.html"). */
export const LANDING_FILE = "index.html";

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f5f2;--card:#fff;--ink:#1c1b19;--muted:#6b6760;--line:#e4e1da;--accent:#2d5bd7;--badge:#e7efff}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1d1b;--ink:#f1efe9;--muted:#a19d95;--line:#33312d;--accent:#8fb0ff;--badge:#24314f}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:1080px;margin:0 auto;padding:48px 24px 64px}
header{margin-bottom:32px}
.eyebrow{margin:0 0 4px;color:var(--muted);font-size:13px;letter-spacing:.06em;text-transform:uppercase}
h1{margin:0;font-size:clamp(28px,5vw,40px);line-height:1.15;overflow-wrap:anywhere}
.meta{margin:8px 0 0;color:var(--muted)}
.note{margin:16px 0 0;padding:10px 14px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--muted);font-size:14px}
.themes{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}
.card{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;min-width:0}
.card.active{border-color:var(--accent)}
.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
h2{margin:0;font-size:19px;line-height:1.3;overflow-wrap:anywhere}
.badge{flex:none;padding:2px 10px;border-radius:999px;background:var(--badge);color:var(--accent);font-size:12px;font-weight:600;white-space:nowrap}
.count{margin:4px 0 14px;color:var(--muted);font-size:14px;overflow-wrap:anywhere}
.open{display:inline-block;align-self:flex-start;margin-bottom:14px;padding:8px 14px;border-radius:8px;background:var(--accent);color:var(--card);font-weight:600;text-decoration:none}
ul{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
li a{display:block;padding:9px 0;border-bottom:1px solid var(--line);color:var(--ink);text-decoration:none}
li:last-child a{border-bottom:0;padding-bottom:0}
li a:hover span{color:var(--accent);text-decoration:underline}
li span{display:block;overflow-wrap:anywhere}
li small{display:block;margin-top:1px;color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:480px){main{padding:28px 16px 40px}.themes{grid-template-columns:1fr}}
`.trim();

/** One theme card: name, active badge, page count, open-home button and every page link. */
function themeCard({ theme }: { theme: LandingTheme }, _options = {}): string {
  const count = `${theme.pages.length} ${theme.pages.length === 1 ? "page" : "pages"}`;
  const home = theme.pages[0];
  return `<article class="card${theme.active ? " active" : ""}"><div class="card-head"><h2>${escapeHtml({ text: theme.title })}</h2>`
    + (theme.active ? `<span class="badge">Active theme</span>` : "") + `</div>`
    + `<p class="count">${count} · sites/${escapeHtml({ text: theme.folder })}/</p>`
    + (home ? `<a class="open" href="${escapeHtml({ text: home.href })}">Open ${escapeHtml({ text: home.label === "/" ? "home page" : home.title })}</a>` : "")
    + `<ul>${theme.pages.map(page => `<li><a href="${escapeHtml({ text: page.href })}"><span>${escapeHtml({ text: page.title })}</span><small>${escapeHtml({ text: page.label })}</small></a></li>`).join("")}</ul></article>`;
}

/**
 * Root index.html of a static download: works from file:// and in Quick Look with no script.
 * Every name and title is escaped; hrefs are plain relative paths to delivered files.
 * @complexity O(total listed pages), no effects.
 * @example staticLandingPage({ siteName: "My Site", themes });
 */
export function staticLandingPage({ siteName, exportedWords, themes }: LandingPageInput, _optional: Record<string, never> = {}): Buffer {
  const site = escapeHtml({ text: siteName });
  const meta = [exportedWords ? `Exported ${exportedWords}` : "", `${themes.length} ${themes.length === 1 ? "theme" : "themes"}`].filter(Boolean).join(" · ");
  return Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${site} — static copy</title><style>${STYLE}</style></head><body><main>`
    + `<header><p class="eyebrow">Static copy</p><h1>${site}</h1><p class="meta">${escapeHtml({ text: meta })}</p>`
    + `<p class="note">Quick Look can't follow links — open this file in your browser.</p></header>`
    + `<section class="themes">${themes.map(theme => themeCard({ theme })).join("")}</section></main></body></html>\n`);
}
