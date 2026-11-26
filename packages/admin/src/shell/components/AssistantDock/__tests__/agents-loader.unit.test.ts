import { expect, it, vi } from "vitest";
import { fetchAgents } from "../hooks/agents-inventory.hooks.js";

it("rejects an empty restart inventory instead of publishing a completed catalog", async () => {
  const request = vi.fn().mockResolvedValue({ agents: [] });
  await expect(fetchAgents({ request, ApiError: vi.fn(), agentsUrl: "/agents", fetchTimeoutMs: 60_000 })).rejects.toThrow("answered with no agents");
  expect(request).toHaveBeenCalledTimes(1);
});
