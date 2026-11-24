import { describe, expect, test, vi } from "vitest";
import { createCustomInstructionsCache, formatCustomInstructionsOverlay, resolveCustomInstructions, type ResolveCustomInstructionsArgs } from "../custom-instructions.js";

function args(value: unknown, overrides: Partial<ResolveCustomInstructionsArgs> = {}): ResolveCustomInstructionsArgs {
  return { settingsRepo: {} as ResolveCustomInstructionsArgs["settingsRepo"], instructionsNamespace: "core.instructions",
    getEffective: vi.fn(async () => (value === undefined ? null : { value })), warn: vi.fn(), workspaceId: "ws", ...overrides };
}

describe("custom instructions", () => {
  test("reads the injected namespace's custom key for the workspace", async () => {
    const a = args("Be brief.", { workspaceId: "ws-1" });
    await expect(resolveCustomInstructions(a)).resolves.toBe("Be brief.");
    expect(a.getEffective).toHaveBeenCalledWith({ deps: { repo: a.settingsRepo }, namespace: "core.instructions", key: "custom", scopeContext: { workspaceId: "ws-1" } });
  });

  test("non-string, missing and failing reads all fail open to the empty string", async () => {
    const quiet = args(42);
    await expect(resolveCustomInstructions(quiet)).resolves.toBe("");
    await expect(resolveCustomInstructions(args(undefined))).resolves.toBe("");
    expect(quiet.warn).not.toHaveBeenCalled();
    const boot = new Error("boot");
    const failing = args("x", { settingsReady: Promise.reject(boot) });
    await expect(resolveCustomInstructions(failing)).resolves.toBe("");
    expect(failing.warn).toHaveBeenCalledTimes(1);
    expect(failing.warn).toHaveBeenCalledWith("resolveCustomInstructions failed; treating as unset", boot);
  });

  test("overlay is null for blank text and carries the operator header otherwise", () => {
    expect(formatCustomInstructionsOverlay({ customInstructions: "  \n " })).toBeNull();
    const overlay = formatCustomInstructionsOverlay({ customInstructions: "  Use metric units. " });
    expect(overlay).toMatch(/^The site operator has configured the following custom instructions/);
    expect(overlay?.endsWith("\n\nUse metric units.")).toBe(true);
  });

  test("cache reads null before refresh and the last resolved overlay after", async () => {
    const cache = createCustomInstructionsCache(args("Say hi."));
    expect(cache.readOverlay()).toBeNull();
    await cache.refresh();
    expect(cache.readOverlay()?.endsWith("Say hi.")).toBe(true);
  });
});
