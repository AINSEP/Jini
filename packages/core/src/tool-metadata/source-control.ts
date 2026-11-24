import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** source-control registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  "source_control_execute_commit": {
    title: 'Publish site files to your repository',
    summary: 'This commits the active theme’s static copy to the selected repository folder and may remove unchanged stale files previously managed there. Other folders and unrelated files are preserved. The root index.html lists the theme and its pages; existing hosting URLs may need configuration.',
    search: {
      keywords: "commit my site to a git repository push the site code export to repo commit changes",
    },
    approval: { class: 'publish', confirmation: 'policy', rule: 'export-commit' },
  },
  // --- source control --------------------------------------------------------------------------------------
  // Connection-status questions distinguish source-control capabilities from deployment operations.
  "source_control_get_capabilities": {
    search: {
      keywords: "git source control connected ready can I commit repository credentials setup",
      queries: [
        "Is a repository host connected for source control?", "Is git set up for this site yet?", "Which repository host is connected?", "Are my source control credentials ready?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
