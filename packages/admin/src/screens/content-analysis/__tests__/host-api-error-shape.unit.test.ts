import { describe, expect, it } from "vitest";
import { describeAnalysisError, isContentAnalysisHidden } from "../rules.js";

/** The host's transport error, restated structurally: an `Error` with a numeric HTTP `status` and an
 *  optional canonical `code`. Pins the moved rules' structural read (the host class is not importable here). */
function hostError(message: string, status: unknown, code?: string): Error {
  return Object.assign(new Error(message), { status }, code === undefined ? {} : { code });
}
const t = (key: string) => key;

describe("content-analysis rules read the host API error structurally", () => {
  it("maps a status-carrying error's refusal code to the card copy", () => {
    expect(describeAnalysisError({ error: hostError("x", 409, "PLUGIN_NOT_ENABLED"), t })).toBe("The Content Analyzer plugin is not enabled.");
    expect(isContentAnalysisHidden({ data: undefined, error: hostError("gone", 404, "PLUGIN_NOT_FOUND") })).toBe(true);
  });

  it("ignores a code on an error without a numeric status (not a transport error)", () => {
    expect(describeAnalysisError({ error: hostError("boom", "404", "PLUGIN_NOT_ENABLED"), t })).toBe("boom");
    expect(isContentAnalysisHidden({ data: undefined, error: Object.assign(new Error("x"), { code: "PLUGIN_NOT_FOUND" }) })).toBe(false);
  });

  it("falls back to the error's own message, then the card fallback", () => {
    expect(describeAnalysisError({ error: hostError("server said no", 500), t })).toBe("server said no");
    expect(describeAnalysisError({ error: hostError("", 500), t })).toBe("Analysis failed.");
    expect(describeAnalysisError({ error: "nope", t })).toBe("Analysis failed.");
  });
});
