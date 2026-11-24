import { expect, it, vi } from "vitest";
import { PAGE_CAPABILITIES, type PageDriver, type WebMcpToolRegistration } from '../../index.js';
import { registerAdminPageWebMcpTools, type RequestAdminPageAction } from '../admin-page-tools.js';

/** Host approval-table double: reads, edits and navigation run directly; every click needs a card. */
const directPageAction = ({ capabilityId }: { capabilityId: string }) => capabilityId !== 'page.click';

function fixture(requestPageAction: RequestAdminPageAction = async () => ({ executed: false })) {
  const tools: WebMcpToolRegistration[] = [];
  const controller = new AbortController();
  const driver: PageDriver = {
    findElements: async () => [], listPages: async () => [], describeField: async () => ({ type: "text" }),
    highlight: vi.fn(), scrollTo: vi.fn(), click: vi.fn(), fill: vi.fn(), selectOption: vi.fn(), navigate: vi.fn(),
  };
  const request = vi.fn(requestPageAction);
  registerAdminPageWebMcpTools({ driver, signal: controller.signal, directPageAction, isEnabled: () => true, onError: vi.fn() }, {
    requestPageAction: request,
    modelContext: { registerTool: async ({ tool }) => { tools.push(tool as WebMcpToolRegistration); } } });
  const tool = (name: string) => tools.find(tool => tool.name === name)!;
  const click = () => tool("page.click").execute({ handle: "post-delete-confirm" });
  return { tools, driver, controller, tool, click, request };
}

it("waits on the authenticated card exchange without performing a local effect", async () => {
  let answer!: (value: unknown) => void;
  const f = fixture(() => new Promise(resolve => { answer = resolve; }));
  let settled = false;
  const waiting = f.click().then(result => { settled = true; return result; });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(f.request).toHaveBeenCalledExactlyOnceWith({ capabilityId: "page.click", input: { handle: "post-delete-confirm" }, signal: f.controller.signal });
  expect(f.driver.click).not.toHaveBeenCalled();
  answer({ clicked: "post-delete-confirm" });
  expect(await waiting).toEqual({ clicked: "post-delete-confirm" });
  expect(f.driver.click).not.toHaveBeenCalled();
});

it("cannot answer a pending card through any registered WebMCP capability", async () => {
  const f = fixture();
  await f.click();
  expect(f.tools.map(tool => tool.name)).toEqual(PAGE_CAPABILITIES.map(capability => capability.id));
  expect(f.tools.find(tool => tool.name === "admin.respond_page_approval")).toBeUndefined();
  expect(f.driver.click).not.toHaveBeenCalled();
});

it.each(["declined", "abandoned"])("returns a human %s outcome without clicking locally", async reason => {
  const result = { executed: false, reason };
  const f = fixture(async () => result);
  expect(await f.click()).toEqual(result);
  expect(f.driver.click).not.toHaveBeenCalled();
});

it("requires the server card exchange for feature-specific destructive confirmation buttons", async () => {
  const f = fixture();
  await f.tool("page.click").execute({ handle: "plugin-row-remove-confirm" });
  expect(f.request).toHaveBeenCalledExactlyOnceWith({ capabilityId: "page.click", input: { handle: "plugin-row-remove-confirm" }, signal: f.controller.signal });
  expect(f.driver.click).not.toHaveBeenCalled();
});

it("validates before asking and passes abort to the pending request", async () => {
  let interrupted = false;
  const f = fixture(({ signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => { interrupted = true; reject(new Error("Page action cancelled")); }, { once: true });
  }));
  const schema = PAGE_CAPABILITIES.find(capability => capability.id === "page.click")!.inputSchema;
  await expect(f.tool("page.click").execute({})).rejects.toThrow(`page.click: "handle" is required. Expected input: ${JSON.stringify(schema)}`);
  expect(f.request).not.toHaveBeenCalled();
  const waiting = f.click();
  f.controller.abort();
  await expect(waiting).rejects.toThrow("Page action cancelled");
  expect(interrupted).toBe(true);
  expect(f.driver.click).not.toHaveBeenCalled();
});

it("captures opaque action arguments before waiting so caller mutation cannot redirect the request", async () => {
  let answer!: (value: unknown) => void;
  const f = fixture(() => new Promise(resolve => { answer = resolve; }));
  const args = { handle: "post-delete-confirm" };
  const waiting = f.tool("page.click").execute(args);
  args.handle = "plugin-row-remove-confirm";
  expect(f.request.mock.calls[0]![0].input).toEqual({ handle: "post-delete-confirm" });
  answer({ clicked: "post-delete-confirm" });
  expect(await waiting).toEqual({ clicked: "post-delete-confirm" });
  expect(f.driver.click).not.toHaveBeenCalled();
});

it("propagates execution errors from the authenticated exchange without retrying locally", async () => {
  const f = fixture(async () => { throw new Error("Plugin source unavailable"); });
  await expect(f.click()).rejects.toThrow("Plugin source unavailable");
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.driver.click).not.toHaveBeenCalled();
});

it("does not treat a returned confirmed flag as permission to execute another local click", async () => {
  const f = fixture(async () => ({ confirmed: true }));
  expect(await f.click()).toEqual({ confirmed: true });
  expect(f.driver.click).not.toHaveBeenCalled();
});

it("retains credential and navigation guards on reviewed direct actions", async () => {
  const f = fixture();
  f.driver.describeField = async () => ({ type: "password", name: "password" });
  await expect(f.tool("page.fill").execute({ handle: "secret", text: "example" })).rejects.toThrow('refusing to fill "secret": this field type can never be filled by an agent');
  await expect(f.tool("page.navigate").execute({ page: "https://example.com" })).rejects.toThrow('"https://example.com" is not a published page. Available: (none)');
  expect(f.driver.fill).not.toHaveBeenCalled();
  expect(f.driver.navigate).not.toHaveBeenCalled();
  expect(f.request).not.toHaveBeenCalled();
});

it("never accepts typed yes or a legacy approval answer as page click input", async () => {
  const f = fixture();
  for (const input of [{ answer: "yes" }, { approvalId: "old", approved: true }, { confirmed: true }]) {
    await expect(f.tool("page.click").execute(input)).rejects.toThrow(/handle/);
  }
  expect(f.request).not.toHaveBeenCalled();
  expect(f.driver.click).not.toHaveBeenCalled();
});

it.each(["Authentication required", "Page request belongs to another tab", "Page request is expired"])(
  "keeps authenticated-channel refusal visible without a local fallback: %s", async message => {
    const f = fixture(async () => { throw new Error(message); });
    await expect(f.click()).rejects.toThrow(message);
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.driver.click).not.toHaveBeenCalled();
  },
);
