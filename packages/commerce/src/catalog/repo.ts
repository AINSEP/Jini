import type { StorageKernel } from "@jini-ai/db/kernel";
export type { CommerceKernel, CommerceDatabase } from "./database.js";
import type { CommerceKernel as ContentKernel } from "./database.js";
import { CommerceProductSlugConflictError } from "./errors.js";
import type {
  ApplyProviderEventResult,
  CommerceOrderRepoPort,
  CommercePriceRepoPort,
  CommerceProductImageRepoPort,
  CommerceProductRepoPort,
  CommerceWebhookEventRepoPort,
} from "./ports.js";
import {
  toOrderItemRecord,
  toOrderItemRow,
  toOrderRecord,
  toOrderRow,
  toPriceRecord,
  toPriceRow,
  toProductImageRecord,
  toProductImageRow,
  toProductRecord,
  toProductRow,
  toWebhookEventRow,
} from "./repo.rows.js";
import type {
  CommerceOrderItemRecord,
  CommerceOrderRecord,
  CommercePriceRecord,
  CommerceProductImageRecord,
  CommerceProductRecord,
} from "./types.js";

/**
 * @file THE commerce repositories: one Kysely query body for every database the storage kernel
 * drives (SQLite, PGlite, Postgres). Every statement goes through `kernel.run` and is awaited;
 * multi-statement writes run inside `kernel.transaction`.
 *
 * Concurrency, per write:
 * - `CommerceProduct.save` checks slug uniqueness under the workspace's `commerce:products:` lock,
 *   not by catching the violation — on Postgres a failed statement aborts the surrounding
 *   transaction. `commerce_products_workspace_slug_unique` stays the backstop.
 * - `applyProviderEvent` needs no lock: its replay guard is one INSERT … ON CONFLICT DO NOTHING
 *   (the affected-row count says whether this call recorded the event) and its ordering guard is
 *   one `UPDATE … WHERE provider_event_at < ?` — never a SELECT deciding whether to write.
 */

export class SqlCommerceProductRepo implements CommerceProductRepoPort {
  protected readonly kernel: ContentKernel;
  constructor({ kernel }: { kernel: ContentKernel }, _optional: Record<string, never> = {}) { this.kernel = kernel; }

  async findById(required: { workspaceId: string; id: string }, _optional: Record<string, never> = {}): Promise<CommerceProductRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .selectFrom("commerce_products")
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toProductRecord(row) : null;
  }

  async findBySlug(required: { workspaceId: string; slug: string }, _optional: Record<string, never> = {}): Promise<CommerceProductRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .selectFrom("commerce_products")
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("slug", "=", required.slug)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toProductRecord(row) : null;
  }

  /**
   * Powers the public storefront grid — `status: "active"` only, so an archived product never
   * appears to a visitor even though the row still exists for historical orders to reference.
   *
   * @complexity Time: O(min(limit, 100)) rows returned — no covering index exists for
   * `(workspace_id, status, name)` yet; adequate for this slice's catalog sizes, flagged rather
   * than silently assumed to scale.
   */
  async listActive(required: { workspaceId: string; limit?: (number) | undefined }, _optional: Record<string, never> = {}): Promise<CommerceProductRecord[]> {
    const limit = Math.min(required.limit ?? 100, 100);
    const rows = await this.kernel.run((db) =>
      db
        .selectFrom("commerce_products")
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("status", "=", "active")
        .orderBy("name", "asc")
        .limit(limit)
        .execute()
    );
    return rows.map((row) => toProductRecord(row));
  }

  /**
   * Upsert on `id`. A slug already held by ANOTHER product in the workspace throws
   * {@link CommerceProductSlugConflictError} before anything is written.
   */
  async save(record: CommerceProductRecord, _optional: Record<string, never> = {}): Promise<void> {
    const row = toProductRow(record);
    await this.kernel.transaction(async () => {
      await this.kernel.lockKey(`commerce:products:${record.workspaceId}`);
      const holder = await this.kernel.run((db) =>
        db
          .selectFrom("commerce_products")
          .select("id")
          .where("workspace_id", "=", record.workspaceId)
          .where("slug", "=", record.slug)
          .where("id", "!=", record.id)
          .limit(1)
          .executeTakeFirst()
      );
      if (holder) {
        throw new CommerceProductSlugConflictError({ message: `a product with slug '${record.slug}' already exists`, slug: record.slug });
      }
      await this.kernel.run((db) =>
        db
          .insertInto("commerce_products")
          .values(row)
          .onConflict((oc) => oc.column("id").doUpdateSet(row))
          .execute()
      );
    });
  }
}

