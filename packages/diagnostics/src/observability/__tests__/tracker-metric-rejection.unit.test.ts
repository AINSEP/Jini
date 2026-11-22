import { describe, expect, it, vi } from "vitest";
import { createNoopObservabilityPort } from "@jini-ai/core/contracts/observability";
import { createTracker } from "../tracker.js";

const WARNING = "[tracker] a telemetry provider failed; application work continues";

describe("tracker.metric vendor failure", () => {
  it("turns a rejecting metric vendor into one warning, never an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const warn = vi.fn();
    try {
      const observability = { ...createNoopObservabilityPort({}), metric: () => Promise.reject(new Error("vendor down")) };
      createTracker({ observability }, { warn }).metric({ name: "queue.size", value: 1 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(WARNING);
    } finally { process.off("unhandledRejection", unhandled); }
  });
});
