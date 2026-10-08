import type { PluginActivationRecord, PluginActivationRepoPort } from "./activation.js";

/**
 * @file In-memory `PluginActivationRepoPort` adapter — mirrors
 * `src/features/presentation/repo.memory.ts`'s shape exactly (rule-of-two, day one).
 *
 * Architectural role:
 * TDD-certified adapter (implementation outline C-013). Implements get/upsert/delete/list over an
 * in-memory row set and satisfies `__tests__/integration/repo.contract.test.ts`, the shared suite
 * this adapter and `repo.sqlite.ts` run identically.
 */
export class InMemoryPluginActivationRepo implements PluginActivationRepoPort {
  private rows: PluginActivationRecord[];

  constructor({ initialRows = [] }: { initialRows?: PluginActivationRecord[] } = {}, _optional: Record<string, never> = {}) {
    this.rows = [...initialRows];
  }

  async getActivation(required: { workspaceId: string; pluginId: string }, _optional: Record<string, never> = {}): Promise<PluginActivationRecord | null> {
    return (
      this.rows.find(
        (row) => row.workspaceId === required.workspaceId && row.pluginId === required.pluginId
      ) ?? null
    );
  }

  async save(record: PluginActivationRecord, _optional: Record<string, never> = {}): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === record.workspaceId && row.pluginId === record.pluginId
    );
    if (index === -1) {
      this.rows.push(record);
      return;
    }

    this.rows[index] = record;
  }

  async deleteActivation(required: { workspaceId: string; pluginId: string }, _optional: Record<string, never> = {}): Promise<void> {
    this.rows = this.rows.filter(
      (row) => row.workspaceId !== required.workspaceId || row.pluginId !== required.pluginId
    );
  }

  async listAll(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): Promise<PluginActivationRecord[]> {
    return [...this.rows];
  }
}
