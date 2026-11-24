import { expect, it, vi } from "vitest";
import { PAGE_CAPABILITIES, type PageDriver, type WebMcpToolRegistration } from '../../index.js';
import { registerAdminPageWebMcpTools } from '../admin-page-tools.js';

/** Host approval-table double: reads, edits and navigation run directly; every click needs a card. */
const directPageAction = ({ capabilityId }: { capabilityId: string }) => capabilityId !== 'page.click';

function fixture() {
  const registrations: WebMcpToolRegistration[] = [];
  const driver: PageDriver = {
    findElements: async () => [], listPages: async () => [], describeField: async () => ({ type: "text" }),
    highlight: vi.fn(), scrollTo: vi.fn(), click: vi.fn(), fill: vi.fn(), selectOption: vi.fn(), navigate: vi.fn(),
  };
  const controller = new AbortController();
  const requestPageAction = vi.fn().mockResolvedValue({ clicked: "post-delete-confirm" });
  registerAdminPageWebMcpTools({ driver, signal: controller.signal, directPageAction, isEnabled: () => true, onError: vi.fn() }, {
    requestPageAction,
    modelContext: { registerTool: async ({ tool }) => { registrations.push(tool as WebMcpToolRegistration); } } });
  const tool = (name: string) => registrations.find(entry => entry.name === name)!;
  return { driver, requestPageAction, controller, tool };
}

it("checks the Jini schema before requesting a card and returns its exact correction schema", async () => {
  const f = fixture();
  const capability = PAGE_CAPABILITIES.find(entry => entry.id === "page.click")!;
  await expect(f.tool("page.click").execute({})).rejects.toThrow(`page.click: "handle" is required. Expected input: ${JSON.stringify(capability.inputSchema)}`);
  expect(f.requestPageAction).not.toHaveBeenCalled();
  expect(f.driver.click).not.toHaveBeenCalled();
  expect(await f.tool("page.click").execute({ handle: "post-delete-confirm" })).toEqual({ clicked: "post-delete-confirm" });
  expect(f.driver.click).not.toHaveBeenCalled();
});

it("returns the authenticated executor result once without creating a browser-local proposal", async () => {
  const f = fixture();
  expect(await f.tool("page.click").execute({ handle: "post-delete-confirm" })).toEqual({ clicked: "post-delete-confirm" });
  expect(f.requestPageAction).toHaveBeenCalledExactlyOnceWith({ capabilityId: "page.click", input: { handle: "post-delete-confirm" }, signal: f.controller.signal });
  expect(f.driver.click).not.toHaveBeenCalled();
});

it("does not expose captured request input through the result returned to the agent", async () => {
  const f = fixture();
  const args = { handle: "post-delete-confirm" };
  const result = await f.tool("page.click").execute(args) as { clicked: string };
  result.clicked = "plugin-row-remove-confirm";
  args.handle = "changed-after-send";
  expect(f.requestPageAction.mock.calls[0]![0].input).toEqual({ handle: "post-delete-confirm" });
  expect(f.driver.click).not.toHaveBeenCalled();
});
