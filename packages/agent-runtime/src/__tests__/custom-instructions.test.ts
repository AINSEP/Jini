import { describe, expect, test, vi } from "vitest";
import { createCustomInstructionsCache, formatCustomInstructionsOverlay, resolveCustomInstructions, type ResolveCustomInstructionsDeps } from "../custom-instructions.js";

function deps(value: unknown, overrides: Partial<ResolveCustomInstructionsDeps> = {}): ResolveCustomInstructionsDeps {
  return { settingsRepo: {} as ResolveCustomInstructionsDeps["settingsRepo"], instructionsNamespace: "core.instructions",
    getEffective: vi.fn(async () => (value === undefined ? null : { value })), ...overrides };
}

describe("custom instructions", () => {
  test("reads the injected namespace's custom key for the workspace", async () => {
    const d = deps("Be brief.");
    await expect(resolveCustomInstructions(d, { workspaceId: "ws-1" })).resolves.toBe("Be brief.");
    expect(d.getEffective).toHaveBeenCalledWith({ deps: { repo: d.settingsRepo }, namespace: "core.instructions", key: "custom", scopeContext: { workspaceId: "ws-1" } });
  });

  test("non-string, missing and failing reads all fail open to the empty string", async () => {
    await expect(resolveCustomInstructions(deps(42), { workspaceId: "ws" })).resolves.toBe("");
    await expect(resolveCustomInstructions(deps(undefined), { workspaceId: "ws" })).resolves.toBe("");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(resolveCustomInstructions(deps("x", { settingsReady: Promise.reject(new Error("boot")) }), { workspaceId: "ws" })).resolves.toBe("");
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  test("overlay is null for blank text and carries the operator header otherwise", () => {
    expect(formatCustomInstructionsOverlay({ customInstructions: "  \n " })).toBeNull();
    const overlay = formatCustomInstructionsOverlay({ customInstructions: "  Use metric units. " });
    expect(overlay).toMatch(/^The site operator has configured the following custom instructions/);
    expect(overlay?.endsWith("\n\nUse metric units.")).toBe(true);
  });

  test("cache reads null before refresh and the last resolved overlay after", async () => {
    const cache = createCustomInstructionsCache(deps("Say hi."), { workspaceId: "ws" });
    expect(cache.readOverlay()).toBeNull();
    await cache.refresh();
    expect(cache.readOverlay()?.endsWith("Say hi.")).toBe(true);
  });
});
