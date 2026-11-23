import type { ByokConfig, ConnectionTestState, ExecutionPort, ModelDiscoveryState } from "@jini-ai/ui/core";
import type { SiteAssistantCredential, SiteAssistantCredentialPatch } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";
import type { SaveState, VisitorCredentialFormPort, VisitorCredentialFormRules } from "./visitor-credential-form-port.js";
import { connectionTestStateFromResult, seedDiscoveredModel } from "./visitor-credential-form.rules.js";

/**
 * @file The visitor credential form's explicit presses (Save key, Save settings, Test Key, Test
 * connection) as top-level async functions, per the complexity-pass extraction rule. The host's
 * error describers arrive as `describeApiError`/`describeProbeError` (see
 * `VisitorCredentialFormRules`).
 */

/** The writers {@link saveVisitorKey} needs, grouped rather than passed as loose setters beside
 *  loose values. A save either advances all of them or none.
 *
 *  `setDirty` is deliberately absent: `dirty` tracks unsaved SETTINGS, and a key write does not save
 *  them — see {@link saveVisitorSettings}, which is the only thing that clears it. */
export interface VisitorCredentialSaveWriters {
  setSaveState: (state: SaveState) => void;
  setStored: (stored: SiteAssistantCredential) => void;
  setConfig: (updater: (current: ByokConfig) => ByokConfig) => void;
}

/** {@link saveVisitorSettings}'s own writers — its own save state, the server's returned view, and
 *  the `dirty` flag it is the sole clearer of. */
export interface VisitorCredentialSettingsSaveWriters {
  setSettingsSaveState: (state: SaveState) => void;
  setStored: (stored: SiteAssistantCredential) => void;
  setDirty: (dirty: boolean) => void;
}

/**
 * The "Save key" press — writes the KEY and nothing else.
 *
 * ## Why this is half of what it used to be (owner ruling, 2026-09-02)
 *
 * One control used to write the key AND provider/baseUrl/model together, mirroring the admin BYOK
 * panel's identical overload. A button with two jobs cannot honestly report which one it just did:
 * pressing it with an empty field sent a patch carrying no `apiKey` at all and still answered "Saved
 * to the server, encrypted." The fix is not a better message, it is one job per button —
 * {@link saveVisitorSettings} took the other half.
 *
 * A blank or whitespace-only field is a no-op, not a partial write. That is a real narrowing: the
 * old guard let a blank field through whenever a key was already stored, on the strength of the
 * OTHER fields being worth writing. Those fields have their own button now, so the only thing left
 * to check is whether there is a key to send.
 *
 * Extracted as a top-level function, not a nested closure, per the complexity-pass extraction rule —
 * see the host view's `VisitorCredentialForm` doc comment for the "why an explicit press, not a
 * debounce" reasoning both halves implement.
 */
export async function saveVisitorKey(deps: {
  /** Injected, not imported — see {@link VisitorCredentialFormPort}. */
  api: VisitorCredentialFormPort;
  /** The whole draft, rather than the one field picked out of it, for symmetry with
   *  {@link saveVisitorSettings} and so a future field cannot be forgotten at one call site. */
  config: ByokConfig;
  writers: VisitorCredentialSaveWriters;
  describeApiError: VisitorCredentialFormRules["describeApiError"];
}): Promise<void> {
  const { setSaveState, setStored, setConfig } = deps.writers;
  const apiKey = deps.config.apiKey.trim();
  if (!apiKey) return; // nothing typed — there is no key to write

  // The key ALONE, built from one literal so no branch here can let another field through.
  const patch: SiteAssistantCredentialPatch = { apiKey };

  setSaveState({ status: "saving" });
  try {
    const { data } = await deps.api.setAssistantSiteCredential(patch);
    // The SERVER's view, not the patch that was sent — same reasoning as the host's
    // `setPublicEnabled`. A partially-applied or rejected write must not leave this screen
    // claiming a key is stored when it is not.
    setStored(data);
    setSaveState({ status: "saved", at: data.updatedAt });
    // Clear the field once the key is safely stored. Leaving the plaintext sitting in a React
    // state tree after it has been persisted keeps it readable in devtools for no benefit, and the
    // masked placeholder now carries the "which key" answer the field would otherwise be giving.
    setConfig((current) => ({ ...current, apiKey: "" }));
  } catch (e) {
    setSaveState({ status: "error", message: deps.describeApiError({ e, fallback: "failed to save the key" }) });
  }
}

