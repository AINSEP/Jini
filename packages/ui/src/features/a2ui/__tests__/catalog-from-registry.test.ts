import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildA2uiCatalogFromRegistry } from '../catalog-from-registry.js';
import { createLabCatalog } from '../protocol.js';
import { InteractiveUiRegistry, type InteractiveComponentEntry } from '../../interactive-ui/registry.js';

function entry(id: string, propsSchema = z.object({})): InteractiveComponentEntry {
  return { id, provider: 'test', capabilities: [], propsSchema, Component: () => null };
}

describe('buildA2uiCatalogFromRegistry', () => {
  it('carries the given catalogId through unchanged', () => {
    const catalog = buildA2uiCatalogFromRegistry(new InteractiveUiRegistry([]), 'my-catalog');
    expect(catalog.catalogId).toBe('my-catalog');
  });

  it('keys one catalog component per registry entry, by id', () => {
    const registry = new InteractiveUiRegistry([entry('native.data-table'), entry('shadcn.button')]);
    const catalog = buildA2uiCatalogFromRegistry(registry, 'c');
    expect([...catalog.components.keys()]).toEqual(['native.data-table', 'shadcn.button']);
  });

  it('reuses the entry\'s own propsSchema rather than re-declaring one', () => {
    const schema = z.object({ columns: z.array(z.string()) });
    const registry = new InteractiveUiRegistry([entry('native.data-table', schema)]);
    const catalog = buildA2uiCatalogFromRegistry(registry, 'c');
    expect(catalog.components.get('native.data-table')?.propsSchema).toBe(schema);
  });

  it('registers no functions when no base catalog is given', () => {
    const catalog = buildA2uiCatalogFromRegistry(new InteractiveUiRegistry([entry('a')]), 'c');
    expect(catalog.functions.size).toBe(0);
  });
});

describe('buildA2uiCatalogFromRegistry with a base catalog', () => {
  it('includes both the base catalog\'s basic types and the registry\'s components', () => {
    const catalog = buildA2uiCatalogFromRegistry(new InteractiveUiRegistry([entry('native.data-table')]), 'merged', {
      base: createLabCatalog(),
    });
    expect(catalog.components.has('Column')).toBe(true);
    expect(catalog.components.has('Button')).toBe(true);
    expect(catalog.components.has('native.data-table')).toBe(true);
  });

  it('carries the base catalog\'s functions through unchanged', () => {
    const base = createLabCatalog();
    const catalog = buildA2uiCatalogFromRegistry(new InteractiveUiRegistry([entry('a')]), 'merged', { base });
    expect(catalog.functions).toBe(base.functions);
  });

  it('uses the given catalogId, not the base catalog\'s own id', () => {
    const catalog = buildA2uiCatalogFromRegistry(new InteractiveUiRegistry([]), 'merged-id', { base: createLabCatalog() });
    expect(catalog.catalogId).toBe('merged-id');
  });
});
