import { credentialScopes } from "@jini-ai/integrations/vendor-credentials/project-scope";
import { expect, it, vi } from "vitest";
import { buildSourceControlRegistrations, type SourceControlToolDeps } from "../tool-registrations.js";
import { executeCommitSchema } from "../commit-schema.js";

it("dry-run previews the same destination without a provider write", async () => {
  const commitSiteToSourceControl = vi.fn();
  const buildSourceControlProvider = vi.fn();
  const previewCommitExport = vi.fn(async () => ({ ok: true, fileCount: 1, totalBytes: 4, paths: ["index.html"] }));
  const descriptor = { id: "git", label: "Git", apiOrigin: "https://git.example" };
  const deps = { deps: { credentialScopes }, workspaceId: "w", authorize: async () => ({ allowed: true }), sourceControlExportRootDir: "/export", idGen: { newId: () => "id" }, staticSitePackager: { entryFile: "index.html" },
    loadSourceControlProviders: async () => ({ get: () => ({ descriptor, module: { supportsFolder: true } }), list: () => [{ descriptor }], refusals: [] }),
    sourceControlCredentialSetRepo: { listByProvider: async () => [{ id: "key", label: "label", providerId: "git", isDefault: true }], listByWorkspace: async () => [] },
    catalog: new Map([
      ["source_control_get_capabilities", { name: "source_control_get_capabilities", description: "Read", sideEffects: "none", authorization: { permission: "source-control.read" }, inputSchema: { type: "object", properties: {} } }],
      ["source_control_execute_commit", { name: "source_control_execute_commit", description: "Commit", sideEffects: "mutates-durable-state", authorization: { permission: "source-control.commit" }, inputSchema: executeCommitSchema }],
    ]), previewCommitExport, commitSiteToSourceControl, buildSourceControlProvider,
  } as unknown as SourceControlToolDeps;
  const tool = buildSourceControlRegistrations(deps, { surfaceExchanges: {} as never }).find(item => item.descriptor.id === "source_control_execute_commit")!;
  expect(await tool.handler({ executionId: "e", principal: { id: "owner" }, run: { id: "run" }, signal: new AbortController().signal,
    input: { provider: "git", owner: "owner", repo: "repo", commitMessage: "Export", folder: "copy", dryRun: true } })).toEqual({ dryRun: true, committed: false, owner: "owner", repo: "repo", branch: undefined, credentialConfigured: true, fileCount: 1, totalBytes: 4, paths: ["index.html"], folder: "copy", entryPath: "copy/index.html", note: "Nothing was sent. Call again without dryRun to commit." });
  expect(previewCommitExport).toHaveBeenCalledWith(expect.objectContaining({ folder: "copy", owner: "owner", repo: "repo" }), expect.objectContaining({ providerId: "git" }));
  expect(buildSourceControlProvider).not.toHaveBeenCalled(); expect(commitSiteToSourceControl).not.toHaveBeenCalled();
});
