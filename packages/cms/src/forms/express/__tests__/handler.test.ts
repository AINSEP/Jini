import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { afterEach, test, vi } from "vitest";
import { FormDefinitionNotFoundError, FormRateLimitExceededError, FormSubmissionValidationError, FormSubmissionTooFastError } from "../../errors.js";
import type { FormDefinitionRecord } from "../../types.js";
import {
  createFormSubmitHandler,
  type CreateFormSubmitHandlerRequired,
  type FormSubmissionRedirectResult,
} from "../index.js";

/**
 * @file The public form-submission route's HTTP boundary: JSON for fetch/API callers, a same-origin
 * Post/Redirect/Get 303 for JS-disabled browser form POSTs, and the validation flash cookie that keeps
 * a visitor's other typed answers across that redirect. Request/response are hand-written fakes of the
 * few Express members the handler touches; every collaborator is an injected port.
 */

const DEFINITION: FormDefinitionRecord = {
  id: "form-1", workspaceId: "ws-1", name: "Contact", slug: "contact",
  fields: [
    { id: "name", label: "Name", type: "text", required: true },
    { id: "email", label: "Email", type: "email", required: true },
    { id: "message", label: "Message", type: "textarea", required: false },
    { id: "consent", label: "Consent", type: "checkbox", required: false },
    { id: "empty", label: "Empty", type: "text", required: false },
  ],
  notify: { enabled: false, recipients: [] }, status: "active", version: 1,
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
};

interface Sent {
  status?: number;
  json?: unknown;
  redirect?: { status: number; location: string };
  cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>;
}

interface Calls {
  submitted: unknown[];
  lookups: unknown[];
  encodedResults: FormSubmissionRedirectResult[];
  flashPayloads: unknown[];
}

function harness(overrides: Partial<CreateFormSubmitHandlerRequired> = {}, codec: Partial<CreateFormSubmitHandlerRequired["resultCodec"]> = {}) {
  const calls: Calls = { submitted: [], lookups: [], encodedResults: [], flashPayloads: [] };
  const deps: CreateFormSubmitHandlerRequired = {
    workspaceId: "ws-1",
    submit: async (required) => { calls.submitted.push(required.input); return { status: "accepted" }; },
    definitionRepo: { findBySlug: async (input) => { calls.lookups.push(input); return DEFINITION; } },
    resolveClientIp: () => "203.0.113.9",
    isHttpsRequest: () => false,
    targetRefusalReason: (target) => (target.startsWith("//") ? "protocol-relative" : null),
    resultCodec: {
      encodeResultQuery: (result) => { calls.encodedResults.push(result); return [["form_result", result.kind], ["form_slug", result.slug]]; },
      clearResultQueryParams: (params) => { for (const key of [...params.keys()]) if (key.startsWith("form_")) params.delete(key); },
      encodeFlashCookie: (payload) => { calls.flashPayloads.push(payload); return JSON.stringify(payload); },
      flashCookieName: "form_flash",
      ...codec,
    },
    ...overrides,
  };
  return { deps, calls };
}

