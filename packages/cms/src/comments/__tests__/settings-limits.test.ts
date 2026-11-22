import { describe, expect, it } from "vitest";

import { MAX_DEPTH_CEILING, MAX_PER_IP_PER_HOUR_CEILING } from "../settings-limits.js";

describe("comments settings limits", () => {
  it("bounds the reply depth a settings write may allow at 20", () => {
    expect(MAX_DEPTH_CEILING).toBe(20);
  });

  it("bounds the per-address hourly submissions a settings write may allow at 1000", () => {
    expect(MAX_PER_IP_PER_HOUR_CEILING).toBe(1000);
  });
});
