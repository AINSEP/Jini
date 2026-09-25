#!/usr/bin/env node
// Regenerates `src/react/components/agent-icon-data-uris.generated.ts` from the image files in
// `src/react/components/agent-icons/`. Run automatically by `npm run build` (see package.json's
// `build` script) so it can never go stale in a real build; re-run manually
// (`node scripts/generate-agent-icon-data-uris.mjs`) after adding or editing an icon file if you
// want the generated source to reflect it before the next build.
//
// Why inline `data:` URIs instead of the `new URL('./agent-icons/<id>.svg', import.meta.url)`
// pattern this replaced: that pattern is a documented, normally-reliable way for a package to
// reference its own bundled asset, and it resolves correctly for first-party Vite source and for
// a Rollup production bundle of a dependency — but it breaks for a *dev-server* dependency that
// Vite's esbuild-based `optimizeDeps` pre-bundles into one flat chunk. Pre-bundling changes
// `import.meta.url` to the flattened chunk's own served URL, which shares no directory with the
// original per-file source tree, so the computed relative path resolves to nothing on disk.
// Confirmed live against a downstream app's admin dev server (`@jini-ai/chat` pre-bundled by
// Vite): the network response for the computed `.../agent-icons/codex.svg` URL came back
// `200 text/html` — Vite's SPA history-fallback serving `index.html` for the unmatched path,
// rather than a 404 — which an `<img src>` still can't decode, so the Local CLI runtime picker's
// Antigravity/Claude Code/Codex CLI icons rendered as broken-image glyphs (OpenCode's icon is a
// CSS `mask-image` rather than an `<img>` — see `AgentIcon.tsx`'s `MONO_ICONS` — and a failed mask
// paints an empty region instead of a visible error, which is why it showed nothing at all rather
// than the same broken-image glyph). The same environment-dependence also broke this package's own
// `AgentIcon.test.tsx` and `@jini-ai/chat`'s `AgentRuntimePicker.test.tsx` under Vitest+jsdom,
// where `import.meta.url` resolves to yet another, third, unrelated base URL.
//
// A literal `data:` URI needs no separate network request and no bundler-specific asset handling
// at all, so it is immune to this whole class of bug under every consumer this package ships to:
// Vite (dev or prod, pre-bundled or not), a plain `file://` load (an Electron shell with no
// bundler in front of it), Vitest/jsdom, or any other bundler.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME_BY_EXTENSION = { '.svg': 'image/svg+xml', '.png': 'image/png' };

const scriptDir = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(scriptDir, '../src/react/components/agent-icons');
const outputFile = join(scriptDir, '../src/react/components/agent-icon-data-uris.generated.ts');

/**
 * Encodes one icon file as a `data:<mime>;base64,<...>` string.
 *
 * @param {string} fileName - Icon file name relative to `iconsDir`, e.g. `"codex.svg"`.
 * @returns {string} The icon's id (its file name without extension) paired with its data URI.
 * @complexity O(n) in the file's byte size (one read, one base64 encode).
 */
function encodeIcon(fileName) {
  const extension = extname(fileName);
  const id = fileName.slice(0, -extension.length);
  const mime = MIME_BY_EXTENSION[extension];
  const base64 = readFileSync(join(iconsDir, fileName)).toString('base64');
  return { id, dataUri: `data:${mime};base64,${base64}` };
}

const entries = readdirSync(iconsDir)
  .filter((fileName) => extname(fileName) in MIME_BY_EXTENSION)
  .sort()
  .map(encodeIcon);

const fields = entries
  .map(({ id, dataUri }) => `  ${JSON.stringify(id)}: ${JSON.stringify(dataUri)},`)
  .join('\n');

writeFileSync(
  outputFile,
  `// GENERATED FILE — do not edit by hand.
// Produced by \`scripts/generate-agent-icon-data-uris.mjs\` from \`src/react/components/agent-icons/\`.
// Regenerated automatically on every \`npm run build\`; see that script for why these are inline
// data URIs instead of a \`new URL(..., import.meta.url)\` runtime lookup.

export const AGENT_ICON_DATA_URIS: Record<string, string> = {
${fields}
};
`,
);

console.log(`Generated ${entries.length} agent icon data URIs -> ${outputFile}`);
