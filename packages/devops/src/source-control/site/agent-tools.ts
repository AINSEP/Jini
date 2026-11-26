import type { AgentToolDefinition } from "@jini-ai/core";
import { executeCommitSchema } from "./commit-schema.js";

const NO_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {},
} as const;

export function createSourceControlAgentToolCatalog({ credentialSaveToolId }: { credentialSaveToolId: string }, _optional: Record<string, never> = {}): AgentToolDefinition[] {
  return [

  {
    name: "source_control_get_capabilities",
    description:
      `Reports the source control hosts for this workspace — every host a turned-on Agent Plugin provides, every host a plugin declares but is switched off, and every host that has a saved connection — WITHOUT decrypting or exposing any credential. For each provider: providerId; label, apiOrigin (the API base URL a saved custom credential for that host points at) and maxFileBytes (the largest single file the host accepts in a push; absent when it declares none), when a plugin declares the host; whether a credential is configured (a source-control connection or provider-declared saved API key exists; credentialSource is saved-api-key for that fallback — this is presence only, NOT a live verification that the token still works; a saved credential that the host has since revoked still reports configured:true here and would only be discovered as invalid by an actual commit attempt), every named credential set saved for it (id, label, isDefault, createdAt, updatedAt — NEVER a token or any part of one), and whether committing to that provider is supported yet (commitSupported: true only when an enabled Agent Plugin provides committing to that host; a saved credential for an unavailable host is reported honestly here, but source_control_execute_commit will refuse it; do not imply to the user that saving such a credential enables committing). Call this before telling a human what committing would do, before calling source_control_execute_commit, or whenever asked something like 'can I commit, and where'. Do NOT ask the user to paste a token into this chat — a value typed into chat is written into the conversation transcript, which is exactly what this workspace's encrypted credential store exists to avoid; call ${credentialSaveToolId} with kind source-control to open a human form, which saves it encrypted server-side and never shows it to you.`,
    sideEffects: "none",
    authorization: { permission: "source-control.read" },
    inputSchema: NO_INPUT_SCHEMA,
  },
  {
    name: "source_control_execute_commit",
    description:
      "Commits a fresh active-theme static copy to a repository using its saved credential. Use the folder the user named; if the destination is unclear ask 'repository root or which folder?'. Run dryRun:true first to preview packaged files and bytes without contacting the host. Requires human approval with {provider, owner, repo, commitMessage, branch?, folder?}; provider must have commitSupported:true and folder commits require supportsFolder:true. Returns {committed:true, owner, repo, folder, entryPath, branch, branchCreated, commitSha, commitUrl, filesChanged, filesDeleted, divergedPaths}. Report destination, entryPath, deleted-file count and divergedPaths. Only unchanged stale paths previously managed in this destination may be removed; unrelated files, human-edited stale files and files outside the folder are preserved. The entry is a root index.html listing the theme and its pages; existing hosting URLs may need configuration. Static publishing has its own tool. Returns {committed:false, reason, message} when the credential or provider is unavailable, and {committed:false, cancelled:false, code, message} when the commit itself fails. Never accepts or exposes a token. Requires source-control.commit.",
    // Genuinely consequential (pushes a real commit into someone's actual git history using a
    // write-scoped external credential) — classified accordingly, cross-checked against
    // `sourceControlDerivedRisk` below at build time. Deliberately carries NO `actorClassRule` — see
    // this file's header for why the MCP-UI held-open exchange gate needs none.
    sideEffects: "mutates-durable-state",
    authorization: { permission: "source-control.commit" },
    inputSchema: executeCommitSchema,
  },
];

}
