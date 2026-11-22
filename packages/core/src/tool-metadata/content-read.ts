import type { HostReadVocabulary } from '../host-read-vocabulary.js';
import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** content-read registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  "content_read.comment": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.term": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.site": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.theme_page_publication": {
    approval: { class: 'read', confirmation: 'direct' },
  },

  // The collapsed cards dispatch the original, independently classified read handlers.
  "content_read.backup_restore_point": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.collection_content_type": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.collection_entry": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.comment_moderation_queue": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.content_post": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.custom_credential": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.database_pending_migration": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.database_restore_point": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.external_mcp": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.form_definition": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.identity_policy": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.identity_role": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.identity_user": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.media_asset": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.member": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.menu": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.newsletter_campaign": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.newsletter_list": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.plugin": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.post": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.redirect": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.seo_entry_meta": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.setting_definition": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.taxonomy": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.theme": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.webhook_subscription": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.widget_instance": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.widget_region": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_read.workspace": {
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;

/**
 * How the host's model-facing CMS tool text names the read of an entity: the `content_read.<resource>`
 * card of `assistant/content-read-tool.ts`. `@jini-ai/cms` words its redirect, taxonomy and widget
 * refusals and field help through this port because the engine may not name a host tool id; the
 * text a model sees stays byte-identical to what the cms domains wrote before the port existed
 * (pinned by the tool-contract golden files and the term-card test).
 */
export const contentReadVocabulary: HostReadVocabulary = {
  readRef: ({ entity }) => `content_read.${entity}`,
};
