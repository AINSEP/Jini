import { describe, expect, it, vi } from "vitest";
import type { CapabilityDef } from "@jini-ai/core/contracts/capabilities";
import { registerAdminPageWebMcpTools, type AdminPageToolCollaborators, type AdminPageToolRegistration } from "../admin-page-tools.js";

/**
 * @file The adapter's own contract with every collaborator injected as a double: which calls run
 * directly, which go to the host's confirmation channel, and how the injected defaults (`isEnabled`,
 * `onError`, `modelContext`) are used. The host's real policy table and `@jini-ai/agentic` wiring are
 * exercised by the host's own composition tests (Tovu `features/webmcp/__tests__/admin-page-*.unit.test.ts`).
 */

type Registration = AdminPageToolRegistration & { readonly execute: (args: Record<string, unknown>) => Promise<unknown> };
const capability = (id: string): CapabilityDef => ({ id, description: id, inputSchema: { type: "object", properties: {} }, risk: "low", surface: "page" } as unknown as CapabilityDef);

function fixture(overrides: Partial<AdminPageToolCollaborators<string>> = {}) {
  const tools: Registration[] = [];
  const executePageCapability = vi.fn(async ({ capabilityId }: { driver: string; capabilityId: string }) => ({ ran: capabilityId }));
  const collaborators: AdminPageToolCollaborators<string> = {
    pageCapabilities: [capability("page.fill"), capability("page.click")],
    executePageCapability,
    toWebMcpTool: ({ capability: c, execute }) => ({ name: c.id, execute: (args) => execute({ id: c.id, args }) }),
    getAgentModelContext: () => ({ registerTool: ({ tool }) => { tools.push(tool as Registration); } }),
    directPageAction: ({ capabilityId }) => capabilityId === "page.fill",
    isBrowserAgentEnabled: () => true,
    reportRegistrationError: vi.fn(),
    ...overrides,
  };
  const run = (name: string) => tools.find((tool) => tool.name === name)!.execute({ handle: "x" });
  return { tools, collaborators, executePageCapability, run };
}

describe("registerAdminPageWebMcpTools", () => {
  it("runs direct actions through the injected executor and sends the rest to the host's confirmation channel", async () => {
    const f = fixture();
    const requestPageAction = vi.fn().mockResolvedValue({ executed: false, reason: "declined" });
    registerAdminPageWebMcpTools({ ...f.collaborators, driver: "driver", signal: new AbortController().signal }, { requestPageAction });
    expect(f.tools.map((tool) => tool.name)).toEqual(["page.fill", "page.click"]);
    expect(await f.run("page.fill")).toEqual({ ran: "page.fill" });
    expect(f.executePageCapability).toHaveBeenCalledExactlyOnceWith({ driver: "driver", capabilityId: "page.fill", input: { handle: "x" } });
    expect(await f.run("page.click")).toEqual({ executed: false, reason: "declined" });
    expect(requestPageAction).toHaveBeenCalledTimes(1);
    expect(f.executePageCapability).toHaveBeenCalledTimes(1);
  });

  it("refuses a confirmed action when the host gave no confirmation channel", async () => {
    const f = fixture();
    registerAdminPageWebMcpTools({ ...f.collaborators, driver: "driver", signal: new AbortController().signal });
    await expect(f.run("page.click")).rejects.toThrow("This page action requires an authenticated chat confirmation channel");
  });

  it("registers nothing while the injected browser-agent preference is off", () => {
    const f = fixture({ isBrowserAgentEnabled: () => false });
    registerAdminPageWebMcpTools({ ...f.collaborators, driver: "driver", signal: new AbortController().signal });
    expect(f.tools).toEqual([]);
  });

  it("reports a failed registration through the injected reporter by default", () => {
    const error = new Error("boom");
    const f = fixture({ getAgentModelContext: () => ({ registerTool: () => { throw error; } }) });
    registerAdminPageWebMcpTools({ ...f.collaborators, driver: "driver", signal: new AbortController().signal });
    expect(f.collaborators.reportRegistrationError).toHaveBeenCalledWith({ name: "page.fill", error });
    expect(f.collaborators.reportRegistrationError).toHaveBeenCalledTimes(2);
  });
});
