import { describe, expect, it } from "vitest";
import { buildCreateOutcome } from "../custom-credential-create-ui.js";

const app = { appName: "created", appVersion: "1" };

describe("buildCreateOutcome", () => {
  it("a success names the label, keeps the caller's message and app, and fixes the frame size", () => {
    expect(buildCreateOutcome({ label: "Stripe live", state: "success", message: "Saved and verified.", app })).toEqual({
      title: "Credential saved", details: [{ label: "Label", value: "Stripe live" }], state: "success",
      message: "Saved and verified.", app, preferredFrameSize: ["100%", "240px"],
    });
  });

  it("a failure says not saved with the same shape", () => {
    const outcome = buildCreateOutcome({ label: "Dup", state: "failure", message: "A credential with this label already exists.", app });
    expect(outcome.title).toBe("Credential not saved");
    expect(outcome.state).toBe("failure");
    expect(outcome.details).toEqual([{ label: "Label", value: "Dup" }]);
    expect(outcome.message).toBe("A credential with this label already exists.");
  });
});
