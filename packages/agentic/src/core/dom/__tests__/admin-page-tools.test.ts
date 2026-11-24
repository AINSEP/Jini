import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGE_CAPABILITIES, type PageDriver, type WebMcpToolRegistration } from '../../index.js';
import { registerAdminPageWebMcpTools, type RequestAdminPageAction } from '../admin-page-tools.js';
import type { AgentModelContextRegisterToolOptions, AgentModelContextToolRegistration } from '../model-context.js';

/** Host approval-table double: reads, edits and navigation run directly; every click needs a card. */
const directPageAction = ({ capabilityId }: { capabilityId: string }) => capabilityId !== 'page.click';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture(options: { isEnabled?: () => boolean; requestPageAction?: RequestAdminPageAction } = {}) {
  const tools: WebMcpToolRegistration[] = [];
  const registerTool = vi.fn(({ tool }: { tool: AgentModelContextToolRegistration }, _options?: AgentModelContextRegisterToolOptions) => {
    tools.push(tool as WebMcpToolRegistration); return Promise.resolve();
  });
  const driver: PageDriver = {
    findElements: vi.fn().mockResolvedValue([{ handle: "save", role: "button", label: "Save" }]),
    listPages: vi.fn().mockResolvedValue([{ id: "pages", label: "Pages" }]),
    describeField: vi.fn().mockResolvedValue({ type: "text", name: "title" }),
    highlight: vi.fn(), scrollTo: vi.fn(), click: vi.fn(), fill: vi.fn(), selectOption: vi.fn(), navigate: vi.fn(),
  };
  const controller = new AbortController();
  const requestPageAction = vi.fn(options.requestPageAction ?? (async () => ({ clicked: "save" })));
  const onError = vi.fn();
  registerAdminPageWebMcpTools({ driver, signal: controller.signal, directPageAction, isEnabled: options.isEnabled ?? (() => true), onError }, {
    modelContext: { registerTool }, requestPageAction });
  const tool = (name: string) => tools.find(entry => entry.name === name)!;
  return { tools, registerTool, driver, controller, requestPageAction, onError, tool };
}

