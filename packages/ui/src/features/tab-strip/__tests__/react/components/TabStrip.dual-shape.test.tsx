import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { reorderTabIds } from '../../../rules.js';
import type { TabStripDropEdge, TabStripTab } from '../../../types.js';
import { TabStrip } from '../../../react/components/TabStrip.js';

/**
 * Proof that ONE primitive serves both source shapes this feature
 * consolidates, per the task brief ("that's the actual proof the
 * consolidation holds, not just that it compiles"):
 *
 * - `WorkspaceTabsBar.tsx`'s shape: a single permanent, non-closable,
 *   non-draggable, leftmost-pinned "entry" tab alongside draggable project
 *   tabs, reordering live during dragover.
 * - `FileWorkspace.tsx`'s shape: no pinned tab at all, every persisted file
 *   tab draggable and closable, one explicitly non-draggable browser tab,
 *   reordering only on drop.
 *
 * Both render through the same `TabStrip`/`TabStripItem`/
 * `useTabStripDragReorder` primitive, with only `tabs` (content + flags)
 * and `reorderTiming` differing — no shape-specific branching inside the
 * primitive itself.
 */

function rect(left: number, right: number) {
  return {
    left,
    right,
    width: right - left,
    top: 0,
    bottom: 0,
    height: 0,
    x: left,
    y: 0,
    toJSON: () => ({}),
  };
}

function stubRects(ids: string[]) {
  const width = 100;
  ids.forEach((id, index) => {
    const el = document.querySelector(`[data-tab-strip-item-id="${id}"]`);
    vi.spyOn(el as HTMLElement, 'getBoundingClientRect').mockReturnValue(
      rect(index * width, index * width + width),
    );
  });
}

function makeDataTransfer() {
  const store = new Map<string, string>();
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
  };
}

/**
 * jsdom has no `DragEvent` constructor
 * (https://github.com/jsdom/jsdom/issues/2913), so
 * `@testing-library/dom`'s `fireEvent.dragOver(el, { clientX })` falls back
 * to a plain `Event`, which silently drops non-standard init properties
 * like `clientX`. Dispatching a manually built `Event` with
 * `clientX`/`dataTransfer` assigned as own properties is the reliable way
 * to exercise clientX-dependent drag logic in this environment. Wrapped in
 * `act()` (unlike `fireEvent`, a raw `dispatchEvent` isn't auto-flushed) so
 * the state update this harness's own `onReorder` triggers is committed to
 * the DOM before the next assertion reads it.
 */
function fireDragEvent(
  element: Element,
  type: 'dragstart' | 'dragover' | 'drop' | 'dragleave' | 'dragend',
  init: { clientX?: number; dataTransfer?: unknown } = {},
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    clientX: init.clientX ?? 0,
    dataTransfer: init.dataTransfer ?? makeDataTransfer(),
  });
  act(() => {
    element.dispatchEvent(event);
  });
}

function ReorderableTabStrip({
  initialTabs,
  reorderTiming,
  onActivate,
  onClose,
}: {
  initialTabs: TabStripTab[];
  reorderTiming?: 'live' | 'onDrop';
  onActivate?: (id: string) => void;
  onClose?: (id: string) => void;
}) {
  const [tabs, setTabs] = useState(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialTabs[0]!.id);

  const handleReorder = (sourceId: string, targetId: string, edge: TabStripDropEdge) => {
    setTabs((current) => {
      const nextIds = reorderTabIds(
        { tabIds: current.map((t) => t.id), sourceId, targetId, edge },
      );
      return nextIds.map((id) => current.find((t) => t.id === id)!);
    });
  };

  return (
    <TabStrip
      tabs={tabs}
      activeTabId={activeTabId}
      onActivate={(id) => {
        setActiveTabId(id);
        onActivate?.(id);
      }}
      onClose={onClose}
      onReorder={handleReorder}
      reorderTiming={reorderTiming}
      ariaLabel="Tabs"
    />
  );
}

