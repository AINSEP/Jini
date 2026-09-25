import type { CSSProperties } from 'react';
import { AGENT_ICON_DATA_URIS } from './agent-icon-data-uris.generated.js';

interface Props {
  id: string;
  size?: number;
  className?: string;
  /** Overrides where assets are served from as `${basePath}/<id>.<ext>`. Omit to use this
   *  package's own bundled icon set (`BUNDLED_ICON_URLS`) instead. */
  basePath?: string;
}

// Coding-agent CLIs that ship a bundled brand asset under the host's
// `<basePath>/` (e.g. a public `/agent-icons/` directory). SVG is preferred
// (resolution-independent, single file ≤ a few KB); PNG is the fallback for
// vendors that don't publish an SVG mark. New brand: drop the optimised file
// in that folder and add the id here.
const ICON_EXT: Record<string, 'svg' | 'png'> = {
  amr: 'svg',
  claude: 'svg',
  codex: 'svg',
  gemini: 'svg',
  opencode: 'svg',
  'cursor-agent': 'svg',
  copilot: 'svg',
  qwen: 'svg',
  qoder: 'svg',
  deepseek: 'svg',
  reasonix: 'svg',
  mimo: 'svg',
  hermes: 'svg',
  'grok-build': 'svg',
  kimi: 'svg',
  pi: 'svg',
  kiro: 'svg',
  kilo: 'svg',
  vibe: 'svg',
  antigravity: 'svg',
  aider: 'png',
  'trae-cli': 'png',
  devin: 'png',
};

// SVG marks that are single-color silhouettes (no baked brand colors).
// Rendered as a CSS-masked `<span>` so `background-color: currentColor`
// can paint them in whatever text color the surrounding theme resolves
// to — light text under dark theme, dark text under light theme. The
// SVG file itself uses an explicit dark fill (baked) instead of
// `currentColor`, so if anything outside this component ever loads
// the asset through `<img>` it still renders as a legible dark mark
// rather than collapsing to the SVG document's default black-on-…-black.
const MONO_ICONS = new Set([
  'cursor-agent',
  'opencode',
  'hermes',
  'mimo',
  'kilo',
  'grok-build',
]);

/**
 * This package's own bundled brand marks, as inline `data:` URIs generated from
 * `agent-icons/*.svg` by `scripts/generate-agent-icon-data-uris.mjs` — see that script for why
 * data URIs rather than a `new URL('./file', import.meta.url)` runtime lookup (the previous
 * approach here, and still how `RemixIcon.tsx` loads its font). That pattern is rewritten
 * correctly by Vite/Rollup/webpack for first-party source and for a production bundle of a
 * dependency, but it silently breaks whenever the *referencing module itself* gets flattened into
 * a different file before it runs — e.g. Vite's esbuild-based dev-server dependency pre-bundling,
 * which changes `import.meta.url` to the flattened chunk's own served URL and leaves the computed
 * relative path pointing at nothing. Confirmed live against a downstream Vite app whose dev server
 * pre-bundles `@jini-ai/chat` (and this package through it): the resulting
 * `.../agent-icons/codex.svg` request came back `200 text/html` (Vite's SPA fallback for the
 * unmatched path) instead of the SVG, which every non-mono icon rendered as a browser broken-image
 * glyph and every `MONO_ICONS` mask-image icon rendered as nothing at all. A `data:` URI needs no
 * separate request and no bundler-specific asset handling, so it works identically under `file://`
 * (an Electron shell with no bundler in front of it), any bundler's dev or production mode, and
 * Vitest/jsdom.
 *
 * Only lists ids this package actually ships artwork for (a subset of `ICON_EXT` — the three PNG
 * brands aren't bundled here yet). A host that already vendors its own assets and passes an
 * explicit `basePath` is unaffected by this map; see the `basePath` branch below.
 */
const BUNDLED_ICON_URLS: Partial<Record<string, string>> = AGENT_ICON_DATA_URIS;

/**
 * Renders a coding-agent's brand mark by id, with a graceful initial-letter
 * fallback for ids the host hasn't shipped artwork for. A host-supplied
 * `basePath` always wins (backward compatible with hosts already vendoring
 * their own copies); otherwise this falls back to `BUNDLED_ICON_URLS`.
 */
export function AgentIcon({ id, size = 36, className, basePath }: Props) {
  const cls = 'agent-icon' + (className ? ' ' + className : '');
  const ext = ICON_EXT[id];
  if (ext) {
    const src = basePath !== undefined ? `${basePath}/${id}.${ext}` : BUNDLED_ICON_URLS[id];
    if (src !== undefined) {
      if (ext === 'svg' && MONO_ICONS.has(id)) {
        const style: CSSProperties = {
          width: size,
          height: size,
          WebkitMaskImage: `url("${src}")`,
          maskImage: `url("${src}")`,
        };
        return (
          <span
            className={cls + ' agent-icon-mono'}
            style={style}
            aria-hidden="true"
          />
        );
      }
      return (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          className={cls}
          aria-hidden="true"
          draggable={false}
        />
      );
    }
  }
  // Fallback for brands we don't ship artwork for. A neutral rounded
  // square with the initial letter — reads as "no official mark yet"
  // without inventing brand artwork we can't license.
  const initial = (id.match(/[a-z]/i)?.[0] ?? '?').toUpperCase();
  return (
    <span
      className={cls + ' agent-icon-fallback'}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        lineHeight: 1,
      }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
