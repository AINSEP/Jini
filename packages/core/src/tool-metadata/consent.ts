/** @file Consent tool discovery and confirmation policy; projected by the native registry. */
import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';
export const toolMetadata = {
  consent_get_settings: { search: { keywords: 'cookie consent banner current settings draft published privacy', queries: ['Read the cookie banner settings.'] }, approval: { class: 'read', confirmation: 'direct' } },
  consent_get_readiness: { search: { keywords: 'cookie consent readiness preview dry run trackers scripts categories placement', queries: ['Is my cookie banner ready to turn on?'] }, approval: { class: 'read', confirmation: 'direct' } },
  consent_explain_blocked: { search: { keywords: 'cookie consent blocked scripts trackers iframe fonts why paused', queries: ['Why are my scripts blocked before consent?'] }, approval: { class: 'read', confirmation: 'direct' } },
  consent_update_settings: {
    title: 'Change consent settings',
    summary: 'This changes how this site requests and records visitor consent.',
    search: { keywords: 'edit change cookie consent banner text appearance position css rules draft', queries: ['Change my cookie banner settings.'] }, approval: { class: 'escalation', confirmation: 'plan' } },
  consent_publish_settings: {
    title: 'Publish consent settings',
    summary: 'This makes the consent settings available to visitors.',
    search: { keywords: 'publish enable disable cookie consent banner draft privacy policy', queries: ['Publish the reviewed cookie consent draft.'] }, approval: { class: 'publish', confirmation: 'plan' } },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
