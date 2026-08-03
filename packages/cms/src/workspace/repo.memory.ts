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

  constructor(initialRows: WorkspaceRecord[] = []) {
    this.rows = [...initialRows];
  }

  /** Insert one workspace record. */
  async insert(record: WorkspaceRecord): Promise<void> {
    this.rows.push(record);
  }

  /** Find workspace by unique slug. */
  async findBySlug(slug: string): Promise<WorkspaceRecord | null> {
    return this.rows.find((row) => row.slug === slug) ?? null;
  }

  /** SPEC-044 REQ-08. Find workspace by id. */
  async findById(id: string): Promise<WorkspaceRecord | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  /** SPEC-044 REQ-08. All workspace rows (v1 always has exactly one — see `delete.ts`'s header). */
  async list(): Promise<WorkspaceRecord[]> {
    return [...this.rows];
  }

  /** SPEC-044 REQ-08. Replace the row matching `record.id` in place. */
  async update(record: WorkspaceRecord): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === record.id);
    if (index === -1) return;
    this.rows[index] = record;
  }

  /** SPEC-044 REQ-08. Remove the row matching `id`, if present (idempotent). */
  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((row) => row.id !== id);
  }
}
