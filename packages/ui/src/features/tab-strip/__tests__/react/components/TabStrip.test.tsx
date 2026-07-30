import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TAB_STRIP_ITEM_ID_ATTRIBUTE } from '../../../constants.js';
import type { TabStripTab } from '../../../types.js';
import { TabStrip } from '../../../react/components/TabStrip.js';

function tab(overrides: Partial<TabStripTab> & { id: string }): TabStripTab {
  return { content: overrides.id, ...overrides };
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
 * jsdom has no `DragEvent` constructor (https://github.com/jsdom/jsdom/issues/2913),
 * so `@testing-library/dom`'s `fireEvent.dragOver(el, { clientX })` falls back to
 * a plain `Event`, which silently drops non-standard init properties like
 * `clientX` — the handler always sees `undefined`. Dispatching a manually
 * built `Event` with `clientX`/`dataTransfer` assigned as own properties is
 * the reliable way to exercise clientX-dependent drag logic in this
 * environment.
 */
function fireDragEvent(
  element: Element,
  type: 'dragstart' | 'dragover' | 'drop' | 'dragleave' | 'dragend',
  init: { clientX?: number; dataTransfer?: unknown; relatedTarget?: EventTarget | null } = {},
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    clientX: init.clientX ?? 0,
    dataTransfer: init.dataTransfer ?? makeDataTransfer(),
    relatedTarget: init.relatedTarget ?? null,
  });
  element.dispatchEvent(event);
}

