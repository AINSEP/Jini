import { describe, expectTypeOf, it } from "vitest";
import type { RouteRequestFacts } from "../json-route.js";

describe("RouteRequestFacts", () => {
  it("keeps every existing fact valid and adds servingOrigin as an optional string", () => {
    const legacy: RouteRequestFacts = { clientAddress: "203.0.113.9", host: "example.test", protocol: "https" };
    const withOrigin: RouteRequestFacts = { ...legacy, servingOrigin: "https://example.test" };
    expectTypeOf(withOrigin.servingOrigin).toEqualTypeOf<string | undefined>();
    expectTypeOf(legacy).toMatchTypeOf<RouteRequestFacts>();
  });
});
