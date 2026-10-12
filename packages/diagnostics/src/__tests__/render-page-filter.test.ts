/** rendr4: URL filtering over the real bounded collector; no transport/module mocks. */
import { expect, test } from "vitest";
import { createJsonCapture } from "../web-evidence/public-page.js";

test.each<[string | string[], string, boolean]>([
  ["/v1/datasource/", "https://cms.example/v1/datasource/rows?q=1", true],
  ["/v1/datasource/", "https://stripe.example/v1/checkout", false],
  [["/rows", "/records"], "https://cms.example/records", true],
  [["/rows", "/records"], "https://cms.example/other", false],
  ["https://*.example/v1/*", "https://cms.example/v1/rows?a=b", true],
  ["https://*.example/v1/*", "https://cms.other/v1/rows", false],
  ["*/data?x=[1].*", "https://cms.example/data?x=[1].json", true],
  ["*/data?x=[1].*", "https://cms.example/dataAx=1xjson", false],
  ["*a*b*a", "aba", true],
  ["*a*b*a", "ab", false],
  ["aa*aa", "aaa", false],
  ["**/rows**", "https://cms.example/rows/1", true],
  ["*", "https://any.example/data", true],
  ["https://cms.example/*/rows", "https://cms.example/x/rows/extra", false],
])("filter %j on %s includes a body only when matching (%s)", (captureDataMatch, url, matches) => {
  const capture = createJsonCapture({}, { captureDataMatch: captureDataMatch as string | string[] });
  const body = '{"record":"needed"}';
  capture.record({ url, resourceType: "xhr", resource: { status: 201, headers: { "Content-Type": "application/json; charset=utf-8" }, body: Buffer.from(body), truncated: false } });
  expect(capture.result()).toEqual(matches
    ? { data: [{ url, status: 201, body, truncated: false }], dataUnmatched: [], dataTruncated: false }
    : { data: [], dataUnmatched: [{ url, status: 201, size: Buffer.byteLength(body) }], dataTruncated: false });
});

test("unmatched large payloads retain byte size and never decode or return their bodies", () => {
  const capture = createJsonCapture({}, { captureDataMatch: "/rows", totalChars: 100 });
  const body = Buffer.from("秘密".repeat(10_000));
  body.toString = () => { throw new Error("unmatched data must never be decoded"); };
  capture.record({ url: "https://noise.example/data", resourceType: "fetch", resource: { status: 200, headers: { "content-type": "application/json" }, body, truncated: false } });
  capture.record({ url: "https://cms.example/rows", resourceType: "fetch", resource: { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from('{}'), truncated: false } });
  expect(capture.result()).toEqual({ data: [{ url: "https://cms.example/rows", status: 200, body: '{}', truncated: false }], dataUnmatched: [{ url: "https://noise.example/data", status: 200, size: 60_000 }], dataTruncated: false });
});

test("filter inventories and matched bodies share the aggregate cap, with separate bounded response counts", () => {
  const capture = createJsonCapture({}, { captureDataMatch: "yes", maxResponses: 2, perBodyChars: 3, totalChars: 10 });
  const record = (url: string) => capture.record({ url, resourceType: "fetch", resource: { status: 200, headers: { "content-type": "application/problem+json" }, body: Buffer.from("123456"), truncated: false } });
  record("no"); record("nx"); record("nz"); // The inventory cap must not consume the matching response slots.
  record("yes"); record("yes2");
  expect(capture.result()).toEqual({ data: [{ url: "yes", status: 200, body: "123", truncated: true }], dataUnmatched: [{ url: "no", status: 200, size: 6 }, { url: "nx", status: 200, size: 6 }], dataTruncated: true });
});

test("unmatched URL length and exhausted inventory budget report truncation", () => {
  const capture = createJsonCapture({}, { captureDataMatch: "yes", totalChars: 2050 });
  const record = (url: string, truncated = false) => capture.record({ url, resourceType: "fetch", resource: { status: 206, headers: { "content-type": "application/json" }, body: Buffer.from("{}"), truncated } });
  record("x".repeat(3000), true); record("more");
  expect(capture.result()).toEqual({ data: [], dataUnmatched: [{ url: "x".repeat(2048), status: 206, size: 2 }], dataTruncated: true });
});

test("omitting a filter keeps the existing result shape and ignores non-JSON or non-data resources", () => {
  const capture = createJsonCapture({});
  for (const [resourceType, contentType] of [["script", "application/json"], ["xhr", "text/html"], ["fetch", "application/json"]]) {
    capture.record({ url: "data", resourceType: resourceType!, resource: { status: 200, headers: { "content-type": contentType! }, body: Buffer.from("{}"), truncated: false } });
  }
  expect(capture.result()).toEqual({ data: [{ url: "data", status: 200, body: "{}", truncated: false }], dataTruncated: false });
});
