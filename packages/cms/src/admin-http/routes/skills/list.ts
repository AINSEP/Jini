import { ToolInputError } from "@jini-ai/core";
import { defineJsonRoute, ok, routeReply, type JsonRouteAuthorize, type JsonRouteSpec, type RouteReply } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { SkillRoutePrincipal } from "./shared.js";

/**
 * @file `GET /api/admin/v1/workspaces/:workspaceId/skills` — the installed-skills listing, with its
 * own HTTP validators.
 *
 * A plain read: workspace guard, authorize, then the host's listing. The answer carries a weak ETag
 * over the exact JSON body, `Cache-Control: private, no-cache` and `Vary: Cookie`; a matching
 * `If-None-Match` answers a bare 304 with the same validators. Matching happens here, after the
 * permission check, so a cached validator can never bypass the workspace or authorization guards.
 * Unexpected discovery failures go to the host's redacted 500; only the discovery owner's input
 * error (a duplicate skill name, the operator's one actionable signal) is answered verbatim.
 */

/** The installed skills of the served workspace, projected by the host; the route serializes them as given. */
export type ManagedSkillsListFn = (required?: Record<string, never>, optional?: Record<string, never>) => Promise<readonly unknown[]>;

/** The deps this route reads. */
export interface SkillListRouteDeps {
  workspaceId: string;
  listManagedSkills: ManagedSkillsListFn;
}

/** The listing body. */
export interface SkillListEnvelope { skills: readonly unknown[] }

/** The one request header the route reads: the client's cached validators. */
export interface SkillListInput { ifNoneMatch: string | undefined }

type SkillListSpec = JsonRouteSpec<SkillListInput, RouteReply<SkillListEnvelope>, SkillListRouteDeps, SkillRoutePrincipal> & { readHeaders: readonly string[] };

/** Base64url without padding, as Node's `digest("base64url")` writes it. @complexity O(n) in the byte count. */
function base64Url({ bytes }: { bytes: Uint8Array }, _optional: Record<string, never> = {}): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The weak validator over the exact body bytes: `W/"<sha256 base64url>"`, byte-identical to the
 * Node `createHash` value clients already cache. Web Crypto, so the spec stays universal.
 * @complexity O(n) in the body size.
 */
async function weakBodyEtag({ body }: { body: string }, _optional: Record<string, never> = {}): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return `W/"${base64Url({ bytes: new Uint8Array(digest) })}"`;
}

/**
 * Asks for the assistant permission with no entity type and no entity id, exactly as the
 * hand-written route did (its siblings name `skill`; this one never did). Fails closed without an
 * authorizer — a wiring bug. @complexity O(1) plus the injected authorizer.
 */
async function authorizeSkillList({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("skills admin route has no authorizer");
  await authorize({ permission: "admin.assistant.use" });
}

/** The host's listing; its `ToolInputError` (named duplicate folders) is safe to show verbatim. @complexity O(1) plus the listing. */
async function listSkills({ deps }: { deps: SkillListRouteDeps }, _optional: Record<string, never> = {}): Promise<readonly unknown[]> {
  try {
    return await deps.listManagedSkills();
  } catch (error) {
    // C-001 requires the named duplicate folders; only the discovery owner marks this safe.
    if (error instanceof ToolInputError) rejectRoute({ status: 500, error: error.message, code: "INTERNAL_ERROR" });
    throw error;
  }
}

const listSpec = defineJsonRoute<SkillListInput, RouteReply<SkillListEnvelope>, SkillListRouteDeps, SkillRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/skills",
  parse: (raw) => ok({ value: { ifNoneMatch: raw.headers?.["if-none-match"] } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeSkillList({ authorize });
    const body = { skills: await listSkills({ deps }) };
    const etag = await weakBodyEtag({ body: JSON.stringify(body) });
    const headers = { "Cache-Control": "private, no-cache", ETag: etag, Vary: "Cookie" };
    // Not Express's req.fresh: fetch adds `Cache-Control: no-cache` to any request that carries
    // If-None-Match (Fetch spec), and `fresh` reads that as a reload, so it would never send 304.
    if (input.ifNoneMatch?.split(",").some((tag) => tag.trim() === etag)) return ok({ value: routeReply<SkillListEnvelope>({ status: 304, headers }) });
    return ok({ value: routeReply<SkillListEnvelope>({ status: 200, body, headers }) });
  },
});

/** The listing spec, opted into the one request header it reads. */
export const skillListRoute: SkillListSpec = { ...listSpec, readHeaders: ["if-none-match"] };
