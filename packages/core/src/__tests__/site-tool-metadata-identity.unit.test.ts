import assert from "node:assert/strict";
import { test } from "vitest";

import { projectToolMetadata } from "../tool-metadata.js";
import type { ToolMetadataById } from "../tool-metadata-types.js";
import type { ToolApprovalPolicy } from "../contracts/site/tool-metadata-approval-policy.js";
import { toolMetadata as filesCopy } from "../tool-metadata/site/files-copy.js";
import { toolMetadata as forms } from "../tool-metadata/site/forms.js";
import { toolMetadata as identity } from "../tool-metadata/site/identity.js";
import { toolMetadata as mailStatus } from "../tool-metadata/site/mail-status.js";
import { toolMetadata as media } from "../tool-metadata/site/media.js";
import { toolMetadata as mediaImport } from "../tool-metadata/site/media-import.js";
import { toolMetadata as navigation } from "../tool-metadata/site/navigation.js";
import { toolMetadata as observability } from "../tool-metadata/site/observability.js";
import { toolMetadata as pages } from "../tool-metadata/site/pages.js";

/**
 * @file Characterization of the site tool-metadata declarations moved from the host. Tool ids are
 * wire-persisted and the approval declarations gate the human callback, so each map's ids, their
 * order and their `class/confirmation` pairs are pinned as literal snapshots taken from the host
 * source before the move.
 */

const domains = [
  { domain: "files-copy", tools: filesCopy },
  { domain: "forms", tools: forms },
  { domain: "identity", tools: identity },
  { domain: "mail-status", tools: mailStatus },
  { domain: "media", tools: media },
  { domain: "media-import", tools: mediaImport },
  { domain: "navigation", tools: navigation },
  { domain: "observability", tools: observability },
  { domain: "pages", tools: pages },
] as const;

/** `id -> "class/confirmation"` in declaration order, so a reorder, rename or reclassification shows. */
function approvalsOf(tools: ToolMetadataById<ToolApprovalPolicy>): string[] {
  return Object.entries(tools).map(([id, metadata]) => `${id} ${metadata.approval?.class}/${metadata.approval?.confirmation}`);
}

test("changing your own username runs directly as a reversible edit", () => {
  assert.equal(identity.identity_user_change_username.approval.confirmation, "direct");
  assert.equal(identity.identity_user_change_username.approval.class, "edit");
});

test("identity declarations keep their ids and approval classes", () => {
  assert.deepEqual(approvalsOf(identity), [
    "identity_user_change_username edit/direct",
    "identity_policy_attach edit/direct",
    "identity_policy_create edit/direct",
    "identity_policy_delete delete/plan",
    "identity_policy_list read/direct",
    "identity_policy_list_permissions read/direct",
    "identity_policy_update edit/direct",
    "identity_role_assign edit/direct",
    "identity_role_create edit/direct",
    "identity_role_delete delete/plan",
    "identity_role_list read/direct",
    "identity_role_rename edit/direct",
    "identity_user_create edit/direct",
    "identity_user_disable edit/direct",
    "identity_user_enable edit/direct",
    "identity_user_list read/direct",
    "identity_user_update_email edit/direct",
  ]);
  assert.equal(identity.identity_policy_delete.title, "Permanently delete this access policy");
  assert.equal(identity.identity_role_delete.summary, "This permanently removes the selected role and its policy links.");
  assert.equal(identity.identity_user_create.approval.input, "human-form");
});

test("the other moved maps keep their ids and approval classes", () => {
  assert.deepEqual(approvalsOf(filesCopy), ["files_copy edit/policy"]);
  assert.deepEqual(approvalsOf(forms), [
    "forms_list_providers read/direct",
    "forms_delivery_status read/direct",
    "forms_create_definition edit/direct",
    "forms_get_submission read/direct",
    "forms_list_definitions read/direct",
    "forms_list_submissions read/direct",
    "forms_pull_submissions edit/direct",
    "forms_set_definition_status edit/direct",
    "forms_update_definition edit/direct",
  ]);
  assert.deepEqual(approvalsOf(mailStatus), [
    "system_get_mail_status read/direct",
    "mail_set_provider escalation/plan",
    "mail_send_test publish/plan",
    "mail_list_providers read/direct",
    "mail_configure_provider read/direct",
    "mail_get_readiness read/direct",
    "mail_list_activity read/direct",
    "mail_get_activity read/direct",
    "mail_list_suppressions read/direct",
    "mail_remove_suppression escalation/plan",
    "mail_get_feedback_setup read/direct",
  ]);
  assert.deepEqual(approvalsOf(media), [
    "library_list read/direct",
    "library_read read/direct",
    "library_save_attachment edit/direct",
    "chat_list_pending_attachments read/direct",
    "media_promote_chat_attachment edit/direct",
    "media_list_assets read/direct",
    "media_trash_asset trash/policy",
    "media_update_metadata edit/direct",
    "media_upload_asset edit/direct",
    "media_view_image read/direct",
    "media_view_video read/direct",
  ]);
  assert.deepEqual(approvalsOf(mediaImport), [
    "media_replace_file edit/direct",
    "media_import_from_url edit/direct",
    "media_import_local_file edit/direct",
  ]);
  assert.deepEqual(approvalsOf(navigation), [
    "menus_assign_location edit/direct",
    "menus_create_menu edit/direct",
    "menus_get_menu read/direct",
    "menus_list_menus read/direct",
    "menus_update_menu_tree edit/direct",
  ]);
  assert.deepEqual(approvalsOf(observability), ["observability_send_test_error edit/direct"]);
  assert.deepEqual(approvalsOf(pages), [
    "pages_move_region edit/direct",
    "pages_read_html read/direct",
    "pages_write_html edit/direct",
    "pages_write_region edit/direct",
  ]);
});

test("projected together, the moved maps gate exactly the plan/policy tools and one secret form", () => {
  const projected = projectToolMetadata<ToolApprovalPolicy>({ domains });
  assert.equal(Object.keys(projected.byId).length, 62);
  assert.deepEqual([...projected.policyConfirmationIds].sort(), [
    "files_copy",
    "identity_policy_delete",
    "identity_role_delete",
    "mail_remove_suppression",
    "mail_send_test",
    "mail_set_provider",
    "media_trash_asset",
  ]);
  assert.deepEqual([...projected.secretFormIds], ["identity_user_create"]);
  // None of these declarations names a host rule, so they fit any host's narrowed rule union.
  assert.deepEqual(Object.values(projected.approvals).filter((policy) => policy.rule !== undefined), []);
});
