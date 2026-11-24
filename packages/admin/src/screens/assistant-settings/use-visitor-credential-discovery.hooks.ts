import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { ByokConfig, ExecutionPort, ModelDiscoveryState, VisitorCredentialFormRules } from "./visitor-credential-form-port.js";
import { seedDiscoveredModel } from "./visitor-credential-form.rules.js";

/**
 * @file The visitor credential form's two AUTOMATIC model-discovery paths, split out of
 * `use-visitor-credential-form.hooks.ts` so each unit stays small. Same effects, same dependency
 * lists, same order as before the split.
 */

/** How long the key field must be quiet before discovery fires. Long enough that typing or pasting a
 *  key is one request rather than one per keystroke — the concern `ExecutionTab`'s own discovery
 *  effect documents ("refetching on every keystroke would spam the provider") — and short enough
 *  that a paste feels immediate. */
export const MODEL_DISCOVERY_DEBOUNCE_MS = 700;

/** What both discovery effects read: the probe transport and the live draft (refs, so they are not
 *  effect dependencies), plus the writers they advance. */
export interface VisitorDiscoveryInputs {
  port: MutableRefObject<ExecutionPort>;
  discoveryConfig: MutableRefObject<ByokConfig>;
  setDiscovery: Dispatch<SetStateAction<ModelDiscoveryState>>;
  setConfig: Dispatch<SetStateAction<ByokConfig>>;
  preferredModel: string;
}

/**
 * Discovery on load, for a key this browser does not have.
 *
 * The debounced effect below only fires on TYPING, which is right for a key being entered for the
 * first time and useless for one already stored: the field is empty, nothing is typed, and the
 * operator sees no models at all for a credential the server can use perfectly well. So a stored
 * key gets one discovery pass when the screen opens.
 *
 * Runs off `stored?.isSet` rather than the mount, so it fires once hydration has confirmed a key
 * exists — and only when the field is empty, so it can never race or duplicate the typed path.
 *
 * Skipped when the stored key belongs to another endpoint (a provider switch): the server refuses
 * that probe, and the key line asks for this provider's key instead. Deliberately NOT keyed on that
 * flag: it also flips when "Save settings" re-points the stored row at the form's endpoint, and an
 * automatic probe at that moment would send the previous provider's key to the new one unasked.
 */
export function useStoredKeyDiscovery(
  inputs: VisitorDiscoveryInputs & {
    storedIsSet: boolean | undefined;
    storedEndpointMismatch: MutableRefObject<boolean>;
    describeProbeError: VisitorCredentialFormRules["describeProbeError"];
  },
  _optional: Record<string, never> = {},
): void {
  const { port, discoveryConfig, storedEndpointMismatch, storedIsSet, setDiscovery, setConfig } = inputs;
  const { baseUrl, protocol } = discoveryConfig.current;
  useEffect(() => {
    // Missing optional discovery must not leave the form waiting for work it cannot start.
    const listModels = port.current.listModels?.bind(port.current);
    const config = discoveryConfig.current;
    if (!storedIsSet || config.apiKey.trim() || storedEndpointMismatch.current || !listModels) return undefined;
    let cancelled = false;
    setDiscovery({ status: "loading" });
    listModels({ ...config, apiKey: "", baseUrl, protocol })
      .then((models) => {
        if (cancelled) return;
        setDiscovery({ status: "ok", models });
        setConfig(seedDiscoveredModel({ models, preferredModel: inputs.preferredModel }));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setDiscovery({ status: "error", message: inputs.describeProbeError({ e, fallback: "Model discovery failed" }) });
      });
    return () => {
      cancelled = true;
    };
  }, [storedIsSet, baseUrl, protocol]);
}

/**
 * Debounced, key-driven model discovery.
 *
 * Keyed on the credential itself (key + endpoint), unlike `ExecutionTab`'s own effect which is
 * deliberately keyed only on the endpoint. That difference is the point of this screen: there, the
 * key is already saved and the operator is switching providers; here, the operator is entering a
 * key for the first time and the only useful moment to look up its models is right after they
 * finish typing it. The debounce is what makes keying on the key affordable.
 */
export function useTypedKeyDiscovery(
  inputs: VisitorDiscoveryInputs & { presetSuppliedEndpoint: boolean },
  _optional: Record<string, never> = {},
): void {
  const { port, discoveryConfig, presetSuppliedEndpoint, setDiscovery, setConfig } = inputs;
  const { apiKey, baseUrl, protocol } = discoveryConfig.current;
  useEffect(() => {
    // The endpoint condition is the security gate (`isPresetSuppliedEndpoint`) — NOT an optimization.
    // Removing it reintroduces the prefix-walk credential leak; read that comment before touching this line.
    // A transport without optional model discovery has no automatic work to start.
    const listModels = port.current.listModels?.bind(port.current);
    if (!apiKey.trim() || !presetSuppliedEndpoint || !listModels) {
      setDiscovery({ status: "idle" });
      return undefined;
    }
    let cancelled = false;
    setDiscovery({ status: "loading" });
    const config = discoveryConfig.current;
    const timer = setTimeout(() => {
      listModels({ ...config, apiKey, baseUrl, protocol })
        // `cancelled` guards the classic out-of-order finish: a slow request for an earlier,
        // half-typed key must never overwrite the result for the key currently in the field.
        .then((models) => {
          if (cancelled) return;
          setDiscovery({ status: "ok", models });
          // Seed the model field from the DISCOVERED list when it is still empty — never from a
          // hardcoded constant, which is what an earlier revision did and what made the field state
          // something this form had invented rather than something the key actually offers.
          // Preferring the server's real default when the account has it keeps the UI agreeing with
          // the server's own `DEFAULT_MODEL`; otherwise the first entry is simply a valid
          // starting point the operator can change. Without this the operator is stuck: `model` is a
          // required field, so `Test connection` stays disabled until something fills it.
          setConfig(seedDiscoveredModel({ models, preferredModel: inputs.preferredModel }));
        })
        .catch((e: unknown) =>
          !cancelled && setDiscovery({ status: "error", message: e instanceof Error ? e.message : "Model discovery failed" }),
        );
    }, MODEL_DISCOVERY_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [apiKey, baseUrl, protocol, presetSuppliedEndpoint]);
}
