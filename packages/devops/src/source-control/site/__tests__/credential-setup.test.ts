import { expect, it, vi } from "vitest";
import { proposeSourceControlCredential, PROPOSE_CREDENTIAL_CLOSED, type SourceControlCredentialSetupDeps } from "../credential-setup.js";

it("an aborted secure-card submission cannot save a credential", async () => {
  const abort = new AbortController();
  const create = vi.fn();
  const descriptor = { id: "git", label: "Git", credential: { tokenField: "token", fields: [{ name: "token", label: "Token", required: true, secret: true }] } };
  const deps = { workspaceId: "w", authorize: async () => ({ allowed: true }), loadSourceControlProviders: async () => ({ get: () => ({ descriptor }), list: () => [{ descriptor }], refusals: [] }),
    sourceControlCredentialSetRepo: { canonical: { supports: () => true, create } }, findPluginCredentialCard: async () => undefined,
    credentialSaveToolId: "credential_save", credentialFormUriHost: "host", assertCredentialFreeField: () => {},
    defineSecretCardTool: (spec: { prepare: () => Promise<unknown>; save: (required: { prep: unknown; values: Record<string, unknown>; signal: AbortSignal }) => Promise<unknown>; result: (required: { prep: unknown; run: { status: string } }) => unknown }) => ({ handler: () => async () => {
      const prep = await spec.prepare(); abort.abort();
      await expect(spec.save({ prep, values: { label: "label", token: "submitted-token" }, signal: abort.signal })).rejects.toThrow();
      return spec.result({ prep, run: { status: "abandoned" } });
    } }),
  } as unknown as SourceControlCredentialSetupDeps;
  const result = await proposeSourceControlCredential({ deps, surfaces: { surfaceExchanges: {} as never }, ctx: { executionId: "e", run: { id: "run" }, principal: { id: "owner" }, input: { provider: "git", label: "label" }, signal: abort.signal } });
  expect(result).toEqual({ saved: false, credentialId: null, provider: "git", label: "label", cancelled: false, message: PROPOSE_CREDENTIAL_CLOSED });
  expect(create).not.toHaveBeenCalled();
});
