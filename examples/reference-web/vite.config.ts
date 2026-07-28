import { readFileSync, readdirSync } from 'node:fs';
import { defineConfig } from 'vite';

const daemonTarget = process.env.JINI_PLAYGROUND_DAEMON_URL ?? 'http://127.0.0.1:4317';
const starterPreviewPrefix = '/sample-preview/starter-site/';
const starterSiteDir = new URL('../sample-projects/starter-site/', import.meta.url);
const starterPreviewCsp =
  "default-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'";

/**
 * Every `.html` file in the sample directory is a page.
 *
 * Enumerated rather than listed: adding a page to the sample must not require editing this
 * config, or the two drift and `page.navigate` reaches somewhere the build never emitted.
 * Directory-only — nothing here joins a request path onto the filesystem.
 */
function starterPageNames(): string[] {
  return readdirSync(starterSiteDir).filter((name) => name.endsWith('.html')).sort();
}

/** Last successful build per page, served if a later read fails. See {@link buildStarterPreviewHtml}. */
const lastGoodStarterPreviewHtml = new Map<string, string>();

/**
 * Inlines the sample project's CSS/JS into one self-contained document and stamps
 * the preview CSP onto it.
 *
 * Read fresh on every call rather than once at config load: the dev server serves these to a
 * live browser, and editing the sample (adding `data-agent-*` handles, a new control, another
 * page) must show up on reload without restarting Vite. Build time calls it once per page,
 * which is equivalent.
 *
 * @param page - An `.html` filename from {@link starterPageNames}.
 * @returns The self-contained document for that page.
 */
function buildStarterPreviewHtml(page: string): string {
  const read = (file: string) => readFileSync(new URL(file, starterSiteDir), 'utf8');
  try {
    const html = read(page)
      .replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="${starterPreviewCsp}" />`,
      )
      .replace('<link rel="stylesheet" href="./styles.css" />', `<style>${read('styles.css')}</style>`)
      .replace(
        '<script src="./app.js"></script>',
        `<script>${read('app.js').replaceAll('</script', '<\\/script')}</script>`,
      );
    lastGoodStarterPreviewHtml.set(page, html);
    return html;
  } catch (error) {
    // Reading per-request buys restart-free iteration, but it also means a transient
    // filesystem failure (a macOS sandbox/TCC EPERM has done this repeatedly on this
    // project) would otherwise take the whole dev server down mid-session. Serving the
    // last good copy degrades to "slightly stale preview" instead of "server dead".
    const lastGood = lastGoodStarterPreviewHtml.get(page);
    if (lastGood === undefined) throw error;
    viteLogger?.warn(
      `[jini-starter-preview] re-read of ${page} failed (${(error as NodeJS.ErrnoException).code ?? 'unknown'}); serving last good copy`,
    );
    return lastGood;
  }
}

/**
 * Maps a request path to a page filename.
 *
 * Returns `undefined` for anything that is not a page this sample actually publishes — the
 * requested name is matched against the enumerated set rather than joined onto a path, so
 * `../` and absolute paths cannot escape the sample directory.
 *
 * @param url - The incoming request URL.
 * @returns The page filename, or `undefined` when the request is not for a published page.
 */
function resolveStarterPage(url: string | undefined): string | undefined {
  const path = url?.split('?')[0];
  if (path === undefined || !path.startsWith(starterPreviewPrefix)) return undefined;
  const requested = path.slice(starterPreviewPrefix.length) || 'index.html';
  return starterPageNames().includes(requested) ? requested : undefined;
}

/** Captured in `configureServer` so the fallback path can log through Vite. */
let viteLogger: { warn: (message: string) => void } | undefined;

// A2UI Lab's action round-trip (browser -> daemon) rides a small, dedicated relay server, not the
// main daemon's own Express app — see daemon.ts's `startA2uiActionRelay` doc for why (adding a
// second route to an already-listening Express `Server` via a second 'request' listener is
// fragile: both listeners fire for every request, and Express would try to 404 a path it already
// got a response written for). One more proxy entry keeps the browser on a single origin either way.
const a2uiActionTarget = process.env.JINI_PLAYGROUND_A2UI_ACTION_URL ?? 'http://127.0.0.1:4318';

export default defineConfig({
  plugins: [{
    name: 'jini-starter-preview',
    configureServer(server) {
      viteLogger = server.config.logger;
      server.middlewares.use((request, response, next) => {
        const page = resolveStarterPage(request.url);
        if (page === undefined) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Content-Security-Policy', starterPreviewCsp);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        // No-store: the preview is edited live during agent-control work, so a
        // cached copy would silently hide the change being tested.
        response.setHeader('Cache-Control', 'no-store');
        response.end(buildStarterPreviewHtml(page));
      });
    },
    generateBundle() {
      // Emit every page, not just the entry one: a page reachable in dev but missing from the
      // build is exactly the silent gap `page.navigate` would fall into in production.
      for (const page of starterPageNames()) {
        this.emitFile({
          type: 'asset',
          fileName: `${starterPreviewPrefix.slice(1)}${page}`,
          source: buildStarterPreviewHtml(page),
        });
      }
    },
  }],
  server: {
    strictPort: true,
    proxy: {
      '/api': {
        target: daemonTarget,
        changeOrigin: true,
      },
      '/health': {
        target: daemonTarget,
        changeOrigin: true,
      },
      '/ready': {
        target: daemonTarget,
        changeOrigin: true,
      },
      '/a2ui-action': {
        target: a2uiActionTarget,
        changeOrigin: true,
      },
    },
  },
});
