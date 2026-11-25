import { expect, it, vi } from "vitest";
import { indexCatalogById, withSchemaOnRejection } from "@jini-ai/core";
import type { MediaImportRefusalPorts } from "@jini-ai/core/contracts/site/media-tool-ports";
import { buildMediaImportAgentToolCatalog } from "../agent-tools.js";
import { isImportShapeRejection, withCallerSafeEgressRefusal } from "../tool-registrations.js";

it("only the safe error reaches schema decoration; ordinary transport errors keep their identity", async () => {
  const original = new Error("internal.example resolved to 10.0.4.7");
  const safe = new Error("The requested host is refused");
  const log = vi.fn();
  const refusals: MediaImportRefusalPorts = {
    isEgressRefusal: ({ error }) => error === original || error === safe,
    describeEgressRefusal: ({ error }) => error === original ? { logMessage: original.message, callerSafeError: safe } : undefined,
    logEgressRefusal: ({ line }) => log(line), isPathRefusal: () => false,
  };
  const catalog = indexCatalogById({ catalog: buildMediaImportAgentToolCatalog({ fsRootIds: ["site"], fsFolderReadRecovery: "Pick a folder.", mediaAssetReadToolId: "read_asset" }) });
  const invoke = (error: Error) => withSchemaOnRejection({
    toolId: "media_import_from_url", catalog, isShapeRejection: ({ error }) => isImportShapeRejection({ error, refusals }),
    fn: () => withCallerSafeEgressRefusal({ refusals, work: async () => { throw error; } }),
  });
  await expect(invoke(original)).rejects.toThrow(safe.message);
  await expect(invoke(original)).rejects.not.toThrow(/10\.0\.4\.7/);
  await expect(withCallerSafeEgressRefusal({ refusals, work: async () => { throw original; } })).rejects.toBe(safe);
  expect(safe).not.toHaveProperty("cause");
  expect(log).toHaveBeenCalledWith("[media-import] media_import_from_url egress refused: internal.example resolved to 10.0.4.7");
  const transport = new Error("socket failed on 10.0.4.7");
  await expect(invoke(transport)).rejects.toBe(transport);
});
