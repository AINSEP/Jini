import { describe, expect, it } from "vitest";
import type { HttpRequest } from "@jini-ai/core/primitives";
import { RecordingHttpClient } from "../http.memory.js";

describe("RecordingHttpClient", () => {
  it("defaults to 200 and records every call", async () => {
    const client = new RecordingHttpClient();
    const first: HttpRequest = { method: "POST", url: "https://example.com/first", headers: {}, timeoutMs: 5000, body: "first" };
    const second: HttpRequest = { ...first, url: "https://example.com/second", body: "second" };

    expect(await client.send(first)).toEqual({ status: 200, headers: {}, bodyText: "" });
    expect(await client.send(second)).toEqual({ status: 200, headers: {}, bodyText: "" });
    expect(client.calls).toEqual([{ request: first }, { request: second }]);
  });

  it("returns scripted responses in order and repeats the final response", async () => {
    const first = { status: 201, headers: {}, bodyText: "first" };
    const second = { status: 503, headers: {}, bodyText: "second" };
    const client = new RecordingHttpClient({ responses: [first, second] });
    const request: HttpRequest = { method: "POST", url: "https://example.com/hooks", headers: {}, timeoutMs: 5000, body: "{}" };

    expect(await client.send(request)).toBe(first);
    expect(await client.send(request)).toBe(second);
    expect(await client.send(request)).toBe(second);
    expect(client.calls).toEqual([{ request }, { request }, { request }]);
  });

  it("records a thrown call, propagates the error and advances the script", async () => {
    const error = new Error("transport failure");
    const response = { status: 202, headers: {}, bodyText: "accepted" };
    const client = new RecordingHttpClient({ responses: [() => { throw error; }, response] });
    const request: HttpRequest = { method: "POST", url: "https://example.com/hooks", headers: {}, timeoutMs: 5000, body: "{}" };

    await expect(client.send(request)).rejects.toBe(error);
    expect(client.calls).toEqual([{ request }]);
    expect(await client.send(request)).toBe(response);
    expect(client.calls).toEqual([{ request }, { request }]);
  });
  it("refuses to replay from an explicitly empty script but still records the call", async () => {
    const client = new RecordingHttpClient({ responses: [] });
    const request: HttpRequest = { method: "POST", url: "https://example.com/hooks", headers: {}, timeoutMs: 5000, body: "{}" };

    await expect(client.send(request)).rejects.toThrow("RecordingHttpClient: no scripted responses");
    expect(client.calls).toEqual([{ request }]);
  });
});
