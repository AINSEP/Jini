import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";

import type { DatabaseTransferPlan } from "../tools/index.js";

/**
 * @file The card `database_transfer_run` raises before anything is written. Same held-open exchange
 * as `site backup confirmation`: Copy/Cancel carry `SURFACE_EXCHANGE_ID_PARAM` back to the same
 * tool call. Plain words only (no "schema", "role" or "connection string"): where the copy goes, how
 * much, what is left out, and that the site itself does not change.
 */

export const DATABASE_TRANSFER_RUN_TOOL_ID = "database_transfer_run";

/** `3:41 PM, Sep 27` in the server's locale-neutral English. */
export function formatSnapshotTime({ iso }: { iso: string }, _optional = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
}

function plural({ n, one, many }: { n: number; one: string; many: string }, _optional = {}): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** `spec.expiresAtMs` is the exchange's deadline, so the chat counts the card down and closes it — as
 *  `requireHumanConfirm` does. @complexity O(left-out tables). */
export function describeTransferApproval({ plan }: { plan: DatabaseTransferPlan }, _optional = {}): HumanConfirmSpec {
  const where = `${plan.destination.database} on ${plan.destination.host}`;
  const leftOutRows = plan.leftOut.reduce((sum, entry) => sum + entry.rows, 0);
  const details = [
    { label: "Destination", value: where },
    { label: "Copies", value: `${plural({ n: plan.tableCount, one: "table", many: "tables" })}, ${plural({ n: plan.rowCount, one: "row", many: "rows" })}, as of ${formatSnapshotTime({ iso: plan.snapshotAt })}` },
    { label: "Goes into", value: `A private area named "${plan.schema}". Nothing else in that database is touched.` },
    { label: "Replaces", value: plan.replaces === null ? "Nothing. This is the first copy." : `The earlier copy from ${formatSnapshotTime({ iso: plan.replaces })}` },
    { label: "Left out", value: `Logins and saved keys (${plural({ n: leftOutRows, one: "row", many: "rows" })}). Photos and files stay where they are.` },
  ];
  return {
    toolId: DATABASE_TRANSFER_RUN_TOOL_ID, errorCode: "DATABASE_TRANSFER",
    title: `Copy this site's data to ${where}?`,
    description: "Your site keeps running on its built-in storage. This only makes a copy.",
    details,
    ...(plan.replaces === null ? {} : { warning: `The earlier copy from ${formatSnapshotTime({ iso: plan.replaces })} is replaced once this copy has been checked.` }),
    confirmLabel: "Copy", cancelLabel: "Cancel",
  };
}