describe('TabStrip — consolidated dual-shape proof', () => {
  it('serves the WorkspaceTabsBar shape: pinned leftmost entry tab, live drag-reorder, pin coercion', async () => {
    const onActivate = vi.fn();
    const tabs: TabStripTab[] = [
      { id: 'entry', pinned: true, content: 'Home' },
      { id: 'proj-1', content: 'Project One' },
      { id: 'proj-2', content: 'Project Two' },
    ];
    render(<ReorderableTabStrip initialTabs={tabs} reorderTiming="live" onActivate={onActivate} />);

    // Pinned tab never shows a close button, even though onClose isn't even wired here.
    expect(screen.queryByRole('button', { name: 'Close tab' })).toBeNull();

    // Pinned tab is not draggable; project tabs are, once there's more than one tab.
    const items = screen.getAllByRole('tab');
    expect(items[0]).toHaveAttribute('draggable', 'false'); // entry
    expect(items[1]).toHaveAttribute('draggable', 'true'); // proj-1
    expect(items[2]).toHaveAttribute('draggable', 'true'); // proj-2

    stubRects(['entry', 'proj-1', 'proj-2']);

    // Drag proj-2 toward the LEFT half of the pinned entry tab — a real
    // "before entry" gesture — and verify it lands AFTER entry instead
    // (entry stays leftmost), reordering live during dragover (before drop).
    fireDragEvent(items[2]!, 'dragstart');
    fireDragEvent(items[0]!, 'dragover', { clientX: 10 });

    expect(screen.getByText('Project Two').closest('[role="tab"]')).toHaveAttribute(
      'data-tab-strip-item-id',
      'proj-2',
    );
    const orderAfterLiveDrag = screen
      .getAllByRole('tab')
      .map((el) => el.getAttribute('data-tab-strip-item-id'));
    expect(orderAfterLiveDrag).toEqual(['entry', 'proj-2', 'proj-1']);

    // Completing the gesture (dragend fires on the drag source, matching
    // native HTML5 DnD) re-arms the drag-suppress-click guard so a
    // subsequent click activates normally instead of being swallowed.
    fireDragEvent(items[2]!, 'dragend');

    // Activation still works through the same primitive.
    await userEvent.click(screen.getByText('Project One'));
    expect(onActivate).toHaveBeenCalledWith('proj-1');
  });

  it('serves the FileWorkspace shape: no pinned tab, per-tab draggable override, drop-timing reorder', () => {
    const onClose = vi.fn();
    const tabs: TabStripTab[] = [
      { id: 'file-1', content: 'design.png' },
      { id: 'file-2', content: 'notes.txt' },
      { id: 'browser-1', draggable: false, content: 'Browser Tab' },
    ];
    render(<ReorderableTabStrip initialTabs={tabs} onClose={onClose} />);

    const items = screen.getAllByRole('tab');
    // No pinned tab in this shape, so every host-eligible tab is draggable —
    // except the browser tab, which explicitly opts out.
    expect(items[0]).toHaveAttribute('draggable', 'true'); // file-1
    expect(items[1]).toHaveAttribute('draggable', 'true'); // file-2
    expect(items[2]).toHaveAttribute('draggable', 'false'); // browser-1

    // Every non-pinned tab gets a close button in this shape (FileWorkspace's
    // Tab is always closable by default), unlike the pinned entry tab above.
    expect(screen.getAllByRole('button', { name: 'Close tab' })).toHaveLength(3);

    stubRects(['file-1', 'file-2', 'browser-1']);

    // Default timing is 'onDrop': dragging over does NOT reorder yet.
    fireDragEvent(items[0]!, 'dragstart');
    fireDragEvent(items[1]!, 'dragover', { clientX: 160 });
    expect(
      screen.getAllByRole('tab').map((el) => el.getAttribute('data-tab-strip-item-id')),
    ).toEqual(['file-1', 'file-2', 'browser-1']);

    // The drop is what commits the reorder.
    fireDragEvent(screen.getByText('notes.txt').closest('[role="tab"]')!, 'drop', { clientX: 160 });
    expect(
      screen.getAllByRole('tab').map((el) => el.getAttribute('data-tab-strip-item-id')),
    ).toEqual(['file-2', 'file-1', 'browser-1']);
  });
});
