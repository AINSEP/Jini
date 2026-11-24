/**
 * @file Unit tests for `hook-refusals.ts`: the class must preserve its shape and identity (so the
 * hook registry's throws are what a content feature recognizes), and the handler-map wrap is
 * transparent except for a plugin refusal.
 */
import { describe, expect, it } from "vitest";

import { ToolInputError, type ToolHandler } from "@jini-ai/core";

import { PluginHookFailedError as RegistryPluginHookFailedError } from "../../index.js";
import { PluginHookFailedError } from "../../errors.js";
import { toModelFacingPluginHookError, withPluginHookRefusals } from "../../hook-refusals.js";

describe("plugin hook refusals", () => {
  it("the host entry exports the SAME class, so its throws match instanceof here", () => {
    expect(RegistryPluginHookFailedError).toBe(PluginHookFailedError);
  });

  it("PluginHookFailedError carries name, pluginId, message and cause", () => {
    const cause = new Error("inner");
    const err = new PluginHookFailedError("seo", "plugin 'seo' failed", { cause });
    expect(err.name).toBe("PluginHookFailedError");
    expect(err.pluginId).toBe("seo");
    expect(err.message).toBe("plugin 'seo' failed");
    expect(err.cause).toBe(cause);
  });

  it("toModelFacingPluginHookError publishes only the fixed refusal and the plugin id", () => {
    const out = toModelFacingPluginHookError({ err: new PluginHookFailedError("seo", "raw /secret/path") });
    expect(out).toBeInstanceOf(ToolInputError);
    expect((out as ToolInputError).message).toBe("PLUGIN_HOOK_FAILED: a site plugin (seo) refused this save; the content was not saved");
  });

  it("PluginHookFailedError has no refused item unless a multi-item apply names one", () => {
    expect(new PluginHookFailedError("seo", "raw").refusedItemRef).toBe(null);
    const cause = new PluginHookFailedError("seo", "raw");
    const atItem = new PluginHookFailedError("seo", "raw", { cause, refusedItemRef: "post:p-2" });
    expect(atItem.refusedItemRef).toBe("post:p-2");
    expect(atItem.cause).toBe(cause);
  });

  it("toModelFacingPluginHookError names the refused item and that earlier items stay saved", () => {
    const out = toModelFacingPluginHookError({
      err: new PluginHookFailedError("seo", "raw /secret/path", { refusedItemRef: "post:p-2" }),
    });
    expect(out).toBeInstanceOf(ToolInputError);
    expect((out as ToolInputError).message).toBe(
      "PLUGIN_HOOK_FAILED: a site plugin (seo) refused item post:p-2; items applied before it stay saved, so check the import history before retrying"
    );
  });

  it("toModelFacingPluginHookError returns any other rejection unchanged", () => {
    const other = new Error("boom");
    expect(toModelFacingPluginHookError({ err: other })).toBe(other);
  });

  it("withPluginHookRefusals passes success and arguments through and reclassifies a refusal", async () => {
    const seen: unknown[] = [];
    const handlers: Record<string, ToolHandler> = {
      ok: (async (...args: Parameters<ToolHandler>) => {
        seen.push(args);
        return { done: true };
      }) as ToolHandler,
      refuse: (async () => {
        throw new PluginHookFailedError("seo", "raw");
      }) as ToolHandler,
    };
    const wrapped = withPluginHookRefusals({ handlers });
    const ctx = { input: { a: 1 } } as unknown as Parameters<ToolHandler>[0];
    const optional = { signal: undefined } as unknown as Parameters<ToolHandler>[1];

    expect(Object.keys(wrapped)).toEqual(["ok", "refuse"]);
    expect(await wrapped.ok!(ctx, optional)).toEqual({ done: true });
    expect(seen).toEqual([[ctx, optional]]);
    await expect(wrapped.refuse!(ctx, optional)).rejects.toSatisfy((err: unknown) =>
      err instanceof ToolInputError && err.message.startsWith("PLUGIN_HOOK_FAILED: a site plugin (seo)"));
  });
});
