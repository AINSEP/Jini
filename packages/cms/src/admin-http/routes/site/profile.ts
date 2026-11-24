import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

/**
 * @file `GET /api/admin/v1/workspaces/:workspaceId/site/profile` — the admin frontend's door to the
 * SAME site-profile builder the host's agent tool calls.
 *
 * This route exists because the admin frontend is a browser bundle and cannot invoke an agent tool.
 * It is the reason the aggregation lives in a shared service rather than inside a tool handler:
 * without it, the frontend would need a second implementation, and this codebase has already
 * produced exactly that divergence once (two independently-maintained "effective settings"
 * implementations that drifted on principal handling).
 *
 * ---------------------------------------------------------------------------
 * Why this route does NOT `authorize()` before calling the builder
 * ---------------------------------------------------------------------------
 * Every other admin read route opens with a single `authorize(...)` and 403s on denial. This one
 * deliberately does not, and the difference is the point of the feature.
 *
 * The builder makes one authorization decision PER SECTION, each against the permission that
 * section's own domain already enforces, and marks a denied section `forbidden` rather than failing
 * the whole response. A blanket check here would either refuse a caller who is entitled to four of
 * the five sections, or (the realistic accident) read as "this route is authorized" and invite a
 * future maintainer to drop the per-section gates, which is precisely the privilege-escalation
 * bypass this design exists to prevent.
 *
 * The route is still authenticated: the host mounts its session middleware on the admin prefix, so
 * the principal always resolves, and that principal is what every section is authorized as. A
 * principal with no grants gets a well-formed 200 in which every section is `forbidden` — which
 * discloses nothing it could not learn by calling the underlying admin routes and being refused by
 * each.
 *
 * Response shape and secret-safety are the builder's, not this file's: nothing is projected,
 * filtered or redacted here. That is what makes a real-server scan of this route's body meaningful
 * evidence for the agent tool too — both adapters return the same object from the same builder.
 */

/** The principal fields this route reads: only the id every section is authorized as. */
export interface SiteProfileRoutePrincipal { id: string }

/** What the caller scoped: which sections (`undefined` = all) and how many page rows (`undefined` = the builder's default). */
export interface SiteProfileOptions {
  sections?: readonly string[] | undefined;
  pageLimit?: number | undefined;
}

/**
 * The host's profile builder, already bound to its own sources. It authorizes each section itself,
 * as the given principal, and answers the JSON body the route sends.
 */
export type SiteProfileBuildFn = (required: { principalId: string }, optional?: SiteProfileOptions) => Promise<object>;

/**
 * The deps this route reads. The section vocabulary and the page cap are the builder's own
 * constants, injected so the route validates against exactly what the builder understands.
 */
export interface SiteProfileRouteDeps {
  workspaceId: string;
  /** The closed section vocabulary the builder accepts. */
  sectionNames: readonly string[];
  /** The largest `pageLimit` the builder honours. */
  maxPageItems: number;
  buildSiteProfile: SiteProfileBuildFn;
}

/** The two raw query values, exactly as the server framework produced them (a string, an array when repeated, or an object when nested). */
export interface SiteProfileQueryInput { sections: unknown; pageLimit: unknown }

/** A malformed query answers 400 with the offending rule named, never a silently coerced default. @complexity O(1). */
function refuseQuery(error: string): never {
  return rejectRoute({ status: 400, error, code: "VALIDATION_ERROR" });
}

/**
 * Flattens `raw` (a query-string value the framework hands back as a string or an array of strings
 * when `?sections=` is repeated) into a comma-split, trimmed, non-empty name list.
 *
 * @complexity O(S) in the requested-section count.
 */
function splitRequestedSectionNames({ raw }: { raw: unknown }, _optional = {}): string[] {
  const parts = Array.isArray(raw) ? raw : [raw];
  const names: string[] = [];
  for (const part of parts) {
    if (typeof part !== "string") refuseQuery("sections must be a comma-separated string of section names");
    for (const name of part.split(",")) {
      const trimmed = name.trim();
      if (trimmed !== "") names.push(trimmed);
    }
  }
  return names;
}

