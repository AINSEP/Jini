import { withToolMetadata, type HostReadVocabulary, type ToolContributor, type ToolMetadataById, type ToolRegistration } from "@jini-ai/core";
import type { PrincipalRepoPort } from "@jini-ai/core/contracts/site/user-management";
import type { SettingsRepoPort } from "@jini-ai/core/settings";
import { buildSeoToolRegistrations, seoDerivedRisk, type SeoPackageToolDeps } from "../tool-registrations.js";
import { getSeoSettings, setSeoSettings, type SeoSettingsLedgerBindings } from "./settings.js";

/**
 * @file SEO's half of ADR-049 Decision 4, the host binding: the catalog, the six handlers, the
 * authored risk map and the typed-error mapping live in `@jini-ai/cms/seo`
 * (`buildSeoToolRegistrations`). This file supplies what is the host's: the settings ledger read and
 * write, the search vocabulary and approval policy (`toolMetadata`), and the route deps the
 * handlers read. The ledger collaborators and the tool metadata are injected through
 * {@link SeoToolHostPolicy}.
 */

/**
 * The exact slice of the route-deps bag SEO's tool handlers read. Declared structurally (rather
 * than importing the host's `RouteDeps`) so this module carries no back-edge into the
 * composition root. The host's route deps satisfy this structurally by passing its existing
 * `RouteDeps` object; nothing there changes.
 *
 * `seoDeps` binds `../media.ts`'s narrow media port to the same host repos
 * that routes use. `sitemapService` is shared with those routes and their bus subscriptions so
 * a tool invalidates the serving app's workspace cache, not a disconnected second cache.
 */
export interface SeoToolDeps extends Omit<SeoPackageToolDeps, "seoSettings"> {
  settingsRepo: SettingsRepoPort;
  principalRepo: PrincipalRepoPort;
}

/**
 * The host policy bound around the package registrations. Every field is required: the host owns
 * its tool metadata, the names of its read tools and its settings-ledger implementation, so this
 * module carries none of them.
 */
export interface SeoToolHostPolicy {
  /** The host's per-tool metadata (search vocabulary, approval/confirmation policy). */
  readonly toolMetadata: ToolMetadataById;
  /** How the host names its read tools in model-facing text. */
  readonly hostReads: HostReadVocabulary;
  /** The settings-ledger reader, chokepoint write and principal-lookup binder the settings tools use. */
  readonly settingsLedger: Pick<SeoSettingsLedgerBindings, "getEffective" | "set" | "createPrincipalLookup">;
}

/**
 * The route deps as the package-side ports. Every field reads the route deps at call time (a getter,
 * not a copy) because the route deps bag is mutable. The settings write closes over the same
 * sitemap invalidation the tool handlers build and the host's settings ledger.
 */
function toPackageDeps(
  { routeDeps, settingsLedger }: { routeDeps: SeoToolDeps; settingsLedger: SeoToolHostPolicy["settingsLedger"] },
  _optional = {},
): SeoPackageToolDeps {
  const requestInvalidation = (input: { workspaceId: string }) =>
    routeDeps.sitemapService.requestSitemapInvalidation({
      deps: { outbox: routeDeps.outbox, bus: routeDeps.bus, clock: routeDeps.clock, idGen: routeDeps.idGen, dispatch: routeDeps.seoDeps.dispatch },
      input,
    }, {});
  return {
    get outbox() { return routeDeps.outbox; },
    get bus() { return routeDeps.bus; },
    get authorize() { return routeDeps.authorize; },
    get workspaceId() { return routeDeps.workspaceId; },
    get clock() { return routeDeps.clock; },
    get idGen() { return routeDeps.idGen; },
    get seoReady() { return routeDeps.seoReady; },
    get seoDeps() { return routeDeps.seoDeps; },
    get sitemapService() { return routeDeps.sitemapService; },
    seoSettings: {
      get: (input) => getSeoSettings({ settingsRepo: routeDeps.settingsRepo, getEffective: settingsLedger.getEffective }, input),
      set: (input) => setSeoSettings(
        {
          settingsRepo: routeDeps.settingsRepo,
          getEffective: settingsLedger.getEffective,
          set: settingsLedger.set,
          createPrincipalLookup: settingsLedger.createPrincipalLookup,
          clock: routeDeps.clock,
          ids: routeDeps.idGen,
          authorize: routeDeps.authorize,
          principals: routeDeps.principalRepo,
          invalidateSitemap: requestInvalidation,
          media: routeDeps.seoDeps.media,
        },
        input,
      ),
    },
  };
}

/**
 * The host builder: the package registrations plus this site's tool metadata.
 * @param required.deps The exact slice of the route-deps bag SEO's tool handlers read.
 * @complexity O(t) in the six registrations.
 * @example buildSeoRegistrations({ deps, toolMetadata, hostReads, settingsLedger })
 */
export function buildSeoRegistrations(
  { deps, toolMetadata, hostReads, settingsLedger }: { deps: SeoToolDeps } & SeoToolHostPolicy,
  _optional: Record<string, never> = {},
): ToolRegistration[] {
  return withToolMetadata({ registrations: buildSeoToolRegistrations({ deps: toPackageDeps({ routeDeps: deps, settingsLedger }) }, { hostReads }), metadata: toolMetadata });
}

/**
 * Contributes SEO's AI tools to the assistant's catalog — called once by the host composition
 * root's tool-catalog manifest (`installFirstPartyToolContributors()`), not by importing this
 * module. The host's assistant tool registrations no longer import `buildSeoRegistrations`/
 * `seoDerivedRisk` by name; this is the seam that replaced it (Stage 2 batch 2). Safe: this
 * module's own cross-domain imports are `import type` only (erased at compile time) apart from
 * `@jini-ai/core` and this package's own SEO modules, so none creates a runtime edge back toward
 * the host's assistant.
 * @complexity O(1); registrations are built on `build`.
 * @example contributions.contributors.register({ contribution: contributeSeoTools({ toolMetadata, hostReads, settingsLedger }) })
 */
export function contributeSeoTools(
  { toolMetadata, hostReads, settingsLedger }: SeoToolHostPolicy,
  _optional: Record<string, never> = {},
): ToolContributor<SeoToolDeps, unknown> {
  return { domain: "seo", build: (deps) => buildSeoRegistrations({ deps, toolMetadata, hostReads, settingsLedger }), risk: seoDerivedRisk };
}
