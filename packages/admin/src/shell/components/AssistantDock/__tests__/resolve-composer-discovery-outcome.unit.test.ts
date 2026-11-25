import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveComposerDiscoveryOutcome as resolveWithDeps, type ResolveComposerDiscoveryOutcomeDeps } from "../hooks/resolve-composer-discovery-outcome.js";
import { projectComposerCapabilities } from "../../../../screens/plugins/composer-capabilities.js";
import type { ComposerHostBinding, ComposerCapability as TovuComposerCapability } from "../../../../screens/plugins/composer-capabilities.js";
import type { ComposerDiscoverySelection } from "../../../../react/kit.js";

/**
 * @file Direct, DI-only coverage for `resolveComposerDiscoveryOutcome` — debate 2's ("Composer
 * slash commands") host-side selection resolver. Every dependency (`capabilities`, `navigate`,
 * `callAllowlistedTool`) is injected, so both `ComposerHostBinding` kinds — including
 * `'allowlisted-tool-call'`, unreachable through any capability in today's bundled catalog — are
 * provable without rendering `AssistantDock` or mocking `@jini-ai/chat/react`.
 */

/** The host half the function now takes by injection: the client-local `/mcp` route and a skill-draft loader. */
const hostDeps = {
  resolveRoute: ({ itemId }: { itemId: string }) => (itemId === "mcp:settings" ? "/settings?tab=external-mcp" : null),
  loadSkillDraft: async ({ toolId }: { toolId: string }) => `guidance for ${toolId}`,
};
type CallerDeps = Omit<ResolveComposerDiscoveryOutcomeDeps, keyof typeof hostDeps> & Partial<Pick<ResolveComposerDiscoveryOutcomeDeps, keyof typeof hostDeps>>;
const resolveComposerDiscoveryOutcome_ = (selected: ComposerDiscoverySelection, deps: CallerDeps) =>
  resolveWithDeps(selected, { ...hostDeps, ...deps });

function selection(itemId: string, argument?: string | null): ComposerDiscoverySelection {
  return { item: { id: itemId, label: itemId }, source: "slash", ...(argument === undefined ? {} : { argument }) };
}

async function projectionWith(capabilities: readonly TovuComposerCapability[]) {
  return projectComposerCapabilities({ sources: [{ id: "test", list: async () => capabilities }] });
}

