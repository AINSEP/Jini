// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import { ProvidersTab } from "../ProvidersTab.js";
import { classifySourceControlCredentialSubmitError } from "../rules.js";
import { useSourceControlCredentials, type SourceControlCredentialsController } from "../hooks/use-source-control-credentials.hooks.js";

test("host classifies refusals and hint receives only the saved hint after a different draft is typed", async () => {
  const savedHint = { length: 16, last4: "safe" };
  const saved = { id: "id", providerId: "host", label: "default", configured: true as const, isDefault: true, createdAt: "2026-11-25T00:00:00Z", updatedAt: "2026-11-25T00:00:00Z", tokenHint: savedHint };
  const refused = new Error("transport refusal");
  const classifyCredentialSubmitError = vi.fn(() => ({ kind: "validation" as const, detail: "host-detail" }));
  expect(classifySourceControlCredentialSubmitError({ e: refused, classifyCredentialSubmitError })).toEqual({ kind: "validation", detail: "host-detail" });
  const useFetchQueryHook: FetchQueryAdapter["useFetchQuery"] = <T,>({ key }: { key: readonly (string | number)[] }) => ({ data: (key[1] === "credentials" ? { credentials: [saved] } : { providers: [{ id: "host", label: "Host" }], switchedOff: [], refusals: [] }) as T, error: null, status: "success", isFetching: false, refetch: () => {} });
  let current: SourceControlCredentialsController | undefined;
  function useController() {
    current = useSourceControlCredentials({ port: { listProviders: async () => ({ providers: [], switchedOff: [], refusals: [] }), listCredentials: async () => ({ credentials: [saved] }), createCredential: async () => { throw refused; }, updateCredential: async () => { throw refused; } }, locale: "en", t: key => key, useFetchQueryHook, localizeSourceControlProviders: ({ providers }) => providers, credentialDraftError: () => null, translateCredentialMessage: ({ message }) => `translated:${message}`, describeApiError: ({ fallback }) => fallback, sourceControlCredentialsLoadErrorMessage: ({ error }) => error, sourceControlCredentialSaveErrorMessage: ({ error }) => `save:${error}`, classifyCredentialSubmitError });
    return current;
  }
  const hints: Array<{ hint?: CredentialTokenHint | null }> = [];
  const node = document.createElement("div");
  const root = createRoot(node);
  await act(async () => { root.render(<ProvidersTab useSourceControlCredentialsHook={useController} useAdminLocaleHook={() => "en"} navigate={() => {}} viewerTimeZone="UTC" CredentialHint={props => { hints.push(props); return <span data-hint>{props.hint?.last4}</span>; }} kit={{ SecretInput: ({ label, secret, ...props }) => <input {...props} aria-label={label} type={secret ? "password" : "text"} />, Icon: () => null }} lineIcon={{ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }} fieldHelpText={() => undefined} fieldNameHandleSegment={({ fieldName }) => fieldName} copy={{ providersRegionLabel: "Connections", storedTokenHint: "Stored safely" }} />); });
  const controller = () => { if (!current) throw new Error("not mounted"); return current; };
  const draft = "DISTINGUISHABLE-UNREDACTED-DRAFT";
  await act(async () => { controller().setToken({ providerId: "host", value: draft }); });
  expect(hints.at(-1)).toEqual({ hint: savedHint });
  expect(node.querySelector("[data-hint]")?.textContent).toBe("safe");
  expect(node.querySelector("[data-hint]")?.textContent).not.toContain(draft);
  await act(async () => { await controller().save("host"); });
  expect(classifyCredentialSubmitError).toHaveBeenLastCalledWith({ error: refused });
  expect(controller().rows?.[0]?.error).toBe("save:translated:host-detail");
  await act(async () => { root.unmount(); });
});