export class SqlCommerceProductImageRepo implements CommerceProductImageRepoPort {
  protected readonly kernel: ContentKernel;
  constructor({ kernel }: { kernel: ContentKernel }, _optional: Record<string, never> = {}) { this.kernel = kernel; }

  /** Gallery order: `position` ascending, `id` as the tie-break. */
  async listByProduct(required: { workspaceId: string; productId: string }, _optional: Record<string, never> = {}): Promise<CommerceProductImageRecord[]> {
    const rows = await this.kernel.run((db) =>
      db
        .selectFrom("commerce_product_images")
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("product_id", "=", required.productId)
        .orderBy("position", "asc")
        .orderBy("id", "asc")
        .execute()
    );
    return rows.map((row) => toProductImageRecord(row));
  }

  async save(record: CommerceProductImageRecord, _optional: Record<string, never> = {}): Promise<void> {
    const row = toProductImageRow(record);
    await this.kernel.run((db) =>
      db
        .insertInto("commerce_product_images")
        .values(row)
        .onConflict((oc) => oc.column("id").doUpdateSet(row))
        .execute()
    );
  }
}

export class SqlCommercePriceRepo implements CommercePriceRepoPort {
  protected readonly kernel: ContentKernel;
  constructor({ kernel }: { kernel: ContentKernel }, _optional: Record<string, never> = {}) { this.kernel = kernel; }

  async findById(required: { workspaceId: string; id: string }, _optional: Record<string, never> = {}): Promise<CommercePriceRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .selectFrom("commerce_prices")
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toPriceRecord(row) : null;
  }

  async listByProduct(required: { workspaceId: string; productId: string }, _optional: Record<string, never> = {}): Promise<CommercePriceRecord[]> {
    const rows = await this.kernel.run((db) =>
      db
        .selectFrom("commerce_prices")
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("product_id", "=", required.productId)
        .execute()
    );
    return rows.map((row) => toPriceRecord(row));
  }

  async save(record: CommercePriceRecord, _optional: Record<string, never> = {}): Promise<void> {
    const row = toPriceRow(record);
    await this.kernel.run((db) =>
      db
        .insertInto("commerce_prices")
        .values(row)
        .onConflict((oc) => oc.column("id").doUpdateSet(row))
        .execute()
    );
  }
}

export class SqlCommerceOrderRepo implements CommerceOrderRepoPort {
  protected readonly kernel: ContentKernel;
  constructor({ kernel }: { kernel: ContentKernel }, _optional: Record<string, never> = {}) { this.kernel = kernel; }

  async findById(required: { workspaceId: string; id: string }, _optional: Record<string, never> = {}): Promise<CommerceOrderRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .selectFrom("commerce_orders")
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toOrderRecord(row) : null;
  }

  async listItems(required: { workspaceId: string; orderId: string }, _optional: Record<string, never> = {}): Promise<CommerceOrderItemRecord[]> {
    const rows = await this.kernel.run((db) =>
      db
        .selectFrom("commerce_order_items")
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("order_id", "=", required.orderId)
        .execute()
    );
    return rows.map((row) => toOrderItemRecord(row));
  }

  /** Header + line items in one kernel transaction: a checkout is all-or-nothing (`ports.ts`). */
  async placeOrder(required: {
    order: CommerceOrderRecord;
    items: readonly CommerceOrderItemRecord[];
  }, _optional: Record<string, never> = {}): Promise<void> {
    const { order, items } = required;
    await this.kernel.transaction(async () => {
      await this.kernel.run((db) => db.insertInto("commerce_orders").values(toOrderRow(order)).execute());
      if (items.length > 0) {
        await this.kernel.run((db) =>
          db.insertInto("commerce_order_items").values(items.map((row) => toOrderItemRow(row))).execute()
        );
      }
    });
  }
}

