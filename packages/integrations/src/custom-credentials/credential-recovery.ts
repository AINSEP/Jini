import type { ToolFailureDiagnostic } from "@jini-ai/core/contracts/site/daemon-tool-recovery";
import { absentWhen, orFallbackSync } from "@jini-ai/core/errors/idioms";
import { CustomCredentialNotFoundError } from "../credentialed-http/sets/store.js";

export interface CredentialSetupFailure {
  executed: false;
  credentialSetup: ToolFailureDiagnostic;
}

/** The host's credential-setup issuer (the daemon issuer bound to the host's credential-free-field
 *  and secret-redaction validation). Injected: the host owns that validation policy. */
export type IssueCredentialSetup = (
  required: { setupToolId: string; prefill: Readonly<Record<string, string | number | boolean | null>> },
  optional?: Record<string, never>,
) => ToolFailureDiagnostic;

/** Preserve provider output, while offering the credential card the failing call can actually use. */
export async function withCustomCredentialSetup<T>(
  { invoke, label, url, verification = false, issueCredentialSetup }: {
    invoke: () => Promise<T>; label: string; url?: string; verification?: boolean; issueCredentialSetup: IssueCredentialSetup;
  },
  _optional = {},
): Promise<T | CredentialSetupFailure> {
  // Only a missing credential becomes a setup card; every other failure is rethrown unchanged.
  const settled = await absentWhen({ work: async () => ({ result: await invoke() }), codes: [], kinds: [CustomCredentialNotFoundError] });
  if (!settled) {
    const prefill: Record<string, string> = { kind: "api", label };
    // The card collects a valid URL; an unknown label is resolved before request validation.
    const baseUrl = url ? orFallbackSync<string | undefined>({ work: () => new URL(url).origin, fallback: undefined, step: "credential-setup-base-url" }) : undefined;
    if (baseUrl) prefill.baseUrl = baseUrl;
    return { executed: false, credentialSetup: issueCredentialSetup({ setupToolId: "credential_save", prefill }, {}) };
  }
  const { result } = settled;
  const output = result as { status?: unknown };
  // A scoped key can get a request 401 while still working for its intended purpose.
  // Only explicit verification can establish invalidity and offer replacement.
  const rotation = verification && output.status === "invalid";
  return rotation ? { credentialSetup: issueCredentialSetup({ setupToolId: "credential_save", prefill: { kind: "api", target: label } }, {}), ...result } : result;
}
