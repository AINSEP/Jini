import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** permanent-delete registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  "comments_purge_comment": {
    title: 'Permanently delete this comment',
    summary: 'This permanently removes the selected comment with no undo.',
    search: {
      keywords: "permanently delete purge erase comment comments spam forever remove",
      queries: [
        "Permanently delete this comment.", "Erase a spam comment forever.",
        "Purge this comment after I approve it.", "Remove a comment permanently.",
      ],
    },
    approval: { class: 'delete', confirmation: 'plan' },
    mcpUi: { exchangeOnly: true },
  },
  "custom_credential_delete": {
    title: 'Permanently delete this saved credential',
    summary: 'This removes the saved credential so it can no longer be used here.',
    search: {
      keywords: "delete remove erase permanently saved custom provider credential credentials api key keys token tokens",
      queries: [
        "Delete this saved custom provider credential.", "Remove a custom API key from Access Tokens.",
        "Erase the custom provider token I saved.", "Permanently delete a custom credential after I confirm.",
      ],
    },
    approval: { class: 'delete', confirmation: 'plan' },
    mcpUi: { exchangeOnly: true },
  },
  "deployment_delete_provider_credential": {
    title: 'Delete this hosting credential',
    summary: 'This removes the saved hosting credential so it can no longer publish from here.',
    search: {
      keywords: "delete remove erase permanently saved publish publishing host hosting deployment provider credential credentials token tokens",
      queries: [
        "Delete a saved publish host credential.", "Remove the hosting token from my saved credentials.",
        "Erase this deployment provider credential.", "Permanently remove my publishing credential.",
      ],
    },
    approval: { class: 'delete', confirmation: 'plan' },
    mcpUi: { exchangeOnly: true },
  },
  "external_mcp_delete": {
    title: 'Delete this external tool connection',
    summary: 'This removes the saved connection and its access to external tools.',
    search: {
      keywords: "delete permanently remove erase external mcp server servers connection connections integration integrations saved",
      queries: [
        "Delete a saved External MCP server.", "Remove an external MCP integration permanently.",
        "Erase this MCP connection configuration.", "Disconnect and delete the saved MCP server.",
      ],
    },
    approval: { class: 'delete', confirmation: 'plan' },
    mcpUi: { exchangeOnly: true },
  },
  "identity_user_delete": {
    title: 'Permanently delete this user account',
    summary: 'This permanently removes the selected user account with no undo.',
    search: {
      keywords: "permanently delete purge erase user users account accounts trashed forever remove",
      queries: [
        "Permanently delete this user account.", "Remove the trashed user forever.",
        "Purge a user after I confirm.", "Erase this user's account permanently.",
      ],
    },
    approval: { class: 'delete', confirmation: 'plan' },
    mcpUi: { exchangeOnly: true },
  },
  "media_purge_asset": {
    title: 'Permanently delete this media file',
    summary: 'This permanently removes the selected media file with no undo.',
    search: {
      keywords: "permanently delete purge erase media asset assets image images photo photos picture pictures file files forever",
      queries: [
        "Permanently delete this media file.", "Erase the trashed photo forever.",
        "Purge a media asset from my library.", "Remove this image permanently after confirmation.",
      ],
    },
    approval: { class: 'delete', confirmation: 'plan' },
    mcpUi: { exchangeOnly: true },
  },
  "source_control_delete_credential": {
    title: 'Delete this repository credential',
    summary: 'This removes the saved repository credential so it can no longer be used here.',
    search: {
      keywords: "delete remove erase permanently saved source control git repository credential credentials api key keys token tokens",
      queries: [
        "Delete a saved source control credential.", "Remove my saved git token.",
        "Erase this repository credential.", "Permanently remove my source control API key.",
      ],
    },
    approval: { class: 'delete', confirmation: 'plan' },
    mcpUi: { exchangeOnly: true },
  },

  "trash_empty": {
    title: 'Permanently empty the Trash',
    summary: 'This permanently deletes the selected items in the Trash with no undo.',
    search: {
      keywords: "empty clear trash bin recycle permanently purge everything all deleted items forever erase",
      queries: [
        "Can you empty my Trash?", "Clear everything out of the recycle bin permanently.",
        "I want all deleted items gone forever.", "Purge the entire Trash after I confirm the selection.",
      ],
    },
    approval: { class: 'delete', confirmation: 'plan' },
    mcpUi: { exchangeOnly: true },
  },

  "trash_purge_item": {
    title: 'Permanently delete this trashed item',
    summary: 'This permanently removes the selected item from the Trash with no undo.',
    search: {
      keywords: "purge one item trash trashed permanently delete deleted post page remove forever erase",
      queries: [
        "Permanently delete this one item from Trash.", "Purge the deleted post I selected.",
        "Remove this trashed page forever.", "Erase one deleted item permanently.",
      ],
    },
    approval: { class: 'delete', confirmation: 'plan' },
    mcpUi: { exchangeOnly: true },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
