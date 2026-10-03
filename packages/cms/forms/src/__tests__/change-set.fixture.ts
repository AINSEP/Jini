import type {
  DomainEvent,
  OutboxPort,
  ChangeSetItemRecord,
  ChangeSetRecord,
  ChangeSetRepoPort,
  ChangeSetWithItems,
} from "@jini-ai/cms/core";

export class InMemoryChangeSetRepo implements ChangeSetRepoPort {
  private rows: ChangeSetRecord[];
  private itemRows: ChangeSetItemRecord[];
  private readonly outbox: OutboxPort | undefined;


  constructor(initialRows: ChangeSetRecord[] = [], initialItems: ChangeSetItemRecord[] = [], outbox?: OutboxPort) {
    this.rows = [...initialRows];
    this.itemRows = [...initialItems];
    this.outbox = outbox;
  }

  async insert({ record, items }: { record: ChangeSetRecord; items: ChangeSetItemRecord[] }, { event }: { event?: DomainEvent } = {}): Promise<void> {
    this.rows.push(record);
    this.itemRows.push(...items);
    if (event) await this.outbox?.enqueue(event);
  }

  async findById(required: { workspaceId: string; id: string }): Promise<ChangeSetWithItems | null> {
    const changeSet =
      this.rows.find(
        (row) => row.workspaceId === required.workspaceId && row.id === required.id
      ) ?? null;
    if (!changeSet) return null;

    const items = this.itemRows
      .filter((item) => item.changeSetId === changeSet.id)
      .sort((a, b) => a.position - b.position);

    return { changeSet, items };
  }

  async findByIdempotencyKey(required: {
    workspaceId: string;
    idempotencyKey: string;
  }): Promise<ChangeSetRecord | null> {
    return (
      this.rows.find(
        (row) =>
          row.workspaceId === required.workspaceId &&
          row.idempotencyKey === required.idempotencyKey
      ) ?? null
    );
  }

  async listByWorkspace(required: { workspaceId: string }): Promise<ChangeSetRecord[]> {
    return this.rows
      .filter((row) => row.workspaceId === required.workspaceId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async save(record: ChangeSetRecord): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === record.id);
    if (index === -1) {
      this.rows.push(record);
      return;
    }

    this.rows[index] = record;
  }
}