/**
 * Rejects any name outside the closed section vocabulary rather than dropping it: a caller that
 * asked for `secrets` and got a response with no `secrets` key could not tell "no such section"
 * from "that section was empty".
 *
 * @complexity O(S) in the requested-section count.
 */
function assertKnownSectionNames({ names, sectionNames }: { names: string[]; sectionNames: readonly string[] }, _optional = {}): void {
  const known = new Set<string>(sectionNames);
  for (const name of names) {
    if (!known.has(name)) refuseQuery(`unknown section '${name}' — valid sections are: ${sectionNames.join(", ")}`);
  }
}

/**
 * Parses `?sections=pages,theme` into the closed section vocabulary.
 *
 * The framework parses a repeated `?sections=a&sections=b` into an array, so both spellings are
 * accepted and normalized here rather than forcing the frontend to pick one.
 *
 * @returns The requested names, or `undefined` when the caller did not scope the request (absent or blank).
 * @throws A 400 route refusal on a non-string/array value or an unknown section name.
 * @complexity O(S) in the requested-section count.
 * @example parseSections({ raw: "pages,theme", sectionNames }); // => ["pages", "theme"]
 */
export function parseSections({ raw, sectionNames }: { raw: unknown; sectionNames: readonly string[] }, _optional = {}): string[] | undefined {
  if (raw === undefined) return undefined;
  const names = splitRequestedSectionNames({ raw });
  if (names.length === 0) return undefined;
  assertKnownSectionNames({ names, sectionNames });
  return names;
}

/**
 * Parses `?pageLimit=25` into a positive integer.
 *
 * Out-of-range values are REJECTED here rather than silently clamped, even though the builder would
 * clamp them anyway: an admin UI that sent `pageLimit=5000` and quietly received 200 rows would have
 * no signal that its request was not honored.
 *
 * @returns The parsed limit, or `undefined` when absent.
 * @throws A 400 route refusal when present but not an integer in `[1, maxPageItems]`.
 * @complexity O(1).
 * @example parsePageLimit({ raw: "25", maxPageItems: 200 }); // => 25
 */
export function parsePageLimit({ raw, maxPageItems }: { raw: unknown; maxPageItems: number }, _optional = {}): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") refuseQuery("pageLimit must be a single integer value");
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxPageItems) {
    refuseQuery(`pageLimit must be an integer between 1 and ${maxPageItems}, got '${raw}'`);
  }
  return parsed;
}

/** The authenticated principal's id, which every section is authorized as. @complexity O(1). */
function siteProfileActorId({ context }: { context: SiteProfileRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("site profile admin route has no authenticated principal");
  return context.id;
}

/**
 * Builds the site profile for the authenticated principal, scoped by the validated query.
 *
 * The principal is read BEFORE the query is validated, as the hand-written route did: a request with
 * no session fails closed as the host's redacted 500 even when its query is also malformed.
 *
 * @complexity O(1) plus the injected builder.
 */
export const siteProfileRoute = defineJsonRoute<SiteProfileQueryInput, object, SiteProfileRouteDeps, SiteProfileRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/site/profile",
  parse: (raw) => ok({ value: { sections: raw.query.sections, pageLimit: raw.query.pageLimit } }),
  handle: async ({ input, deps, context }) => {
    const principalId = siteProfileActorId({ context });
    const sections = parseSections({ raw: input.sections, sectionNames: deps.sectionNames });
    const pageLimit = parsePageLimit({ raw: input.pageLimit, maxPageItems: deps.maxPageItems });
    // No blanket authorize() — see this file's header. Every section is authorized inside the
    // builder against its own domain's permission, as THIS principal.
    return ok({ value: await deps.buildSiteProfile({ principalId }, { sections, pageLimit }) });
  },
});
