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
    const { toolMetadata } = await import(`../${name}`) as { toolMetadata: Record<string, { search?: { keywords?: string; queries?: readonly string[] } }> };
    const vocabulary = Object.values(toolMetadata).flatMap(entry => [entry.search?.keywords ?? '', ...(entry.search?.queries ?? [])]);
    expect(vocabulary.join(' ')).not.toMatch(/\b(openai|anthropic|gemini)\b/i);
  });
});