export class SqlCommerceWebhookEventRepo implements CommerceWebhookEventRepoPort {
  protected readonly kernel: ContentKernel;
  constructor({ kernel }: { kernel: ContentKernel }, _optional: Record<string, never> = {}) { this.kernel = kernel; }

  /** See `ports.ts`'s doc for the returned outcomes and the file header for the two guards. */
  async applyProviderEvent(
    required: Parameters<CommerceWebhookEventRepoPort["applyProviderEvent"]>[0], _optional: Record<string, never> = {}
  ): Promise<ApplyProviderEventResult> {
    const { event, orderId, projection, processedAt } = required;

    return this.kernel.transaction(async (): Promise<ApplyProviderEventResult> => {
      // Idempotency guard. A conflict on UNIQUE(provider, event_id) inserts nothing — this exact
      // event was already recorded, so nothing is applied a second time.
      const inserted = await this.kernel.run((db) =>
        db
          .insertInto("commerce_webhook_events")
          .values(toWebhookEventRow(event))
          .onConflict((oc) => oc.columns(["provider", "event_id"]).doNothing())
          .executeTakeFirst()
      );
      if (Number(inserted.numInsertedOrUpdatedRows ?? 0) === 0) {
        return "duplicate";
      }

      // Ordering guard, one atomic UPDATE: the WHERE comparison is what makes "is this event newer
      // than what's applied" and "apply it" a single indivisible operation.
      const applied = await this.kernel.run((db) =>
        db
          .updateTable("commerce_orders")
          .set((eb) => ({
            status: projection.status,
            provider_event_at: projection.providerEventAt,
            updated_at: projection.updatedAt,
            version: eb("version", "+", 1),
          }))
          .where("id", "=", orderId)
          .where("workspace_id", "=", event.workspaceId)
          .where((eb) =>
            eb.or([eb("provider_event_at", "is", null), eb("provider_event_at", "<", projection.providerEventAt)])
          )
          .executeTakeFirst()
      );

      const outcome: ApplyProviderEventResult = Number(applied.numUpdatedRows) === 0 ? "stale" : "applied";
      await this.kernel.run((db) =>
        db
          .updateTable("commerce_webhook_events")
          .set({ status: outcome === "stale" ? "ignored" : "applied", processed_at: processedAt })
          .where("id", "=", event.id)
          .execute()
      );
      return outcome;
    });
  }
}

/** The commerce product repo for `kernel`.
 * Kysely is invariant in its table type: each factory borrows only the commerce view of the same
 * injected kernel. No connection, schema preparation or reconciliation is performed here. */
export function commerceProductRepoFor<DB>({ kernel }: { kernel: StorageKernel<DB> }, _optional: Record<string, never> = {}): SqlCommerceProductRepo {
  return new SqlCommerceProductRepo({ kernel: kernel as unknown as ContentKernel });
}

/** The commerce product-image repo for `kernel`. */
export function commerceProductImageRepoFor<DB>({ kernel }: { kernel: StorageKernel<DB> }, _optional: Record<string, never> = {}): SqlCommerceProductImageRepo {
  return new SqlCommerceProductImageRepo({ kernel: kernel as unknown as ContentKernel });
}

/** The commerce price repo for `kernel`. */
export function commercePriceRepoFor<DB>({ kernel }: { kernel: StorageKernel<DB> }, _optional: Record<string, never> = {}): SqlCommercePriceRepo {
  return new SqlCommercePriceRepo({ kernel: kernel as unknown as ContentKernel });
}

/** The commerce order repo for `kernel`. */
export function commerceOrderRepoFor<DB>({ kernel }: { kernel: StorageKernel<DB> }, _optional: Record<string, never> = {}): SqlCommerceOrderRepo {
  return new SqlCommerceOrderRepo({ kernel: kernel as unknown as ContentKernel });
}

/** The commerce webhook-event (inbox) repo for `kernel`. */
export function commerceWebhookEventRepoFor<DB>({ kernel }: { kernel: StorageKernel<DB> }, _optional: Record<string, never> = {}): SqlCommerceWebhookEventRepo {
  return new SqlCommerceWebhookEventRepo({ kernel: kernel as unknown as ContentKernel });
}
