import type { PresentationSettingsRecord, PresentationSettingsRepoPort } from "./presentation.js";

export class InMemoryPresentationSettingsRepo implements PresentationSettingsRepoPort {
  private rows: PresentationSettingsRecord[];

  constructor(requiredArgs: Record<string, never>, optionalArgs: { initialRows?: PresentationSettingsRecord[] } = {}) {
    const { initialRows = [] } = optionalArgs;
    this.rows = [...initialRows];
  }

  async findByWorkspaceId({ workspaceId }: { workspaceId: string }): Promise<PresentationSettingsRecord | null> {
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
