import type { StorageDialect, StorageKernel } from "@jini-ai/db/kernel";
import { createFormsTables } from "../../sql/index.js";

/** Names are fixture data; production SQL always receives them from the host. */
export const tables = { definitions: "form_definitions", submissions: "form_submissions" };

/** Apply the forms tables through the production `createFormsTables` (this fixture owns no DDL).
 * `_dialect` stays for the matrix's `createTables(kernel, dialect)` shape; the kernel carries it.
 * @complexity O(1) statements plus database DDL cost. */
export async function createTables<DB>(
  kernel: StorageKernel<DB>,
  _dialect: StorageDialect,
): Promise<void> {
  await createFormsTables({ kernel, tables });
}
