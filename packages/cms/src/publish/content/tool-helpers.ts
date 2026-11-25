import { ToolInputError, type DerivedRiskByToolId, type AgentToolSideEffect } from "@jini-ai/core";
import { PUBLISH_CONTENT_PUBLISH_TOOL_ID, PUBLISH_BACKSTOP_GAPS_TOOL_ID, PUBLISH_CONTENT_STATUS_TOOL_ID, PUBLISH_CONTENT_PLAN_PULL_TOOL_ID, PUBLISH_CONTENT_EXECUTE_PULL_TOOL_ID, PUBLISH_CONTENT_CONNECT_TOOL_ID } from "./agent-tools.js";
import { entityKey, type PublishContentReport } from "./plan-rows.js";

export const publishContentDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // External write: uploads/stages on live and confirms/executes its gateway, applying durable
  // remote content. The registry's write classification is mutates-durable-state (no separate
  // external-write enum); this must never be marked read-only or token-only.
  [PUBLISH_CONTENT_PUBLISH_TOOL_ID, "mutates-durable-state"],
  // -> a read-only projection of source audit events; no bundle, confirmation or writes.
  [PUBLISH_BACKSTOP_GAPS_TOOL_ID, "none"],
  // -> one peer-table read, one repo-config read. Writes nothing, contacts nothing.
  [PUBLISH_CONTENT_STATUS_TOOL_ID, "none"],
  // -> pullAndStageFromPeer stores blobs and a 24-hour staged row; gateway.plan reads;
  //    the planned run row retains the source label. These are durable writes, even with a TTL.
  [PUBLISH_CONTENT_PLAN_PULL_TOOL_ID, "mutates-durable-state"],
  // -> human-confirmed gateway.confirm mints a token; gateway.execute captures a restore point
  //    and applies through the existing import hooks/apply port.
  [PUBLISH_CONTENT_EXECUTE_PULL_TOOL_ID, "mutates-durable-state"],
  // -> connectDestination(): one round trip to the destination, then a write to committed config
  //    and one row in this workspace's destination list.
  [PUBLISH_CONTENT_CONNECT_TOOL_ID, "mutates-durable-state"],
]);

/** Matches a bare identifier-shaped token — `PEER_NOT_FOUND`, `publish_trust_export_not_wired`,
 *  `EGRESS_REFUSED`. Anchored on word boundaries so ordinary prose and a capitalised site name are
 *  untouched. */
const MACHINE_TOKEN = /\b(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[a-z0-9]+(?:_[a-z0-9]+)+)\b/;

/**
 * Returns `text` only if a person could read it, and `fallback` otherwise.
 *
 * Several errors these handlers catch carry messages that were written for a person — and several
 * carry, or interpolate, a machine code. Review cannot keep that straight for every future error
 * added upstream, so the sentence a person sees passes through one filter that can. The filter is
 * deliberately blunt: a message with an underscore-joined identifier anywhere in it is discarded
 * whole rather than patched, because a half-scrubbed sentence reads worse than the plain one.
 *
 * @complexity O(n) in the message length.
 */
export function plainSentence({ text, fallback }: { text: string; fallback: string }, _optional = {}): string {
  const trimmed = text.trim();
  if (trimmed.length === 0 || MACHINE_TOKEN.test(trimmed)) return fallback;
  return trimmed;
}

/** A refused planner result is a failure, never an empty successful plan. O(1). */
export function acceptedPullReport({ report }: { report: PublishContentReport }, _optional = {}): PublishContentReport {
  if (report.refused) throw new ToolInputError({ message: report.refusalReason ?? "The live content cannot be imported here." });
  return report;
}

/** Stable counts for plan, dialog and apply. Conflicts are returned separately for selection.
 * @complexity O(e) time and space for e report rows, including the temporary filtered arrays. */
export function pullCounts({ report }: { report: PublishContentReport }, _optional = {}): { create: number; update: number; unchanged: number; blocked: number } {
  return {
    create: report.rows.filter(row => row.outcome === "created").length,
    update: report.rows.filter(row => row.outcome === "applied" || row.outcome === "forced").length,
    unchanged: report.rows.filter(row => row.outcome === "unchanged").length,
    blocked: report.rows.filter(row => row.outcome === "blocked").length,
  };
}
/** Display label, falling back to the stable entity key when the imported entity has no title. */
export function pullTitle({ row }: { row: PublishContentReport["rows"][number] }, _optional = {}): string {
  return row.entityLabel ?? entityKey({ entityType: row.entityType, entityId: row.entityId });
}
/** Requires the staged bundle identifier; rejects malformed input with a model-readable error. */
export function requiredPullBundleId({ value }: { value: unknown }, _optional = {}): string {
  if (typeof value !== "string" || value.trim() === "") throw new ToolInputError({ message: "'bundleId' must be a non-empty string." });
  return value;
}
/** Snapshot a bounded selection before drawing the confirmation card. O(k), at most 1000 keys. */
export function pullOverwriteKeys({ value }: { value: unknown }, _optional = {}): ReadonlySet<string> {
  if (value === undefined) return new Set();
  if (!Array.isArray(value) || value.length > 1000 || !value.every(key => typeof key === "string" && key.trim() !== "")) {
    throw new ToolInputError({ message: "'overwriteEntityKeys' must be an array of at most 1000 non-empty strings." });
  }
  return new Set(value as string[]);
}

