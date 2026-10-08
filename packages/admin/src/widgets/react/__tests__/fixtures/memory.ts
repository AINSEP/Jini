import { createMemoryWidgetsApi } from '../../../adapters/memory.js';
import type { MemoryWidgetsSeed } from '../../../adapters/memory.js';
import type { AdminWidget } from '../../../models.js';
import type { WidgetsPort, WidgetRegionsPort } from './legacy-ports.js';
export function createFakeWidgetsPort(seed: MemoryWidgetsSeed = {}): WidgetsPort & { widgets: AdminWidget[] } {
  const memory = createMemoryWidgetsApi(seed);
  return {
    widgets: memory.widgets,
    listWidgets: (options = {}) => memory.listWidgets(options), getWidget: id => memory.getWidget({ id }),
    createWidget: input => memory.createWidget(input), updateWidget: input => memory.updateWidget(input), trashWidget: id => memory.trashWidget({ id }),
  };
}
export function createFakeWidgetRegionsPort(seed: Omit<MemoryWidgetsSeed, 'widgets'> & { widgets?: Record<string, Pick<AdminWidget, 'title' | 'widgetType'>> | undefined } = {}): WidgetRegionsPort & { regions: NonNullable<MemoryWidgetsSeed['regions']> } {
  const widgets = Object.entries(seed.widgets ?? {}).map(([id, widget]) => ({ id, workspaceId: 'fake-ws', slug: id, title: widget.title, widgetType: widget.widgetType, status: 'active' as const, config: {}, updatedAt: new Date(0).toISOString(), version: 1 }));
  const memory = createMemoryWidgetsApi({ ...seed, widgets });
  return { regions: memory.regions,
    listWidgetRegions: () => memory.listWidgetRegions({}), bindWidgetRegion: regionKey => memory.bindWidgetRegion({ regionKey }),
    getWidgetRegion: regionKey => memory.getWidgetRegion({ regionKey }), mutateWidgetRegionPlacements: input => memory.mutateWidgetRegionPlacements(input),
    getWidget: id => memory.getWidget({ id }),
  };
}
