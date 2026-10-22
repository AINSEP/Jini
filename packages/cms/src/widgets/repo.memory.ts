import type { UUID } from "@jini-ai/core/primitives";
import type { WidgetRegionBindingRepoPort } from "./ports.js";
import type { WidgetRegionBindingRow, WidgetRegionKey } from "./types.js";

/**
 * @file In-memory `WidgetRegionBindingRepoPort` adapter (ADR-006 rule-of-two "one being built now"
 * half — `repo.sqlite.ts` is the other), mirroring `navigation/repo.memory.ts`'s
 * `InMemoryNavLocationBindingRepo` exactly: enforces `UNIQUE(workspace_id, region_key)` by storing
 * at most one row per `(workspaceId, regionKey)` pair, `upsert` replacing any prior row for that
 * key (last-writer-wins, same discipline `NavLocationBindingRepoPort.upsert` documents).
 *
 * Architectural role:
 * Infrastructure adapter (in-memory). No feature logic — that is `region-area-service.ts`'s job;
 * this class is a dumb, uniqueness-enforcing collection.
 */
export class InMemoryWidgetRegionBindingRepo implements WidgetRegionBindingRepoPort {
  private rows: WidgetRegionBindingRow[];

  constructor(initialRows: WidgetRegionBindingRow[] = []) {
    this.rows = [...initialRows];
  }

  async findByRegion(required: { workspaceId: UUID; regionKey: WidgetRegionKey }): Promise<WidgetRegionBindingRow | null> {
    return (
      this.rows.find((row) => row.workspaceId === required.workspaceId && row.regionKey === required.regionKey) ?? null
    );
  }

  async listByWorkspace(required: { workspaceId: UUID }): Promise<WidgetRegionBindingRow[]> {
    return this.rows.filter((row) => row.workspaceId === required.workspaceId);
  }

  async upsert(required: {
    workspaceId: UUID;
    regionKey: WidgetRegionKey;
    areaEntryId: UUID;
    updatedAt: string;
  }): Promise<WidgetRegionBindingRow> {
    const row: WidgetRegionBindingRow = {
      workspaceId: required.workspaceId,
      regionKey: required.regionKey,
      areaEntryId: required.areaEntryId,
      updatedAt: required.updatedAt,
    };
    const index = this.rows.findIndex(
      (existing) => existing.workspaceId === required.workspaceId && existing.regionKey === required.regionKey
    );
    if (index === -1) {
      this.rows.push(row);
    } else {
      this.rows[index] = row;
    }
    return row;
  }

  /** REQ-14 — a theme switch orphaned this region key: drop the binding row, retain the underlying `widget_area` entry (untouched by this port). */
  async markInactive(required: { workspaceId: UUID; regionKey: WidgetRegionKey }): Promise<void> {
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === required.workspaceId && row.regionKey === required.regionKey)
    );
  }

  async rebuildForWorkspace(required: { workspaceId: UUID; bindings: readonly WidgetRegionBindingRow[] }): Promise<void> {
    const others = this.rows.filter((row) => row.workspaceId !== required.workspaceId);
    this.rows = [...others, ...required.bindings];
  }
}
