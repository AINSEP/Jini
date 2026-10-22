import type { UUID } from "@jini-ai/core/primitives";
import { FormSlugConflictError } from "../errors.js";
import type { FormDefinitionRepoPort, FormSubmissionRepoPort } from "../ports.js";
import type { FormDefinitionRecord, FormSubmissionPage, FormSubmissionRecord } from "../types.js";

interface StoredFormDefinition extends FormDefinitionRecord {
  deletedAt: string | null;
}

function cloneStored(row: StoredFormDefinition): StoredFormDefinition {
  return {
    ...row,
    fields: row.fields.map((f) => ({ ...f })),
    notify: { ...row.notify, recipients: [...row.notify.recipients] },
  };
}

function toPublicRecord(row: StoredFormDefinition): FormDefinitionRecord {
  const { deletedAt: _deletedAt, ...record } = cloneStored(row);
  return record;
}

export class InMemoryFormDefinitionRepo implements FormDefinitionRepoPort {
  private readonly rows = new Map<UUID, StoredFormDefinition>();


  async findById(required: { workspaceId: UUID; id: UUID }): Promise<FormDefinitionRecord | null> {
    const row = this.rows.get(required.id);
    if (!row || row.workspaceId !== required.workspaceId || row.deletedAt !== null) return null;
    return toPublicRecord(row);
  }


  async findBySlug(required: { workspaceId: UUID; slug: string }): Promise<FormDefinitionRecord | null> {
    for (const row of this.rows.values()) {
      if (row.workspaceId === required.workspaceId && row.slug === required.slug && row.deletedAt === null) {
        return toPublicRecord(row);
      }
    }
    return null;
  }


  async list(required: { workspaceId: UUID }): Promise<FormDefinitionRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.workspaceId === required.workspaceId && row.deletedAt === null)
      .map(toPublicRecord);
  }

  async create(record: FormDefinitionRecord): Promise<void> {
    const conflicting = [...this.rows.values()].find(
      (row) => row.workspaceId === record.workspaceId && row.slug === record.slug
    );
    if (conflicting) {
      // Trash-blind, deliberately — see `ports.ts`'s doc on `create` for why a trashed row still
      // conflicts, and `repo.sqlite.ts`'s identical message for why the two adapters must agree.
      const message =
        conflicting.deletedAt !== null
          ? `a form with slug '${record.slug}' is in the Trash — restore it, or delete it permanently from the Trash, to reuse the slug`
          : `a form with slug '${record.slug}' already exists`;
      throw new FormSlugConflictError({ message: message, slug: record.slug });
    }
    this.rows.set(record.id, { ...cloneStored({ ...record, deletedAt: null }) });
  }


  async update(record: FormDefinitionRecord): Promise<void> {
    const existing = this.rows.get(record.id);
    if (existing && existing.deletedAt !== null) return;
    this.rows.set(record.id, cloneStored({ ...record, deletedAt: existing?.deletedAt ?? null }));
  }


  async isSlugTaken(required: { workspaceId: UUID; slug: string }): Promise<boolean> {
    for (const row of this.rows.values()) {
      if (row.workspaceId === required.workspaceId && row.slug === required.slug) return true;
    }
    return false;
  }


  async findAnyById(required: { workspaceId: UUID; id: UUID }): Promise<StoredFormDefinition | null> {
    const row = this.rows.get(required.id);
    if (!row || row.workspaceId !== required.workspaceId) return null;
    return cloneStored(row);
  }


  async save(record: StoredFormDefinition): Promise<void> {
    this.rows.set(record.id, cloneStored(record));
  }


  async hardDelete(required: { workspaceId: UUID; id: UUID }): Promise<void> {
    const row = this.rows.get(required.id);
    if (row && row.workspaceId === required.workspaceId) {
      this.rows.delete(required.id);
    }
  }
}

export interface StoredFormSubmission extends FormSubmissionRecord {
  deletedAt: string | null;
  version: number;
}

function cloneSubmission(row: StoredFormSubmission): StoredFormSubmission {
  return { ...row, data: { ...row.data } };
}

function toSubmissionRecord(row: StoredFormSubmission): FormSubmissionRecord {
  const { deletedAt: _deletedAt, version: _version, ...record } = row;
  return { ...record, data: { ...record.data } };
}

export class InMemoryFormSubmissionRepo implements FormSubmissionRepoPort {
  private readonly rows = new Map<UUID, StoredFormSubmission>();


  async findById(required: { workspaceId: UUID; id: UUID }): Promise<FormSubmissionRecord | null> {
    const row = this.rows.get(required.id);
    if (!row || row.workspaceId !== required.workspaceId || row.deletedAt !== null) return null;
    return toSubmissionRecord(row);
  }

  async create(record: FormSubmissionRecord): Promise<void> {
    this.rows.set(record.id, { ...record, data: { ...record.data }, deletedAt: null, version: 1 });
  }

  async listByDefinition(required: {
    workspaceId: UUID;
    formDefinitionId: UUID;
    limit: number;
  }, optional: { cursor?: string | null } = {}): Promise<FormSubmissionPage> {
    const all = [...this.rows.values()]
      .filter(
        (row) =>
          row.workspaceId === required.workspaceId &&
          row.formDefinitionId === required.formDefinitionId &&
          row.deletedAt === null
      )
      // Newest-first (behavior.spec.md §2.1): submittedAt desc, id desc tie-break.
      .sort((a, b) => {
        if (a.submittedAt !== b.submittedAt) return b.submittedAt.localeCompare(a.submittedAt);
        return b.id.localeCompare(a.id);
      });

    const startIndex = optional.cursor
      ? all.findIndex((row) => row.id === optional.cursor) + 1
      : 0;
    const page = all.slice(startIndex, startIndex + required.limit);
    const nextCursor =
      startIndex + required.limit < all.length ? page[page.length - 1]?.id ?? null : null;

    return { items: page.map(toSubmissionRecord), nextCursor };
  }


  async findAnyById(required: { workspaceId: UUID; id: UUID }): Promise<StoredFormSubmission | null> {
    const row = this.rows.get(required.id);
    return row && row.workspaceId === required.workspaceId ? cloneSubmission(row) : null;
  }


  async save(record: StoredFormSubmission): Promise<void> {
    this.rows.set(record.id, cloneSubmission(record));
  }


  async hardDelete(required: { workspaceId: UUID; id: UUID }): Promise<void> {
    const row = this.rows.get(required.id);
    if (row && row.workspaceId === required.workspaceId) {
      this.rows.delete(required.id);
    }
  }


  async deleteAllForDefinition(required: { workspaceId: UUID; formDefinitionId: UUID }): Promise<void> {
    for (const [id, row] of this.rows) {
      if (row.workspaceId === required.workspaceId && row.formDefinitionId === required.formDefinitionId) {
        this.rows.delete(id);
      }
    }
  }
}
