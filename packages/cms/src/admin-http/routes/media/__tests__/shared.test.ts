import { expect, it, vi } from "vitest";
import { rejectMediaError, rejectMediaNotFound } from "../shared.js";
import { refusalOf } from "./helpers.js";

it("a missing media asset has a legacy code-less 404 naming the requested asset", async () => {
  expect(await refusalOf(() => rejectMediaNotFound({ mediaId: "thumbnail-7" })))
    .toStrictEqual({ status: 404, body: { error: "media 'thumbnail-7' was not found" } });
});

it("a fixed media refusal never uses private adapter text or calls the outward formatter", async () => {
  const error = new Error("private storage path");
  const outwardErrorMessage = vi.fn(() => "formatted private storage path");
  expect(await refusalOf(() => rejectMediaError({ err: error, outwardErrorMessage, mappings: [{
    matches: ({ err }) => err === error, status: 503, code: "MEDIA_STORE_UNAVAILABLE", error: "Media storage is unavailable.",
  }] }))).toStrictEqual({ status: 503, body: { error: "Media storage is unavailable.", code: "MEDIA_STORE_UNAVAILABLE" } });
  expect(outwardErrorMessage).not.toHaveBeenCalled();
});

it("preserves an injected media classification when a host port throws text", async () => {
  const error = "unsupported media provider setting";
  const outwardErrorMessage = vi.fn();
  expect(await refusalOf(() => rejectMediaError({ err: error, outwardErrorMessage, mappings: [{
    matches: ({ err }) => err === error, status: 400, code: "MEDIA_PROVIDER_INVALID",
  }] }))).toStrictEqual({ status: 400, body: { error: "unsupported media provider setting", code: "MEDIA_PROVIDER_INVALID" } });
  expect(outwardErrorMessage).not.toHaveBeenCalled();
});
