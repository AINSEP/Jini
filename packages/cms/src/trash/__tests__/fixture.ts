import { InMemoryTrashRepo } from "../repo.memory.js";
import { createRecordStoreTrashAdapter } from "../adapters/record-store.js";
import { createTrashService, type TrashServiceOptional } from "../write-service.js";
import type { TransactionRunner, TrashAdapter } from "../ports.js";

export interface RecordValue {
  id: string;
  workspaceId: string;
  version: number;
  deletedAt?: string | null;
  updatedAt: string;
  bodyJson?: unknown;
  [key: string]: unknown;
}
export class MemoryRecordStore {
  records = new Map<string, RecordValue>();
  revisions = new Map<string, string[]>();
  constructor(initial: RecordValue[] = []) {
    for (const record of initial) {
      this.records.set(record.id, structuredClone(record));
      this.revisions.set(record.id, ["creation-revision"]);
    }
  }
  async findById(required: { workspaceId: string; id: string }) {
    const record = this.records.get(required.id);
    return record?.workspaceId === required.workspaceId ? structuredClone(record) : null;
  }
  async save({ record }: { record: RecordValue }) { this.records.set(record.id, structuredClone(record)); }
  async hardDelete(required: { workspaceId: string; id: string }) {
    if (!await this.findById(required)) return;
    this.records.delete(required.id);
    this.revisions.delete(required.id);
  }
  async listRevisions(required: { workspaceId: string; postId: string }) {
    return await this.findById({ workspaceId: required.workspaceId, id: required.postId }) ? this.revisions.get(required.postId) ?? [] : [];
  }
}
export const WS = "workspace-1";
export const AT = "2026-09-20T12:00:00.000Z";
export const ACTOR = { principalId: "principal-1" };
export const ALLOW_ALL = async () => true;
export function harness(optional: TrashServiceOptional = {}) {
  const records = new MemoryRecordStore([{ id: "record-1", workspaceId: WS, version: 1, updatedAt: AT, bodyJson: "{corrupt" }]);
  const repo = new InMemoryTrashRepo({});
  let sequence = 0;
  let depth = 0;
  const transaction: TransactionRunner = async ({ work }) => {
    if (depth > 0) return work();
    const before = structuredClone(records.records);
    const beforeRevisions = structuredClone(records.revisions);
    const index = repo.all({});
    depth++;
    try { return await work(); }
    catch (error) {
      records.records = before;
      records.revisions = beforeRevisions;
      for (const row of repo.all({})) await repo.deleteById({ workspaceId: row.workspaceId, id: row.id });
      for (const row of index) await repo.insert({ row });
      throw error;
    } finally { depth--; }
  };
  const adapter = createRecordStoreTrashAdapter({
    entityType: "record", store: records,
    isHidden: ({ record }) => record.deletedAt != null,
    hidden: ({ record, at }) => ({ ...record, deletedAt: at, updatedAt: at }),
    shown: ({ record, at }) => ({ ...record, deletedAt: null, updatedAt: at }),
  }, { hardDelete: required => records.hardDelete(required) });
  const adapters = new Map<string, TrashAdapter>([["record", adapter]]);
  const deps = { repo, adapters, idGen: { newId: () => `trash-${++sequence}` }, transaction, entityPolicy: () => true };
  return { records, repo, adapter, adapters, deps, trash: createTrashService(deps, optional) };
}
export const removal = { workspaceId: WS, entityType: "record", entityId: "record-1", actor: ACTOR, display: { title: "Snapshot title" }, at: AT, expectedVersion: 1 };
