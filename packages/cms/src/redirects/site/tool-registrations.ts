import { withToolMetadata, type HostReadVocabulary, type ToolContributor, type ToolMetadataById, type ToolRegistration } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { buildRedirectsToolRegistrations, redirectsDerivedRisk, type RedirectsPackageToolDeps } from "../tool-registrations.js";

/**
 * @file Redirects' half of ADR-049 Decision 4 (SPEC-009): this site's binding of the seven redirects
 * agent tools, whose catalog, handlers, model-facing error mapping and authored risk map live in
 * `@jini-ai/cms/redirects`. What stays with the host is its own policy: the tool metadata (search
 * vocabulary and the `redirects_tombstone` confirmation policy), injected here through
 * {@link RedirectsToolHostPolicy}, and the contributor the composition root installs.
 */

/**
 * The host policy bound around the package registrations. Both fields are required: the host owns
 * its tool metadata and the names of its read tools, so this module carries neither.
 */
export interface RedirectsToolHostPolicy {
  /** The host's per-tool metadata (search vocabulary, approval/confirmation policy). */
  readonly toolMetadata: ToolMetadataById;
  /** How the host names its read tools in model-facing text. */
  readonly hostReads: HostReadVocabulary;
}

/**
 * The host builder: the package registrations plus this site's tool metadata. No handler reads the
 * assistant surfaces, so the builder takes none.
 * @param required.deps The exact slice of the route-deps bag Redirects' tool handlers read.
 * @complexity O(t) in the seven registrations.
 * @example buildRedirectsRegistrations({ deps, toolMetadata, hostReads })
 */
export function buildRedirectsRegistrations(
  { deps, toolMetadata, hostReads }: { deps: RedirectsPackageToolDeps } & RedirectsToolHostPolicy,
  _optional: Record<string, never> = {},
): ToolRegistration[] {
  return withToolMetadata({ registrations: buildRedirectsToolRegistrations({ deps }, { hostReads }), metadata: toolMetadata });
}

/**
 * Contributes Redirects' AI tools to the assistant's catalog — called once by the host composition
 * root's tool-catalog manifest (`installFirstPartyToolContributors()`), not by importing this
 * module. The host's assistant tool registrations no longer import `buildRedirectsRegistrations`/
 * `redirectsDerivedRisk` by name; this is the seam that replaced it (2026-08-17, Stage 2 of the
 * rollout — no sibling domain still statically wired through `assistant` imports `redirects`, so this
 * one-directional `redirects -> assistant` call closes no new cycle).
 * @complexity O(1); registrations are built on `build`.
 * @example contributions.contributors.register({ contribution: contributeRedirectsTools({ toolMetadata, hostReads }) })
 */
export function contributeRedirectsTools(
  { toolMetadata, hostReads }: RedirectsToolHostPolicy,
  _optional: Record<string, never> = {},
): ToolContributor<RedirectsPackageToolDeps, AssistantSurfaceDeps> {
  return { domain: "redirects", build: (deps) => buildRedirectsRegistrations({ deps, toolMetadata, hostReads }), risk: redirectsDerivedRisk };
}
