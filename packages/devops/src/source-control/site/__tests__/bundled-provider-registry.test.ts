import { describe, expect, it, vi } from "vitest";
import { collectBundledSourceControlProviders } from "../bundled-provider-registry.js";

const copy = {
  sourceFailure: "sources unavailable",
  packageFailure: ({ pluginId }: { pluginId: string }) => `failed ${pluginId}`,
  duplicateId: ({ id }: { id: string }) => `duplicate ${id}`,
};

describe("collectBundledSourceControlProviders", () => {
  it("three declarations of the same id yield one refusal and no selectable provider", async () => {
    const result = await collectBundledSourceControlProviders({
      sources: () => [{ pluginId: "a" }, { pluginId: "b" }, { pluginId: "c" }],
      load: async () => ({ providers: [{ id: "same" }], refusals: [] }),
      providerId: ({ provider }) => provider.id,
      reportSourceFailure: vi.fn(), copy,
    });
    expect(result).toEqual({ providers: [], refusals: ["duplicate same"] });
  });

  it("reports source enumeration failure without leaking the exception", async () => {
    const error = new Error("private path");
    const reportSourceFailure = vi.fn();
    const load = vi.fn(async () => ({ providers: [] as { id: string }[], refusals: [] }));
    const result = await collectBundledSourceControlProviders({
      sources: () => { throw error; }, load,
      providerId: ({ provider }) => provider.id, reportSourceFailure, copy,
    });
    expect(result).toEqual({ providers: [], refusals: [copy.sourceFailure] });
    expect(reportSourceFailure).toHaveBeenCalledExactlyOnceWith({ error });
    expect(load).not.toHaveBeenCalled();
  });

  it("keeps original refusal order and import failures omit exception text", async () => {
    const result = await collectBundledSourceControlProviders({
      sources: () => [{ pluginId: "a" }, { pluginId: "broken" }, { pluginId: "b" }],
      load: async ({ source }) => {
        if (source.pluginId === "broken") throw new Error("credential-secret");
        return { providers: [{ id: "second" }, { id: "first" }], refusals: [source.pluginId] };
      },
      providerId: ({ provider }) => provider.id, reportSourceFailure: vi.fn(), copy,
    });
    expect(result).toEqual({ providers: [], refusals: ["a", "failed broken", "b", "duplicate second", "duplicate first"] });
  });

  it("does not eagerly read sources during binder construction", async () => {
    const sources = vi.fn(() => [] as { pluginId: string }[]);
    const bound = () => collectBundledSourceControlProviders({
      sources, load: async () => ({ providers: [] as { id: string }[], refusals: [] }),
      providerId: ({ provider }) => provider.id, reportSourceFailure: vi.fn(), copy,
    });
    expect(sources).not.toHaveBeenCalled();
    await bound();
    expect(sources).toHaveBeenCalledTimes(1);
  });
});
