import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import type { PinnedPeer } from "@jini-ai/platform/http/guarded";
import { InMemoryCredentialedRequestAuditLog, makeCredentialedRequest } from "../../credentialed-http/credentialed-request.js";
import type { SavedRequestDefinition, SavedRequestDeps } from "../types.js";

export function definition(overrides: Partial<SavedRequestDefinition> = {}): SavedRequestDefinition {
  return {
    version: 1, method: "GET", url: "https://api.example/catalog?public=true",
    credential: { id: "credential-1", revision: "rev-1", origin: "https://api.example" },
    inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 200 } }, required: ["query"], additionalProperties: false },
    queryBindings: { q: "query" }, bodyBindings: {},
    output: { path: ["products"], maxItems: 2, fields: { title: { path: ["title"], type: "string", maxLength: 200 } } },
    ...overrides,
  };
}

export function fixture() {
  const calls: { request: HttpRequest; peer: PinnedPeer }[] = [];
  const resolutions: { workspaceId: string; credentialId: string }[] = [];
  const lookups: string[] = [];
  const deadlines: number[] = [];
  const state = {
    response: { status: 200, headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ products: [{ title: "Public", private: "hidden" }] }) } as HttpResponse,
    credential: { baseUrl: "https://api.example/v1", additionalHosts: ["https://other.example"], connection: { token: "secret-token-value" }, revision: "rev-1" } as Awaited<ReturnType<SavedRequestDeps["credentials"]["resolve"]>>,
    addresses: ["93.184.216.34"],
    failure: undefined as unknown,
    deadline: new AbortController(),
    send: undefined as undefined | ((request: HttpRequest) => Promise<HttpResponse>),
  };
  const audit = new InMemoryCredentialedRequestAuditLog();
  const deps: SavedRequestDeps = {
    executeCredentialedRequest: makeCredentialedRequest,
    credentials: { async resolve(input) { resolutions.push(input); return state.credential; } },
    schemeRegistry: { async load() { return []; } }, audit,
    clock: { nowMs: () => 0, timeoutSignal: ({ timeoutMs }) => { deadlines.push(timeoutMs); return state.deadline.signal; } },
    dns: { async resolve({ hostname }) { lookups.push(hostname); return state.addresses; } },
    transport: { async requestPinned({ request, peer }) {
      calls.push({ request, peer });
      if (state.failure !== undefined) throw state.failure;
      if (state.send) return state.send(request);
      return state.response;
    } },
    userAgent: "SavedRequestTest/1", forbiddenOrigins: ["https://site.example", "https://admin.example"],
  };
  return { deps, state, calls, resolutions, lookups, deadlines, audit };
}
