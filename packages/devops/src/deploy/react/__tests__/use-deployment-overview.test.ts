import { describe, expect, it, vi } from "vitest";
import { useDeploymentOverview, type DeploymentOverviewArgs } from "../index.js";

describe("useDeploymentOverview", () => {
  it("uses the exact query key and port read and returns the snapshot and bound translator", async () => {
    const snapshot = { fixture: "overview" };
    const getDeploymentOverview = vi.fn(async () => snapshot);
    const t = (key: string) => `bound:${key}`;
    const useFetchQueryHook = vi.fn<DeploymentOverviewArgs<typeof snapshot>["useFetchQueryHook"]>(
      () => ({ data: snapshot, error: null }),
    );
    const describeError = vi.fn(() => "unexpected error");
    const controller = useDeploymentOverview({ port: { getDeploymentOverview }, t, locale: "fr", useFetchQueryHook, describeError });
    expect(useFetchQueryHook).toHaveBeenCalledTimes(1);
    const [queryArgs] = useFetchQueryHook.mock.calls[0]!;
    expect(queryArgs.key).toEqual(["deployment", "overview"]);
    expect(await queryArgs.fetch()).toBe(snapshot);
    expect(getDeploymentOverview).toHaveBeenCalledTimes(1);
    expect(controller.snapshot).toBe(snapshot);
    expect(controller.error).toBeNull();
    expect(controller.t).toBe(t);
    expect(describeError).not.toHaveBeenCalled();
  });

  it("passes the sentinel error and bound locale to the supplied formatter", () => {
    const error = { fixture: "error" };
    const describeError = vi.fn(({ locale }: { error: unknown; locale: string }) => `fixture-error:${locale}`);
    const controller = useDeploymentOverview({
      port: { getDeploymentOverview: async () => ({ fixture: "overview" }) },
      t: key => key,
      locale: "fr-CA",
      useFetchQueryHook: () => ({ data: undefined, error }),
      describeError,
    });
    expect(describeError).toHaveBeenCalledExactlyOnceWith({ error, locale: "fr-CA" });
    expect(controller.error).toBe("fixture-error:fr-CA");
  });
});
