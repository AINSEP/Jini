/**
 * @file The owner's per-site grant for permanent deletes through the admin assistant chat: which
 * permanent-delete tool ids exist and the stored policy shape. The tool table (labels, groups, admin
 * destinations), the settings key and the guidance text are host-owned values; only the types live
 * here so server, UI and tests share them without importing the host's contract module.
 */

/**
 * Every tool id a chat permanent-delete grant can name. The host's tool table (labels, groups, admin
 * destinations) checks each of its ids against this union with `satisfies`; keep the two in step.
 */
export type ChatPermanentDeleteToolId =
  | "trash_empty"
  | "trash_purge_item"
  | "media_purge_asset"
  | "comments_purge_comment"
  | "identity_user_delete"
  | "deployment_ops_unset_secret"
  | "external_mcp_delete"
  | "custom_credential_delete"
  | "deployment_delete_provider_credential"
  | "source_control_delete_credential"
  | "webhooks_delete_subscription"
  | "identity_role_delete"
  | "identity_policy_delete";

export interface AssistantPermanentDeletesPolicy { enabled: boolean; allowedToolIds: string[] }