/**
 * The "Save settings" press — writes provider/baseUrl/model and NEVER an `apiKey` property.
 *
 * Not even an empty string: the server's put-site-credential route rejects that with a 400, and it
 * is precisely the write the old overloaded control could make. The field's contents are not read
 * here at all, so there is no state of the form in which this patch can grow a key.
 *
 * `dirty` is cleared here and only here — it means "settings changed since they were last written",
 * which is exactly the question this button answers. {@link saveVisitorKey} leaves it alone.
 */
export async function saveVisitorSettings(deps: {
  api: VisitorCredentialFormPort;
  config: ByokConfig;
  writers: VisitorCredentialSettingsSaveWriters;
  describeApiError: VisitorCredentialFormRules["describeApiError"];
}): Promise<void> {
  const { config } = deps;
  const { setSettingsSaveState, setStored, setDirty } = deps.writers;

  const patch: SiteAssistantCredentialPatch = {
    provider: config.protocol,
    baseUrl: config.baseUrl,
    model: config.model,
  };

  setSettingsSaveState({ status: "saving" });
  try {
    const { data } = await deps.api.setAssistantSiteCredential(patch);
    setStored(data);
    setSettingsSaveState({ status: "saved", at: data.updatedAt });
    setDirty(false);
  } catch (e) {
    setSettingsSaveState({ status: "error", message: deps.describeApiError({ e, fallback: "failed to save the settings" }) });
  }
}

/** The probe collaborators every Test press shares. */
interface ProbeDeps {
  port: ExecutionPort;
  config: ByokConfig;
  setDiscovery: (state: ModelDiscoveryState) => void;
  describeProbeError: VisitorCredentialFormRules["describeProbeError"];
}

/**
 * The explicit "Test Key" press — extracted for the same reason as {@link saveVisitorKey}.
 * Runs against WHATEVER endpoint is in `config`, preset or not, unlike the debounced automatic
 * discovery effect: an operator pressing a button labelled "Test Key" has deliberately chosen to
 * send this credential to the host they typed.
 */
export async function runVisitorKeyTest(deps: ProbeDeps & {
  setConfig: (updater: (current: ByokConfig) => ByokConfig) => void;
  preferredModel: string;
}): Promise<void> {
  const { port, config, setDiscovery, setConfig } = deps;
  setDiscovery({ status: "loading" });
  try {
    const models = (await port.listModels?.(config)) ?? [];
    setDiscovery({ status: "ok", models });
    setConfig(seedDiscoveredModel({ models, preferredModel: deps.preferredModel }));
  } catch (e) {
    setDiscovery({ status: "error", message: deps.describeProbeError({ e, fallback: "Could not reach the provider with that key" }) });
  }
}

/**
 * Refreshes discovery after an explicit connection test — extracted for the same reason as
 * {@link saveVisitorKey}. The debounced effect can't recover from a transient discovery
 * failure on its own (nothing about the credential changed afterwards), so without this the
 * operator would be stuck looking at a stale error next to a connection that just went green. Only
 * called by {@link runVisitorTestConnection} below, on a successful test. A failed refresh reports
 * its reason through discovery's existing error state while preserving the successful connection
 * result; the provider can accept a connection but refuse its model-list endpoint.
 */
async function refreshVisitorDiscoveryAfterTest(deps: ProbeDeps): Promise<void> {
  const { port, config, setDiscovery } = deps;
  if (!config.apiKey.trim()) return;
  try {
    const models = await port.listModels?.(config);
    if (models) setDiscovery({ status: "ok", models });
  } catch (error) {
    // The connection result is the answer the operator asked for, so keep it. The separate
    // discovery state must still explain why the model list could not be refreshed.
    setDiscovery({ status: "error", message: deps.describeProbeError({ e: error, fallback: "Model discovery failed" }) });
  }
}

/** The explicit "Test connection" press — extracted for the same reason as
 *  {@link saveVisitorKey}. */
export async function runVisitorTestConnection(deps: ProbeDeps & {
  setConnectionTest: (state: ConnectionTestState) => void;
}): Promise<void> {
  const { port, config, setConnectionTest } = deps;
  setConnectionTest({ status: "testing" });
  try {
    const result = await port.testConnection?.(config);
    setConnectionTest(connectionTestStateFromResult({ result }));
    if (result?.ok) await refreshVisitorDiscoveryAfterTest(deps);
  } catch (e) {
    setConnectionTest({ status: "error", message: deps.describeProbeError({ e, fallback: "Connection test failed" }) });
  }
}
