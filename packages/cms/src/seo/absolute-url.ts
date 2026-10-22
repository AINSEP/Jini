import type { OriginRegistryPort, VerifiedOrigin } from "@jini-ai/http-kit/verified-origin";
import { OriginNotVerifiedError } from "@jini-ai/http-kit/verified-origin";


/**
 * @file `toAbsoluteUrl`/`resolveWorkspaceOrigin` — the one seam that joins a workspace's verified
 * origin onto a site-relative path (SPEC-008 gap fix, 2026-09-03).
 *
 * Before this file existed, `canonical`, `og:url`, `og:image`, and `twitter:image` all emitted bare
 * paths (`/documentation`, `/m/{assetId}/...`) on both production and local — reproduced with
 * `curl` against both. A relative `rel="canonical"` is technically resolvable by a search engine
 * (it resolves against the page's own URL), but `og:url`/`og:image` MUST be absolute per the Open
 * Graph protocol: every social crawler and link-preview fetcher fails to resolve a relative one, so
 * link previews for the live site were silently broken.
 *
 * Root cause: `platform/routing/routing.ts`'s `composeCanonicalUrl` has carried a `TODO(ADR-040)`
 * since routing was built — "compose canonicalUrl from OriginRegistryPort.canonicalOrigin(ctx) once
 * src/origin exists" — but nothing ever wired it up once `src/origin` (now `features/origin`)
 * landed; `RouteResolveContext.originOverride` (the seam that TODO describes) is never populated by
 * any real caller. This file is that wiring, scoped to SEO's own two call sites
 * (`seo.ts`'s `resolveCanonical`/`resolveShareImages`, and `routes/site/pages.ts`'s
 * `buildExtraHead` for the entry-less home/page canonical) rather than a change to the shared
 * `routing` library itself — `urlFor`/`entryPublicPath`/`RouteResolverDeps` have call sites well
 * outside SEO's ownership (menus, redirects, post tool-registrations), so widening their signature
 * to do an async origin lookup on every call is a separate, larger change than this bug fix.
 *
 * ONE join point, not scattered string concatenation: every caller in this feature that needs an
 * absolute URL goes through {@link toAbsoluteUrl}.
 */

/** Renders a `VerifiedOrigin` as a base URL with no trailing slash (`https://example.com`,
 *  `https://example.com/site`, `http://localhost:3000`).
 *
 *  Local copy, not a shared import — `features/site-evidence/same-origin.ts`'s own
 *  `verifiedOriginToBaseUrl` (the same three-line join) documents why: `newsletter/unsubscribe.ts`,
 *  `newsletter/confirmation.ts`, `redirects/phase-handler.ts`, and `members/write-service.ts` each
 *  already keep a private copy rather than import one, because `features/origin` deliberately
 *  exports no shared formatter — promoting one is a cross-cutting change owned by that module, not
 *  by any one feature. This is the same established convention, not a new one. */
function originBaseUrl(origin: VerifiedOrigin): string {
  const authority = origin.port === undefined ? origin.host : `${origin.host}:${origin.port}`;
  return `${origin.scheme}://${authority}${origin.basePath ?? ""}`;
}

const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Whether `value` already names a full URL (a scheme is present) rather than a site-relative path
 *  — mirrors `platform/routing/routing.ts`'s and `features/seo/media.ts`'s own local copies of the
 *  identical check (both pre-existing, both unexported, so this is a third local copy by the same
 *  convention {@link originBaseUrl} follows above, not a new pattern). */
function isAbsoluteUrl(value: string): boolean {
  return ABSOLUTE_URL_PATTERN.test(value) || value.startsWith("//");
}

