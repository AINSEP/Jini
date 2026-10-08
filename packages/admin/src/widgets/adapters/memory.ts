import { AdminApiError } from '../../core/transport/errors.js';
import type { AdminWidgetsPort } from '../ports.js';
import type { AdminWidget, AdminWidgetArea, AdminWidgetPlacement, AdminWidgetRegionBinding, AdminWidgetWhereUsed } from '../models.js';
export interface MemoryWidgetsSeed {
  widgets?: AdminWidget[] | undefined; regions?: AdminWidgetRegionBinding[] | undefined;
  areas?: Record<string, { area: AdminWidgetArea; placements: AdminWidgetPlacement[] }> | undefined;
  whereUsed?: Record<string, AdminWidgetWhereUsed> | undefined; skippedCount?: number | undefined; skippedIds?: string[] | undefined;
}
/** JSON-shaped port snapshots are detached; mutable fixture arrays are explicit on the returned adapter. */
export function createMemoryWidgetsApi({ widgets = [], regions = [], areas = {}, whereUsed = {}, skippedCount, skippedIds }: MemoryWidgetsSeed = {}, { workspaceId = 'fake-ws', now = () => new Date(0).toISOString() }: { workspaceId?: string | undefined; now?: (() => string) | undefined } = {}): AdminWidgetsPort & { readonly widgets: AdminWidget[]; readonly regions: AdminWidgetRegionBinding[] } {
  const copy = <T>(value: T): T => structuredClone(value);
  const rows = copy(widgets), bindings = copy(regions), regionRows = new Map(Object.entries(copy(areas)));
  const usage = copy(whereUsed);
  let widgetSequence = rows.length, areaSequence = Math.max(bindings.length, regionRows.size);
  function fail(code: string, message: string): never { throw new AdminApiError({ message, status: code === 'NOT_FOUND' ? 404 : 409 }, { code }); }
  function instance(id: string) {
    const index = rows.findIndex(w => w.slug === id);
    const resolved = index < 0 ? rows.findIndex(w => w.id === id) : index;
    if (resolved < 0) return fail('NOT_FOUND', `fake widget not found: ${id}`);
    return { index: resolved, widget: rows[resolved]! };
  }
  function region(regionKey: string) {
    const result = regionRows.get(regionKey);
    return result ?? fail('NOT_FOUND', `fake widget region not found: ${regionKey}`);
  }
  return {
    widgets: rows, regions: bindings,
    async listWidgets({ widgetType, includeInactive }, options = {}) {
      options.signal?.throwIfAborted();
      return { widgets: copy(rows.filter(w => (!widgetType || w.widgetType === widgetType) && (includeInactive || w.status === 'active'))), ...(skippedCount === undefined ? {} : { skippedCount }), ...(skippedIds === undefined ? {} : { skippedIds: copy(skippedIds) }) };
    },
    async getWidget({ id }, options = {}) {
      options.signal?.throwIfAborted();
      const { widget } = instance(id);
      return copy({ widget, whereUsed: usage[widget.id] ?? { count: 0, references: [] } });
    },
    async createWidget(input, options = {}) {
      options.signal?.throwIfAborted();
      let id: string;
      do { id = `fake-${++widgetSequence}`; } while (rows.some(w => w.id === id || w.slug === `fake-slug-${widgetSequence}`));
      const widget: AdminWidget = { id, workspaceId, slug: `fake-slug-${widgetSequence}`, title: input.title, status: 'active', widgetType: input.widgetType, config: copy(input.config), updatedAt: now(), version: 1 };
      rows.push(widget);
      return { widget: copy(widget) };
    },
    async updateWidget({ id, baseVersion, config, title }, options = {}) {
      options.signal?.throwIfAborted();
      const { index, widget } = instance(id);
      if (widget.version !== baseVersion) fail('WIDGETS_VERSION_CONFLICT', 'Widget version conflict');
      const updated = { ...widget, config: copy(config), title: title ?? widget.title, updatedAt: now(), version: widget.version + 1 };
      rows[index] = updated;
      return { widget: copy(updated) };
    },
    async trashWidget({ id }, options = {}) {
      options.signal?.throwIfAborted();
      const { index, widget } = instance(id);
      // Shared Trash owns restoration and permanent removal; this API only moves status.
      rows[index] = { ...widget, status: 'trash', version: widget.version + 1, updatedAt: now() };
      return { ok: true, version: rows[index]!.version };
    },
    async listWidgetRegions(_required, options = {}) { options.signal?.throwIfAborted(); return { regions: copy(bindings) }; },
    async bindWidgetRegion({ regionKey }, options = {}) {
      options.signal?.throwIfAborted();
      if (regionRows.has(regionKey) || bindings.some(b => b.regionKey === regionKey)) fail('WIDGETS_REGION_BOUND', 'Region already bound');
      let id: string;
      do { id = `fake-area-${++areaSequence}`; } while (bindings.some(b => b.areaEntryId === id) || [...regionRows.values()].some(r => r.area.id === id));
      const area: AdminWidgetArea = { id, workspaceId, regionKey, updatedAt: now(), version: 1 };
      bindings.push({ workspaceId, regionKey, areaEntryId: id, updatedAt: area.updatedAt, placementCount: 0 });
      regionRows.set(regionKey, { area, placements: [] });
      return { area: copy(area) };
    },
    async getWidgetRegion({ regionKey }, options = {}) { options.signal?.throwIfAborted(); return copy(region(regionKey)); },
    async mutateWidgetRegionPlacements({ regionKey, baseVersion, placements }, options = {}) {
      options.signal?.throwIfAborted();
      const entry = region(regionKey);
      if (entry.area.version !== baseVersion) fail('WIDGETS_AREA_CONFLICT', 'Region version conflict');
      const area = { ...entry.area, version: entry.area.version + 1, updatedAt: now() };
      // Ordered rows retain identity and allow repeated widget refs; broken refs stay visible.
      const saved: AdminWidgetPlacement[] = placements.map(p => {
        const widget = rows.find(w => w.id === p.widgetEntryId && w.status === 'active');
        return { ...p, widgetTitle: widget?.title ?? null, widgetType: widget?.widgetType ?? null, broken: !widget };
      });
      regionRows.set(regionKey, { area, placements: saved });
      const binding = bindings.find(b => b.regionKey === regionKey);
      if (binding) { binding.placementCount = saved.length; binding.updatedAt = area.updatedAt; }
      return { area: copy(area) };
    },
  };
}
