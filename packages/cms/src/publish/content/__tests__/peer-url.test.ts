import { describe, expect, it } from "vitest";
import { normalizePeerBaseUrl, peerHostname, peerUrl } from "../peer-url.js";

describe("peer base URL", () => {
  it("normalizes case, a trailing dot and repeated trailing slashes, keeping a path prefix", () => {
    expect(normalizePeerBaseUrl({ raw: "https://Site.Example.COM./" })).toEqual({ baseUrl: "https://site.example.com" });
    expect(normalizePeerBaseUrl({ raw: "https://site.example.com:8443/base///" })).toEqual({ baseUrl: "https://site.example.com:8443/base" });
  });

  it("refuses credentials, a query and a fragment", () => {
    expect("baseUrl" in normalizePeerBaseUrl({ raw: "https://user:pass@site.example.com" })).toBe(false);
    expect("baseUrl" in normalizePeerBaseUrl({ raw: "https://site.example.com?a=1" })).toBe(false);
    expect("baseUrl" in normalizePeerBaseUrl({ raw: "https://site.example.com#x" })).toBe(false);
  });

  it("joins an API path under the prefix and reads the hostname", () => {
    expect(peerUrl({ baseUrl: "https://site.example.com/base", path: "/api/admin/v1/x" })).toBe("https://site.example.com/base/api/admin/v1/x");
    expect(peerHostname({ baseUrl: "https://site.example.com:8443/base" })).toBe("site.example.com");
  });
});
