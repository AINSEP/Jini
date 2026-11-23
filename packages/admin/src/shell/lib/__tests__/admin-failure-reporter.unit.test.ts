import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UserFacingError } from "@jini-ai/core";
import { formatUserFacingError } from "@jini-ai/core";
import { createAdminFailureReporter, isClipboardRefusal, type AdminDecodedError } from "../admin-failure-reporter.js";
import { setAdminDraftIdentity } from "../admin-draft-identity.js";

/**
 * @file `createAdminFailureReporter` — the disclosure rules, driven through a fake channel and a
 * small fake vocabulary. The host's own request-stack integration tests pin its real vocabulary.
 */

function fakeChannel() {
  const published: Array<{ failure: UserFacingError; generation?: number }> = [];
  return { published, generation: 7, publish(input: { failure: UserFacingError; generation?: number }) { published.push(input); }, getGeneration() { return this.generation; } };
}

/** Same shape as the protocol decoder: nested `{error: {...}}` or flat body. */
function decodeError({ body }: { body: unknown }): AdminDecodedError {
  const record = (body ?? {}) as Record<string, unknown>;
  const nested = record.error !== null && typeof record.error === "object" ? record.error as Record<string, unknown> : record;
  return { details: nested.details, ...(typeof nested.requestId === "string" ? { requestId: nested.requestId } : {}) };
}

function build() {
  const channel = fakeChannel();
  const reporter = createAdminFailureReporter({
    channel,
    vocabulary: { nouns: { posts: { singular: "post", plural: "posts" } } },
    redaction: {},
    appVersion: "Host Admin 1.0.0",
    jiniVersion: "0.7.3",
    decodeError,
    notRunningCodes: new Set(["PARKED"]),
  }, { now: () => new Date("2026-11-23T00:00:00.000Z"), mintErrorId: () => "local-1" });
  return { channel, reporter };
}

const last = (channel: ReturnType<typeof fakeChannel>) => channel.published.at(-1)?.failure;

beforeEach(() => setAdminDraftIdentity({ id: "owner" }));
afterEach(() => setAdminDraftIdentity({ id: null }));

describe("createAdminFailureReporter", () => {
  it("returns the bound channel and publishes with the captured generation", () => {
    const { channel, reporter } = build();
    expect(reporter.adminFailureChannel).toBe(channel);
    reporter.publishAdminFailure({ body: { errorId: "incident-1" }, path: "/posts/ID", method: "PUT", status: 500, generation: 3 });
    expect(channel.published[0]?.generation).toBe(3);
    expect(last(channel)).toMatchObject({ errorId: "incident-1", cause: "The error ID identifies the server report.", appVersion: "Host Admin 1.0.0", jiniVersion: "0.7.3" });
  });

  it("swaps post wording for page when the caller says the row is a page", () => {
    const { channel, reporter } = build();
    const failure = formatUserFacingError({ message: "The post failed.", action: "Reload posts.", step: "Saving post", cause: "approved" }, { errorId: "a" });
    reporter.publishAdminFailure({ body: { error: { details: { failure } } }, path: "/posts/ID", method: "PUT", status: 500, generation: 1, entry: "page" });
    expect(last(channel)).toMatchObject({ message: "The page failed.", action: "Reload pages." });
  });

  it("names method and redacted path plus the small server reply for an unlisted route after sign-in", () => {
    const { channel, reporter } = build();
    reporter.publishAdminFailure({ body: { error: "Nope", code: "BAD_THING" }, path: "/widgets/ID123?token=x", method: "post", status: 502, generation: 1 }, { basePath: "/api/v1" });
    expect(last(channel)?.step).toBe("POST /api/v1/widgets/:id (HTTP 502)");
    expect(last(channel)?.cause).toContain("The server answered BAD_THING: Nope.");
  });

  it("ignores approved server wording and server text when signed out", () => {
    setAdminDraftIdentity({ id: null });
    const { channel, reporter } = build();
    const failure = formatUserFacingError({ message: "SECRET_CANARY", action: "x", step: "x", cause: "x" }, {});
    reporter.publishAdminFailure({ body: { error: "SECRET_CANARY", code: "BAD", details: { failure } }, path: "/widgets/1", status: 0, generation: 1 });
    expect(last(channel)?.copyText).not.toContain("SECRET_CANARY");
    expect(last(channel)?.step).toBe("Request /widgets/:id (no server response)");
  });

  it("keeps client errors and not-running reads off the page-wide notice, writes stay loud", () => {
    const { reporter } = build();
    expect(reporter.isPageWideFailure({ status: 404, method: "GET" })).toBe(false);
    expect(reporter.isPageWideFailure({ status: 503, method: "get", code: "PARKED" })).toBe(false);
    expect(reporter.isPageWideFailure({ status: 503, method: "POST", code: "PARKED" })).toBe(true);
    expect(reporter.isPageWideFailure({ status: 0, method: "GET" })).toBe(true);
  });

  it("publishes a local failure with a minted id at the current generation", () => {
    const { channel, reporter } = build();
    reporter.publishLocalAdminFailure({ message: "Copy failed.", action: "Try again.", step: "Copy", cause: new Error("boom") });
    expect(channel.published[0]).toMatchObject({ generation: 7, failure: { errorId: "local-1", time: "2026-11-23T00:00:00.000Z" } });
  });
});

it("treats only a NotAllowedError DOMException as a clipboard refusal", () => {
  expect(isClipboardRefusal({ error: new DOMException("no", "NotAllowedError") })).toBe(true);
  expect(isClipboardRefusal({ error: new Error("no") })).toBe(false);
});
