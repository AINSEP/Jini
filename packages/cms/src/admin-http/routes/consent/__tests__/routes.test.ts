import { describe, expect, it } from "vitest";
import { ToolInputError, ToolPermissionDeniedError } from "@jini-ai/core";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import {
  CONSENT_RESPONSE_HEADERS, consentDryRunRoute, consentPreviewRoute, consentPublishRoute, consentReadinessRoute,
  consentSettingsGetRoute, consentSettingsPutRoute, type ConsentRouteDeps,
} from "../routes.js";

/** @file Consent route specs: paths, headers, per-route permission, request reading and the error ladder. */

const BASE = "/api/admin/v1/workspaces/:workspaceId/consent";
const signal = new AbortController().signal;
const PRINCIPAL = { id: "owner" };
class ConflictFake extends Error {}

type Call = { op: string; args: unknown };

/** Fake deps recording every service call; the request readers mirror the host's closed-contract readers. */
function fakeDeps(fail?: () => never): { deps: ConsentRouteDeps; calls: Call[] } {
  const calls: Call[] = [];
  const op = (name: string) => async (args: unknown) => { calls.push({ op: name, args }); if (fail) fail(); return { op: name }; };
  return {
    calls,
    deps: {
      workspaceId: "ws",
      consent: { read: op("read"), readiness: op("readiness"), preview: op("preview"), saveDraft: op("saveDraft"), publish: op("publish") },
      readConsentRequest: ({ body, fields }) => {
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new ToolInputError({ message: "Request must be a JSON object." });
        if (Object.keys(body).some((key) => !fields.includes(key))) throw new ToolInputError({ message: "Unknown consent request field." });
        return body as Record<string, unknown>;
      },
      consentRevisionToken: ({ input, key }) => {
        const value = input[key];
        if (value === null || typeof value === "string") return value;
        throw new ToolInputError({ message: `${key} must be a revision id or null.` });
      },
      isConsentConflict: (error) => error instanceof ConflictFake,
    },
  };
}

function recording() {
  const seen: unknown[] = [];
  return { seen, authorize: async (r: { permission: string; entityType?: string }, o: { entityId?: string } = {}) => { seen.push({ ...r, ...o }); } };
}

const raw = ({ body, query = {} }: { body?: unknown; query?: Record<string, unknown> | undefined } = {}) => ({ body, query, params: { workspaceId: "ws" } });

async function run(route: typeof consentSettingsGetRoute, { body, query, deps = fakeDeps().deps, authorize = recording().authorize }: { body?: unknown; query?: Record<string, unknown>; deps?: ConsentRouteDeps; authorize?: ReturnType<typeof recording>["authorize"] } = {}) {
  const parsed = route.parse(raw({ body, query }));
  if (!parsed.ok) throw new Error("parse refused");
  return route.handle({ input: parsed.value, deps, context: PRINCIPAL, authorize }, { signal });
}

async function refusalOf(fn: () => Promise<unknown>) {
  try { await fn(); } catch (error) { if (error instanceof RouteRefusalError) return error.response; throw error; }
  throw new Error("expected a refusal");
}

const ROUTES = [
  { route: consentSettingsGetRoute, method: "get", suffix: "/settings", write: false },
  { route: consentReadinessRoute, method: "get", suffix: "/readiness", write: false },
  { route: consentDryRunRoute, method: "post", suffix: "/dry-run", write: false },
  { route: consentPreviewRoute, method: "post", suffix: "/preview", write: false },
  { route: consentSettingsPutRoute, method: "put", suffix: "/settings", write: true },
  { route: consentPublishRoute, method: "post", suffix: "/publish", write: true },
] as const;

