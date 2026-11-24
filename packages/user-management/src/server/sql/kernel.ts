import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";

/**
 * @file The kernel shape every SQL identity store takes: the host's storage kernel typed without its schema.
 * A store supplies each query's table view itself (`db.withTables<…>()`), so the host's table names stay
 * host-owned (see each store's `tables` argument) and no product schema is named in this package.
 */
export type SqlIdentityKernel = StorageKernel<Kysely<unknown>, unknown>;
