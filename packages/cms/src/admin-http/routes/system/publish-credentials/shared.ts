import type { JsonRouteAuthorize, RouteInputContext } from "@jini-ai/core/contracts/server";
import { ok } from "@jini-ai/core/contracts/server";

import {
  authorizeCredentials, credentialErrorRows, credentialRouteInput, type CredentialStoreErrorClasses,
} from "../credential-routes-shared.js";

/**
 * @file What the Deployment panel's publish-credential routes share: the `system.publish` check
 * (entity type `site-publish`, no `entityId` even on by-id verbs, as the hand-written routes asked
 * it), the store-error ladder, and the collaborator types the host injects — the store, the
 * after-save verification, the compatibility re-check and the account-label heal trigger.
 */

export const PUBLISH_CREDENTIALS_BASE_PATH = "/api/admin/v1/workspaces/:workspaceId/system/publish/credentials";

/** The credential summary the store returns; only `id`/`scope` are read here, the rest passes through. */
export interface PublishCredentialView { readonly id: string; readonly scope?: string }

/** The opaque verification result a save or an explicit verify returns (the host's probe outcome). */
export type PublishCredentialVerification = object;

/** Probe one saved credential (decrypts it; may throw) and heal its account label; `undefined` = nothing to report. */
export type VerifyPublishCredential = (args: { id: string }) => Promise<PublishCredentialVerification | undefined>;

/** Re-check publish hosts a credential change affects; `before`/`after` present only when known. */
export type InvalidatePublishCredential = (change: { before?: PublishCredentialView; after?: PublishCredentialView }) => void;
/** Load what the re-check needs BEFORE the write (the deploy-target registry); hands back the re-check. */
export type PreparePublishCredentialInvalidation = () => Promise<InvalidatePublishCredential>;

/** Look one credential up without decrypting it. */
export type DescribePublishCredential = (args: { workspaceId: string; id: string }) => Promise<PublishCredentialView | null | undefined>;

/** What every publish-credential route reads: its workspace and the host's store error classes. */
export interface PublishCredentialBaseDeps { workspaceId: string; storeErrors: CredentialStoreErrorClasses }

export const publishCredentialRows = (deps: PublishCredentialBaseDeps) => credentialErrorRows({ classes: deps.storeErrors });

/** `system.publish` on `site-publish`, before any store or loader is reached. @complexity O(1). */
export const authorizePublishCredentials = (authorize: JsonRouteAuthorize | undefined) =>
  authorizeCredentials({ authorize, permission: "system.publish", entityType: "site-publish" });

export const parsePublishCredential = (raw: RouteInputContext) => ok({ value: credentialRouteInput(raw) });

/** Verify only when the request supplied a `connection`: a label/isDefault-only change verifies
 *  nothing new (the connection, and whatever a previous verification found, is unchanged), so a
 *  re-check would repeat the same network call for no new information. @complexity O(1). */
export async function verifyIfConnectionChanged(
  { body, id, verify }: { body: Record<string, unknown>; id: string; verify: VerifyPublishCredential },
  _optional: Record<string, never> = {},
): Promise<{ verification?: PublishCredentialVerification }> {
  const verification = body.connection !== undefined ? await verify({ id }) : undefined;
  return verification ? { verification } : {};
}
