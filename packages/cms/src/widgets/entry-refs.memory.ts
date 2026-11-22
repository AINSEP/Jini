import type { UUID } from "@jini-ai/core/primitives";
import type { EntryRefRow, EntryRefsRepoPort } from "./ports.js";

/**
 * @file In-memory `EntryRefsRepoPort` adapter for hermetic tests and dev composition: a plain collection
 * that replaces per source entry and validates nothing of its own (extraction does that).
 */
export class InMemoryEntryRefsRepo implements EntryRefsRepoPort {
  private rows: EntryRefRow[] = [];

  async findByTarget(required: { workspaceId: UUID; targetKind: EntryRefRow["targetKind"]; targetId: UUID }): Promise<EntryRefRow[]> {
    return this.rows.filter(
      (row) =>
        row.workspaceId === required.workspaceId &&
        row.targetKind === required.targetKind &&
        row.targetId === required.targetId
    );
  }

  async findBySource(required: { workspaceId: UUID; sourceEntryId: UUID }): Promise<EntryRefRow[]> {
    return this.rows.filter(
      (row) => row.workspaceId === required.workspaceId && row.sourceEntryId === required.sourceEntryId
    );
  }

  async replaceForSource(required: { workspaceId: UUID; sourceEntryId: UUID; refs: readonly EntryRefRow[] }): Promise<void> {
    const others = this.rows.filter(
      (row) => !(row.workspaceId === required.workspaceId && row.sourceEntryId === required.sourceEntryId)
    );
    this.rows = [...others, ...required.refs];
  }

  async removeBySource(required: { workspaceId: UUID; sourceEntryId: UUID }): Promise<void> {
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === required.workspaceId && row.sourceEntryId === required.sourceEntryId)
    );
  }

  async rebuildForWorkspace(required: { workspaceId: UUID; refs: readonly EntryRefRow[] }): Promise<void> {
    const others = this.rows.filter((row) => row.workspaceId !== required.workspaceId);
    this.rows = [...others, ...required.refs];
  }
}
