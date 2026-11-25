interface PluginInstallSource { source: { kind: "folder"; path: string } | { kind: "zip"; file: File }; replace?: boolean }

export function createPluginInstallPort<Preview>({ request, workspaceId }: {
  request: <T>(required: { path: string; method: string; body: unknown }) => Promise<T>;
  workspaceId: string;
}, _optional: Record<string, never> = {}) {
function installRequest({ input, preview }: { input: PluginInstallSource & { expectedDigest?: string }; preview: boolean }, _optional = {}) {
  const endpoint = `/workspaces/${workspaceId}/plugins/install`;
  if (input.source.kind === "folder") return request<{ plugin: Preview }>({ path: endpoint + (preview ? "/preview" : ""), method: "POST", body: input });
  const query = new URLSearchParams({ replace: String(input.replace === true), ...(input.expectedDigest ? { expectedDigest: input.expectedDigest } : {}) });
  return request<{ plugin: Preview }>({ path: `${endpoint}/zip${preview ? "/preview" : ""}?${query}`, method: "POST", body: input.source.file.slice(0, input.source.file.size, "application/zip") });
}

/** Reuse the authenticated request seam, including session expiry and the normal API prefix. */
return {
  preview: (body: PluginInstallSource, _optional = {}) => installRequest({ input: body, preview: true }),
  install: (body: PluginInstallSource & { expectedDigest: string }, _optional = {}) => installRequest({ input: body, preview: false }),
};

}
