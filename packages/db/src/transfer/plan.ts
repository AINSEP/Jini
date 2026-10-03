/** Every physical source must account for every table before a copy can be planned. */
import type { TransferSource } from "./sqlite-source.js";
import type { SnapshotTablePlan } from "./table-catalog.js";
export interface TransferPlanSource extends SnapshotTablePlan { readonly name: string; readonly source: TransferSource;
  /** Optional frozen counts from a prior plan; checked inside the destination transaction. */
  readonly counts?: readonly import("./copy-engine.js").TableCount[];
}
export class IncompleteTransferPlanError extends Error {
  readonly missing: readonly { source: string; table: string }[];
  constructor({ missing }: { missing: readonly { source: string; table: string }[] }, _optional = {}) {
    super(`incomplete transfer plan: ${missing.map(entry => `${entry.source}: ${entry.table}`).join(", ")}`);
    this.name = "IncompleteTransferPlanError";
    this.missing = missing;
  }
}
/** O(source tables): completeness is per source; a catalog in another DB cannot conceal a gap. */
export function planTransfer({ sources }: { sources: readonly TransferPlanSource[] }, _optional = {}): { sources: readonly TransferPlanSource[] } {
  const missing = sources.flatMap(({ name, source, tables, leftOut }) => {
    const accounted = new Set([...tables.map(table => table.name), ...leftOut.filter(entry => entry.reason.trim() !== "").map(entry => entry.table)]);
    return source.tableNames().filter(table => !accounted.has(table)).map(table => ({ source: name, table }));
  });
  if (missing.length > 0) throw new IncompleteTransferPlanError({ missing });
  return { sources };
}
