// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { adminFrontendTabId } from "../../../../lib/admin-frontend-session.js";
import type { FrontendSessionBridge } from "../../../../../react/kit.js";
import type { AgentScreenContext } from "../../../../lib/agent-screen-context.js";
import { resolveRunContext, useRunContext } from "../run-context.hooks.js";

/** @file `resolveRunContext` / `useRunContext`: the per-send run context (bind token read fresh at call time, optional fields omitted when empty). */

describe("resolveRunContext", () => {
  it("omits frontendBindToken entirely when there is no bind token", () => {
    expect(resolveRunContext({ bindToken: undefined })).toEqual({});
  });

  it("carries the bind token through when one exists", () => {
    expect(resolveRunContext({ bindToken: "tok-123" })).toEqual({ frontendBindToken: "tok-123" });
  });

  it("carries the live model selection through when one exists", () => {
    expect(resolveRunContext({ bindToken: undefined, model: "sonnet" })).toEqual({ model: "sonnet" });
  });

  it("omits model entirely when absent — including the empty-string case", () => {
    expect(resolveRunContext({ bindToken: undefined, model: undefined })).toEqual({});
    expect(resolveRunContext({ bindToken: undefined, model: "" })).toEqual({});
  });

  it("carries bindToken and model together without either shadowing the other", () => {
    expect(resolveRunContext({ bindToken: "tok-123", model: "opus" })).toEqual({
      frontendBindToken: "tok-123",
      model: "opus",
    });
  });

  it("carries pinned pluginRefIds through when at least one is pinned", () => {
    expect(resolveRunContext({ bindToken: undefined, pluginRefIds: ["ui-ux-design"] })).toEqual({
      pluginRefIds: ["ui-ux-design"],
    });
  });

  it("omits pluginRefIds entirely when the array is empty or absent", () => {
    expect(resolveRunContext({ bindToken: undefined, pluginRefIds: [] })).toEqual({});
    expect(resolveRunContext({ bindToken: undefined })).toEqual({});
  });

  it("carries the active conversation id through when one exists", () => {
    expect(resolveRunContext({ bindToken: undefined, conversationId: "c1" })).toEqual({ conversationId: "c1" });
  });

  it("omits conversationId entirely when absent, null, or empty — no conversation is active yet", () => {
    expect(resolveRunContext({ bindToken: undefined, conversationId: undefined })).toEqual({});
    expect(resolveRunContext({ bindToken: undefined, conversationId: null })).toEqual({});
    expect(resolveRunContext({ bindToken: undefined, conversationId: "" })).toEqual({});
  });

  // Same round trip the model already makes, for the value the Execution tab's "Reasoning effort"
  // control persists. Without it the level is stored in the ledger and never reaches argv, which
  // reads to an operator as the setting silently doing nothing.
  it("carries the selected reasoning effort through when one exists", () => {
    expect(resolveRunContext({ bindToken: undefined, reasoning: "high" })).toEqual({ reasoning: "high" });
  });

  it("omits reasoning entirely when absent or empty — '' is the ledger's 'no explicit effort'", () => {
    expect(resolveRunContext({ bindToken: undefined, reasoning: undefined })).toEqual({});
    expect(resolveRunContext({ bindToken: undefined, reasoning: "" })).toEqual({});
  });

  it("carries model and reasoning together without either shadowing the other", () => {
    expect(resolveRunContext({ bindToken: "tok-123", model: "opus", reasoning: "max" })).toEqual({
      frontendBindToken: "tok-123",
      model: "opus",
      reasoning: "max",
    });
  });
});

