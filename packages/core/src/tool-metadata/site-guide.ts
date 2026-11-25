import type { ToolMetadataById } from "../tool-metadata-types.js";
import type { ToolApprovalPolicy } from "../contracts/site/tool-metadata-approval-policy.js";

/** Site-guide registration declarations; shared placement rationale is in the host aggregator.
 * The guide's search copy names the hosting product (a keyword and an example question), so the
 * host passes its product name in (`productName`) and the package never names one. */
export function createSiteGuideToolMetadata({ productName }: { productName: string }, _optional: Record<string, never> = {}) {
  return {
    site_guide: {
      search: {
        keywords: `how ${productName.toLowerCase()} works site guide learn building blocks forms widgets markers themes members SEO deploy plugins ${productName}`,
        queries: [`How does ${productName} work?`, "Design a planner directory site."],
      },
      approval: { class: "read", confirmation: "direct" },
    },
  } as const satisfies ToolMetadataById<ToolApprovalPolicy>;
}
