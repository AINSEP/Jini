import { toolMetadata } from './tool-metadata.js';
import { withToolMetadata } from '@jini-ai/core';
/**
 * @file Entries' agent-tool registrations, built by `@jini-ai/cms/entries`.
 * This host seam binds metadata and model-facing errors to the assistant's domain catalog.
 * Contributors are installed explicitly at the composition root; importing a feature must not
 * register tools or create an assistant-to-feature runtime cycle.
 */
import type { ToolContributor } from "@jini-ai/core";
import {
  buildEntriesRegistrations,
  entriesDerivedRisk,
  ContentTypeNotActiveError,
  ContentTypeNotFoundError,
  EntryNotFoundError,
  EntrySlugConflictError,
  ForbiddenError as EntriesForbiddenError,
  VersionConflictError,
  type EntriesToolDeps,
} from "../index.js";

import { ForbiddenError } from "../../core/index.js";
import { forbiddenRule, withModelFacingRegistrationErrors, type ModelFacingErrorRule } from "@jini-ai/core/model-facing-tool-errors";

export { buildEntriesRegistrations, entriesDerivedRisk, type EntriesToolDeps };

/**
 * Entries' model-facing allowlist. `write-service.ts` throws these five domain classes
 * plus the entries package's OWN `ForbiddenError` from fixed text plus caller-supplied ids/slugs/
 * versions only (verified against every `new X(...)` call site) — none carries a stack trace, a
 * filesystem path, or another tenant's data, so every one is safe to publish verbatim. `VersionConflictError`
 * gets guidance because "expected version N, found M" alone does not tell a caller what to do next.
 * `forbiddenRule("ENTRIES")` covers the KIT's `ForbiddenError` (`requireToolPermission`, thrown before
 * any of these domain checks run) — a distinct class from the entries package's own.
 */
const ENTRIES_MODEL_FACING_RULES: readonly ModelFacingErrorRule[] = [
  { error: EntriesForbiddenError, code: "ENTRIES_FORBIDDEN" },
  { error: EntryNotFoundError, code: "ENTRIES_NOT_FOUND" },
  { error: ContentTypeNotFoundError, code: "ENTRIES_CONTENT_TYPE_NOT_FOUND" },
  { error: ContentTypeNotActiveError, code: "ENTRIES_CONTENT_TYPE_NOT_ACTIVE" },
  { error: EntrySlugConflictError, code: "ENTRIES_SLUG_CONFLICT" },
  {
    error: VersionConflictError,
    code: "ENTRIES_VERSION_CONFLICT",
    guidance: "Re-read the entry and retry with its current version.",
  },
  forbiddenRule({ domainPrefix: "ENTRIES", error: ForbiddenError }),
];

/**
 * Contributes Entries' AI tools to the assistant's catalog — called once by
 * the host composition root's tool-catalog manifest (`installFirstPartyToolContributors()`), not by importing this
 * module. The host assistant's tool-registrations module no longer imports `buildEntriesRegistrations`/
 * `entriesDerivedRisk` by name; this is the seam that replaced it.
 *
 * `build` wraps every registration with {@link withModelFacingRegistrationErrors}: Jini's
 * `ToolExecutor` classifies any rejection that is not `instanceof ToolInputError` as `'internal'`, and
 * every one of entries' own domain errors still extends plain `Error` (unlike `content-types`', which
 * were fixed at the source — see the core model-facing-tool-errors module's header), so without
 * this wrap every entries failure reached the model as a redacted `INTERNAL_ERROR` 500.
 */
export function contributeEntriesTools(): ToolContributor<EntriesToolDeps, unknown> {
  return {
    domain: "entries",
    build: (deps) => withModelFacingRegistrationErrors({ registrations: withToolMetadata({ registrations: buildEntriesRegistrations(deps), metadata: toolMetadata }), rules: ENTRIES_MODEL_FACING_RULES }),
    risk: entriesDerivedRisk,
  };
}
