import { describe, expect, it } from "vitest";
import { executionModeFromEnv } from "../execution-mode.js";

/** `executionModeFromEnv` — the safe-default contract matters most: anything other than the
 *  exact literal `"hosted-api-only"` must resolve to `"self-hosted-cli"`, never the reverse.
 *  The variable name is host-owned, so every case passes it in. */
describe("executionModeFromEnv", () => {
  const envVarName = "HOST_EXECUTION_MODE";

  it("defaults to self-hosted-cli when the env var is unset", () => {
    expect(executionModeFromEnv({ env: {}, envVarName })).toBe("self-hosted-cli");
  });

  it("resolves hosted-api-only when set to exactly that value", () => {
    expect(executionModeFromEnv({ env: { HOST_EXECUTION_MODE: "hosted-api-only" }, envVarName })).toBe("hosted-api-only");
  });

  it("reads only the host-named variable, not a differently named one", () => {
    expect(executionModeFromEnv({ env: { OTHER_EXECUTION_MODE: "hosted-api-only" }, envVarName })).toBe("self-hosted-cli");
  });

  it("an unrecognized/typo'd value falls back to self-hosted-cli, not hosted-api-only", () => {
    expect(executionModeFromEnv({ env: { HOST_EXECUTION_MODE: "hosted" }, envVarName })).toBe("self-hosted-cli");
  });

  it("blank string falls back to self-hosted-cli", () => {
    expect(executionModeFromEnv({ env: { HOST_EXECUTION_MODE: "" }, envVarName })).toBe("self-hosted-cli");
  });
});
