import { describe, expect, it } from "vitest";

import { ToolAccessLoweringError } from "../tool-access-change.js";

describe("ToolAccessLoweringError", () => {
  it("carries the stable code and never claims the answers were stopped", () => {
    const err = new ToolAccessLoweringError();
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("TOOL_ACCESS_STOP_FAILED");
    expect(err.message).toBe("Tool access changed, but affected answers could not be confirmed stopped.");
  });
});