describe("useRunContext", () => {
  it("builds context by reading the bind token fresh at call time, not captured at build time", () => {
    let token = "tok-1";
    const agentBridge = { bindToken: () => token } as unknown as FrontendSessionBridge;
    const { result } = renderHook(() => useRunContext({ agentBridge, model: "sonnet" }));

    expect(result.current()).toEqual({ frontendTabId: adminFrontendTabId, frontendBindToken: "tok-1", model: "sonnet" });

    token = "tok-2"; // simulates an EventSource reconnect minting a new bind token
    expect(result.current()).toEqual({ frontendTabId: adminFrontendTabId, frontendBindToken: "tok-2", model: "sonnet" });
  });

  it("omits frontendBindToken when there is no agentBridge", () => {
    const { result } = renderHook(() => useRunContext({ agentBridge: null, model: "sonnet" }));

    expect(result.current()).toEqual({ frontendTabId: adminFrontendTabId, model: "sonnet" });
  });

  // 2026-09-16 owner report: in the page editor for "Landing sample — xai", the assistant could not
  // say which page was open. The screen must be read when Send is pressed — the callback is memoized
  // and outlives navigation, so a value captured at build time would describe a screen already left.
  it("carries the screen the operator is on, read fresh at call time", () => {
    const pageEditor = {
      path: "/pages/4f22",
      section: "pages",
      view: "page-editor",
      entry: { kind: "page", id: "4f22", title: "Landing sample — xai" },
    };
    let screen: typeof pageEditor | { path: string; section: string } | undefined = pageEditor;
    const { result } = renderHook(() => useRunContext({ agentBridge: null, readScreenContext: () => screen }));

    expect(result.current()).toEqual({ frontendTabId: adminFrontendTabId, pageContext: pageEditor });

    screen = { path: "/pages", section: "pages" };
    expect(result.current()).toEqual({ frontendTabId: adminFrontendTabId, pageContext: { path: "/pages", section: "pages" } });

    screen = undefined;
    expect(result.current()).toEqual({ frontendTabId: adminFrontendTabId });
  });

  it("memoizes the callback while agentBridge and model are unchanged", () => {
    const agentBridge = { bindToken: () => "tok" } as unknown as FrontendSessionBridge;
    const { result, rerender } = renderHook(() => useRunContext({ agentBridge, model: "sonnet" }));
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it("rebuilds the callback when model changes", () => {
    const agentBridge = { bindToken: () => "tok" } as unknown as FrontendSessionBridge;
    const { result, rerender } = renderHook(
      ({ model }: { model: string | undefined }) => useRunContext({ agentBridge, model }),
      { initialProps: { model: "sonnet" as string | undefined } },
    );
    const first = result.current;

    rerender({ model: "opus" });

    expect(result.current).not.toBe(first);
  });

  it("carries pluginRefIds through, read fresh at call time like the bind token", () => {
    const agentBridge = { bindToken: () => "tok" } as unknown as FrontendSessionBridge;
    const { result, rerender } = renderHook(
      ({ pluginRefIds }: { pluginRefIds: readonly string[] }) =>
        useRunContext({ agentBridge, model: "sonnet", pluginRefIds }),
      { initialProps: { pluginRefIds: [] as readonly string[] } },
    );

    expect(result.current()).toEqual({ frontendTabId: adminFrontendTabId, frontendBindToken: "tok", model: "sonnet" });

    rerender({ pluginRefIds: ["ui-ux-design"] });

    expect(result.current()).toEqual({ frontendTabId: adminFrontendTabId, frontendBindToken: "tok", model: "sonnet", pluginRefIds: ["ui-ux-design"] });
  });

  it("carries conversationId through, and rebuilds the callback when it changes (a conversation switch)", () => {
    const agentBridge = { bindToken: () => "tok" } as unknown as FrontendSessionBridge;
    const { result, rerender } = renderHook(
      ({ conversationId }: { conversationId: string | null }) => useRunContext({ agentBridge, model: "sonnet", conversationId }),
      { initialProps: { conversationId: null as string | null } },
    );
    const first = result.current;

    expect(result.current()).toEqual({ frontendTabId: adminFrontendTabId, frontendBindToken: "tok", model: "sonnet" });

    rerender({ conversationId: "c1" });

    expect(result.current()).toEqual({ frontendTabId: adminFrontendTabId, frontendBindToken: "tok", model: "sonnet", conversationId: "c1" });
    expect(result.current).not.toBe(first);
  });
});
