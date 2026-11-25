import type { ToolMetadataById } from "../tool-metadata-types.js";
import type { ToolApprovalPolicy } from "../contracts/site/tool-metadata-approval-policy.js";

/** Agent-pause registration declarations (H4); shared placement rationale is in ./index.ts.
 *  `direct`: the tool holds its own call open for the approval card, so no second policy prompt. */
export function createResumeAgentWorkMetadata<const Id extends string>(
  { toolId, search }: { toolId: Id; search: { keywords: string; queries: readonly string[] } }, _optional = {},
): { readonly [K in Id]: { readonly search: { keywords: string; queries: readonly string[] }; readonly approval: { readonly class: "edit"; readonly confirmation: "direct" } } } {
  const metadata = {
    [toolId]: { search, approval: { class: "edit", confirmation: "direct" } },
  } as const satisfies ToolMetadataById<ToolApprovalPolicy>;
  return metadata as { readonly [K in Id]: { readonly search: { keywords: string; queries: readonly string[] }; readonly approval: { readonly class: "edit"; readonly confirmation: "direct" } } };
}
