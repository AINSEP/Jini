/** The published `@jini-ai/ui/a2ui` entry (`../index.ts`) re-exports the interpreter, catalog
 *  builders, surface hook and renderer one import away, without a second copy of the protocol. */
import { describe, expect, it } from 'vitest';
import * as a2ui from '../index.js';
import { createA2uiInterpreter } from '@jini-ai/agentic/a2ui';

describe('@jini-ai/ui/a2ui entry', () => {
  it('exposes the React renderer and hook beside the re-exported protocol runtime', () => {
    for (const name of ['createA2uiInterpreter', 'createLabCatalog', 'buildA2uiCatalogFromRegistry', 'useA2uiSurfaceRoot', 'A2uiSurfaceRenderer']) {
      expect(typeof Reflect.get(a2ui, name), name).toBe('function');
    }
    expect(a2ui.createA2uiInterpreter).toBe(createA2uiInterpreter);
  });
});
