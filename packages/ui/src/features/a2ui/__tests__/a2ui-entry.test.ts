/** The published `@jini-ai/ui/a2ui` entry (`../index.ts`) exposes the catalog builder, surface hook and
 *  renderer. The wire vocabulary and interpreter live in `@jini-ai/protocol/a2ui`, not here. */
import { describe, expect, it } from 'vitest';
import * as a2ui from '../index.js';

describe('@jini-ai/ui/a2ui entry', () => {
  it('exposes the React renderer, hook and catalog builder', () => {
    for (const name of ['buildA2uiCatalogFromRegistry', 'useA2uiSurfaceRoot', 'A2uiSurfaceRenderer']) {
      expect(typeof Reflect.get(a2ui, name), name).toBe('function');
    }
    expect(Reflect.get(a2ui, 'createA2uiInterpreter')).toBeUndefined();
  });
});
