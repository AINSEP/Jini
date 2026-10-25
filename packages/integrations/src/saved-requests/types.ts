import type { CredentialedRequestAuditPort, makeCredentialedRequest } from "../credentialed-http/credentialed-request.js";
import type { CredentialSchemeRegistryPort, ResolvedCredential } from "../credentialed-http/ports.js";
import type { DnsResolver, GuardedClock, PinnedHttpTransport } from "@jini-ai/platform/http/guarded";

/** Persisted data only. Identity, policy, consent and quotas belong to the calling host. */
export interface SavedRequestDefinition {
  readonly version: 1;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly url: string;
  readonly credential: { readonly id: string; readonly revision: string; readonly origin: string };
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly queryBindings: Readonly<Record<string, string>>;
  readonly bodyBindings: Readonly<Record<string, string>>;
  readonly staticBody?: Readonly<Record<string, unknown>>;
  readonly output: {
    readonly path: readonly string[];
    readonly maxItems: number;
    readonly fields: Readonly<Record<string, SavedRequestOutputField>>;
  };
}

export interface SavedRequestOutputField {
  readonly path: readonly string[];
  readonly type: "string" | "number" | "boolean" | "url";
  readonly maxLength?: number;
  readonly allowedOrigin?: string;
}

/** Resolve opaque IDs within the mounted workspace, never editable display labels. A revision
 * must change whenever account, token, origin or visitor-use authorization changes. */
export interface SavedRequestCredentialResolverPort {
  resolve(required: { workspaceId: string; credentialId: string }): Promise<(ResolvedCredential & { readonly revision: string }) | null>;
}

/** All effects are injected. The interpreter constructs the existing guard, so callers cannot
 * accidentally supply an HTTP client with redirects or development bypasses enabled. The trusted
 * executor port must bind the credentialed-http owner so auditing and redaction stay intact. */
export interface SavedRequestDeps {
  /** Composition binds the credential owner's executor; the interpreter never loads that domain. */
  readonly executeCredentialedRequest: typeof makeCredentialedRequest;
  readonly credentials: SavedRequestCredentialResolverPort;
  readonly schemeRegistry: CredentialSchemeRegistryPort;
  readonly audit: CredentialedRequestAuditPort;
  readonly clock: GuardedClock;
  readonly dns: DnsResolver;
  readonly transport: PinnedHttpTransport;
  readonly userAgent: string;
  /** Trusted composition supplies the site's public, admin, API and control origins. */
  readonly forbiddenOrigins: readonly string[];
}

/** Only positively selected values; no provider headers, diagnostics or credential metadata. */
export interface SavedRequestResult {
  readonly trust: "untrusted";
  readonly items: readonly Readonly<Record<string, string | number | boolean>>[];
}
