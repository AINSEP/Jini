import type { UUID } from "@jini-ai/core/primitives";
import { assertVersionedWrite } from "@jini-ai/core/optimistic-concurrency";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { FormsTables, FormDefinitionDatabase, FormSubmissionDatabase } from "./tables.js";
import { FormSlugConflictError } from "../errors.js";
import type { FormDefinitionRepoPort, FormSubmissionRepoPort } from "../ports.js";
import {
  toDefinitionRecord,
  toDefinitionRow,
  toSubmissionRecord,
  toSubmissionRow,
  updatableDefinitionColumns,
} from "./repo.rows.js";
import type { FormDefinitionRecord, FormSubmissionPage, FormSubmissionRecord } from "../types.js";
import type { Kysely } from "kysely";

/**
 * @file THE forms repositories: one Kysely query body for every database the storage kernel drives
 * (SQLite, PGlite, Postgres). Every statement goes through `kernel.run` and is awaited.
 *
 * `create`'s slug uniqueness is enforced by the real unique index
 * (`form_definitions_workspace_slug_unique`) — the tie-break of behavior.spec.md §6.1 — but the
 * conflict is detected by a check inside a transaction holding the workspace's forms lock, not by
 * catching the violation: on Postgres a failed statement aborts the surrounding transaction, so a
 * follow-up "is it in the Trash?" query could not run. The index stays as the backstop against a
 * writer outside this process.
 */

export class SqlFormDefinitionRepo implements FormDefinitionRepoPort {
  protected readonly kernel: StorageKernel<Kysely<FormDefinitionDatabase>, FormDefinitionDatabase>;
  protected readonly tables: FormsTables;
  constructor(
    { kernel, tables }: { kernel: StorageKernel<Kysely<FormDefinitionDatabase>, FormDefinitionDatabase>; tables: FormsTables },
    _optional: Record<string, never> = {},
  ) { this.kernel = kernel; this.tables = tables; }

  /** Trash-aware: `deleted_at IS NULL` excludes a trashed row (`ports.ts`'s fail-closed-reads doc). */
  async findById(required: { workspaceId: UUID; id: UUID }): Promise<FormDefinitionRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .selectFrom(this.tables.definitions)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .where("deleted_at", "is", null)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toDefinitionRecord(row) : null;
  }

  /** Trash-aware, as {@link findById}. */
  async findBySlug(required: { workspaceId: UUID; slug: string }): Promise<FormDefinitionRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .selectFrom(this.tables.definitions)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("slug", "=", required.slug)
        .where("deleted_at", "is", null)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toDefinitionRecord(row) : null;
  }

  /** Trash-aware, as {@link findById}. */
  async list(required: { workspaceId: UUID }): Promise<FormDefinitionRecord[]> {
    const rows = await this.kernel.run((db) =>
      db
        .selectFrom(this.tables.definitions)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("deleted_at", "is", null)
        .execute()
    );
    return rows.map((row) => toDefinitionRecord(row));
  }

  async create(record: FormDefinitionRecord): Promise<void> {
    await this.kernel.transaction(async () => {
      await this.kernel.lockKey(`forms:${record.workspaceId}`);
      // Trash-blind, deliberately: the unique index has no `WHERE deleted_at IS NULL` clause, so a
      // trashed row's slug is still "taken" — the conflict is real either way, only the remedy
      // differs, which is why the message names it.
      const conflicting = await this.kernel.run((db) =>
        db
          .selectFrom(this.tables.definitions)
          .select("deleted_at")
          .where("workspace_id", "=", record.workspaceId)
          .where("slug", "=", record.slug)
          .limit(1)
          .executeTakeFirst()
      );
      if (conflicting) {
        throw new FormSlugConflictError({
          message: conflicting.deleted_at !== null
            ? `a form with slug '${record.slug}' is in the Trash — restore it, or delete it permanently from the Trash, to reuse the slug`
            : `a form with slug '${record.slug}' already exists`,
          slug: record.slug,
        });
      }
      await this.kernel.run((db) => db.insertInto(this.tables.definitions).values(toDefinitionRow(record)).execute());
    });
  }

  /**
   * Update-only path for a LIVE row. Every update stores `record.version` (the service sets it to
   * the read version + 1), guarded or not, so the stored version always matches what the caller was
   * told; otherwise a stale editor's basis would survive a basis-less edit and could revert it.
   * `deleted_at IS NULL` in the WHERE means the UPDATE matches zero rows if the record has since
   * been trashed — a stale in-hand copy can never clear a marker it never knew was set.
   */
  async update(record: FormDefinitionRecord, optional: { expectedVersion?: number } = {}): Promise<void> {
    const set = updatableDefinitionColumns(toDefinitionRow(record));
    const { expectedVersion } = optional;
    if (expectedVersion !== undefined) {
      // One conditional UPDATE prevents two editors with the same basis from both landing.
      const result = await this.kernel.run((db) => db.updateTable(this.tables.definitions)
        .set({ ...set, version: record.version })
        .where("workspace_id", "=", record.workspaceId)
        .where("id", "=", record.id)
        .where("deleted_at", "is", null)
        .where("version", "=", expectedVersion)
        .executeTakeFirst());
      await assertVersionedWrite({
        changedRows: result.numUpdatedRows, recordKind: "form", recordId: record.id, expectedVersion,
        readCurrentVersion: async () => (await this.findById({ workspaceId: record.workspaceId, id: record.id }))?.version ?? null,
      });
      return;
    }
    await this.kernel.run((db) =>
      db
        .updateTable(this.tables.definitions)
        .set({ ...set, version: record.version })
        .where("workspace_id", "=", record.workspaceId)
        .where("id", "=", record.id)
        .where("deleted_at", "is", null)
        .execute()
    );
  }

  /** Trash-BLIND — see `ports.ts`'s doc for why this is the one deliberate exception. */
  async isSlugTaken(required: { workspaceId: UUID; slug: string }): Promise<boolean> {
    const row = await this.kernel.run((db) =>
      db
        .selectFrom(this.tables.definitions)
        .select("id")
        .where("workspace_id", "=", required.workspaceId)
        .where("slug", "=", required.slug)
        .limit(1)
        .executeTakeFirst()
    );
    return row !== undefined;
  }
}

