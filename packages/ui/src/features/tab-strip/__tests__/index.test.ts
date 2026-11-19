import { describe, expect, it } from 'vitest';
import * as tabStrip from '../index.js';

/**
 * A barrel-only smoke test, matching `features/viewer-shell/index.test.ts`'s
 * rationale — every other test in this feature imports from the concrete
 * module rather than `./index.js`, so nothing else exercises this file's
 * re-export statements.
 */
describe('tab-strip barrel (index.ts)', () => {
  it('re-exports the constants', () => {
    expect(tabStrip.TAB_STRIP_DRAG_HAPTIC_MS).toBeGreaterThan(0);
    expect(tabStrip.TAB_STRIP_DROP_HAPTIC_MS).toBeGreaterThan(0);
    expect(tabStrip.TAB_STRIP_ITEM_ID_ATTRIBUTE).toEqual(expect.any(String));
  });

  it('re-exports the pure rule functions', () => {
    expect(tabStrip.dropEdgeFromPointerX({ pointerX: 10, rect: { left: 0, width: 100 } })).toBe('before');
    expect(tabStrip.reorderTabIds({ tabIds: ['a', 'b'], sourceId: 'a', targetId: 'b', edge: 'after' })).toEqual(['b', 'a']);
    expect(tabStrip.arraysEqual({ a: ['a'], b: ['a'] })).toBe(true);
    expect(tabStrip.dragTargetKey({ tabId: 'a', edge: 'before' })).toBe('a:before');
    expect(tabStrip.coercePinnedDropTarget({ target: { tabId: 'a', edge: 'before' }, pinnedTabIds: new Set() })).toEqual({
      tabId: 'a',
      edge: 'before',
    });
    expect(tabStrip.findNearestDropTarget({ pointerX: 10, elements: [], sourceId: 'a' })).toBeNull();
    expect(tabStrip.pinnedTabIdSet([])).toEqual(new Set());
    expect(tabStrip.isTabDraggable({ tab: { id: 'a', content: null }, tabs: [{ id: 'a', content: null }] })).toBe(false);
    expect(tabStrip.isTabClosable({ tab: { id: 'a', content: null }, hasCloseHandler: false })).toBe(false);
  });

  it('re-exports the ports and dependency factory', () => {
    expect(typeof tabStrip.noopTabStripHaptics.pulse).toBe('function');
    expect(typeof tabStrip.createBrowserTabStripHaptics).toBe('function');
  });

  it('re-exports the hook and components as functions', () => {
    expect(typeof tabStrip.useTabStripDragReorder).toBe('function');
    expect(typeof tabStrip.TabStripItem).toBe('function');
    expect(typeof tabStrip.TabStrip).toBe('function');
  });
});
