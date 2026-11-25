import { expect, it, vi } from "vitest";
import { requireChatDeleteGrant } from "../chat-delete-grant.js";
import type { ChatDeleteSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";

it("requires a fresh grant only for a selected delete tool", async () => {
  const surfaces = { surfaceExchanges: {} } as ChatDeleteSurfaceDeps;
  const missing = new Error("missing grant");
  const input = { surfaces, toolId: "delete", isDeleteTool: ({ toolId }: { toolId: string }) => toolId === "delete", missingGrant: () => missing };
  await expect(requireChatDeleteGrant({ ...input, toolId: "read" })).resolves.toBeUndefined();
  await expect(requireChatDeleteGrant(input)).rejects.toBe(missing);
  const read = vi.fn(async () => {});
  surfaces.assertChatDeleteAllowed = read;
  await requireChatDeleteGrant({ ...input, principalId: "person" });
  await requireChatDeleteGrant(input);
  expect(read.mock.calls).toEqual([[{ toolId: "delete", principalId: "person" }], [{ toolId: "delete" }]]);
});
