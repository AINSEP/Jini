import { describe, expect, it } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { createPluginHookErrorEnvelope, type PluginHookFailure } from "../plugin-hook-error.js";

/** @file The `PLUGIN_HOOK_FAILED` envelope: fixed public text, redacted log line, refusal for route specs. */

class FakeHookError extends Error implements PluginHookFailure {
  constructor(readonly pluginId: string, message: string) { super(message); }
}

function envelope() {
  const warnings: string[] = [];
  const api = createPluginHookErrorEnvelope({
    isPluginHookFailure: (err): err is FakeHookError => err instanceof FakeHookError,
    // Injected host copy: a value no real host ships, so the test proves the injected one is used.
    refusalText: (err) => `refused by ${err.pluginId}`,
    redact: (text) => text.replace(/sk-[a-z0-9]+/g, "[REDACTED]"),
    warn: (message) => { warnings.push(message); },
  });
  return { api, warnings };
}

describe("createPluginHookErrorEnvelope", () => {
  it("builds the body from the injected refusal text, never the error's own message", () => {
    const { api } = envelope();
    expect(api.pluginHookFailedBody(new FakeHookError("word-count", "token=sk-live123"))).toEqual({
      error: "refused by word-count", code: "PLUGIN_HOOK_FAILED", pluginId: "word-count",
    });
  });

  it("uses the caller's publicText instead of the refusal text when given", () => {
    const { api } = envelope();
    expect(api.pluginHookFailedBody(new FakeHookError("p", "boom"), { publicText: "preview failed" }).error).toBe("preview failed");
  });

  it("logs the cause once, redacted, with the plugin id", () => {
    const { api, warnings } = envelope();
    api.pluginHookFailedBody(new FakeHookError("p1", "provider refused sk-abc123"));
    expect(warnings).toEqual(["[plugin-runtime] 'p1' hook refused a request: provider refused [REDACTED]"]);
  });

  it("sendPluginHookFailedError writes 500 + the envelope for a hook failure and returns true", () => {
    const { api } = envelope();
    const written: Array<{ status: number; body: unknown }> = [];
    const res = { status: (status: number) => ({ json: (body: unknown) => written.push({ status, body }) }) };
    expect(api.sendPluginHookFailedError({ res, err: new FakeHookError("p", "x") })).toBe(true);
    expect(written).toEqual([{ status: 500, body: { error: "refused by p", code: "PLUGIN_HOOK_FAILED", pluginId: "p" } }]);
  });

  it("sendPluginHookFailedError leaves any other error alone (writes nothing, returns false)", () => {
    const { api, warnings } = envelope();
    const written: unknown[] = [];
    const res = { status: () => ({ json: (body: unknown) => written.push(body) }) };
    expect(api.sendPluginHookFailedError({ res, err: new Error("other") })).toBe(false);
    expect(written).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("rejectPluginHookFailure throws the flat 500 refusal for a hook failure", () => {
    const { api } = envelope();
    let thrown: unknown;
    try { api.rejectPluginHookFailure({ err: new FakeHookError("p", "x") }); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(RouteRefusalError);
    expect((thrown as RouteRefusalError).response).toEqual({ status: 500, body: { error: "refused by p", code: "PLUGIN_HOOK_FAILED", pluginId: "p" } });
  });

  it("rejectPluginHookFailure returns for any other error so the route's own ladder continues", () => {
    const { api } = envelope();
    expect(api.rejectPluginHookFailure({ err: new Error("other") })).toBeUndefined();
  });
});
