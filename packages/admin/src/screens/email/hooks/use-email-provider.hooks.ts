import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { AdminAgentPluginRow } from "@jini-ai/core/contracts/site/cms-agent-plugins";

import type { EmailApi, MailProviderConfiguration, MailProviderConfigurationReport, MailProviderCredentialInput } from "../email-api.types.js";
import { errorMessage, type EmailLoadApiError, type LoadView, type useLoad } from "./email-load.hooks.js";

/**
 * @file Provider tab state: the installed providers (`GET …/mail-providers`), a key form per
 * provider (`PUT …/:id/credential` — saves or rotates WITHOUT switching), and the switch
 * (`POST …/:id/activate`, which moves both lanes). Everything shown comes from the providers'
 * own declared setup fields; nothing here names a vendor.
 */

export type ProviderNotice = { providerId: string; tone: "ok" | "error"; text: string } | null;

export interface EmailProviderController {
  choices: AdminAgentPluginRow[] | null;
  adding: string | null;
  addError: string | null;
  addWarning: string | null;
  retryAdd: () => Promise<string | undefined>;
  addProvider: (required: { pluginId: string }) => Promise<string | undefined>;
  view: LoadView<MailProviderConfigurationReport>;
  reload: () => void;
  drafts: Record<string, MailProviderCredentialInput>;
  setDraftField: (providerId: string, key: keyof MailProviderCredentialInput, value: string) => void;
  busyId: string | null;
  notice: ProviderNotice;
  saveKey: (provider: MailProviderConfiguration) => Promise<void>;
  /** The provider waiting for the switch confirmation, or null. */
  pendingSwitch: MailProviderConfiguration | null;
  askSwitch: (provider: MailProviderConfiguration | null) => void;
  confirmSwitch: () => Promise<void>;
}

/** Email orchestration only; the Plugins API owns activation and trust checks. The host's plugins client satisfies it structurally. */
export interface EmailProviderPluginApi {
  listAgentPlugins: () => Promise<{ agentPlugins: AdminAgentPluginRow[] }>;
  setAgentPluginEnabled: (input: { pluginId: string; enabled: boolean }, optional?: Record<string, never>) => Promise<{ warnings?: string[] }>;
}
/** The installable-provider list and the enable flow. Exported so the host can bind it as `useProviderChoicesHook`. */
export function useProviderChoices(required: { pluginApi: EmailProviderPluginApi; refresh: () => Promise<MailProviderConfigurationReport>; ApiError: EmailLoadApiError }, _optional = {}) {
  const { pluginApi, refresh, ApiError } = required;
  const [choices, setChoices] = useState<AdminAgentPluginRow[] | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [addWarning, setAddWarning] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const locked = useRef(false);
  const lastPlugin = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    pluginApi.listAgentPlugins().then(({ agentPlugins }) => {
      if (live) setChoices(agentPlugins.filter((p) => !p.enabled && p.provides?.includes("outbound-mail")));
    }, (error: unknown) => { if (live) setAddError(errorMessage({ error, ApiError })); });
    return () => { live = false; };
  }, [pluginApi, attempt, ApiError]);
  const addProvider = useCallback(async ({ pluginId }: { pluginId: string }, _optional = {}) => {
    if (locked.current) return undefined;
    locked.current = true;
    lastPlugin.current = pluginId;
    setAdding(pluginId);
    setAddError(null);
    setAddWarning(null);
    try {
      const { warnings } = await pluginApi.setAgentPluginEnabled({ pluginId, enabled: true });
      setAddWarning(warnings?.join(" ") || null);
      const report = await refresh();
      const provider = report.providers.find((p) => p.pluginId === pluginId);
      if (!provider) throw new Error(report.refusals.filter((reason) => reason.includes(`from '${pluginId}'`)).join("; ") || "The plugin did not load an email provider.");
      setChoices((rows) => rows?.filter((p) => p.pluginId !== pluginId) ?? null);
      return provider.id;
    } catch (error) {
      setAddError(error instanceof Error ? error.message : errorMessage({ error, ApiError }));
      return undefined;
    } finally {
      locked.current = false;
      setAdding(null);
    }
  }, [pluginApi, refresh, ApiError]);
  const retryAdd = useCallback(async () => {
    if (lastPlugin.current) return addProvider({ pluginId: lastPlugin.current });
    setAddError(null); setAttempt((n) => n + 1);
    return undefined;
  }, [addProvider]);
  return useMemo(() => ({ choices, adding, addError, addWarning, retryAdd, addProvider }), [choices, adding, addError, addWarning, retryAdd, addProvider]);
}

/** Whether a provider already sends both lanes (nothing left to switch). Pure. */
export function isFullyActive({ provider }: { provider: Pick<MailProviderConfiguration, "lanes"> }, _optional = {}): boolean {
  return provider.lanes.includes("transactional") && provider.lanes.includes("bulk");
}

/** The body a key save sends: trimmed, blank parts left out (a rotation may change just one). Pure. */
export function credentialBody({ draft }: { draft: MailProviderCredentialInput | undefined }, _options = {}): MailProviderCredentialInput {
  const out: MailProviderCredentialInput = {};
  for (const key of ["token", "username", "baseUrl"] as const) {
    const value = draft?.[key]?.trim();
    if (value) out[key] = value;
  }
  return out;
}

type ProviderActionApi = Pick<EmailApi, "saveProviderKey" | "activateProvider">;

