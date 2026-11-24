import { describe, expect, it } from "vitest";
import type { AdminAgentPluginLifecycleDto } from "@jini-ai/core/contracts/site/cms-agent-plugins";

import { agentPluginLifecycleFields, type AgentPluginLifecycleFields, type AgentPluginRowCandidate } from "../agent-plugins.js";
import { pluginIdParam } from "../../routes/agent-plugins/shared.js";

/**
 * @file rv1123e migration: the agent-plugins wire DTOs are declared once in neutral Core; CMS keeps
 * only the serialization (the lifecycle projection and the route specs' row builders), called with
 * object arguments.
 */
/** Mutual assignability, checked by the compiler: `true` only when each side accepts the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("agent-plugins wire DTOs", () => {
  it("keeps Core's restated lifecycle projection identical to the serializer's return type", () => {
    // Core cannot import CMS, so it restates this shape; a drift on either side fails `tsc` here.
    const parity: [Same<AgentPluginLifecycleFields<AgentPluginRowCandidate>, AdminAgentPluginLifecycleDto>] = [true];
    expect(parity).toEqual([true]);
  });

  it("projects through object arguments", () => {
    const candidate = { pluginId: "p", keywords: [], enabled: true, skills: [], mcpServerIds: [], maturity: "soon", origin: "bundled" } satisfies AgentPluginRowCandidate;
    const fields: AdminAgentPluginLifecycleDto = agentPluginLifecycleFields({ candidate });
    expect(fields).toEqual({ maturity: "soon", origin: "bundled", hostOk: undefined, missingRequires: [], requiredBy: [], archiveDigest: undefined });
  });

  it("reads the plugin id path segment through an object argument", () => {
    expect(pluginIdParam({ params: {} })).toBe("");
    expect(pluginIdParam({ params: { pluginId: "site-compliance" } })).toBe("site-compliance");
  });
});
