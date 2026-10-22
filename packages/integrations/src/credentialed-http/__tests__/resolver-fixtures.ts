import type { CredentialConnection, CredentialResolverPort, ResolvedCredential } from "../ports.js";
import type { Clock } from "@jini-ai/core/primitives";

export class EgressRefusedError extends Error {}
export class MemoryCredentialResolver implements CredentialResolverPort {
  readonly rows = new Map<string, ResolvedCredential>();
  describeCalls = 0;
  resolveCalls = 0;
  async describe(required: { workspaceId: string; label: string }) {
    this.describeCalls++;
    const row = this.rows.get(JSON.stringify([required.workspaceId, required.label]));
    return row ? { baseUrl: row.baseUrl, additionalHosts: row.additionalHosts } : null;
  }
  async resolve(required: { workspaceId: string; label: string }) {
    this.resolveCalls++;
    return this.rows.get(JSON.stringify([required.workspaceId, required.label])) ?? null;
  }
}
export interface CustomCredentialWriteDeps {
  repo: MemoryCredentialResolver;
  clock: Clock;
}
export function makeWriteDeps(): CustomCredentialWriteDeps {
  return { repo: new MemoryCredentialResolver(), clock: { nowMs: () => Date.parse("2026-08-31T00:00:00.000Z") } };
}
export async function createCustomCredential(deps: CustomCredentialWriteDeps, input: {
  workspaceId: string; label: string; category: string; baseUrl: string;
  connection: CredentialConnection; additionalHosts?: readonly string[];
}) {
  deps.repo.rows.set(JSON.stringify([input.workspaceId, input.label]), {
    baseUrl: input.baseUrl, additionalHosts: input.additionalHosts ?? [], connection: input.connection,
  });
}
export const loadBundledAuthSchemes = async () => [{ id: "custom", prefix: "CustomV1", scheme: "CustomV1" }];
