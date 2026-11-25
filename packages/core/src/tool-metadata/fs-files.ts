import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** fs-files registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  // Folder-content questions must discover filesystem tools (SPEC-053).
  "fs_list_files": {
    search: {
      keywords: "folder directory local computer machine desktop dropped path browse inside contents list files explore shallow recursive depth cursor pagination",
      queries: [
        "What's in this folder on my computer?",
        "Can you look inside the folder I just dropped into the chat?",
        "What files are in a directory on my machine?",
        "Browse a local folder that isn't part of the site.",
        "Show me what a website folder on my desktop contains.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "fs_read_file": {
    search: {
      keywords: "folder directory local computer machine desktop dropped path open view read show file contents text",
      queries: [
        "Can you open a file from the folder I dropped?",
        "Read this file on my computer and tell me what it says.",
        "Show me the contents of a local HTML file.",
        "What does the index.html in that folder contain?",
        "Read a text file from a directory on my machine.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  // Owner 2026-10-27: the picked folder lies outside the site, so a write leaves it ('publish').
  // 'policy' asks every time and makes the card's click exchange-only.
  "fs_write_files": {
    title: 'Save files to the selected folder',
    summary: 'This creates or replaces the listed files in the folder on your computer.',
    search: {
      keywords: "folder directory local computer machine desktop picked write save create edit change update files",
      queries: [
        "Save these files into the folder I picked.",
        "Write the new pages into my Desktop folder.",
        "Update index.html in the folder on my computer.",
      ],
    },
    approval: { class: 'publish', confirmation: 'policy' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
