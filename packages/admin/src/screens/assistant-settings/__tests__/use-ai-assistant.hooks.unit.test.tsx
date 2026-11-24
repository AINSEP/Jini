// @vitest-environment jsdom
/** wcmp: real query/mutation hook, injected settings port, no module mocks. */
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { describe, expect, it } from "vitest";
import type { PublicAssistantSettings } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";
import { useAiAssistant, type AiAssistantDependencies, type AiAssistantPort } from "../use-ai-assistant.hooks.js";

/** Stand-in for the host's error-to-copy rule: an error's own message, else the English fallback. */
const describeError: AiAssistantDependencies["describeError"] = ({ e, fallback }) =>
  e instanceof Error && e.message ? e.message : fallback;

function fixture() {
  let state: PublicAssistantSettings = { publicEnabled: false, widget: "react" };
  let failure: Error | null = null;
  const writes: Partial<PublicAssistantSettings>[] = [];
  const port: AiAssistantPort = {
    getAssistantSettings: async () => ({ data: { ...state } }),
    setAssistantSettings: async patch => {
      writes.push(patch);
      if (failure) throw failure;
      state = { ...state, ...patch };
      return { data: { ...state } };
    },
  };
  return { port, writes, fail: (error = new Error("Widget choice could not be saved.")) => { failure = error; } };
}

describe("visitor widget setting", () => {
  it("keeps React by default, saves only the explicit widget choice and retains the master switch", async () => {
    const f = fixture();
    const { result } = renderHook(() => useAiAssistant({ port: f.port, describeError }));
    await waitFor(() => expect(result.current.settings?.widget).toBe("react"));
    expect(f.writes).toEqual([]);
    await act(async () => { await result.current.setWidget({ widget: "vanilla" }); });
    await waitFor(() => expect(result.current.settings).toEqual({ publicEnabled: false, widget: "vanilla" }));
    expect(f.writes).toEqual([{ widget: "vanilla" }]);
    await act(async () => { await result.current.setPublicEnabled({ publicEnabled: true }); });
    await waitFor(() => expect(result.current.settings).toEqual({ publicEnabled: true, widget: "vanilla" }));
  });

  it("preserves the persisted choice and reports the real error when saving fails", async () => {
    const f = fixture();
    const { result } = renderHook(() => useAiAssistant({ port: f.port, describeError }));
    await waitFor(() => expect(result.current.settings?.widget).toBe("react"));
    f.fail();
    await act(async () => { await result.current.setWidget({ widget: "vanilla" }); });
    await waitFor(() => expect(result.current.saveError).toBe("Widget choice could not be saved."));
    expect(result.current.settings?.widget).toBe("react");
    expect(result.current.saving).toBe(false);
  });

  it("passes the save fallback to the host's describer when the error says nothing", async () => {
    const f = fixture();
    const { result } = renderHook(() => useAiAssistant({ port: f.port, describeError }));
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    f.fail(new Error(""));
    await act(async () => { await result.current.setPublicEnabled({ publicEnabled: true }); });
    await waitFor(() => expect(result.current.saveError).toBe("failed to save AI assistant settings"));
  });

  it("surfaces a described load failure and no settings", async () => {
    const port: AiAssistantPort = {
      getAssistantSettings: async () => { throw new Error(""); },
      setAssistantSettings: async () => { throw new Error("unused"); },
    };
    const { result } = renderHook(() => useAiAssistant({ port, describeError }));
    await waitFor(() => expect(result.current.loadError).toBe("failed to load AI assistant settings"));
    expect(result.current.settings).toBeNull();
  });
});
