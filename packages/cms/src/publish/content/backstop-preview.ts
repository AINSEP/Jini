import { createHash } from "node:crypto";
import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";
import type { BackstopPorts, RawRowSnapshot } from "../transfer/index.js";
import type { PackedEntity } from "../transfer/index.js";
import type { RawBackstopPolicy } from "./backstop-refusal.js";

export interface BackstopPreview {
  readonly entityType: string;
  readonly entityId: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly unavailableReason: string | null;
}

function safeValues(
  { row, workspaceId, policy }: { row: RawRowSnapshot; workspaceId: string; policy: RawBackstopPolicy },
  _optional = {},
): string | null {
  const { checkRawTable, checkRawValues } = policy;
  const tableReason = checkRawTable({ table: row.table, columns: [...row.columns.map((column) => column.name), ...Object.keys(row.values)] });
  if (tableReason !== null) return tableReason;
  if (Object.hasOwn(row.values, "workspace_id") && row.values.workspace_id !== workspaceId) return "This row belongs to a different workspace.";
  return checkRawValues({
      table: row.table, values: Object.fromEntries(Object.entries(row.values).map(([name, value]) => [name,
        typeof value === "object" && value !== null ? Buffer.from(value.blobBase64, "base64").toString("utf8") : value]))
    });
}

/** Only called after import-plan authorization. Preview re-runs the immutable policy on LIVE
 * values too: a safe source must never be used to read a newly private live column or workspace.
 * File values are checksum/size/mode, never arbitrary file text or private absolute paths. */
export async function buildBackstopPreview(
  { entities, backstop, workspaceId, policy, warn }: {
    entities: readonly PackedEntity[];
    backstop: BackstopPorts;
    workspaceId: string;
    /** Host-owned immutable table/file/value rules, injected so this module carries no host tables. */
    policy: RawBackstopPolicy;
    /** Host log sink; receives the untagged message so the host owns its log formatting. */
    warn: (args: { message: string; detail: unknown }) => void;
  },
  _optional: Record<string, never> = {},
): Promise<readonly BackstopPreview[]> {
  const previews: BackstopPreview[] = [];
  for (const entity of entities) {
    if (entity.entityType !== "raw-row" && entity.entityType !== "raw-file") continue;
    const preview: BackstopPreview = { entityType: entity.entityType, entityId: entity.id, before: null, after: null, unavailableReason: null };
    try {
      previews.push(entity.entityType === "raw-row"
        ? await previewRow({ entity, backstop, workspaceId, preview, policy })
        : await previewFile({ entity, backstop, preview, policy }));
    } catch (error) {
      warn({ message: "backstop values could not be inspected; preview remains unavailable", detail: describeErrorForLog({ err: error }) });
      previews.push({ ...preview, unavailableReason: "These values could not be inspected safely. Check again before sending." });
    }
  }
  return previews;
}

async function previewRow(
  { entity, backstop, workspaceId, preview, policy }: { entity: PackedEntity; backstop: BackstopPorts; workspaceId: string; preview: BackstopPreview; policy: RawBackstopPolicy },
  _optional: Record<string, never> = {},
): Promise<BackstopPreview> {
  const incoming = entity.state as unknown as RawRowSnapshot;
  const denied = safeValues({ row: incoming, workspaceId, policy }) ??
    (backstop.coveredTables.some((table) => table.toLowerCase() === incoming.table.toLowerCase()) ? "This table already publishes normally." : null);
  if (denied) return { ...preview, unavailableReason: denied };
  if (!backstop.rows) return { ...preview, unavailableReason: "Live row values are not available." };
  const live = await backstop.rows.read({ table: incoming.table, pk: incoming.pk });
  const privateLive = live ? safeValues({ row: live, workspaceId, policy }) : null;
  return { ...preview, before: privateLive ? null : live?.values ?? null, after: incoming.values, unavailableReason: privateLive };
}

async function previewFile(
  { entity, backstop, preview, policy }: { entity: PackedEntity; backstop: BackstopPorts; preview: BackstopPreview; policy: RawBackstopPolicy },
  _optional: Record<string, never> = {},
): Promise<BackstopPreview> {
  const denied = policy.checkRawFilePath({ relPath: entity.id }) ??
    (backstop.coveredRoots.some((root) => entity.id.toLowerCase() === root.toLowerCase().replace(/\/$/, "") || entity.id.toLowerCase().startsWith(root.toLowerCase().replace(/\/$/, "") + "/")) ? "This file already publishes normally." : null) ??
    await backstop.files?.check({ relPath: entity.id });
  if (denied) return { ...preview, unavailableReason: denied };
  if (!backstop.files) return { ...preview, unavailableReason: "Live file values are not available." };
  const live = await backstop.files.read({ relPath: entity.id });
  const before = live ? { path: entity.id, sha256: createHash("sha256").update(live.bytes).digest("hex"), size: live.bytes.byteLength, mode: live.mode & 0o111 ? 0o755 : 0o644 } : null;
  const { path, sha256, size, mode } = entity.state;
  return { ...preview, before, after: { path, sha256, size, mode } };
}