/**
 * Joins `path` onto `origin`'s base URL, producing an absolute URL.
 *
 * - `path` already absolute (an author's cross-domain canonical override, EC-10, or an
 *   already-resolved `ogImage`/`twitterImage` ref) is returned UNCHANGED — never double-prefixed.
 * - `origin` absent (no verified origin registered for the workspace yet — the deliberate,
 *   disclosed degradation) returns `path` unchanged, matching today's relative-path behavior. Never
 *   fabricates a broken `undefined/path` URL.
 * - Never doubles the slash on the root path: `postPublicPath`'s own contract guarantees `path`
 *   always starts with exactly one `/` (the root case is the literal string `"/"`, never `""`), and
 *   {@link originBaseUrl} never ends in one, so plain concatenation cannot produce `//`.
 *
 * @complexity O(1).
 */
export function toAbsoluteUrl(required: { origin: VerifiedOrigin | undefined; path: string }, _optional: Record<string, never> = {}): string {
  const { origin, path } = required;
  if (isAbsoluteUrl(path)) return path;
  if (!origin) return path;
  return `${originBaseUrl(origin)}${path}`;
}

/**
 * Resolves the workspace's verified origin for {@link toAbsoluteUrl}, degrading to `undefined`
 * when none is registered yet (`OriginNotVerifiedError` — ADR-040's documented fail-closed
 * precondition on `canonicalOrigin`, not a bug). Any OTHER error is a real registry failure and is
 * rethrown rather than silently swallowed into the same degraded path.
 *
 * 2026-09-18 production sitemap fix: a `dev-capability`-sourced origin (always `http://localhost`,
 * per `origin/types.ts`'s own invariant) is ALSO degraded to `undefined` whenever this process is
 * running in production (`resolveRuntimeMode() === "production"`, which `fly.toml` sets). Root
 * cause this guards against: `server/runtime/composition/deps.ts`'s `seedDevCapabilityOrigin` call
 * used to be the origin registry's ONLY writer, and ran unconditionally on every boot, including
 * the Fly deployment's. Its first boot durably persisted `http://localhost:3000` into
 * `content.db`'s `origin_settings` table, and its own idempotent find-or-create contract (by
 * design, so a future real registration is never clobbered) means that row survives every later
 * boot too — it can never self-correct on its own. Every public SEO
 * document (`sitemap.xml`, `robots.txt`'s `Sitemap:` line, `canonical`, `og:url`, `og:image`) goes
 * through this one seam, so this is the one place that must refuse to let that row leak into a
 * document served to real crawlers. Degrading here reuses the SAME pre-existing "no verified
 * origin" relative-path fallback `toAbsoluteUrl` already had — never a fabricated origin, per
 * INV-07. Outside production (local dev, tests), a `dev-capability` origin still resolves as
 * before — its entire purpose is to let a dev server exercise absolute-URL code paths.
 *
 * STILL LOAD-BEARING after the 2026-09-18 registration work (`features/origin/configured-origin.ts`,
 * design note `ADS-memory/reports/2026-09-18-public-origin-registration-design.md`), which stopped
 * the dev seed from running in production at all. That change prevents NEW poisoned rows; it cannot
 * remove the one production's `content.db` already holds. Until the host's public URL is set on that
 * deployment (and `registerConfiguredOrigin` corrects the row on the next boot), this degradation
 * is the only thing keeping that row out of documents served to real crawlers. Do not delete it as
 * "now redundant".
 *
 * @param required.runtimeMode - Required host runtime mode; the port never chooses a deployment policy.
 * @complexity O(1) plus one `canonicalOrigin` lookup.
 */
export async function resolveWorkspaceOrigin(
  required: { originRegistry: OriginRegistryPort; workspaceId: string; runtimeMode: string },
  _optional: Record<string, never> = {}
): Promise<VerifiedOrigin | undefined> {
  const { originRegistry, workspaceId, runtimeMode } = required;
  try {
    const origin = await originRegistry.canonicalOrigin({ workspaceId });
    if (origin.source === "dev-capability" && runtimeMode === "production") return undefined;
    return origin;
  } catch (err) {
    if (err instanceof OriginNotVerifiedError) return undefined;
    throw err;
  }
}
