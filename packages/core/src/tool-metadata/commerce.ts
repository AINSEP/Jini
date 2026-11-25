import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** The handler owns its human card; plan admits its callback without a second policy prompt. */
export const toolMetadata = {
  commerce_get_status: { approval: { class: 'read', confirmation: 'direct' } },
  // Catalog setup changes only site records; purchase-time order prices remain immutable.
  commerce_create_product: { approval: { class: 'edit', confirmation: 'direct' } },
  commerce_create_price: { approval: { class: 'edit', confirmation: 'direct' } },
  commerce_resolve_unknown: { title: 'Record a verified payment outcome',
    summary: 'This records verified payment evidence and may fulfill the order.',
    approval: { class: 'publish', confirmation: 'plan' } },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