describe("consent route specs", () => {
  for (const { route, method, suffix, write } of ROUTES) {
    it(`${method} ${suffix}: path, no-store on every answer, no cap, read/write permission on site-consent`, async () => {
      expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual([method, `${BASE}${suffix}`, undefined, undefined]);
      expect(route.responseHeaders).toBe(CONSENT_RESPONSE_HEADERS);
      const { seen, authorize } = recording();
      const body = suffix === "/publish" ? { draftId: "d1", expectedPublishedId: null } : method === "put" ? { config: {}, expectedDraftId: null } : {};
      await run(route, { body, authorize });
      expect(seen).toEqual([{ permission: write ? "settings.workspace.write" : "settings.read", entityType: "site-consent" }]);
    });

    it(`${method} ${suffix}: a denied authorization reaches no service call`, async () => {
      const { deps, calls } = fakeDeps();
      await expect(run(route, { body: {}, deps, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
      expect(calls).toEqual([]);
    });
  }

  it("pins the header value the hand-written routes set", () => {
    expect(CONSENT_RESPONSE_HEADERS).toEqual({ "Cache-Control": "no-store" });
  });

  it("forwards the principal and request fields to the service", async () => {
    const { deps, calls } = fakeDeps();
    expect(await run(consentSettingsGetRoute, { deps })).toEqual({ ok: true, value: { op: "read" } });
    await run(consentReadinessRoute, { deps, query: { path: "/privacy" } });
    await run(consentDryRunRoute, { deps, body: { path: "/", config: { a: 1 } } });
    await run(consentPreviewRoute, { deps, body: {} });
    await run(consentSettingsPutRoute, { deps, body: { config: { a: 1 }, expectedDraftId: "d0" } });
    await run(consentPublishRoute, { deps, body: { draftId: "d1", expectedPublishedId: null } });
    expect(calls).toEqual([
      { op: "read", args: { principalId: "owner" } },
      { op: "readiness", args: { principalId: "owner", path: "/privacy" } },
      { op: "readiness", args: { principalId: "owner", path: "/", config: { a: 1 } } },
      { op: "preview", args: { principalId: "owner", path: undefined } },
      { op: "saveDraft", args: { principalId: "owner", config: { a: 1 }, expectedDraftId: "d0" } },
      { op: "publish", args: { principalId: "owner", draftId: "d1", expectedPublishedId: null } },
    ]);
  });

  it("refuses malformed requests with the validation 400 (code first), after authorization", async () => {
    const validation = (error: string) => ({ status: 400, body: { code: "CONSENT_VALIDATION_FAILED", error } });
    expect(await refusalOf(() => run(consentReadinessRoute, { query: { path: ["/a"] } }))).toEqual(validation("path must be one local page path."));
    expect(await refusalOf(() => run(consentDryRunRoute, { body: { path: 7 } }))).toEqual(validation("path must be one local page path."));
    expect(await refusalOf(() => run(consentPreviewRoute, { body: { path: 7 } }))).toEqual(validation("path must be one local page path."));
    expect(await refusalOf(() => run(consentDryRunRoute, { body: { confirm: true } }))).toEqual(validation("Unknown consent request field."));
    expect(await refusalOf(() => run(consentPublishRoute, { body: { draftId: null, expectedPublishedId: null } }))).toEqual(validation("draftId must name a saved draft."));
    const refusal = await refusalOf(() => run(consentPreviewRoute, { body: { confirm: true } }));
    expect(Object.keys(refusal.body as object)).toEqual(["code", "error"]);
  });

  it("maps a revision conflict to 409 and a permission denial to the fixed 403 copy; rethrows anything else", async () => {
    const conflict = fakeDeps(() => { throw new ConflictFake("draft moved"); }).deps;
    expect(await refusalOf(() => run(consentSettingsPutRoute, { deps: conflict, body: { config: {}, expectedDraftId: null } }))).toEqual({ status: 409, body: { code: "CONSENT_REVISION_CONFLICT", error: "draft moved" } });
    const denied = fakeDeps(() => { throw new ToolPermissionDeniedError({ message: "secret reason" } as never); }).deps;
    expect(await refusalOf(() => run(consentSettingsGetRoute, { deps: denied }))).toEqual({ status: 403, body: { code: "FORBIDDEN", error: "Permission to access cookie consent was denied." } });
    const broken = fakeDeps(() => { throw new Error("disk gone"); }).deps;
    await expect(run(consentSettingsGetRoute, { deps: broken })).rejects.toThrow("disk gone");
  });

  it("lets a host refusal from authorize through unchanged", async () => {
    const refused = new RouteRefusalError({ status: 403, body: { error: "nope" } });
    await expect(run(consentSettingsGetRoute, { authorize: async () => { throw refused; } })).rejects.toBe(refused);
  });
});
