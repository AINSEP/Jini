import { useEffect, useMemo, useRef, useState } from "react";
import type { SiteAssistantCredential } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";
import { useSerialWrites } from "../../react/kit.js";
import type {
  ByokConfig, ConnectionTestState, ExecutionPort, ModelDiscoveryState, ProviderPreset, SaveState,
  VisitorCredentialFormController, VisitorCredentialFormDependencies,
} from "./visitor-credential-form-port.js";
import { configuredPresetIds, defaultVisitorCredentialConfig, hasStoredCredential, hydrateVisitorCredentialConfig, isPresetSuppliedEndpoint, visitorProviderGroups } from "./visitor-credential-form.rules.js";
import { runVisitorKeyTest, runVisitorTestConnection, saveVisitorKey, saveVisitorSettings } from "./visitor-credential-form-actions.js";
import { useStoredKeyDiscovery, useTypedKeyDiscovery } from "./use-visitor-credential-discovery.hooks.js";

/**
 * @file Everything `VisitorCredentialForm` does, so the host's form component is only markup.
 * Extracted verbatim — same state, same order, same effects, same error strings — then split into
 * the state/hydration unit, the two discovery effects (`use-visitor-credential-discovery.hooks.ts`)
 * and the press handlers (`visitor-credential-form-actions.ts`).
 *
 * The form is the SITE's provider credential, distinct from the admin's own BYOK key in Settings →
 * Execution mode, and it saves to the host's write-only server-side store (ADR-058).
 */