/** What a key save and a switch share: the client, the error class, the refresh and the busy/notice setters. */
interface ProviderActionContext {
  api: ProviderActionApi;
  ApiError: EmailLoadApiError;
  reload: () => void;
  onChanged?: (() => void) | undefined;
  setBusyId: (id: string | null) => void;
  setNotice: Dispatch<SetStateAction<ProviderNotice>>;
}

/** The per-provider key forms. Typing drops the "Enter the key first." hint so it does not linger next to a filled field. */
function useProviderDrafts({ setNotice }: { setNotice: Dispatch<SetStateAction<ProviderNotice>> }, _optional = {}) {
  const [drafts, setDrafts] = useState<Record<string, MailProviderCredentialInput>>({});
  const setDraftField = useCallback((providerId: string, key: keyof MailProviderCredentialInput, value: string) => {
    setDrafts((all) => ({ ...all, [providerId]: { ...all[providerId], [key]: value } }));
    setNotice((current) => (current?.providerId === providerId && current.text === "Enter the key first." ? null : current));
  }, [setNotice]);
  return { drafts, setDrafts, setDraftField };
}

/** Saves or rotates one provider's key WITHOUT switching to it. */
function useSaveProviderKey({ ctx, drafts, setDrafts }: { ctx: ProviderActionContext; drafts: Record<string, MailProviderCredentialInput>; setDrafts: Dispatch<SetStateAction<Record<string, MailProviderCredentialInput>>> }, _optional = {}) {
  const { api, ApiError, reload, onChanged, setBusyId, setNotice } = ctx;
  return useCallback(async (provider: MailProviderConfiguration) => {
    const body = credentialBody({ draft: drafts[provider.id] });
    if (!provider.credential.saved && !body.token) {
      setNotice({ providerId: provider.id, tone: "error", text: "Enter the key first." });
      return;
    }
    setBusyId(provider.id);
    setNotice(null);
    try {
      await api.saveProviderKey({ providerId: provider.id, input: body });
      setDrafts((all) => ({ ...all, [provider.id]: {} }));
      setNotice({ providerId: provider.id, tone: "ok", text: "Key saved." });
      reload();
      onChanged?.();
    } catch (error) {
      setNotice({ providerId: provider.id, tone: "error", text: errorMessage({ error, ApiError }) });
    } finally {
      setBusyId(null);
    }
  }, [api, drafts, setDrafts, reload, onChanged, ApiError, setBusyId, setNotice]);
}

/** The confirm-then-switch flow (`POST …/:id/activate`, which moves both lanes). */
function useProviderSwitch({ ctx }: { ctx: ProviderActionContext }, _optional = {}) {
  const { api, ApiError, reload, onChanged, setBusyId, setNotice } = ctx;
  const [pendingSwitch, setPendingSwitch] = useState<MailProviderConfiguration | null>(null);
  const confirmSwitch = useCallback(async () => {
    const provider = pendingSwitch;
    if (!provider) return;
    setBusyId(provider.id);
    setNotice(null);
    try {
      await api.activateProvider({ providerId: provider.id });
      setNotice({ providerId: provider.id, tone: "ok", text: "Now sending with this provider." });
      reload();
      onChanged?.();
    } catch (error) {
      setNotice({ providerId: provider.id, tone: "error", text: errorMessage({ error, ApiError }) });
    } finally {
      setBusyId(null);
      setPendingSwitch(null);
    }
  }, [api, pendingSwitch, reload, onChanged, ApiError, setBusyId, setNotice]);
  return { pendingSwitch, askSwitch: setPendingSwitch, confirmSwitch };
}

/**
 * @param required.api - the Email API port; a fake in tests.
 * @param required.pluginApi - the Plugins API port (list + enable); a fake in tests.
 * @param required.ApiError - the host's transport error class (a stable class identity).
 * @param required.useLoadHook - the host's binding of {@link useLoad} (the provider report loader).
 * @param required.useProviderChoicesHook - the host's binding of {@link useProviderChoices} (the installable-provider list).
 * @param optional.onChanged - called after a save or switch so the page's status re-reads.
 */
export function useEmailProvider(required: { api: Pick<EmailApi, "listProviders" | "saveProviderKey" | "activateProvider">; pluginApi: EmailProviderPluginApi; ApiError: EmailLoadApiError; useLoadHook: typeof useLoad; useProviderChoicesHook: typeof useProviderChoices }, optional: { onChanged?: () => void } = {}): EmailProviderController {
  const { api, ApiError, pluginApi, useLoadHook, useProviderChoicesHook } = required;
  const { onChanged } = optional;
  const load = useCallback(() => api.listProviders(), [api]);
  const { view, reload, setData } = useLoadHook({ ApiError, load });
  const refresh = useCallback(async () => { const report = await api.listProviders(); setData(report); return report; }, [api, setData]);
  const additions = useProviderChoicesHook({ pluginApi, refresh, ApiError });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<ProviderNotice>(null);
  const ctx = useMemo<ProviderActionContext>(() => ({ api, ApiError, reload, onChanged, setBusyId, setNotice }), [api, ApiError, reload, onChanged]);
  const { drafts, setDrafts, setDraftField } = useProviderDrafts({ setNotice });
  const saveKey = useSaveProviderKey({ ctx, drafts, setDrafts });
  const { pendingSwitch, askSwitch, confirmSwitch } = useProviderSwitch({ ctx });

  return useMemo(() => ({
    ...additions, view, reload, drafts, setDraftField, busyId, notice, saveKey, pendingSwitch, askSwitch, confirmSwitch,
  }), [additions, view, reload, drafts, setDraftField, busyId, notice, saveKey, pendingSwitch, askSwitch, confirmSwitch]);
}
