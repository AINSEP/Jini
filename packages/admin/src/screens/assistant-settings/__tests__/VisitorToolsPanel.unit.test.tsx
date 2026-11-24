// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "../../../__tests__/fetch-query-support.js";
import userEvent from "@testing-library/user-event";
import { InfoTip } from "@jini-ai/ui/admin-widgets";
import { describe, expect, it } from "vitest";

import { publishSettingsRefresh } from "../../../shell/lib/settings-refresh-bus.js";
import type { VisitorToolConfigureInput, VisitorToolsPort, VisitorToolsView, VisitorToolView } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";
import { VisitorToolsPanel, visitorToolDefaultLimitsText, type VisitorToolSegmentedProps } from "../VisitorToolsPanel.js";
import { parseLimitsDraft, useVisitorToolLimitsDraft, useVisitorTools, type VisitorToolsDependencies } from "../use-visitor-tools.hooks.js";

const VISITOR_TOOLS_NAMESPACE = "site.assistant";
const CONFLICT_CODE = "VISITOR_TOOLS_REVISION_CONFLICT";
/** Plays the host's API error: a message plus a machine code. */
class FakeApiError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}
/** Host rules as a host binds them: its namespace, its 409 code check and its error-to-copy rule. */
const DEPENDENCIES: Omit<VisitorToolsDependencies, "port"> = {
  namespace: VISITOR_TOOLS_NAMESPACE,
  isConflict: ({ error }) => error instanceof FakeApiError && error.code === CONFLICT_CODE,
  describeError: ({ error, fallback }) => (error instanceof Error ? error.message || fallback : fallback),
};
/** The host's segmented pill, reduced to its contract: one labelled radio per item sharing `name`. */
function Segmented({ name, items }: VisitorToolSegmentedProps) {
  return <div>{items.map(item => <label key={item.key}>
    <input type="radio" name={name} checked={!!item.checked} disabled={item.disabled} onChange={item.change} />
    <span>{item.label}</span>
  </label>)}</div>;
}
const BINDINGS = { useVisitorToolLimitsDraftHook: useVisitorToolLimitsDraft, InfoTip, Segmented };

const t = (key: string) => key;
const DEFAULTS = { perIpPerHour: 30, perSitePerDay: 1000 };

function tool(id: string, overrides: Partial<VisitorToolView> = {}): VisitorToolView {
  return { id, source: "builtin", sourceRevision: "r1", title: `Tool ${id}`, description: `Does ${id}.`, effect: "read",
    availability: { available: true }, mode: "auto", limits: { ...DEFAULTS }, ...overrides };
}
function view(overrides: Partial<VisitorToolsView> = {}): VisitorToolsView {
  return { revisionSeq: 7, defaults: { ...DEFAULTS }, callsPerTurn: 4, tools: [tool("list_posts"), tool("site_guide", { mode: "off" })], ...overrides };
}

/** Typed fake of the HTTP port: applies writes like the server (new revision each time). */
function fakePort(initial: VisitorToolsView = view()) {
  let current = initial;
  let nextFailure: unknown = null;
  let lists = 0;
  const writes: VisitorToolConfigureInput[] = [];
  const port: VisitorToolsPort = {
    list: async () => { lists++; return current; },
    configure: async (input) => {
      writes.push(input);
      if (nextFailure) { const failure = nextFailure; nextFailure = null; throw failure; }
      const ids = input.toolId === "site" ? current.tools.map(item => item.id) : [input.toolId];
      const { policyState: _repaired, ...settled } = current;
      current = { ...settled, revisionSeq: current.revisionSeq + 1,
        tools: current.tools.map(item => ids.includes(item.id)
          ? { ...item, mode: input.mode ?? item.mode, limits: { ...item.limits, ...input.limits } } : item) };
      return current;
    },
  };
  return { port, writes, lists: () => lists, failNext: (error: unknown) => { nextFailure = error; },
    changeElsewhere: (next: VisitorToolsView) => { current = next; } };
}

