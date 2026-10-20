import type { Request } from "express";
import { describe, expect, test, vi } from "vitest";
import { failRequest, readValueMutation, resolvePrincipal, VALUE_MUTATION_REQUIRED } from "../http-request.js";
import type { SettingsHttpOptions } from "../index.js";
import { createCapturingResponse } from "./settings-fixture.js";

const forbiddenMapping = { matches: (error: unknown) => error instanceof RangeError, status: 418, code: "MAPPED" };
// Malformed-input fixture: these helpers never read the request, so an empty object stands in for it.
const request = {} as Request;

describe("failRequest", () => {
  test("before headers, writes the first matching mapping", () => {
    const { res, capture } = createCapturingResponse();
    failRequest({ response: res, error: new RangeError("bad range"), mappings: [forbiddenMapping] }, {});
    expect(capture).toMatchObject({ statusCode: 418, jsonBody: { error: "bad range", code: "MAPPED" } });
    expect(res.end).not.toHaveBeenCalled();
  });
  test("after headers, reports the error and ends the response without a body", () => {
    const { res, capture } = createCapturingResponse(); Object.assign(res, { headersSent: true });
    const onError = vi.fn<NonNullable<SettingsHttpOptions["onError"]>>();
    const error = new Error("late failure");
    failRequest({ response: res, error, mappings: [forbiddenMapping] }, { onError });
    expect(onError).toHaveBeenCalledWith({ operation: "settings-request", error });
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(capture.jsonBody).toBeUndefined();
  });
  test("after headers, still ends the response when the reporter throws", () => {
    const { res } = createCapturingResponse(); Object.assign(res, { headersSent: true });
    failRequest({ response: res, error: new Error("late"), mappings: [] }, { onError: () => { throw new Error("reporter broke"); } });
    expect(res.end).toHaveBeenCalledTimes(1);
  });
  test("after headers, ends the response when no reporter is configured", () => {
    const { res } = createCapturingResponse(); Object.assign(res, { headersSent: true });
    failRequest({ response: res, error: new Error("late"), mappings: [] }, {});
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});

describe("resolvePrincipal", () => {
  const { res } = createCapturingResponse();
  test("returns the resolved principal once ready", async () => {
    const principalResolver = vi.fn(async () => ({ id: "me" }));
    expect(await resolvePrincipal({ ready: Promise.resolve(), principalResolver }, { request, response: res })).toEqual({ id: "me" });
    expect(principalResolver).toHaveBeenCalledWith({ request, response: res });
  });
  test("collapses a readiness failure to null without resolving", async () => {
    const principalResolver = vi.fn(() => ({ id: "me" }));
    expect(await resolvePrincipal({ ready: Promise.reject(new Error("not ready")), principalResolver }, { request, response: res })).toBeNull();
    expect(principalResolver).not.toHaveBeenCalled();
  });
  test("collapses a resolver rejection to null", async () => {
    const principalResolver = vi.fn(async (): Promise<{ id: string } | null> => { throw new Error("token store down"); });
    expect(await resolvePrincipal({ ready: Promise.resolve(), principalResolver }, { request, response: res })).toBeNull();
  });
  test("passes a null principal through", async () => {
    expect(await resolvePrincipal({ ready: Promise.resolve(), principalResolver: () => null }, { request, response: res })).toBeNull();
  });
});

describe("readValueMutation", () => {
  const complete = { namespace: "preferences", key: "color", scope: "user", valueJson: 0 };
  test.each(["set", "clear"] as const)("%s accepts a complete body", (operation) => {
    expect(readValueMutation(complete, operation)).toEqual({ namespace: "preferences", key: "color", scope: "user" });
  });
  test("set requires valueJson to be present, even as undefined", () => {
    const { valueJson: _omitted, ...withoutValue } = complete;
    expect(readValueMutation(withoutValue, "set")).toBeNull();
    expect(readValueMutation({ ...withoutValue, valueJson: undefined }, "set")).toEqual({ namespace: "preferences", key: "color", scope: "user" });
  });
  test("clear does not require valueJson", () => {
    const { valueJson: _omitted, ...withoutValue } = complete;
    expect(readValueMutation(withoutValue, "clear")).toEqual({ namespace: "preferences", key: "color", scope: "user" });
  });
  test.each([
    { namespace: "" }, { namespace: undefined }, { key: "" }, { key: undefined }, { scope: "tenant" }, { scope: "constructor" }, { scope: undefined },
  ])("rejects %j", (override) => {
    expect(readValueMutation({ ...complete, ...override }, "clear")).toBeNull();
  });
  test("stringifies non-string namespace and key", () => {
    expect(readValueMutation({ ...complete, namespace: 7, key: true }, "clear")).toEqual({ namespace: "7", key: "true", scope: "user" });
  });
  test("names valueJson only in the set requirement", () => {
    expect(VALUE_MUTATION_REQUIRED).toEqual({
      set: "namespace, key, scope (global|workspace|user), and valueJson are required",
      clear: "namespace, key, and scope (global|workspace|user) are required",
    });
  });
});
