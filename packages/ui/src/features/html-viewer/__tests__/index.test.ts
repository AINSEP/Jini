import { describe, expect, it } from 'vitest';
import * as htmlViewer from '../index.js';

/**
 * Barrel-only smoke test — every other test in this feature imports from
 * the concrete module directly, so nothing else exercises this file's
 * re-export statements. See `features/viewer-shell/index.test.ts` for the
 * precedent this mirrors.
 */
describe('html-viewer barrel (index.ts)', () => {
  it('re-exports the constants', () => {
    expect(htmlViewer.DECK_NAVIGATE_MESSAGE_TYPE).toBe('jini:deck-navigate');
    expect(htmlViewer.DECK_STATE_MESSAGE_TYPE).toBe('jini:deck-state');
    expect(htmlViewer.DEFAULT_ZOOM).toBe(100);
    expect(htmlViewer.DEFAULT_ZOOM_LEVELS).toEqual([50, 75, 100, 125, 150, 200]);
  });

  it('re-exports the pure rule functions', () => {
    expect(htmlViewer.canGoPrev({ state: { active: 1, count: 3 } })).toBe(true);
    expect(htmlViewer.canGoNext({ state: { active: 1, count: 3 } })).toBe(true);
    expect(htmlViewer.clampSlideIndex({ index: 9, count: 3 })).toBe(2);
    expect(htmlViewer.isKnownZoomLevel({ zoom: 100, levels: [100] })).toBe(true);
    expect(htmlViewer.parseDeckStateMessage({ data: { active: 0, count: 1 } })).toEqual({ active: 0, count: 1 });
    expect(htmlViewer.slideCounterLabel({ state: { active: 0, count: 1 } })).toBe('1 / 1');
    expect(htmlViewer.zoomToScale({ zoom: 200 })).toBe(2);
  });

  it('re-exports the dependency factories and hooks/components as functions', () => {
    expect(typeof htmlViewer.createBrowserFullscreenPort).toBe('function');
    expect(typeof htmlViewer.createBrowserNewTabPreviewPort).toBe('function');
    expect(typeof htmlViewer.createDefaultHtmlViewerDependencies).toBe('function');
    expect(typeof htmlViewer.defaultHtmlViewerDependencies).toBe('object');
    expect(typeof htmlViewer.useDeckNavigation).toBe('function');
    expect(typeof htmlViewer.useZoomControl).toBe('function');
    expect(typeof htmlViewer.usePresentMode).toBe('function');
    expect(typeof htmlViewer.useWiredPresentMode).toBe('function');
    expect(typeof htmlViewer.DeckNavigationControls).toBe('function');
    expect(typeof htmlViewer.ZoomMenu).toBe('function');
    expect(typeof htmlViewer.PresentMenu).toBe('function');
  });
});
