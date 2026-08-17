import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as catalog from '../catalog.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG_ENTRY = resolve(HERE, '../catalog.ts');
const MEDIA_ROOT = resolve(HERE, '..');

/** Every `from '...'` specifier in a source file, type-only imports included.
 *  Type-only imports are deliberately NOT filtered out: this graph is about what a bundler could
 *  be made to follow, and a `import type` today is one careless edit away from a value import. */
function importSpecifiersOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/\bfrom\s+'([^']+)'/g)].map((m) => m[1]!);
}

/** Walks the catalog subpath's transitive source graph, returning every reachable file plus every
 *  bare (non-relative) specifier encountered. `.js` specifiers map back to their `.ts` source. */
function walkGraph(entry: string): { files: string[]; bareSpecifiers: string[] } {
  const seen = new Set<string>();
  const bareSpecifiers: string[] = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const specifier of importSpecifiersOf(file)) {
      if (!specifier.startsWith('.')) {
        bareSpecifiers.push(specifier);
        continue;
      }
      queue.push(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
    }
  }

  return { files: [...seen], bareSpecifiers };
}

describe('@jini-ai/integrations/media-providers/catalog', () => {
  it('re-exports the vendor catalogue as reference data', () => {
    expect(catalog.MEDIA_PROVIDERS.length).toBeGreaterThan(0);
    expect(catalog.IMAGE_MODELS.length).toBeGreaterThan(0);
    expect(catalog.VIDEO_MODELS.length).toBeGreaterThan(0);
    expect(catalog.AUDIO_MODELS_BY_KIND).toBeTypeOf('object');
    expect(catalog.MEDIA_ASPECTS.length).toBeGreaterThan(0);
    expect(catalog.VIDEO_LENGTHS_SEC.length).toBeGreaterThan(0);
    expect(catalog.AUDIO_DURATIONS_SEC.length).toBeGreaterThan(0);
    expect(catalog.PROVIDER_CREDENTIAL_ENV_VARS).toBeTypeOf('object');
  });

  it('re-exports the catalogue lookups', () => {
    expect(catalog.findMediaModel).toBeTypeOf('function');
    expect(catalog.findProvider).toBeTypeOf('function');
    expect(catalog.modelsForSurface).toBeTypeOf('function');
    expect(catalog.findProvider('openai')?.label).toBe('OpenAI');
  });

  it('does NOT re-export anything from the node-only dispatch/task/staging layers', () => {
    // The whole point of this subpath. Named individually rather than by a count assertion so a
    // regression says which layer leaked, and so adding a legitimate catalogue export stays free.
    for (const nodeOnly of [
      'createMediaDispatchEngine',
      'renderStub',
      'renderOpenAIImage',
      'assertExternalAssetUrl',
      'createFsAttachmentStaging',
      'createSqliteMediaTaskStore',
      'createInMemoryMediaTaskStore',
      'resolveProviderCredentialsFromEnv',
    ]) {
      expect(catalog, `${nodeOnly} must not be reachable from the catalog subpath`).not.toHaveProperty(nodeOnly);
    }
  });

  it('has a transitive import graph with no bare specifiers at all', () => {
    // No bare specifier means no `node:*`, no `undici`, no `better-sqlite3`, and no `@jini-ai/core`
    // — a browser bundler needs nothing resolved or polyfilled to consume this entry.
    const { bareSpecifiers } = walkGraph(CATALOG_ENTRY);
    expect(bareSpecifiers).toEqual([]);
  });

  it('never reaches the dispatch, staging, or sqlite modules', () => {
    const { files } = walkGraph(CATALOG_ENTRY);
    const reachable = files.map((f) => relative(MEDIA_ROOT, f)).sort();
    expect(reachable).toEqual(['catalog.ts', 'providers.ts', 'types.ts']);
  });
});
