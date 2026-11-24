import { describe, expect, it } from "vitest";

import type { ToolExecutionContext } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import { InMemoryWorkspaceRepo } from "../../repo.memory.js";
import type { WorkspaceRecord } from "../../create.js";
import { contributeWorkspaceTools } from "../tool-registrations.js";

/**
 * @file The site contributor seam for workspace tools: metadata bound to every wired tool,
 * model-facing domain errors, and version guidance naming the host's published read tool.
 */

const SEED: WorkspaceRecord = { id: "ws", name: "Site", slug: "site", createdAt: "now", version: 1 };
const allow: AuthorizeFn = async () => ({ allowed: true, reason: "matched" });
const ctx = (input: unknown) => ({ input, principal: { id: "owner" }, signal: new AbortController().signal } as ToolExecutionContext);

function build({ workspaceId = "ws", rows = [SEED] }: { workspaceId?: string; rows?: WorkspaceRecord[] } = {}) {
  const workspaceRepo = new InMemoryWorkspaceRepo({}, { initialRows: rows });
  const registrations = contributeWorkspaceTools({ readToolId: "host_read.workspace" }).build({ authorize: allow, workspaceId, workspaceRepo });
  const tool = (id: string) => {
    const found = registrations.find((registration) => registration.descriptor.id === id);
    if (!found) throw new Error(`${id} is not wired`);
    return found;
  };
  return { registrations, tool };
}

describe("contributeWorkspaceTools", () => {
  it("contributes the workspace domain: two reads and the rename, with list risk classified", () => {
    const contributor = contributeWorkspaceTools({ readToolId: "host_read.workspace" });
    expect(contributor.domain).toBe("workspace");
    expect(contributor.risk.get("workspace_list")).toBe("none");
    expect(build().registrations.map((registration) => registration.descriptor.id)).toEqual(["workspace_get", "workspace_update", "workspace_list"]);
  });

  it("lists the served workspace and reads it by its own id", async () => {
    const { tool } = build();
    expect(await tool("workspace_list").handler(ctx({}))).toEqual({ workspaces: [SEED] });
    expect(await tool("workspace_get").handler(ctx({ workspaceId: "ws" }))).toEqual({ workspace: SEED });
  });

  it("publishes the missing current workspace as its safe WORKSPACE_NOT_FOUND refusal", async () => {
    const { tool } = build({ workspaceId: "missing" });
    await expect(tool("workspace_list").handler(ctx({}))).rejects.toThrow("WORKSPACE_NOT_FOUND: workspace 'missing' was not found");
  });

  it("names the host's published read tool in version-conflict guidance", async () => {
    const { tool } = build();
    await expect(tool("workspace_update").handler(ctx({ expectedVersion: 0, name: "Renamed" }))).rejects.toThrow(/Call host_read\.workspace again/);
  });
});
