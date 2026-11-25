import { describe, expect, it } from "vitest";
import { siteKeyStatusBadgeLabel } from "../hooks/site-key-status.rules.js";

const t = String;

describe("site key env provenance", () => {
  it.each(["none", "file", "env"] as const)("labels an inactive %s key as None", (source) => {
    expect(siteKeyStatusBadgeLabel({
      status: { active: false, source, envVarName: "HOST_SITE_KEY" },
      t,
      fallbackEnvVarName: "HOST_SITE_KEY",
    })).toBe("None");
  });

  it("renders the server's actual env name", () => {
    expect(siteKeyStatusBadgeLabel({ status: { active: true, source: "env", envVarName: "HOST_SITE_KEY" }, t, fallbackEnvVarName: "HOST_SITE_KEY" })).toBe("Active: environment variable HOST_SITE_KEY");
    expect(siteKeyStatusBadgeLabel({ status: { active: true, source: "env", envVarName: "LEGACY_VAR" }, t, fallbackEnvVarName: "HOST_SITE_KEY" })).toBe("Active: environment variable LEGACY_VAR");
  });

  it("uses the standard environment name when the server omits it", () => {
    expect(siteKeyStatusBadgeLabel({
      status: { active: true, source: "env" },
      t,
      fallbackEnvVarName: "HOST_SITE_KEY",
    })).toBe("Active: environment variable HOST_SITE_KEY");
  });

  it("labels an active file key without using environment provenance", () => {
    expect(siteKeyStatusBadgeLabel({
      status: { active: true, source: "file", envVarName: "IGNORED_VAR" },
      t,
      fallbackEnvVarName: "HOST_SITE_KEY",
    })).toBe("Active — key file");
  });

  // SITE-KEY-FALLBACK-HOST: a non-default host fallback is used only when the server omitted its own name.
  it("uses the injected host fallback only when the server omits its own name", () => {
    expect(siteKeyStatusBadgeLabel({ status: { active: true, source: "env" }, t, fallbackEnvVarName: "OTHER_HOST_KEY" }))
      .toBe("Active: environment variable OTHER_HOST_KEY");
    expect(siteKeyStatusBadgeLabel({ status: { active: true, source: "env", envVarName: "SERVER_NAMED_KEY" }, t, fallbackEnvVarName: "OTHER_HOST_KEY" }))
      .toBe("Active: environment variable SERVER_NAMED_KEY");
  });
});
