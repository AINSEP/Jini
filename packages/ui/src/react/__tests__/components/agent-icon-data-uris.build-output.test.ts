// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ICONS_SOURCE_DIR = join(process.cwd(), 'src/react/components/agent-icons');
const GENERATED_MODULE_BUILT = join(
  process.cwd(),
  'dist/react/components/agent-icon-data-uris.generated.js',
);
const MIME_BY_EXTENSION: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png' };

/**
 * The full set of icon ids `scripts/generate-agent-icon-data-uris.mjs` is expected to have
 * produced an entry for, derived independently from the same source directory `AgentIcon.tsx`'s
 * `BUNDLED_ICON_URLS` is meant to cover.
 */
const expectedIds = readdirSync(ICONS_SOURCE_DIR)
  .filter((fileName) => extname(fileName) in MIME_BY_EXTENSION)
  .map((fileName) => fileName.slice(0, -extname(fileName).length))
  .sort();

describe('agent icon data URIs reach the built package', () => {
  // Regression coverage for the bug this replaced: `AgentIcon.tsx` used to resolve its bundled
  // icons via `new URL('./agent-icons/<id>.svg', import.meta.url)`, a URL that only resolves
  // correctly when the referencing module keeps living next to the actual asset file at runtime.
  // Vite's dev-server dependency pre-bundling flattens `@jini-ai/ui` into a different file and
  // breaks exactly that assumption (see `AgentIcon.tsx`'s `BUNDLED_ICON_URLS` doc for the full
  // story) — every CLI icon in a downstream app's runtime picker rendered as a broken-image glyph.
  // A unit test against `AgentIcon.tsx`'s *source* can't catch a regression back to that pattern,
  // because the source-level API (`BUNDLED_ICON_URLS: Partial<Record<string, string>>`) looks
  // identical either way — only the *built* output tells the two apart, since only one of them
  // ships a working icon with no separate file to fetch at runtime. This test asserts directly
  // against `dist/`, so it requires `npm run build` to have already run.
  it('has been built at least once for this suite to check', () => {
    expect(
      existsSync(GENERATED_MODULE_BUILT),
      `${GENERATED_MODULE_BUILT} is missing — run \`npm run build\` before this test.`,
    ).toBe(true);
  });

  it('embeds a real data: URI for every bundled icon id, with none left as a bare path or URL', async () => {
    const { AGENT_ICON_DATA_URIS } = await import(pathToFileURL(GENERATED_MODULE_BUILT).href);

    expect(Object.keys(AGENT_ICON_DATA_URIS).sort()).toEqual(expectedIds);
    for (const id of expectedIds) {
      const dataUri: unknown = AGENT_ICON_DATA_URIS[id];
      expect(typeof dataUri, `${id}'s entry should be a string`).toBe('string');
      // Anchored to the whole value (not just a prefix check) so a regression that appends a
      // fetchable path after the data URI, or reintroduces a bare `/agent-icons/<id>.svg` or
      // `new URL(...).href`-style value, fails here instead of only showing up live in a browser.
      expect(dataUri as string).toMatch(/^data:(image\/svg\+xml|image\/png);base64,[A-Za-z0-9+/]+=*$/);
    }
  });
});
