import type { WorkspaceRecord, WorkspaceRepoPort } from "./create.js";

/**
 * @file In-memory workspace repository adapter.
 *
 * Purpose:
 * Provides a local `WorkspaceRepoPort` implementation for development/tests.
 *
 * How it relates to the package:
 * - Satisfies the repository contract defined in `./create.ts`.
 * - Injected by a host during runtime composition.
 * - Used by slice tests for database-free verification.
 *
 * Architectural role:
 * Temporary/local adapter. A database-backed adapter (which a host owns, since it names that
 * host's schema) implements the same interface so slice logic remains unchanged.
 */
export class InMemoryWorkspaceRepo implements WorkspaceRepoPort {
  /** Internal record storage. */
  private rows: WorkspaceRecord[];
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(requiredArgs: Record<string, never>, optionalArgs: { initialRows?: WorkspaceRecord[] } = {}) {
    const { initialRows = [] } = optionalArgs;
    this.rows = [...initialRows];
  }

  /** Insert one workspace record. */
  async insert(record: WorkspaceRecord): Promise<void> {
    this.rows.push(record);
  }

  /** Find workspace by unique slug. */
  async findBySlug({ slug }: { slug: string }): Promise<WorkspaceRecord | null> {
    return this.rows.find((row) => row.slug === slug) ?? null;
  }

  /** Find workspace by id. */
  async findById({ id }: { id: string }): Promise<WorkspaceRecord | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  /** All workspace rows (v1 always has exactly one — see `delete.ts`'s header). */
  async list(): Promise<WorkspaceRecord[]> {
    return [...this.rows];
  }

  /** Replace the row matching `record.id` in place. */
  async update(record: WorkspaceRecord): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === record.id);
    if (index === -1) return;
    this.rows[index] = record;
  }

  /** Remove the row matching `id`, if present (idempotent). */
  async delete({ id }: { id: string }): Promise<void> {
    this.rows = this.rows.filter((row) => row.id !== id);
  }

  /** Serializes transactions on this instance, restoring rows on failure. Non-reentrant:
   * callers must put every competing guarded deletion through this seam. Direct repo writes
   * do not join or wait for it; this local adapter supplies no cross-process isolation. */
  async transaction<T>({ fn }: { fn: () => Promise<T> }): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const before = this.rows.map((row) => ({ ...row }));
    try {
      return await fn();
    } catch (error) {
      this.rows = before;
      throw error;
    } finally {
      release();
    }
  }
}
