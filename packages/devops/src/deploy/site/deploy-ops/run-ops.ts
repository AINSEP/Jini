import { createHash } from 'node:crypto';
import type { Clock, HttpRequest, HttpResponse } from '@jini-ai/core/primitives';
import type { CredentialedRequestRequired, CredentialedRequestOptional, CredentialedRequestResult, CredentialSetRepoPort } from '@jini-ai/core/contracts/credentials';
import type { CustomCredentialCategoryId } from '@jini-ai/core/contracts/site/core-custom-credential-categories';
import type { SecretSealerPort } from '@jini-ai/core/contracts/vault';
import type { CredentialSchemeRule } from '@jini-ai/core/contracts/site/integrations-credentialed-http';
import { aborted } from '../../ops-runner.js';
import type { DeployOpsRuntime } from '../../ops-tool-contracts.js';

interface CredentialedRequestDeps {
  readonly repo: CredentialSetRepoPort<CustomCredentialCategoryId>;
  readonly sealer: SecretSealerPort;
  readonly httpClient: { send(request: HttpRequest, options?: { redirect?: 'follow' | 'error' | 'manual' }): Promise<HttpResponse> };
  readonly clock: Clock;
  readonly audit?: { record(entry: { readonly label: string; readonly host: string; readonly method: string; readonly status: number; readonly bodyBytes: number; readonly at: string; readonly egressRefusal?: string }): void };
  readonly loadAuthSchemes: (ctx: { readonly workspaceId: string }) => Promise<readonly CredentialSchemeRule[]>;
}

const sha256 = ({ value }: { value: string }, _options = {})=>createHash('sha256').update(value,'utf8').digest();
/** A site-key-shaped value gets the Security page's own fingerprint, so the two can be compared by eye. O(n). */
export function secretFingerprint({ value, deps }: { value: string; deps: {
  parseSiteKeyHex(input: { raw: string }): { ok: true; hex: string } | { ok: false };
  fingerprintSiteKeyHex(input: { hex: string }): string;
} }, _options = {}): { fingerprint: string; fingerprintKind: "site-key" | "sha256" } {
  const { parseSiteKeyHex, fingerprintSiteKeyHex } = deps;
  const parsed = parseSiteKeyHex({ raw: value });
  return parsed.ok ? { fingerprint: fingerprintSiteKeyHex({ hex: parsed.hex }), fingerprintKind: "site-key" } : { fingerprint: sha256({ value }).toString("hex").slice(0, 12), fingerprintKind: "sha256" };
}

export function bindDeployOpsRuntime({ runtime, deps, makeCredentialedRequest }: {
  runtime: Omit<DeployOpsRuntime, 'credentials'> & { credentials: Omit<DeployOpsRuntime['credentials'], 'request'> };
  deps: {
    customCredentialSetRepo: CredentialedRequestDeps['repo']; siteAssistantSecretSealer: CredentialedRequestDeps['sealer'];
    deployOpsHttpClient?: CredentialedRequestDeps['httpClient']; clock: Clock;
    customCredentialsAudit?: CredentialedRequestDeps['audit']; loadAuthSchemes: CredentialedRequestDeps['loadAuthSchemes'];
  };
  makeCredentialedRequest(deps: CredentialedRequestDeps, input: CredentialedRequestRequired & CredentialedRequestOptional): Promise<CredentialedRequestResult>;
}, _optional = {}): DeployOpsRuntime {
  return { ...runtime, credentials: { ...runtime.credentials,
    request: async (required, optional) => {
      const {signal}=optional;
      const httpClient = deps.deployOpsHttpClient;
      if (httpClient === undefined) throw new Error('Deployment operations have no HTTP client');
      const requestDeps:CredentialedRequestDeps={repo:deps.customCredentialSetRepo,sealer:deps.siteAssistantSecretSealer,httpClient,clock:deps.clock,...(deps.customCredentialsAudit?{audit:deps.customCredentialsAudit}:{}),loadAuthSchemes:deps.loadAuthSchemes};
      let transportTruncated = false;
      // Preserve the text clipping flag the credential API does not expose in its returned shape.
      const boundedDeps: CredentialedRequestDeps = { ...requestDeps, httpClient: { send: async (request: HttpRequest, _optional = {}) => {
        // Auth scheme loading can yield after the earlier abort check. Recheck at the I/O boundary.
        if (signal?.aborted) throw aborted();
        const result = await requestDeps.httpClient.send({ ...request, ...(signal ? { signal } : {}), maxResponseBytes: required.maxResponseBytes });
        transportTruncated = result.bodyTruncated === true;
        return result;
      } } };
      const {maxResponseBytes: _limit,...request}=required;
      const result=await makeCredentialedRequest(boundedDeps,{...request,headers:optional.headers,body:optional.body});
      return {...result,bodyTruncated:transportTruncated};
    },
  } };
}
