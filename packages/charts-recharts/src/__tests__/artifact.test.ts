// @vitest-environment node
/** Runs AFTER the coordinator builds the artifact; deliberately fails if no artifact exists. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

describe('reviewable standalone browser artifact', () => {
  it('pins self-contained ESM and scoped CSS, without bare imports or global resets', async () => {
    const root = new URL('../../plugin/', import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
    expect(manifest.id).toBe('charts-recharts');
    expect(manifest.browserProviders).toEqual([{ id: 'plugin.recharts', kind: 'chart', contractVersion: 1, kinds: ['bar', 'line', 'pie'], javascript: 'client/provider.js', stylesheet: 'client/styles.css' }]);
    for (const [file, digest] of Object.entries(manifest.integrity)) {
      const bytes = await readFile(new URL(file, root));
      expect(`sha256-${createHash('sha256').update(bytes).digest('hex')}`).toBe(digest);
    }
    const metadata = JSON.parse(await readFile(new URL('bundle-meta.json', root), 'utf8'));
    expect(Object.values(metadata.outputs).flatMap((output: any) => output.imports)).toEqual([]);
    const js = await readFile(new URL('client/provider.js', root), 'utf8');
    expect(js).toMatch(/export\s*\{/);
    const css = await readFile(new URL('client/styles.css', root), 'utf8');
    expect(css).toContain('[data-chart-provider="plugin.recharts"]');
    expect(css).not.toMatch(/@import|:root|\*\s*\{\s*box-sizing/);
    const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(packageJson.private).toBe(true);
  });
});