/** The form's state plus the one-shot hydration from the server. */
function useVisitorCredentialState(deps: VisitorCredentialFormDependencies, _optional: Record<string, never> = {}) {
  // A ref so the hydration effect can read it without listing it as a dependency, and so swapping
  // the prop mid-life cannot re-run that one-shot effect. Same lifetime rule as `port` below (the
  // OTHER port — `ExecutionPort`, for model discovery/connection tests — not this credential one).
  const apiRef = useRef(deps.port);
  // The host's default preset until hydration says otherwise (owner, 2026-10-09; it was Google Gemini). The model
  // stays empty: an earlier revision hardcoded `gemini-flash-latest` purely to avoid a required-field
  // marker, which invited the operator to keep a value this form had invented. The model list is a
  // property OF THE KEY, so it stays empty until a key produces one. See `discovery` below, and
  // `defaultVisitorCredentialConfig` / `hasSavedVisitorCredential`.
  const [config, setConfig] = useState<ByokConfig>(() => defaultVisitorCredentialConfig({ presets: deps.presets, defaultPresetId: deps.defaultPresetId }));
  const [discovery, setDiscovery] = useState<ModelDiscoveryState>({ status: "idle" });
  const [connectionTest, setConnectionTest] = useState<ConnectionTestState>({ status: "idle" });
  /** The server's write-only view of what is currently stored (`isSet` + `masked`), never the key. */
  const [stored, setStored] = useState<SiteAssistantCredential | null>(null);
  const [loadState, setLoadState] = useState<VisitorCredentialFormController["loadState"]>({ status: "loading" });
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [settingsSaveState, setSettingsSaveState] = useState<SaveState>({ status: "idle" });
  // State rather than a ref because a button's disabled-ness has to re-render on it. Set ONLY from
  // `editConfig` — see `VisitorCredentialFormController.dirty`.
  const [dirty, setDirty] = useState(false);

  // Hydrate from the server once. This is what makes the screen honest across sessions: without it
  // an operator who saved a key last week reopens the tab, sees an empty key field, and reasonably
  // concludes nothing was ever stored. The KEY cannot come back (the route is write-only by design),
  // so what hydrates is everything else — provider, base URL, model (`hydrateVisitorCredentialConfig`)
  // — plus `isSet`/`masked`, which is what the "A key is stored" line under the field reports.
  useEffect(() => {
    let cancelled = false;
    apiRef.current
      .getAssistantSiteCredential()
      .then(({ data }) => {
        if (cancelled) return;
        setStored(data);
        setConfig((current) => hydrateVisitorCredentialConfig({ current, stored: data, presets: deps.presets }));
        setLoadState({ status: "ready" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadState({ status: "error", message: deps.rules.describeApiError({ e: error, fallback: "Could not load saved settings." }) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    apiRef, config, setConfig, discovery, setDiscovery, connectionTest, setConnectionTest, stored, setStored,
    loadState, saveState, setSaveState, settingsSaveState, setSettingsSaveState, dirty, setDirty,
  };
}

type VisitorCredentialState = ReturnType<typeof useVisitorCredentialState>;

/** The press handlers over one render's state — plain closures, rebuilt each render as before. */
function visitorCredentialHandlers(
  { s, deps, port, writes, storedKeyIsForOtherEndpoint }: {
    s: VisitorCredentialState;
    deps: VisitorCredentialFormDependencies;
    port: ExecutionPort;
    writes: ReturnType<typeof useSerialWrites>;
    storedKeyIsForOtherEndpoint: boolean;
  },
  _optional: Record<string, never> = {},
) {
  const { config, stored, setConfig, setDiscovery, setConnectionTest } = s;
  const { rules, preferredModel } = deps;
  const { describeApiError, describeProbeError } = rules;
  const probe = { apiKey: config.apiKey, stored, baseUrl: config.baseUrl };
  /** Every edit that originates from a CONTROL goes through here, so `dirty` reflects the operator
   *  and never hydration or discovery. */
  const editConfig = (next: ByokConfig) => {
    s.setDirty(true);
    setConfig(next);
  };
  /**
   * The provider picker's selection handler. `nextConfigForPresetSelect` is where the non-obvious
   * behaviour lives — it snapshots the OUTGOING provider's credentials into `savedByProviderId`
   * before loading the incoming preset's own saved draft, which is what stops one provider's key
   * from making an unrelated provider's chip read as "configured". Hand-rolling
   * `setConfig({protocol, baseUrl})` here would look correct and quietly lose that.
   */
  const selectPreset = (next: ProviderPreset) => {
    editConfig(deps.presetRules.nextConfigForPresetSelect({ config, preset: next }));
    // Both are properties OF THE OUTGOING PROVIDER and neither survives the switch. Left in place,
    // the previous provider's "42 models available" and green connection result would sit under a
    // different provider's empty key field, describing a credential that is no longer in the form.
    setDiscovery({ status: "idle" });
    setConnectionTest({ status: "idle" });
  };
  const { groupPresets, isProviderConfigured } = deps.presetRules;
  const configuredIds = configuredPresetIds({ config, presets: deps.presets, isProviderConfigured });
  return {
    editConfig, selectPreset, configuredPresetIds: configuredIds, storedKeyIsForOtherEndpoint,
    hasUsableKey: rules.hasUsableKey(probe),
    hasStoredKey: hasStoredCredential({ stored }),
    providerGroups: visitorProviderGroups({ configuredIds, presets: deps.presets, groupPresets }),
    selectPresetById: ({ presetId }: { presetId: string }, _options: Record<string, never> = {}) => {
      const next = deps.presets.find((p) => p.id === presetId);
      if (next) selectPreset(next);
    },
    saveKey: () => writes.run({ task: () => saveVisitorKey({ api: s.apiRef.current, config, describeApiError, writers: { setSaveState: s.setSaveState, setStored: s.setStored, setConfig } }) }),
    saveSettings: () => writes.run({ task: () => saveVisitorSettings({ api: s.apiRef.current, config, describeApiError, writers: { setSettingsSaveState: s.setSettingsSaveState, setStored: s.setStored, setDirty: s.setDirty } }) }),
    // With nothing typed and the stored key saved for another endpoint, neither press sends anything:
    // the server would refuse, and the key line already asks for this provider's key. The buttons are
    // disabled in that state too; this keeps the hook honest for any other caller.
    runKeyTest: () => rules.storedKeyBlocksProbe(probe) ? Promise.resolve() : runVisitorKeyTest({ port, config, setDiscovery, setConfig, preferredModel, describeProbeError }),
    runTestConnection: () => rules.storedKeyBlocksProbe(probe) ? Promise.resolve() : runVisitorTestConnection({ port, config, setConnectionTest, setDiscovery, describeProbeError }),
  };
}

/**
 * Everything `VisitorCredentialForm` does: config state, hydration from the server, the two debounced
 * and on-demand model-discovery paths, connection testing, and the explicit saves.
 *
 * `port` is injected rather than importing the host's API client directly, so a test can describe
 * hydration/save against a fake instead of stubbing global `fetch` or spying on a module singleton.
 * The host's zero-argument `useWiredVisitorCredentialForm` binds the real client, rules and catalog.
 * The Save lane is the admin kit's `useSerialWrites`, so `<AdminKitProvider>` must be mounted above.
 *
 * @param deps - The site-credential client, the host's rules, catalog and defaults.
 * @param optional.executionPort - The probe transport; the host's `createExecutionPort()` when absent.
 * @complexity Time: O(1) per call across every handler — one request per save/test/discovery pass,
 *   no caller-controlled collections. Space: O(1).
 */
export function useVisitorCredentialForm(
  deps: VisitorCredentialFormDependencies,
  { executionPort }: { executionPort?: ExecutionPort } = {},
): VisitorCredentialFormController {
  const s = useVisitorCredentialState(deps);
  const { config, stored } = s;
  const preset = useMemo(() => deps.presetRules.resolveSelectedPreset({ presets: [...deps.presets], config }), [config]);
  // One port instance for this component's lifetime. These are the SAME admin routes the Settings
  // screen probes with, and they take the credential in the request body rather than reading a
  // stored one. The host's port opts into its stored credential so both probes work against a key
  // this browser does not have; Settings → Execution mode deliberately does NOT opt in — different
  // key, and an implicit fallback there would probe the visitor credential instead of the admin's own.
  // The host probe transport can be injected without replacing the credential store or Jini policy.
  const port = useRef(executionPort ?? deps.createExecutionPort());
  const storedKeyIsForOtherEndpoint = deps.rules.storedKeyIsForOtherEndpoint({ stored, baseUrl: config.baseUrl });
  const discoveryConfig = useRef(config);
  discoveryConfig.current = config;
  const storedEndpointMismatch = useRef(storedKeyIsForOtherEndpoint);
  storedEndpointMismatch.current = storedKeyIsForOtherEndpoint;
  const inputs = { port, discoveryConfig, setDiscovery: s.setDiscovery, setConfig: s.setConfig, preferredModel: deps.preferredModel };
  useStoredKeyDiscovery({ ...inputs, storedIsSet: stored?.isSet, storedEndpointMismatch, describeProbeError: deps.rules.describeProbeError });
  // One lane for both Save buttons, which can be enabled at the same time. The server builds every
  // write from the row it reads first (read → seal → upsert the whole merged record), so a key PUT
  // and a settings PUT in flight together each merge over the same old row and the later upsert
  // reverts the other's field. Queued through the shared lane, the second PUT reads what the first
  // wrote. Tab-local — two tabs still race; closing that needs a server-side check.
  const writes = useSerialWrites();
  // `isPresetSuppliedEndpoint` is the SECURITY GATE for the debounced discovery effect — read its doc
  // comment before touching either. Memoised on `baseUrl` alone, matching the effect's own dependency list.
  const presetSuppliedEndpoint = useMemo(() => isPresetSuppliedEndpoint({ baseUrl: config.baseUrl, presets: deps.presets }), [config.baseUrl]);
  useTypedKeyDiscovery({ ...inputs, presetSuppliedEndpoint });
  const handlers = visitorCredentialHandlers({ s, deps, port: port.current, writes, storedKeyIsForOtherEndpoint });
  return {
    loadState: s.loadState, config, preset, discovery: s.discovery, connectionTest: s.connectionTest, stored,
    saveState: s.saveState, settingsSaveState: s.settingsSaveState, dirty: s.dirty, ...handlers,
  };
}
