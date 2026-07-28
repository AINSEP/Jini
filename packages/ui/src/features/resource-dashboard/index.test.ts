// The barrel itself has no test-suite call sites (every other test in this
// feature imports its target module directly, per the vertical-slice
// convention), so it was never actually exercised by the rest of the suite.
// This is the smoke test proving the public surface a host actually imports
// (`from '@injini/ui'` → this file) really re-exports what `source-map.md`
// documents, not just that each underlying module compiles on its own.
import { describe, expect, it } from 'vitest';
import * as ResourceDashboardFeature from './index.js';

describe('resource-dashboard barrel (index.ts)', () => {
  it('re-exports constants', () => {
    expect(ResourceDashboardFeature.DEFAULT_BOARD_VIEW_MODE).toBe('grid');
    expect(ResourceDashboardFeature.DEFAULT_STATUS_TONE).toBe('neutral');
    expect(typeof ResourceDashboardFeature.UNMATCHED_STATUS_BUCKET).toBe('string');
  });

  it('re-exports rules (excluding the pending-action helpers, deliberately not re-exported to avoid an ambiguous-export collision with features/source-config-list — see index.ts)', () => {
    expect(typeof ResourceDashboardFeature.filterBoardItemsByQuery).toBe('function');
    expect(typeof ResourceDashboardFeature.groupItemsByStatus).toBe('function');
    expect(typeof ResourceDashboardFeature.pruneSelectedIds).toBe('function');
    expect(typeof ResourceDashboardFeature.sortBoardItems).toBe('function');
    expect(typeof ResourceDashboardFeature.statusToneFor).toBe('function');
    expect(typeof ResourceDashboardFeature.toggleSelectedId).toBe('function');
  });

  it('re-exports dependencies + fakes', () => {
    expect(typeof ResourceDashboardFeature.createFakeResourceBoardPort).toBe('function');
    expect(typeof ResourceDashboardFeature.createFakeResourceBoardDependencies).toBe('function');
    expect(typeof ResourceDashboardFeature.createFakeResourceRowListPort).toBe('function');
    expect(typeof ResourceDashboardFeature.createFakeResourceRowListDependencies).toBe('function');
    expect(typeof ResourceDashboardFeature.createLocalStorageViewModeStorage).toBe('function');
  });

  it('re-exports hooks, including the wired variants', () => {
    expect(typeof ResourceDashboardFeature.useResourceBoard).toBe('function');
    expect(typeof ResourceDashboardFeature.useWiredResourceBoard).toBe('function');
    expect(typeof ResourceDashboardFeature.useResourceRowList).toBe('function');
    expect(typeof ResourceDashboardFeature.useWiredResourceRowList).toBe('function');
  });

  it('re-exports every shared + board-shape component, including the orchestrator', () => {
    expect(typeof ResourceDashboardFeature.StatusPill).toBe('function');
    expect(typeof ResourceDashboardFeature.ResourceMetrics).toBe('function');
    expect(typeof ResourceDashboardFeature.ResourceCard).toBe('function');
    expect(typeof ResourceDashboardFeature.ResourceKanbanBoard).toBe('function');
    expect(typeof ResourceDashboardFeature.ResourceBoardToolbar).toBe('function');
    expect(typeof ResourceDashboardFeature.ResourceBoardView).toBe('function');
    expect(typeof ResourceDashboardFeature.ResourceBoard).toBe('function');
  });

  it('re-exports every row-list-shape component, including the orchestrator', () => {
    expect(typeof ResourceDashboardFeature.ResourceRunHistoryList).toBe('function');
    expect(typeof ResourceDashboardFeature.ResourceRowListItem).toBe('function');
    expect(typeof ResourceDashboardFeature.ResourceRowListView).toBe('function');
    expect(typeof ResourceDashboardFeature.ResourceRowList).toBe('function');
  });
});
