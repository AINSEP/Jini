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