function request(options: { slug?: string; body?: unknown; headers?: Record<string, string>; protocol?: string } = {}): Request {
  const headers = Object.fromEntries(Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    params: options.slug === undefined ? {} : { slug: options.slug },
    body: options.body,
    protocol: options.protocol ?? "http",
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

async function send(deps: CreateFormSubmitHandlerRequired, req: Request): Promise<Sent> {
  const sent: Sent = { cookies: [] };
  const res = {
    status(code: number) { sent.status = code; return this; },
    json(payload: unknown) { sent.json = payload; return this; },
    redirect(status: number, location: string) { sent.redirect = { status, location }; },
    cookie(name: string, value: string, options: Record<string, unknown>) { sent.cookies.push({ name, value, options }); return this; },
  };
  await createFormSubmitHandler(deps, {})(req, res as unknown as Response);
  return sent;
}

const HTML_HEADERS = { accept: "text/html,application/xhtml+xml", host: "site.example" };

test("a JSON timing refusal answers 422 with fixed retry copy and no flash cookie", async () => {
  const { deps, calls } = harness({ submit: async () => { throw new FormSubmissionTooFastError({}, {}); } });
  const sent = await send(deps, request({ slug: "contact", body: { name: "Ada", _attempt: "issued" } }));
  assert.equal(sent.status, 422);
  assert.deepEqual(sent.json, { error: "Please wait a moment, then submit again.", code: "FORMS_SUBMISSION_TOO_FAST" });
  assert.deepEqual([sent.cookies, calls.lookups], [[], []]);
});

test("a native timing refusal redirects with a retry result and flashes only eligible text", async () => {
  const { deps, calls } = harness({ submit: async () => { throw new FormSubmissionTooFastError({}, {}); } });
  const sent = await send(deps, request({ slug: "contact", headers: { ...HTML_HEADERS, referer: "http://site.example/contact?keep=1" },
    body: { name: "Ada", email: "ada@example.com", message: "Hello", consent: "on", _hp: "", _attempt: "issued", photo: { bytes: new Uint8Array([1]) }, extra: "excluded" },
  }));
  assert.deepEqual(sent.redirect, { status: 303, location: "/contact?keep=1&form_result=too-fast&form_slug=contact" });
  assert.deepEqual(calls.encodedResults, [{ kind: "too-fast", slug: "contact" }]);
  assert.deepEqual(calls.flashPayloads, [{ slug: "contact", values: { name: "Ada", email: "ada@example.com", message: "Hello" } }]);
  assert.deepEqual(sent.cookies, [{ name: "form_flash", value: JSON.stringify(calls.flashPayloads[0]),
    options: { httpOnly: true, path: "/", maxAge: 120000, sameSite: "lax", secure: false },
  }]);
});

afterEach(() => { vi.restoreAllMocks(); });

test("a JSON caller's accepted submission answers 201 and passes workspace, slug, body and client IP to submit", async () => {
  const { deps, calls } = harness();
  const sent = await send(deps, request({ slug: "contact", body: { name: "Ada" }, headers: { accept: "application/json" } }));
  assert.equal(sent.status, 201);
  assert.deepEqual(sent.json, { status: "accepted" });
  assert.deepEqual(calls.submitted, [{ workspaceId: "ws-1", slug: "contact", body: { name: "Ada" }, sourceIp: "203.0.113.9" }]);
  assert.equal(sent.redirect, undefined);
});

test("a request without a slug param or body submits an empty slug and an empty body instead of crashing", async () => {
  const { deps, calls } = harness();
  await send(deps, request());
  assert.deepEqual(calls.submitted, [{ workspaceId: "ws-1", slug: "", body: {}, sourceIp: "203.0.113.9" }]);
});

test("a caller with no Accept header keeps the JSON contract", async () => {
  const { deps } = harness({ submit: async () => { throw new FormDefinitionNotFoundError({ message: "form 'x' not found" }); } });
  const sent = await send(deps, request({ slug: "x" }));
  assert.equal(sent.status, 404);
  assert.deepEqual(sent.json, { error: "form 'x' not found", code: "FORMS_DEFINITION_NOT_FOUND" });
});

test("a JSON validation failure answers 400 with field errors and never reads the definition for a flash cookie", async () => {
  const fieldErrors = [{ field: "email", reason: "invalid_email" }];
  const { deps, calls } = harness({ submit: async () => { throw new FormSubmissionValidationError({ message: "invalid", fieldErrors }); } });
  const sent = await send(deps, request({ slug: "contact", body: { email: "nope" }, headers: { accept: "*/*" } }));
  assert.equal(sent.status, 400);
  assert.deepEqual(sent.json, { error: "invalid", code: "FORMS_SUBMISSION_VALIDATION_ERROR", details: { fieldErrors } });
  assert.deepEqual(calls.lookups, []);
  assert.deepEqual(sent.cookies, []);
});

test("a JSON rate-limited submission answers 429 with the retry delay", async () => {
  const { deps } = harness({ submit: async () => { throw new FormRateLimitExceededError({ message: "slow down", retryAfterSeconds: 42 }); } });
  const sent = await send(deps, request({ slug: "contact" }));
  assert.equal(sent.status, 429);
  assert.deepEqual(sent.json, { error: "slow down", code: "FORMS_RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds: 42 } });
});

test("an unexpected failure answers a generic 500 without leaking the error message", async () => {
  const { deps } = harness({ submit: async () => { throw new Error("db password in here"); } });
  const sent = await send(deps, request({ slug: "contact" }));
  assert.equal(sent.status, 500);
  assert.deepEqual(sent.json, { error: "internal error", code: "INTERNAL_ERROR" });
});

test("a browser form POST is redirected 303 back to its same-origin Referer with stale form params replaced", async () => {
  const { deps, calls } = harness();
  const sent = await send(deps, request({
    slug: "contact", body: { name: "Ada" },
    headers: { ...HTML_HEADERS, referer: "http://site.example/about?keep=1&form_result=error&form_slug=old" },
  }));
  assert.deepEqual(sent.redirect, { status: 303, location: "/about?keep=1&form_result=success&form_slug=contact" });
  assert.deepEqual(calls.encodedResults, [{ kind: "success", slug: "contact" }]);
  assert.equal(sent.status, undefined);
});

test("a browser form POST without a Referer is redirected to the site root", async () => {
  const { deps } = harness();
  const sent = await send(deps, request({ slug: "contact", headers: HTML_HEADERS }));
  assert.deepEqual(sent.redirect, { status: 303, location: "/?form_result=success&form_slug=contact" });
});

test("a cross-origin, unparsable or protocol-relative Referer never becomes the redirect target", async () => {
  for (const referer of ["https://evil.example/phish", "not a url", "http://site.example//evil.example/x"]) {
    const { deps } = harness();
    const sent = await send(deps, request({ slug: "contact", headers: { ...HTML_HEADERS, referer } }));
    assert.deepEqual(sent.redirect, { status: 303, location: "/?form_result=success&form_slug=contact" }, referer);
  }
});

test("a browser form POST with no Host header still redirects to the site root", async () => {
  const { deps } = harness();
  const sent = await send(deps, request({ slug: "contact", headers: { accept: "text/html", referer: "http://site.example/about" } }));
  assert.deepEqual(sent.redirect, { status: 303, location: "/?form_result=success&form_slug=contact" });
});

test("each typed failure reaches a browser as its own redirect result kind", async () => {
  const cases: Array<[Error, FormSubmissionRedirectResult]> = [
    [new FormDefinitionNotFoundError({ message: "missing" }), { kind: "error", slug: "contact" }],
    [new FormRateLimitExceededError({ message: "slow", retryAfterSeconds: 7 }), { kind: "rate-limited", slug: "contact", retryAfterSeconds: 7 }],
    [new Error("boom"), { kind: "error", slug: "contact" }],
  ];
  for (const [error, expected] of cases) {
    const { deps, calls } = harness({ submit: async () => { throw error; } });
    const sent = await send(deps, request({ slug: "contact", headers: HTML_HEADERS }));
    assert.deepEqual(calls.encodedResults, [expected]);
    assert.equal(sent.redirect?.status, 303);
  }
});

test("a browser validation failure flashes only declared, re-typeable, non-empty answers in a lax HttpOnly cookie", async () => {
  const fieldErrors = [{ field: "email", reason: "invalid_email" }];
  const { deps, calls } = harness({ submit: async () => { throw new FormSubmissionValidationError({ message: "invalid", fieldErrors }); } });
  const body = { name: "Ada", email: "nope", message: "Hello", consent: "yes", empty: "", _hp: "", undeclared: "x", count: 3 };
  const sent = await send(deps, request({ slug: "contact", body, headers: { ...HTML_HEADERS, referer: "http://site.example/contact-page" } }));
  assert.deepEqual(calls.lookups, [{ workspaceId: "ws-1", slug: "contact" }]);
  const flashed = { slug: "contact", values: { name: "Ada", email: "nope", message: "Hello" } };
  assert.deepEqual(calls.flashPayloads, [flashed]);
  assert.deepEqual(sent.cookies, [{
    name: "form_flash", value: JSON.stringify(flashed),
    options: { httpOnly: true, path: "/", maxAge: 120_000, sameSite: "lax", secure: false },
  }]);
  assert.deepEqual(calls.encodedResults, [{ kind: "validation", slug: "contact", fieldErrors }]);
  assert.deepEqual(sent.redirect, { status: 303, location: "/contact-page?form_result=validation&form_slug=contact" });
});

test("the flash cookie is marked Secure exactly when the host reports an HTTPS request", async () => {
  const { deps } = harness({
    isHttpsRequest: () => true,
    submit: async () => { throw new FormSubmissionValidationError({ message: "invalid" }); },
  });
  const sent = await send(deps, request({ slug: "contact", body: { name: "Ada" }, headers: HTML_HEADERS, protocol: "https" }));
  assert.equal(sent.cookies[0]?.options.secure, true);
});

test("no flash cookie is set when nothing is worth repopulating or the definition has vanished", async () => {
  const invalid = async (): Promise<{ status: "accepted" }> => { throw new FormSubmissionValidationError({ message: "invalid" }); };
  const nothingTyped = harness({ submit: invalid });
  const first = await send(nothingTyped.deps, request({ slug: "contact", body: { consent: "yes" }, headers: HTML_HEADERS }));
  assert.deepEqual(first.cookies, []);
  assert.deepEqual(nothingTyped.calls.flashPayloads, []);

  const vanished = harness({ submit: invalid, definitionRepo: { findBySlug: async () => null } });
  const second = await send(vanished.deps, request({ slug: "contact", body: { name: "Ada" }, headers: HTML_HEADERS }));
  assert.deepEqual(second.cookies, []);
  assert.equal(second.redirect?.status, 303);
});

test("an oversized flash payload the codec refuses still redirects, just without a cookie", async () => {
  const { deps, calls } = harness(
    { submit: async () => { throw new FormSubmissionValidationError({ message: "invalid" }); } },
    { encodeFlashCookie: (payload) => { calls.flashPayloads.push(payload); return undefined; } },
  );
  const sent = await send(deps, request({ slug: "contact", body: { name: "Ada" }, headers: HTML_HEADERS }));
  assert.equal(calls.flashPayloads.length, 1);
  assert.deepEqual(sent.cookies, []);
  assert.deepEqual(sent.redirect, { status: 303, location: "/?form_result=validation&form_slug=contact" });
});

test("a failing definition lookup is logged and the validation redirect still happens", async () => {
  const logged: unknown[][] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logged.push(args); });
  const lookupError = new Error("db down");
  const { deps } = harness({
    submit: async () => { throw new FormSubmissionValidationError({ message: "invalid" }); },
    definitionRepo: { findBySlug: async () => { throw lookupError; } },
  });
  const sent = await send(deps, request({ slug: "contact", body: { name: "Ada" }, headers: HTML_HEADERS }));
  assert.deepEqual(logged, [["[site/forms-submit] failed to set validation flash cookie (slug=contact)", lookupError]]);
  assert.deepEqual(sent.cookies, []);
  assert.deepEqual(sent.redirect, { status: 303, location: "/?form_result=validation&form_slug=contact" });
});
