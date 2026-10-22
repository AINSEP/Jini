import { describe, expect, it } from 'vitest';
import { parseAgentToRendererMessage } from '../agent-to-renderer.js';
import { A2UI_DISPLAY_ONLY_PROPERTY, a2uiSurfaceIdOf, displayOnlySurfaceIdOf } from '../surface-properties.js';
import * as a2ui from '../index.js';

describe('display-only surface marker', () => {
  const displayOnly = { version: 'v1.0', createSurface: { surfaceId: 's1', catalogId: 'cat', surfaceProperties: { [A2UI_DISPLAY_ONLY_PROPERTY]: true } } };

  it('is a valid createSurface envelope (surfaceProperties is an open record)', () => {
    expect(parseAgentToRendererMessage({ raw: displayOnly }).ok).toBe(true);
  });

  it('names the surface a display-only createSurface declares', () => {
    expect(displayOnlySurfaceIdOf({ message: displayOnly })).toBe('s1');
  });

  it('is undefined for a surface that does not declare it, or declares it false', () => {
    expect(displayOnlySurfaceIdOf({ message: { version: 'v1.0', createSurface: { surfaceId: 's1', catalogId: 'cat' } } })).toBeUndefined();
    expect(displayOnlySurfaceIdOf({ message: { version: 'v1.0', createSurface: { surfaceId: 's1', catalogId: 'cat', surfaceProperties: { displayOnly: false } } } })).toBeUndefined();
    expect(displayOnlySurfaceIdOf({ message: { version: 'v1.0', updateComponents: { surfaceId: 's1', components: [] } } })).toBeUndefined();
    expect(displayOnlySurfaceIdOf({ message: null })).toBeUndefined();
  });

  it('reads the surface id of every surface-scoped message', () => {
    expect(a2uiSurfaceIdOf({ message: displayOnly })).toBe('s1');
    expect(a2uiSurfaceIdOf({ message: { version: 'v1.0', updateComponents: { surfaceId: 's2', components: [] } } })).toBe('s2');
    expect(a2uiSurfaceIdOf({ message: { version: 'v1.0', updateDataModel: { surfaceId: 's3', value: 1 } } })).toBe('s3');
    expect(a2uiSurfaceIdOf({ message: { version: 'v1.0', deleteSurface: { surfaceId: 's4' } } })).toBe('s4');
    expect(a2uiSurfaceIdOf({ message: { version: 'v1.0', callFunction: { functionCallId: 'f' } } })).toBeUndefined();
    expect(a2uiSurfaceIdOf({ message: 'nope' })).toBeUndefined();
  });

  it('is re-exported from the public barrel', () => {
    expect(a2ui.A2UI_DISPLAY_ONLY_PROPERTY).toBe('displayOnly');
    expect(typeof a2ui.displayOnlySurfaceIdOf).toBe('function');
    expect(typeof a2ui.a2uiSurfaceIdOf).toBe('function');
  });
});
