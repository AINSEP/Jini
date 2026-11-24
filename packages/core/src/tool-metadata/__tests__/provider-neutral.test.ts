import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Core's tool metadata is product-neutral search vocabulary. Provider-specific terms (a named model
 * vendor) belong to the host that registers the tool, so the Integrations owner keeps them.
 */
describe('core tool metadata vocabulary', () => {
  const dir = fileURLToPath(new URL('..', import.meta.url));
  const modules = readdirSync(dir).filter(name => name.endsWith('.ts'));

  it.each(modules)('%s carries no provider-specific search keyword', async (name) => {
    type Metadata = Record<string, { search?: { keywords?: string; queries?: readonly string[] } }>;
    const mod = await import(`../${name}`) as Record<string, unknown>;
    // A module whose vocabulary carries a host-owned word exports a factory instead; probe it with neutral sample values.
    const factory = Object.entries(mod).find(([key, value]) => key.startsWith('create') && typeof value === 'function')?.[1] as ((required: Record<string, string>) => Metadata) | undefined;
    const toolMetadata = (mod.toolMetadata as Metadata | undefined) ?? factory!({ siteKeyEnvName: 'SITE_KEY', archiveLabel: 'site ZIP' });
    const vocabulary = Object.values(toolMetadata).flatMap(entry => [entry.search?.keywords ?? '', ...(entry.search?.queries ?? [])]);
    expect(vocabulary.join(' ')).not.toMatch(/\b(openai|anthropic|gemini)\b/i);
  });
});
