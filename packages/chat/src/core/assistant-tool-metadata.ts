import type { ToolMetadataById } from '@jini-ai/core';
import { assistantHistoryToolMetadata } from './history-tool-metadata.js';
import type { ToolApprovalPolicy } from '@jini-ai/core/contracts/site/tool-metadata-approval-policy';

/** assistant registration declarations; shared placement rationale is in the host's tool-metadata aggregator. */
export const toolMetadata = {
  ...assistantHistoryToolMetadata,
  "tool_gaps_list": {
    search: { keywords: "tool gaps fallback Bash shell direct file edit write missing tools audit" },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "assistant_admin_screen_link": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  // --- ask the administrator a question -----------------------------------------------------------------
  "assistant_ask_choice": {
    search: {
      keywords: "ask question decide decision confirm confirmation choose choice choices options option select " +
        "single multi checklist checkbox radio approve approval permission go-ahead consent which one " +
        "poll survey form dialog interactive get input from user administrator before doing proceed",
    },
    approval: { class: 'read', confirmation: 'direct' },
    mcpUi: { redeemable: true },
  },
  "assistant_demo_a2ui": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  // Pure form readback needs no confirmation token: submitting cannot mutate state.
  "assistant_demo_choices": {
    approval: { class: 'read', confirmation: 'direct' },
    mcpUi: { redeemable: true },
  },
  "assistant_demo_image": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "assistant_render_ui": {
    search: {
      keywords: "render show display draw put a chart here show me a graph draw a table build a dashboard visualize view results embed inline in chat",
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "describe_component": {
    search: {
      keywords: "component props properties schema fields interactive ui widget render rendering",
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  // --- interactive-UI component catalog -----------------------------------------------------------------
  "search_components": {
    search: {
      keywords: "component components widget widgets chart charts graph graphs table tables button buttons checkbox card cards render rendering draw drawing display visualize visualization interactive ui shadcn recharts pie bar line",
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "assistant_tool_failure_recovery": {
    mcpUi: { redeemable: true },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