describe('TabStrip', () => {
  it('renders every tab as a role=tab item inside a role=tablist container', () => {
    const tabs = [tab({ id: 'a' }), tab({ id: 'b' }), tab({ id: 'c' })];
    render(<TabStrip tabs={tabs} activeTabId="b" onActivate={() => {}} onReorder={() => {}} ariaLabel="Tabs" />);
    expect(screen.getByRole('tablist', { name: 'Tabs' })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('marks only the active tab id as selected', () => {
    const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
    render(<TabStrip tabs={tabs} activeTabId="b" onActivate={() => {}} onReorder={() => {}} />);
    const [tabA, tabB] = screen.getAllByRole('tab');
    expect(tabA).toHaveAttribute('aria-selected', 'false');
    expect(tabB).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onActivate with the clicked tab id', async () => {
    const onActivate = vi.fn();
    const tabs = [tab({ id: 'a', content: 'Alpha' }), tab({ id: 'b', content: 'Beta' })];
    render(<TabStrip tabs={tabs} activeTabId="a" onActivate={onActivate} onReorder={() => {}} />);
    await userEvent.click(screen.getByText('Beta'));
    expect(onActivate).toHaveBeenCalledWith('b');
  });

  it('calls onClose for the closed tab id, when supplied', async () => {
    const onClose = vi.fn();
    const tabs = [tab({ id: 'a' })];
    render(<TabStrip tabs={tabs} activeTabId="a" onActivate={() => {}} onClose={onClose} onReorder={() => {}} />);
    // Closability doesn't depend on tab count (unlike draggability) — one tab is enough to prove close wiring.
    await userEvent.click(screen.getByRole('button', { name: 'Close tab' }));
    expect(onClose).toHaveBeenCalledWith('a');
  });

  it('renders host-injected trailing content after the tabs', () => {
    const tabs = [tab({ id: 'a' })];
    render(
      <TabStrip
        tabs={tabs}
        activeTabId="a"
        onActivate={() => {}}
        onReorder={() => {}}
        trailing={<button type="button">New tab</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'New tab' })).toBeTruthy();
  });

  it('reports a reorder through the strip container drop wiring', () => {
    const onReorder = vi.fn();
    const tabs = [tab({ id: 'a' }), tab({ id: 'b' }), tab({ id: 'c' })];
    render(<TabStrip tabs={tabs} activeTabId="a" onActivate={() => {}} onReorder={onReorder} />);
    const items = screen.getAllByRole('tab');
    for (const item of items) {
      vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        right: 100,
        width: 100,
        top: 0,
        bottom: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
    }
    const cItem = document.querySelector(`[${TAB_STRIP_ITEM_ID_ATTRIBUTE}="c"]`);
    vi.spyOn(cItem as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      left: 200,
      right: 300,
      width: 100,
      top: 0,
      bottom: 0,
      height: 0,
      x: 200,
      y: 0,
      toJSON: () => ({}),
    });

    fireDragEvent(items[0]!, 'dragstart');
    fireDragEvent(cItem!, 'drop', { clientX: 260 });

    expect(onReorder).toHaveBeenCalledWith('a', 'c', 'after');
  });
});

describe('TabStrip hook override 4-pattern test suite', () => {
  it('Pattern 1 — State 1: Default idle state with no active drag', () => {
    const customReorderHook = () => ({
      draggingTabId: null,
      dragOverTarget: null,
      stripRef: { current: null },
      stripDragProps: { onDragOver: vi.fn(), onDrop: vi.fn(), onDragLeave: vi.fn() },
      getItemDragProps: () => ({ draggable: true, onDragStart: vi.fn(), onDragEnd: vi.fn(), onClickCapture: vi.fn() }),
    });

    const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
    render(
      <TabStrip
        tabs={tabs}
        activeTabId="a"
        onActivate={() => {}}
        onReorder={() => {}}
        useTabStripDragReorder={customReorderHook as any}
      />,
    );

    const [tabA, tabB] = screen.getAllByRole('tab');
    expect(tabA).not.toHaveClass('dragging');
    expect(tabB).not.toHaveClass('dragging');
  });

  it('Pattern 2 — State 2: Active dragging tab state via hook override', () => {
    const customReorderHook = () => ({
      draggingTabId: 'a',
      dragOverTarget: null,
      stripRef: { current: null },
      stripDragProps: { onDragOver: vi.fn(), onDrop: vi.fn(), onDragLeave: vi.fn() },
      getItemDragProps: () => ({ draggable: true, onDragStart: vi.fn(), onDragEnd: vi.fn(), onClickCapture: vi.fn() }),
    });

    const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
    render(
      <TabStrip
        tabs={tabs}
        activeTabId="a"
        onActivate={() => {}}
        onReorder={() => {}}
        useTabStripDragReorder={customReorderHook as any}
      />,
    );

    const [tabA] = screen.getAllByRole('tab');
    expect(tabA).toHaveClass('is-dragging');
  });

  it('Pattern 3 — State 3: Active drag-over edge indicator state via hook override', () => {
    const customReorderHook = () => ({
      draggingTabId: 'a',
      dragOverTarget: { tabId: 'b', edge: 'after' as const },
      stripRef: { current: null },
      stripDragProps: { onDragOver: vi.fn(), onDrop: vi.fn(), onDragLeave: vi.fn() },
      getItemDragProps: () => ({ draggable: true, onDragStart: vi.fn(), onDragEnd: vi.fn(), onClickCapture: vi.fn() }),
    });

    const tabs = [tab({ id: 'a' }), tab({ id: 'b' })];
    render(
      <TabStrip
        tabs={tabs}
        activeTabId="a"
        onActivate={() => {}}
        onReorder={() => {}}
        useTabStripDragReorder={customReorderHook as any}
      />,
    );

    const [, tabB] = screen.getAllByRole('tab');
    expect(tabB).toHaveClass('is-drag-over-after');
  });

  it('Pattern 4 — State 4: Dynamic full state transition walkthrough using React useState inside test harness', () => {
    function DynamicTabHarness() {
      const [activeId, setActiveId] = useState('a');
      const tabs = [tab({ id: 'a', content: 'Tab A' }), tab({ id: 'b', content: 'Tab B' })];

      return <TabStrip tabs={tabs} activeTabId={activeId} onActivate={setActiveId} onReorder={() => {}} />;
    }

    render(<DynamicTabHarness />);

    const [tabA, tabB] = screen.getAllByRole('tab');
    expect(tabA).toHaveAttribute('aria-selected', 'true');
    expect(tabB).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(screen.getByText('Tab B'));

    expect(tabA).toHaveAttribute('aria-selected', 'false');
    expect(tabB).toHaveAttribute('aria-selected', 'true');
  });
});