describe("admin page WebMCP", () => {
  it("publishes only page capabilities, with no approval response tool or answer instructions", () => {
    const f = fixture();
    expect(f.tools.map(tool => tool.name)).toEqual(PAGE_CAPABILITIES.map(capability => capability.id));
    for (const tool of f.tools) {
      expect(tool.description).not.toContain("respond_page_approval");
      expect(tool.description).not.toContain("approval_required");
    }
  });

  it.each([{}, { handle: 42 }, { handle: false }, { handle: null }, { approved: true }, { approvalId: "old-proposal", approved: true }])(
    "rejects malformed click input before the confirmation request: %j", async args => {
      const f = fixture();
      await expect(f.tool("page.click").execute(args)).rejects.toThrow(/handle/);
      expect(f.requestPageAction).not.toHaveBeenCalled();
      expect(f.driver.click).not.toHaveBeenCalled();
    },
  );

  it.each(["disabled", "aborted"])("refuses stale protected requests when access is %s", async state => {
    let enabled = true;
    const f = fixture({ isEnabled: () => enabled });
    if (state === "disabled") enabled = false;
    else f.controller.abort();
    await expect(f.tool("page.click").execute({ handle: "save" })).rejects.toThrow("WebMCP admin access is disabled or closed");
    expect(f.requestPageAction).not.toHaveBeenCalled();
    expect(f.driver.click).not.toHaveBeenCalled();
  });

  it("does nothing when neither browser host exposes a model context", () => {
    const f = fixture();
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("navigator", undefined);
    expect(() => registerAdminPageWebMcpTools({ driver: f.driver, signal: f.controller.signal, directPageAction, isEnabled: () => true, onError: vi.fn() })).not.toThrow();
    expect(f.driver.findElements).not.toHaveBeenCalled();
  });

  it.each(["document", "navigator"])("discovers and registers native tools through %s.modelContext", async host => {
    const f = fixture();
    const tools: AgentModelContextToolRegistration[] = [];
    const registerTool = vi.fn(async (tool: AgentModelContextToolRegistration) => { tools.push(tool); });
    vi.stubGlobal("document", host === "document" ? { modelContext: { registerTool } } : undefined);
    vi.stubGlobal("navigator", host === "navigator" ? { modelContext: { registerTool } } : undefined);
    registerAdminPageWebMcpTools({ driver: f.driver, signal: f.controller.signal, directPageAction, isEnabled: () => true, onError: vi.fn() });
    expect(tools.map(tool => tool.name)).toEqual(PAGE_CAPABILITIES.map(capability => capability.id));
    expect(registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: "page.find_elements" }), { signal: f.controller.signal });
    expect(await tools.find(tool => tool.name === "page.find_elements")!.execute({})).toMatchObject({ elements: [{ handle: "save" }], pages: [{ id: "pages" }] });
  });

  it("reports every asynchronous registration failure through the injected host callback", async () => {
    const f = fixture();
    const failure = new Error("native registration unavailable");
    registerAdminPageWebMcpTools({ driver: f.driver, signal: f.controller.signal, directPageAction, isEnabled: () => true, onError: f.onError }, {
      modelContext: { registerTool: async () => { throw failure; } } });
    await Promise.resolve(); await Promise.resolve();
    expect(f.onError.mock.calls).toEqual(PAGE_CAPABILITIES.map(capability => [{ name: capability.id, error: failure }]));
  });

  it("asks the injected host approval table with the captured input before any local effect", async () => {
    const classify = vi.fn(() => true);
    const f = fixture();
    const tools: WebMcpToolRegistration[] = [];
    registerAdminPageWebMcpTools({ driver: f.driver, signal: f.controller.signal, directPageAction: classify, isEnabled: () => true, onError: f.onError }, {
      modelContext: { registerTool: async ({ tool }) => { tools.push(tool as WebMcpToolRegistration); } }, requestPageAction: f.requestPageAction });
    await tools.find(tool => tool.name === "page.click")!.execute({ handle: "save" });
    expect(classify).toHaveBeenCalledExactlyOnceWith({ capabilityId: "page.click", input: { handle: "save" } });
    expect(f.driver.click).toHaveBeenCalledExactlyOnceWith({ handle: "save" });
    expect(f.requestPageAction).not.toHaveBeenCalled();
  });

  it.each(["synchronous", "asynchronous"])("ignores %s registration failures after teardown", async kind => {
    const f = fixture();
    const failure = new Error("closed context");
    const registerTool = vi.fn(() => {
      if (kind === "synchronous") { f.controller.abort(); throw failure; }
      return Promise.reject(failure);
    });
    registerAdminPageWebMcpTools({ driver: f.driver, signal: f.controller.signal, directPageAction, isEnabled: () => true, onError: f.onError }, {
      modelContext: { registerTool } });
    f.controller.abort(); await Promise.resolve(); await Promise.resolve();
    expect(registerTool).toHaveBeenCalledTimes(PAGE_CAPABILITIES.length);
    expect(f.onError).not.toHaveBeenCalled();
  });

  it("rechecks access after the authenticated request returns", async () => {
    let enabled = true;
    const f = fixture({ isEnabled: () => enabled, requestPageAction: async () => { enabled = false; return { executed: false }; } });
    await expect(f.tool("page.click").execute({ handle: "save" })).rejects.toThrow("WebMCP admin access is disabled or closed");
    expect(f.controller.signal.aborted).toBe(false);
    expect(f.driver.click).not.toHaveBeenCalled();
  });

  it("publishes the whole Jini page manifest with an abort signal and read hints", async () => {
    const f = fixture();
    for (const [index, call] of f.registerTool.mock.calls.entries()) {
      expect(call[1]).toEqual({ signal: f.controller.signal });
      expect(f.tools[index]!.annotations?.readOnlyHint).toBe(PAGE_CAPABILITIES[index]!.risk === "read");
    }
    expect(await f.tool("page.find_elements").execute({})).toMatchObject({ elements: [{ handle: "save" }], pages: [{ id: "pages" }] });
    expect(f.requestPageAction).not.toHaveBeenCalled();
  });

  it("returns a human decline unchanged and never falls back to a local click", async () => {
    const declined = { executed: false, cancelled: true, reason: "declined" };
    const f = fixture({ requestPageAction: async () => declined });
    await expect(f.tool("page.click").execute({ handle: "save" })).resolves.toEqual(declined);
    expect(f.requestPageAction).toHaveBeenCalledExactlyOnceWith({ capabilityId: "page.click", input: { handle: "save" }, signal: f.controller.signal });
    expect(f.driver.click).not.toHaveBeenCalled();
  });

  it("refuses opaque effects without an authenticated chat confirmation channel", async () => {
    const f = fixture();
    const tools: WebMcpToolRegistration[] = [];
    registerAdminPageWebMcpTools({ driver: f.driver, signal: f.controller.signal, directPageAction, isEnabled: () => true, onError: vi.fn() }, {
      modelContext: { registerTool: async ({ tool }) => { tools.push(tool as WebMcpToolRegistration); } } });
    await expect(tools.find(tool => tool.name === "page.click")!.execute({ handle: "save" })).rejects.toThrow("authenticated chat confirmation channel");
    expect(f.driver.click).not.toHaveBeenCalled();
  });

  it("retains Jini navigation and credential-field refusals", async () => {
    const f = fixture();
    await expect(f.tool("page.navigate").execute({ page: "https://evil.example" })).rejects.toThrow(new Error('"https://evil.example" is not a published page. Available: pages (Pages)'));
    expect(f.driver.navigate).not.toHaveBeenCalled();
    vi.mocked(f.driver.describeField).mockResolvedValue({ type: "password", name: "password" });
    await expect(f.tool("page.fill").execute({ handle: "save", text: "secret" })).rejects.toThrow(new Error('refusing to fill "save": this field type can never be filled by an agent'));
    expect(f.driver.fill).not.toHaveBeenCalled();
    expect(f.requestPageAction).not.toHaveBeenCalled();
  });

  it("validates before confirmation and blocks stale reads after teardown", async () => {
    const f = fixture();
    await expect(f.tool("page.click").execute({})).rejects.toThrow(/handle/);
    expect(f.requestPageAction).not.toHaveBeenCalled();
    f.controller.abort();
    await expect(f.tool("page.find_elements").execute({})).rejects.toThrow(/disabled|closed/);
    expect(f.driver.findElements).not.toHaveBeenCalled();
  });

  it("passes teardown to an in-flight authenticated request and checks it after settlement", async () => {
    const f = fixture();
    f.requestPageAction.mockImplementationOnce(async ({ signal }) => { f.controller.abort(); expect(signal.aborted).toBe(true); return { executed: false }; });
    await expect(f.tool("page.click").execute({ handle: "save" })).rejects.toThrow(/disabled|closed/);
    expect(f.driver.click).not.toHaveBeenCalled();
  });

  it("handles synchronous and asynchronous registration failures without throwing", async () => {
    const f = fixture();
    const failure = new Error("registration failed");
    const registerTool = vi.fn().mockImplementationOnce(() => { throw failure; }).mockRejectedValue(failure);
    expect(() => registerAdminPageWebMcpTools({ driver: f.driver, signal: f.controller.signal, directPageAction, isEnabled: () => true, onError: f.onError }, {
      modelContext: { registerTool } })).not.toThrow();
    await Promise.resolve(); await Promise.resolve();
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ error: failure }));
  });

  it("skips registration when access is disabled or the registration lifetime ended", () => {
    const f = fixture(); f.registerTool.mockClear();
    registerAdminPageWebMcpTools({ driver: f.driver, signal: f.controller.signal, directPageAction, isEnabled: () => false, onError: vi.fn() }, { modelContext: { registerTool: f.registerTool } });
    expect(f.registerTool).not.toHaveBeenCalled();
    f.controller.abort();
    registerAdminPageWebMcpTools({ driver: f.driver, signal: f.controller.signal, directPageAction, isEnabled: () => true, onError: vi.fn() }, { modelContext: { registerTool: f.registerTool } });
    expect(f.registerTool).not.toHaveBeenCalled();
  });
});
