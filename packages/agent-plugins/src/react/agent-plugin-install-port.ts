/** The live upload, through the shared authenticated request seam (session expiry, API prefix). */
export function createAgentPluginInstallPort<Result>({ request, workspaceId, digest: digestBytes }: {
  request: <T>(required: { path: string; method: string; body: Blob }) => Promise<T>;
  workspaceId: string;
  digest: (algorithm: "SHA-256", data: ArrayBuffer) => Promise<ArrayBuffer>;
}, _optional: Record<string, never> = {}) {
  return {
  installZip: ({ file, sha256, replace = false, update }: { file: File; sha256: string; replace?: boolean; update?: { pluginId: string; expectedOldDigest: string } }, _optional: Record<string, never> = {}) =>
    request<Result>({
      path: `/workspaces/${workspaceId}/agent-plugins/${update ? encodeURIComponent(update.pluginId) + "/update/zip" : "install/zip"}?${new URLSearchParams({ expectedSha256: sha256, replace: String(replace), ...(update ? { expectedOldDigest: update.expectedOldDigest } : {}) })}`,
      method: "POST",
      body: file.slice(0, file.size, "application/zip"),
    }),
  sha256: async ({ file }: { file: File }, _optional: Record<string, never> = {}) => {
    const digest = await digestBytes("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  },
  };
}

