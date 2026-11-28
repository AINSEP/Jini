import { describe, expect, it } from "vitest";
import { assetId, errorClassLabel, hostLabel } from "../lib/diagnostic-labels.mjs";

// Printed script lines carry fixed labels only: an error's text and a raw URL can carry a credential.
describe("diagnostic labels", () => {
  it("labels built-in classes, the two well-known names and non-Error values, never the message", () => {
    expect(errorClassLabel({ error: new TypeError("boom SECRETSECRET") })).toBe("TypeError");
    expect(errorClassLabel({ error: new RangeError("x") })).toBe("RangeError");
    expect(errorClassLabel({ error: new SyntaxError("x") })).toBe("SyntaxError");
    expect(errorClassLabel({ error: new AggregateError([], "x") })).toBe("AggregateError");
    expect(errorClassLabel({ error: Object.assign(new Error("x"), { name: "TimeoutError" }) })).toBe("TimeoutError");
    expect(errorClassLabel({ error: Object.assign(new Error("x"), { name: "AbortError" }) })).toBe("AbortError");
    expect(errorClassLabel({ error: Object.assign(new Error("x"), { name: "SECRETSECRETSECRETSECRET" }) })).toBe("Error");
    expect(errorClassLabel({ error: "plain SECRETSECRET" })).toBe("string");
    expect(errorClassLabel({ error: undefined })).toBe("undefined");
  });

  it("survives a throwing name getter and a revoked proxy", () => {
    const hostileName = Object.defineProperty(new Error("x"), "name", { get() { throw new Error("getter SECRETSECRET"); } });
    expect(errorClassLabel({ error: hostileName })).toBe("Error");
    const { proxy, revoke } = Proxy.revocable(new Error("x"), {});
    revoke();
    expect(errorClassLabel({ error: proxy })).toBe("[diagnostic unavailable]");
  });

  it("prints a host without userinfo, path or query, and generated asset ids", () => {
    expect(hostLabel({ url: "https://user:SECRETPASS@s.test:8443/private?token=SECRETQUERY" })).toBe("s.test:8443");
    expect(hostLabel({ url: "not a url" })).toBe("(invalid url)");
    expect(hostLabel({ url: "file:///srv/site/index.html" })).toBe("(no host)");
    expect(hostLabel({ url: "mailto:owner@s.test" })).toBe("(no host)");
    expect(assetId({ index: 0 })).toBe("asset-1");
    expect(assetId({ index: 9 })).toBe("asset-10");
  });
});
