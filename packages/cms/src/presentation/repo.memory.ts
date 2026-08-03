import type { PresentationSettingsRecord, PresentationSettingsRepoPort } from "./presentation.js";

export class InMemoryPresentationSettingsRepo implements PresentationSettingsRepoPort {
  private rows: PresentationSettingsRecord[];

  constructor(initialRows: PresentationSettingsRecord[] = []) {
    this.rows = [...initialRows];
  }

  async findByWorkspaceId(workspaceId: string): Promise<PresentationSettingsRecord | null> {
    return this.rows.find((row) => row.workspaceId === workspaceId) ?? null;
  }

  async save(record: PresentationSettingsRecord): Promise<void> {
    const index = this.rows.findIndex((row) => row.workspaceId === record.workspaceId);
    if (index === -1) {
      this.rows.push(record);
      return;
    }

    this.rows[index] = record;
  }

  async listAll(): Promise<PresentationSettingsRecord[]> {
    return [...this.rows];
  }
}