describe("resolveComposerDiscoveryOutcome", () => {
  it("navigates for the existing client-local /mcp route and clears no draft (returns void)", async () => {
    const navigate = vi.fn();
    const callAllowlistedTool = vi.fn();
    const capabilities = await projectionWith([]);

    const outcome = await resolveComposerDiscoveryOutcome_(selection("mcp:settings"), {
      capabilities,
      navigate,
      callAllowlistedTool,
    });

    expect(navigate).toHaveBeenCalledWith("/settings?tab=external-mcp");
    expect(outcome).toBeUndefined();
    expect(callAllowlistedTool).not.toHaveBeenCalled();
  });

  it("resolves a compose-text binding into a draft-replacing outcome, without calling the tool endpoint", async () => {
    const resolve = ({ argument }: { argument: string | null | undefined }): ComposerHostBinding => ({
      kind: "compose-text",
      text: `Search the web for: ${argument}`,
    });
    const capabilities = await projectionWith([
      { groupId: "search", groupLabel: "Search", item: { id: "search:web", label: "/search" }, resolve },
    ]);
    const callAllowlistedTool = vi.fn();

    const outcome = await resolveComposerDiscoveryOutcome_(selection("search:web", "aria listbox"), {
      capabilities,
      navigate: vi.fn(),
      callAllowlistedTool,
    });

    expect(outcome).toEqual({ draft: "Search the web for: aria listbox" });
    expect(callAllowlistedTool).not.toHaveBeenCalled();
  });

  it("resolves an allowlisted-tool-call binding by POSTing through the injected caller, then clears the draft", async () => {
    const resolve = (): ComposerHostBinding => ({
      kind: "allowlisted-tool-call",
      toolName: "content_post_delete",
      params: { postId: "42" },
    });
    const capabilities = await projectionWith([
      { groupId: "danger", groupLabel: "Danger", item: { id: "danger:delete", label: "/delete" }, resolve },
    ]);
    const callAllowlistedTool = vi.fn().mockResolvedValue({ ok: true });

    const outcome = await resolveComposerDiscoveryOutcome_(selection("danger:delete", ""), {
      capabilities,
      navigate: vi.fn(),
      callAllowlistedTool,
    });

    expect(callAllowlistedTool).toHaveBeenCalledWith({
      name: "content_post_delete",
      arguments: { postId: "42" },
    });
    expect(outcome).toEqual({ draft: "" });
  });

  it("propagates an allowlist rejection (e.g. TOOL_NOT_ALLOWLISTED) rather than swallowing it", async () => {
    const resolve = (): ComposerHostBinding => ({
      kind: "allowlisted-tool-call",
      toolName: "search_web",
      params: {},
    });
    const capabilities = await projectionWith([
      { groupId: "search", groupLabel: "Search", item: { id: "search:web", label: "/search" }, resolve },
    ]);
    const rejection = new Error("'search_web' is not an MCP-UI-redeemable tool");
    const callAllowlistedTool = vi.fn().mockRejectedValue(rejection);

    await expect(
      resolveComposerDiscoveryOutcome_(selection("search:web", "cats"), {
        capabilities,
        navigate: vi.fn(),
        callAllowlistedTool,
      }),
    ).rejects.toThrow(rejection);
  });

  it("does nothing for a selection whose item id has no route and no projected capability", async () => {
    const capabilities = await projectionWith([]);
    const navigate = vi.fn();
    const callAllowlistedTool = vi.fn();

    const outcome = await resolveComposerDiscoveryOutcome_(selection("unknown:item"), {
      capabilities,
      navigate,
      callAllowlistedTool,
    });

    expect(outcome).toBeUndefined();
    expect(navigate).not.toHaveBeenCalled();
    expect(callAllowlistedTool).not.toHaveBeenCalled();
  });

  it("does nothing for a projected capability that declares no resolve (macro-only item)", async () => {
    const capabilities = await projectionWith([
      { groupId: "plugins", groupLabel: "Plugins", item: { id: "regular-plugin:word-count", label: "Word Count", insertText: "Word Count plugin" } },
    ]);

    const outcome = await resolveComposerDiscoveryOutcome_(selection("regular-plugin:word-count"), {
      capabilities,
      navigate: vi.fn(),
      callAllowlistedTool: vi.fn(),
    });

    expect(outcome).toBeUndefined();
  });

  it("pins a pluginRefId capability via addPluginRef and clears the draft", async () => {
    const capabilities = await projectionWith([
      {
        groupId: "agent-plugins",
        groupLabel: "Agent Plugins",
        item: { id: "agent-plugin:ui-ux-design", label: "UI/UX Design (Agent Plugin)" },
        pluginRefId: "ui-ux-design",
      },
    ]);
    const addPluginRef = vi.fn();

    const outcome = await resolveComposerDiscoveryOutcome_(selection("agent-plugin:ui-ux-design"), {
      capabilities,
      navigate: vi.fn(),
      callAllowlistedTool: vi.fn(),
      addPluginRef,
    });

    expect(addPluginRef).toHaveBeenCalledWith("ui-ux-design");
    // `{ draft: "" }`, not undefined: a command-bearing slash selection (e.g. `/ui-ux-design`)
    // never gets its own draft-clear from Composer.tsx's insertText path (see
    // `resolveComposerDiscoveryOutcome`'s own doc on this branch), so the host must clear it.
    expect(outcome).toEqual({ draft: "" });
  });

  it("does not call callAllowlistedTool or navigate when pinning a pluginRefId capability", async () => {
    const capabilities = await projectionWith([
      {
        groupId: "agent-plugins",
        groupLabel: "Agent Plugins",
        item: { id: "agent-plugin:ui-ux-design", label: "UI/UX Design (Agent Plugin)" },
        pluginRefId: "ui-ux-design",
      },
    ]);
    const navigate = vi.fn();
    const callAllowlistedTool = vi.fn();

    await resolveComposerDiscoveryOutcome_(selection("agent-plugin:ui-ux-design"), {
      capabilities,
      navigate,
      callAllowlistedTool,
      addPluginRef: vi.fn(),
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(callAllowlistedTool).not.toHaveBeenCalled();
  });

  it("does not throw when addPluginRef is omitted for a pluginRefId capability — a documented no-op", async () => {
    const capabilities = await projectionWith([
      {
        groupId: "agent-plugins",
        groupLabel: "Agent Plugins",
        item: { id: "agent-plugin:ui-ux-design", label: "UI/UX Design (Agent Plugin)" },
        pluginRefId: "ui-ux-design",
      },
    ]);

    const outcome = await resolveComposerDiscoveryOutcome_(selection("agent-plugin:ui-ux-design"), {
      capabilities,
      navigate: vi.fn(),
      callAllowlistedTool: vi.fn(),
    });

    // Still clears the draft even when there is no addPluginRef to call — the draft clear is not
    // conditioned on the pin having anywhere to go.
    expect(outcome).toEqual({ draft: "" });
  });
});


afterEach(() => vi.unstubAllGlobals());
it("selecting an installed skill pins exact guidance for the run without pasting it", async () => {
  // The guidance text is the host loader's product; this function pins exactly what the injected loader returns.
  const loadSkillDraft = vi.fn(async ({ toolId }: { toolId: string }) => `guidance for ${toolId}`);
  const capabilities = await projectionWith([{ groupId: "installed-skills", groupLabel: "Skills", item: { id: "installed-skill:skill_incident_response", label: "incident-response" }, resolve: () => ({ kind: "installed-skill", toolId: "skill_incident_response" }) }]);
  const addSkill = vi.fn();
  expect(await resolveComposerDiscoveryOutcome_(selection("installed-skill:skill_incident_response"), { capabilities, navigate: vi.fn(), callAllowlistedTool: vi.fn(), addSkill, loadSkillDraft })).toEqual({ draft: "" });
  expect(loadSkillDraft).toHaveBeenCalledExactlyOnceWith({ toolId: "skill_incident_response" });
  expect(addSkill).toHaveBeenCalledExactlyOnceWith({ toolId: "skill_incident_response", name: "incident-response", guidance: "guidance for skill_incident_response" });
});


it("a runtime with no tools receives no skill guidance", async () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  const capabilities = await projectionWith([{ groupId: "skills", groupLabel: "Skills", item: { id: "installed-skill:test", label: "test" }, resolve: () => ({ kind: "installed-skill", toolId: "skill_test" }) }]);
  await expect(resolveComposerDiscoveryOutcome_(selection("installed-skill:test"), { capabilities, navigate: vi.fn(), callAllowlistedTool: vi.fn(), skillsAvailable: false })).rejects.toThrow("This runtime has no tools. Choose a runtime with tools to use skills.");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("regression: installed skill pins guidance and keeps user text as the title source", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ skillName: "ui-ux-design", guidance: "Keep focus visible.", bundledFiles: [{ kind: "references", root: "site", path: "skills/ui-ux-design/references/check.md" }] })));
  const capabilities = await projectionWith([{ groupId: "skills", groupLabel: "Skills", item: { id: "installed-skill:ui", label: "ui-ux-design", insertText: "" }, resolve: () => ({ kind: "installed-skill", toolId: "skill_ui_ux_design" }) }]);
  const addSkill = vi.fn();
  const outcome = await resolveComposerDiscoveryOutcome_({ item: capabilities.byItemId.get("installed-skill:ui")!.item, source: "plus" }, { capabilities, navigate: vi.fn(), callAllowlistedTool: vi.fn(), addSkill, readDraft: () => "Redesign the menu", loadSkillDraft: async () => "Keep focus visible." });
  expect(outcome).toEqual({ draft: "Redesign the menu" });
  expect(addSkill).toHaveBeenCalledWith(expect.objectContaining({ toolId: "skill_ui_ux_design", name: "ui-ux-design", guidance: expect.stringContaining("Keep focus visible.") }));
});

it("names a pinned skill without its menu's \" · Skill\" suffix", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ skillName: "deploy", guidance: "Ship it.", bundledFiles: [] })));
  const capabilities = await projectionWith([{ groupId: "skills", groupLabel: "Skills", item: { id: "installed-skill:deploy", label: "deploy · Skill" }, resolve: () => ({ kind: "installed-skill", toolId: "skill_deploy" }) }]);
  const addSkill = vi.fn();
  await resolveComposerDiscoveryOutcome_(selection("installed-skill:deploy"), { capabilities, navigate: vi.fn(), callAllowlistedTool: vi.fn(), addSkill });
  expect(addSkill).toHaveBeenCalledWith(expect.objectContaining({ toolId: "skill_deploy", name: "deploy" }));
});
