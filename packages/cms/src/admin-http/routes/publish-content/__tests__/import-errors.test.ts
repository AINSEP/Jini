import { TokenAlreadyRedeemedError, TokenExpiredError } from "@jini-ai/core/gated-mutations";
import { expect, it } from "vitest";

import { RestorePointUnavailableError } from "../../../../publish/content/execute-import.js";
import { PublishContentBundleNotFoundError } from "../../../../publish/content/gated-hooks.js";
import { knownImportErrorResponse, type ImportErrorHost } from "../import-errors.js";

class FakeForbidden extends Error { constructor(message: string, readonly reasonCode: string) { super(message); } }
class FakeStale extends Error {}
class FakePlugin extends Error {}

const host: ImportErrorHost = {
  readForbiddenReason: ({ error }) => (error instanceof FakeForbidden ? { message: error.message, reasonCode: error.reasonCode } : undefined),
  isStalePlan: ({ error }) => error instanceof FakeStale,
  pluginHookBody: ({ error }) => (error instanceof FakePlugin ? { error: "A plugin refused this change.", code: "PLUGIN_HOOK_FAILED", pluginId: "p1", errorId: "e1" } : undefined),
};

it("expired and redeemed tokens remain distinct and plugin text stays redacted", () => {
  expect(knownImportErrorResponse({ err: new TokenExpiredError({ message: "expired msg" }), host })).toEqual({ status: 409, body: { error: "expired msg", code: "TOKEN_EXPIRED" } });
  expect(knownImportErrorResponse({ err: new TokenAlreadyRedeemedError({ message: "redeemed msg" }), host })).toEqual({ status: 409, body: { error: "redeemed msg", code: "TOKEN_ALREADY_REDEEMED" } });
  const plugin = knownImportErrorResponse({ err: new FakePlugin("secret /etc/path SQL token=abc"), host });
  expect(plugin).toEqual({ status: 500, body: { error: "A plugin refused this change.", code: "PLUGIN_HOOK_FAILED", pluginId: "p1", errorId: "e1" } });
  expect(JSON.stringify(plugin)).not.toContain("secret");
});

it("keeps the exact 403/409/404 distinction and answers undefined for unknown failures", () => {
  expect(knownImportErrorResponse({ err: new FakeForbidden("no", "FORBIDDEN_X"), host })).toEqual({ status: 403, body: { error: "no", code: "FORBIDDEN_X" } });
  expect(knownImportErrorResponse({ err: new FakeStale("stale"), host })).toEqual({ status: 409, body: { error: "stale", code: "PLAN_STALE" } });
  expect(knownImportErrorResponse({ err: new RestorePointUnavailableError({ message: "rp" }), host })?.status).toBe(409);
  expect(knownImportErrorResponse({ err: new PublishContentBundleNotFoundError({ message: "b" }), host })).toEqual({ status: 404, body: { error: "b", code: "BUNDLE_NOT_FOUND" } });
  expect(knownImportErrorResponse({ err: new Error("private driver detail"), host })).toBeUndefined();
  expect(knownImportErrorResponse({ err: "string", host })).toBeUndefined();
});

it("keeps the stale-plan code without leaking a non-Error classifier value", () => {
  const stale = "private upstream detail";
  expect(knownImportErrorResponse({ err: stale, host: { ...host, isStalePlan: ({ error }) => error === stale } }))
    .toStrictEqual({ status: 409, body: { code: "PLAN_STALE", error: "" } });
});
