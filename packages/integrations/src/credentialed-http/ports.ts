/** Plaintext credentials are resolved in-process for trusted authenticated-request executors.
 * Request/verification results and target previews never return them to tool/model callers;
 * callers needing only origins use `describe`, which does not decrypt. */
export interface CredentialConnection { readonly token: string; readonly username?: string; }
export interface CredentialTarget { readonly baseUrl: string; readonly additionalHosts: readonly string[]; }
export interface ResolvedCredential extends CredentialTarget { readonly connection: CredentialConnection; }
/** describe must not decrypt; the host owns sealed storage, AAD and workspace authorization. */
export interface CredentialResolverPort {
  describe(required: { workspaceId: string; label: string }): Promise<CredentialTarget | null>;
  resolve(required: { workspaceId: string; label: string }): Promise<ResolvedCredential | null>;
}
/** Registry loading/trust policy is host-owned. There is no default plugin loader. */
export interface CredentialSchemeRegistryPort {
  load(required: { workspaceId: string }): Promise<readonly import("./auth-schemes.js").CredentialSchemeRule[]>;
}
/** Recognize host egress-refusal identities without coupling to a transport implementation.
 * Descriptions must contain only safe network diagnostics; refusal errors are rethrown unchanged. */
export interface CredentialedRequestErrorPolicyPort {
  isEgressRefusal(required: { error: unknown }): boolean;
  describeEgressRefusal(required: { error: unknown }): string;
}
