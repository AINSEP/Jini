import type { AgentToolSideEffect } from "@jini-ai/core";

/** Host bindings for the permanent-delete catalog's model-facing guidance. */
export interface PermanentDeleteSpecsArgs {
  /** The host read tool (and field) the model reads a saved custom credential id from, named in that tool's guidance. */
  readonly customCredentialIdSource: string;
}

/** Owner Q1, 2026-10-01: each permanent delete waits for a human confirmation card.
 * Keep these in a separate contributor: the media and identity catalogs are package-owned.
 * The host names its own credential read tool; the engine never hard-codes a host tool name. */
export function createPermanentDeleteSpecs({ customCredentialIdSource }: PermanentDeleteSpecsArgs, _optional: Record<string, never> = {}) {
  return [
    { name: "trash_empty", key: null, permission: "content.read", entityType: "trash", subject: "all currently listed Trash items", guidance: "Empty the Trash / clear the recycle bin. The card names every selected item across all pages; any changed target set, including new arrivals after the card opens, requires a new confirmation. Refused if Trash is empty or any selected item is unauthorized." },
    { name: "trash_purge_item", key: "trashItemId", permission: "content.read", entityType: "trash", subject: "one trashed item", guidance: "Use the trashItemId field from trash_list_items, not the content entityId. To remove a live item reversibly, use trash_item instead." },
    { name: "media_purge_asset", key: "mediaId", permission: "media.delete.force", entityType: "media", subject: "a media file / image / photo", guidance: "The media asset must already be trashed; use media_trash_asset first. Removes the asset record and renditions; shared file bytes survive, and unshared bytes follow the existing garbage-collection grace period." },
    { name: "comments_purge_comment", key: "commentId", permission: "comments.delete.force", entityType: "comment", subject: "a comment", guidance: "Use this to erase a comment forever, including spam. For a reversible removal, use comments_trash_comment instead." },
    { name: "identity_user_delete", key: "principalId", permission: "user.manage", entityType: "user", subject: "a trashed user account", guidance: "Owners and built-in admins may delete ordinary users; only owners may delete admin or owner accounts. The user must already be in Trash; trash_item with entityType user is the reversible first step. Cannot remove yourself or the seeded owner. To suspend a live user, use identity_user_disable." },
    { name: "external_mcp_delete", key: "serverId", permission: "admin.integrations.manage", entityType: "external-mcp", subject: "an External MCP server connection", guidance: "Removes the saved integration configuration and its stored authentication. Its tools refuse subsequent calls; restarting the assistant removes their stale listings. Returns restartRequired:true on success." },
    { name: "custom_credential_delete", key: "credentialId", permission: "custom-credentials.write", entityType: "custom-credentials", subject: "a saved custom provider credential / API token", guidance: `Use the saved id from ${customCredentialIdSource}. Removes only the saved credential; it does not revoke the key at the provider or change the assistant's own model credential.` },
    { name: "deployment_delete_provider_credential", key: "credentialId", permission: "system.publish", entityType: "publish-credentials", subject: "a saved publish-host / hosting / deployment credential", guidance: "Use a saved credential id from deployment_get_static_publish_capabilities. Removes the vendor credential shared by its publish hosts; it does not delete a deployed site or revoke the key at the provider." },
    { name: "source_control_delete_credential", key: "credentialId", permission: "source-control.credentials.write", entityType: "source-control-credentials", subject: "a saved source-control / git repository credential", guidance: "Use a saved credential id from source_control_get_capabilities. Removes only the saved connection; it does not delete a repository or revoke its token at the provider." },
  ] as const;
}

export type PermanentDeleteSpecs = ReturnType<typeof createPermanentDeleteSpecs>;
export type PermanentDeleteToolId = PermanentDeleteSpecs[number]["name"];

/** Static catalog: no confirmation flag or redemption token can be supplied by the model. */
export function createPermanentDeleteAgentToolCatalog({ specs }: { readonly specs: PermanentDeleteSpecs }, _optional: Record<string, never> = {}) {
  return specs.map(spec => ({
    name: spec.name,
    description: `Permanently delete ${spec.subject}. ${spec.guidance} ` +
      "This ONE call shows a human confirmation card and waits for a Confirm click; the agent cannot self-confirm. " +
      "Returns {removed:true, ...resource result} after confirmation, or {removed:false, cancelled, reason?, note} if declined, expired or abandoned. " +
      "Refuses without an interactive confirmation channel, on permission denial, a missing id, or a target changed while the card was open. There is no undo.",
    sideEffects: "mutates-durable-state" as AgentToolSideEffect,
    authorization: { permission: spec.permission },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: spec.key === null ? {} : { [spec.key]: { type: "string", minLength: 1, description: `The saved ${spec.entityType} id to permanently delete.` } },
      required: spec.key === null ? [] : [spec.key],
    },
  }));
}