export class SqlFormSubmissionRepo implements FormSubmissionRepoPort {
  protected readonly kernel: StorageKernel<Kysely<FormSubmissionDatabase>, FormSubmissionDatabase>;
  protected readonly tables: FormsTables;
  constructor(
    { kernel, tables }: { kernel: StorageKernel<Kysely<FormSubmissionDatabase>, FormSubmissionDatabase>; tables: FormsTables },
    _optional: Record<string, never> = {},
  ) { this.kernel = kernel; this.tables = tables; }

  async findById(required: { workspaceId: UUID; id: UUID }): Promise<FormSubmissionRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .selectFrom(this.tables.submissions)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .where("deleted_at", "is", null)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toSubmissionRecord(row) : null;
  }

  async create(record: FormSubmissionRecord): Promise<void> {
    await this.kernel.run((db) => db.insertInto(this.tables.submissions).values(toSubmissionRow(record)).execute());
  }

  /** The content kernel's transaction; a nested call joins the open one.
   *  @complexity O(1) beyond `work`. */
  transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.kernel.transaction(work);
  }

  /**
   * Newest-first (`submitted_at` desc, `id` desc tie-break, behavior.spec.md §2.1). The cursor
   * resumes strictly after the previously returned page's last row on that same ordering; an unknown
   * cursor id is ignored (first page), as before.
   *
   * @complexity O(limit) rows read via the definition index; two statements when a cursor is given.
   */
  async listByDefinition(required: {
    workspaceId: UUID;
    formDefinitionId: UUID;
    limit: number;
  }, optional: { cursor?: string | null } = {}): Promise<FormSubmissionPage> {
    const cursorRow = optional.cursor
      ? await this.kernel.run((db) =>
          db
            .selectFrom(this.tables.submissions)
            .select(["submitted_at", "id"])
            .where("workspace_id", "=", required.workspaceId)
            .where("id", "=", optional.cursor as string)
            .limit(1)
            .executeTakeFirst()
        )
      : undefined;

    const rows = await this.kernel.run((db) => {
      let query = db
        .selectFrom(this.tables.submissions)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("form_definition_id", "=", required.formDefinitionId)
        .where("deleted_at", "is", null);
      if (cursorRow) {
        query = query.where((eb) =>
          eb.or([
            eb("submitted_at", "<", cursorRow.submitted_at),
            eb.and([eb("submitted_at", "=", cursorRow.submitted_at), eb("id", "<", cursorRow.id)]),
          ])
        );
      }
      return query.orderBy("submitted_at", "desc").orderBy("id", "desc").limit(required.limit + 1).execute();
    });

    const hasMore = rows.length > required.limit;
    const page = hasMore ? rows.slice(0, required.limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;
    return { items: page.map((row) => toSubmissionRecord(row)), nextCursor };
  }
}

/** The form-definition repo for the injected kernel and required host table names.
 * @complexity O(1); no connection or schema work. */
export function formDefinitionRepoFor<DB>(
  { kernel, tables }: { kernel: StorageKernel<Kysely<DB>, DB>; tables: FormsTables },
  _optional: Record<string, never> = {},
): SqlFormDefinitionRepo {
  return new SqlFormDefinitionRepo({ kernel: kernel as unknown as StorageKernel<Kysely<FormDefinitionDatabase>, FormDefinitionDatabase>, tables });
}

/** The form-submission repo for the injected kernel and required host table names.
 * @complexity O(1); no connection or schema work. */
export function formSubmissionRepoFor<DB>(
  { kernel, tables }: { kernel: StorageKernel<Kysely<DB>, DB>; tables: FormsTables },
  _optional: Record<string, never> = {},
): SqlFormSubmissionRepo {
  return new SqlFormSubmissionRepo({ kernel: kernel as unknown as StorageKernel<Kysely<FormSubmissionDatabase>, FormSubmissionDatabase>, tables });
}