function mount(port: VisitorToolsPort) {
  return render(<VisitorToolsPanel t={t} {...BINDINGS} useVisitorToolsHook={(input) => useVisitorTools({ ...input, ...DEPENDENCIES, port })} />);
}
const row = (title: string) => screen.getByText(title).closest("li") as HTMLElement;

describe("VisitorToolsPanel", () => {
  it("announces loading until the tool catalog arrives", async () => {
    let deliver!: (next: VisitorToolsView) => void;
    const pending = new Promise<VisitorToolsView>(resolve => { deliver = resolve; });
    mount({ list: async () => pending, configure: async () => view() });
    expect(screen.getByRole("status").textContent).toBe("Loading visitor tools…");
    await act(async () => { deliver(view()); });
    expect(await screen.findByText("Tool list_posts")).toBeTruthy();
    expect(screen.queryByText("Loading visitor tools…")).toBeNull();
  });

  it("explains that Ask first waits for the visitor's own click in chat", async () => {
    mount(fakePort().port);
    await screen.findByText("Tool list_posts");
    const tip = screen.getByRole("button", { name: "About visitor tools" });
    await userEvent.click(tip);
    const descriptionId = tip.getAttribute("aria-describedby")!;
    expect(document.getElementById(descriptionId)?.textContent).toBe("Auto runs it. Ask first waits for the visitor to click Allow in chat before running. Off hides it.");
  });

  it("formats the budget hint with present or unavailable defaults", () => {
    expect(visitorToolDefaultLimitsText({ defaults: DEFAULTS, t })).toBe("Default: 30 per visitor/hour, 1000 per site/day.");
    expect(visitorToolDefaultLimitsText({ t })).toBe("Default:  per visitor/hour,  per site/day.");
  });

  it("lists each tool with its description and current mode, and uses no <select>", async () => {
    const { container } = mount(fakePort().port);
    expect(await screen.findByText("Tool list_posts")).toBeTruthy();
    expect(screen.getByText("Does list_posts.")).toBeTruthy();
    expect((within(row("Tool list_posts")).getByRole("radio", { name: "Auto" }) as HTMLInputElement).checked).toBe(true);
    expect((within(row("Tool site_guide")).getByRole("radio", { name: "Off" }) as HTMLInputElement).checked).toBe(true);
    expect(within(row("Tool list_posts")).getByRole("radiogroup", { name: "Tool list_posts" })).toBeTruthy();
    expect(container.querySelector("select")).toBeNull();
    // One source: no group heading.
    expect(screen.queryByRole("heading", { name: "Built-in" })).toBeNull();
  });

  it("a mode click sends one revisioned PUT and shows the server's answer", async () => {
    const fake = fakePort();
    mount(fake.port);
    await screen.findByText("Tool list_posts");
    await userEvent.click(within(row("Tool list_posts")).getByRole("radio", { name: "Ask first" }));
    await waitFor(() => expect(fake.writes).toEqual([{ toolId: "list_posts", mode: "ask", expectedRevisionSeq: 7 }]));
    await waitFor(() => expect((within(row("Tool list_posts")).getByRole("radio", { name: "Ask first" }) as HTMLInputElement).checked).toBe(true));
    // The next write uses the returned revision.
    await userEvent.click(within(row("Tool site_guide")).getByRole("radio", { name: "Auto" }));
    await waitFor(() => expect(fake.writes[1]).toEqual({ toolId: "site_guide", mode: "auto", expectedRevisionSeq: 8 }));
  });

  it("shows the saving tool and locks mode controls until the write returns", async () => {
    const fake = fakePort();
    let finish!: () => Promise<void>;
    mount({ ...fake.port, configure: input => new Promise(resolve => {
      finish = async () => { resolve(await fake.port.configure(input)); };
    }) });
    await screen.findByText("Tool list_posts");
    await userEvent.click(within(row("Tool list_posts")).getByRole("radio", { name: "Off" }));
    expect(row("Tool list_posts").getAttribute("aria-busy")).toBe("true");
    expect(within(row("Tool list_posts")).getByRole("button", { name: "Saving…" })).toBeTruthy();
    for (const radio of screen.getAllByRole("radio")) expect((radio as HTMLInputElement).disabled).toBe(true);
    await act(async () => { await finish(); });
    await waitFor(() => expect(row("Tool list_posts").hasAttribute("aria-busy")).toBe(false));
    expect((within(row("Tool list_posts")).getByRole("radio", { name: "Off" }) as HTMLInputElement).checked).toBe(true);
  });

  it("limits: typing, change and blur send nothing; only the Save click does (F2)", async () => {
    const fake = fakePort();
    mount(fake.port);
    await screen.findByText("Tool list_posts");
    const scope = within(row("Tool list_posts"));
    const perIp = scope.getByLabelText("Per visitor, per hour");
    fireEvent.change(perIp, { target: { value: "12" } });
    fireEvent.blur(perIp);
    fireEvent.keyDown(perIp, { key: "Enter" });
    await act(async () => { await Promise.resolve(); });
    expect(fake.writes).toEqual([]);
    await userEvent.click(scope.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.writes).toEqual([{ toolId: "list_posts", limits: { perIpPerHour: 12 }, expectedRevisionSeq: 7 }]));
    await waitFor(() => expect((scope.getByLabelText("Per visitor, per hour") as HTMLInputElement).value).toBe("12"));
    expect((scope.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("rejects zero and non-integers locally and keeps Save disabled", async () => {
    mount(fakePort().port);
    await screen.findByText("Tool list_posts");
    const scope = within(row("Tool list_posts"));
    for (const bad of ["0", "1.5", ""]) {
      fireEvent.change(scope.getByLabelText("Whole site, per day"), { target: { value: bad } });
      expect(scope.getByRole("alert").textContent).toBe("Use a whole number, 1 or more.");
      expect((scope.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("on a revision conflict it reloads, says so, and does not retry", async () => {
    const fake = fakePort();
    mount(fake.port);
    await screen.findByText("Tool list_posts");
    fake.changeElsewhere(view({ revisionSeq: 9, tools: [tool("list_posts", { mode: "off" }), tool("site_guide", { mode: "off" })] }));
    fake.failNext(new FakeApiError("stale", CONFLICT_CODE));
    await userEvent.click(within(row("Tool list_posts")).getByRole("radio", { name: "Ask first" }));
    expect((await screen.findByRole("status")).textContent).toBe("Changed somewhere else. Showing the latest — try again.");
    await waitFor(() => expect((within(row("Tool list_posts")).getByRole("radio", { name: "Off" }) as HTMLInputElement).checked).toBe(true));
    expect(fake.writes).toHaveLength(1);
  });

  it("shows other save failures as an alert and keeps server truth", async () => {
    const fake = fakePort();
    mount(fake.port);
    await screen.findByText("Tool list_posts");
    fake.failNext(new FakeApiError("visitor-tools.manage is required", "FORBIDDEN"));
    await userEvent.click(within(row("Tool list_posts")).getByRole("radio", { name: "Off" }));
    expect((await screen.findByRole("alert")).textContent).toBe("visitor-tools.manage is required");
    expect((within(row("Tool list_posts")).getByRole("radio", { name: "Auto" }) as HTMLInputElement).checked).toBe(true);
  });

  it("invalid policy: everything shows Off and locked; only the reset click repairs it", async () => {
    const fake = fakePort(view({ policyState: "invalid", tools: [tool("list_posts", { mode: "auto" })] }));
    mount(fake.port);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Saved tool settings can't be read, so every tool is Off.");
    const scope = within(row("Tool list_posts"));
    expect((scope.getByRole("radio", { name: "Off" }) as HTMLInputElement).checked).toBe(true);
    for (const name of ["Auto", "Ask first", "Off"]) expect((scope.getByRole("radio", { name }) as HTMLInputElement).disabled).toBe(true);
    expect((scope.getByLabelText("Per visitor, per hour") as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Turn all tools Off to reset" }));
    await waitFor(() => expect(fake.writes).toEqual([{ toolId: "site", mode: "off", expectedRevisionSeq: 7 }]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Turn all tools Off to reset" })).toBeNull());
    expect((scope.getByRole("radio", { name: "Auto" }) as HTMLInputElement).disabled).toBe(false);
  });

  it("an unavailable tool can only be switched Off, with its reason shown; sources get headings", async () => {
    const fake = fakePort(view({ tools: [tool("list_posts"), tool("gone", { source: "unavailable", mode: "ask", availability: { available: false, reason: "Plugin removed." } })] }));
    mount(fake.port);
    await screen.findByText("Plugin removed.");
    const scope = within(row("Tool gone"));
    expect((scope.getByRole("radio", { name: "Auto" }) as HTMLInputElement).disabled).toBe(true);
    expect((scope.getByRole("radio", { name: "Ask first" }) as HTMLInputElement).disabled).toBe(true);
    expect((scope.getByRole("radio", { name: "Off" }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole("heading", { name: "Built-in" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Unavailable" })).toBeTruthy();
  });

  it("keeps custom copy readable, with an availability fallback and distinct plugin/created groups", async () => {
    const customTitle = "Customer lookup";
    mount(fakePort(view({ tools: [
      tool("plugin_lookup", { source: "plugin", title: customTitle, description: "Looks up a public customer profile." }),
      tool("_", { source: "created", availability: { available: false } }),
    ] })).port);
    expect(await screen.findByText(customTitle)).toBeTruthy();
    expect(screen.getByText("Looks up a public customer profile.")).toBeTruthy();
    expect(screen.getByText("Not available right now.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "From plugins" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Created" })).toBeTruthy();
    expect((within(row("Tool _")).getByLabelText("Per visitor, per hour") as HTMLInputElement).disabled).toBe(true);
  });

  it("shows an empty line for an empty catalog and a retry on load failure", async () => {
    mount(fakePort(view({ tools: [] })).port);
    expect(await screen.findByText("No visitor tools yet.")).toBeTruthy();
  });

  it("load failure offers Retry", async () => {
    let fail = true;
    const port: VisitorToolsPort = { list: async () => { if (fail) throw new Error("down"); return view(); }, configure: async () => view() };
    mount(port);
    expect((await screen.findByRole("alert")).textContent).toContain("down");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Tool list_posts")).toBeTruthy();
  });

  it("refetches when the settings feed names the assistant namespace (chat writes)", async () => {
    const fake = fakePort();
    mount(fake.port);
    await screen.findByText("Tool list_posts");
    const before = fake.lists();
    fake.changeElsewhere(view({ revisionSeq: 11, tools: [tool("list_posts", { mode: "off" }), tool("site_guide", { mode: "off" })] }));
    act(() => publishSettingsRefresh(["unrelated.namespace"]));
    expect(fake.lists()).toBe(before);
    act(() => publishSettingsRefresh([VISITOR_TOOLS_NAMESPACE]));
    await waitFor(() => expect((within(row("Tool list_posts")).getByRole("radio", { name: "Off" }) as HTMLInputElement).checked).toBe(true));
  });
});

describe("parseLimitsDraft", () => {
  const current = { perIpPerHour: 30, perSitePerDay: 1000 };
  it("returns only changed dimensions", () => {
    expect(parseLimitsDraft({ draft: { perIpPerHour: "30", perSitePerDay: "1000" }, current })).toEqual({ error: false, patch: {} });
    expect(parseLimitsDraft({ draft: { perIpPerHour: " 5 ", perSitePerDay: "2000" }, current })).toEqual({ error: false, patch: { perIpPerHour: 5, perSitePerDay: 2000 } });
  });
  it("rejects zero, negatives, decimals, blanks and unsafe integers", () => {
    for (const bad of ["0", "-1", "1.5", "", "1e3", "99999999999999999999"]) {
      expect(parseLimitsDraft({ draft: { perIpPerHour: bad, perSitePerDay: "1" }, current })).toEqual({ error: true });
    }
  });
});
