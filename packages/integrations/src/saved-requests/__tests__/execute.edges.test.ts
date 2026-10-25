import { describe, expect, test } from "vitest";
import { executeSavedRequest } from "../index.js";
import { definition, fixture } from "./fixtures.js";

/** Boundary pins for `execute.ts`'s response checks (Stryker L6 survivors at the 2xx and media-type checks). */

function run(f: ReturnType<typeof fixture>) {
  return executeSavedRequest({ deps: f.deps, workspaceId: "workspace-1", definition: definition(), input: { query: "tea" } });
}

describe("saved-request response status boundary", () => {
  test.each([200, 201, 299])("status %i with JSON is accepted", async (status) => {
    const f = fixture(); f.state.response = { ...f.state.response, status };
    expect(await run(f)).toEqual({ trust: "untrusted", items: [{ title: "Public" }] });
  });

  test.each([199, 300, 304, 400, 404])("status %i is refused as invalid_response", async (status) => {
    const f = fixture(); f.state.response = { ...f.state.response, status };
    await expect(run(f)).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("saved-request response media type", () => {
  test.each(["application/json", "APPLICATION/JSON", "application/json; charset=utf-8", "application/problem+json", " application/json "])(
    "content-type %j is accepted",
    async (contentType) => {
      const f = fixture(); f.state.response = { ...f.state.response, headers: { "content-type": contentType } };
      expect(await run(f)).toEqual({ trust: "untrusted", items: [{ title: "Public" }] });
    },
  );

  test.each(["application/jsonx", "xapplication/json", "application/json+evil", "text/json", "application/+json", "application/ld json", ""])(
    "content-type %j is refused as invalid_response",
    async (contentType) => {
      const f = fixture(); f.state.response = { ...f.state.response, headers: { "content-type": contentType } };
      await expect(run(f)).rejects.toMatchObject({ code: "invalid_response" });
    },
  );

  test("the header name is matched case-insensitively", async () => {
    const f = fixture(); f.state.response = { ...f.state.response, headers: { "CONTENT-TYPE": "application/json" } };
    expect(await run(f)).toEqual({ trust: "untrusted", items: [{ title: "Public" }] });
  });
});

describe("saved-request locked-down egress", () => {
  test("a forbidden origin's host is refused before any credential resolution", async () => {
    const f = fixture();
    // Matched by hostname, so another port on the same host is still the forbidden site.
    const deps = { ...f.deps, forbiddenOrigins: ["https://elsewhere.example", "https://api.example:8443"] };
    await expect(executeSavedRequest({ deps, workspaceId: "workspace-1", definition: definition(), input: { query: "tea" } })).rejects.toMatchObject({ code: "invalid_definition" });
    expect(f.resolutions).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  test("a credential token containing CR/LF/NUL is refused as credential_changed without dialing", async () => {
    for (const token of ["a\rb", "a\nb", "a\u0000b"]) {
      const f = fixture(); f.state.credential = { ...f.state.credential!, connection: { token } };
      await expect(run(f)).rejects.toMatchObject({ code: "credential_changed" });
      expect(f.calls).toEqual([]);
    }
  });
});
