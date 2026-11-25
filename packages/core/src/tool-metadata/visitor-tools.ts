import type { ToolMetadataById } from "../tool-metadata-types.js";
import type { ToolApprovalPolicy } from "../contracts/site/tool-metadata-approval-policy.js";

/** Configure's branded approval handler decides the tier from the frozen service plan. */
export const toolMetadata = {
  visitor_tools_list: { search: { keywords: "visitor public assistant tools list modes limits permissions anonymous chatbot", queries: ["What can visitors do in chat?", "List visitor tools and limits."] }, approval: { class: "read", confirmation: "direct" } },
  visitor_tool_configure: {
    title: 'Change visitor assistant access',
    summary: 'This changes which actions the visitor assistant can perform.',
    search: { keywords: "visitor public assistant tools enable disable auto ask off mode limits rate budget", queries: ["Turn off visitor search.", "Raise the visitor tool limit.", "Set visitor tools to Ask first."] }, approval: { class: "escalation", confirmation: "plan" }, mcpUi: { redeemable: true } },
  visitor_tool_save: { search: { keywords: "visitor tool create update saved request api endpoint", queries: ["Create a visitor tool."] }, approval: { class: "read", confirmation: "direct" } },
  visitor_tool_delete: { search: { keywords: "visitor tool delete remove saved request permanently", queries: ["Delete a created visitor tool."] }, approval: { class: "read", confirmation: "direct" } },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
