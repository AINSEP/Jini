import { describe, expect, it } from "vitest";
import { createSourceControlProviderKit } from "../provider-kit.js";

describe("createSourceControlProviderKit transport-failure description", () => {
  it("hands the host the raw error and returns exactly the host's refusal text and log detail", () => {
    const seen: unknown[] = [];
    const kit = createSourceControlProviderKit({
      host: { describeTransportError: ({ error }) => { seen.push(error); return { refusal: "egress refused", logDetail: "redacted" }; } },
    });
    const error = new Error("blocked https://secret.example/?token=abc");

    expect(kit.describeTransportError(error)).toEqual({ refusal: "egress refused", logDetail: "redacted" });
    expect(seen).toEqual([error]);
  });

  it("keeps an undefined refusal and the host's redacted fallback detail for a non-refusal failure", () => {
    const kit = createSourceControlProviderKit({
      host: { describeTransportError: () => ({ refusal: undefined, logDetail: "fallback-detail" }) },
    });

    expect(kit.describeTransportError(new Error("boom"))).toEqual({ refusal: undefined, logDetail: "fallback-detail" });
  });
});
