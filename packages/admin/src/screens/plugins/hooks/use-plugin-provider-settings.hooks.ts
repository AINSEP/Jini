import { useEffect, useState } from "react";

import type { AdminPluginProviderSettings } from "../api/plugins-api.types.js";
import type { PluginsPort } from "./plugins-port.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file `PluginProviderSettingsDialog`'s data (2026-10-26): one provider plugin's settings card —
 * its manifest-declared fields, the saved public values, and for each secret only whether one is
 * saved. Secret inputs start empty and stay write-only: an empty secret on save keeps the saved one
 * while the public fields are unchanged (the server's rule); changing one (an endpoint, a host) is
 * refused until the saved secrets are entered again, and the server's message names them.
 *
 * `useX(dependencies)`: the host supplies the port, the translator and its error describer; its own
 * wired hook binds the real ones.
 */

export interface PluginProviderSettingsController {
  card: AdminPluginProviderSettings | null;
  /** The form's current text per field name. */
  values: Readonly<Record<string, string>>;
  setValue: (required: { name: string; value: string }, optional?: Record<string, never>) => void;
  /** Resolves `true` once the server has the values (the dialog then closes with a notice), `false` on a refusal. */
  save: () => Promise<boolean>;
  useSavedKey: () => Promise<boolean>;
  saving: boolean;
  /** A load or save failure, in the screen's words. */
  error: string | null;
  t: Translate;
}

/** Public fields start from their saved value, else the plugin's declared default; secrets always start blank. */
function initialValues(card: AdminPluginProviderSettings): Record<string, string> {
  return Object.fromEntries(card.fields.map((field) => [field.name, field.secret ? "" : field.value || field.default || ""]));
}

export function usePluginProviderSettings(
  { pluginId, port, t, describeApiError }: {
    pluginId: string;
    port: Pick<PluginsPort, "getProviderSettings" | "saveProviderSettings" | "useProjectKey">;
    t: Translate;
    /** The host's error describer (it knows the host's error type and server codes). */
    describeApiError: (required: { e: unknown; fallback: string }) => string;
  },
  _optional = {},
): PluginProviderSettingsController {
  const [card, setCard] = useState<AdminPluginProviderSettings | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    port.getProviderSettings({ id: pluginId }).then(
      (loaded) => { if (live) { setCard(loaded); setValues(initialValues(loaded)); } },
      (failure: unknown) => { if (live) setError(describeApiError({ e: failure, fallback: t("failed to load plugin settings") })); },
    );
    return () => { live = false; };
  }, [pluginId, port, t, describeApiError]);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await port.saveProviderSettings({ id: pluginId, values });
      setCard(next);
      setValues(initialValues(next));
      if (next.appliesAt === "failed") {
        setError(next.message ?? t("Saved, but the provider could not start. Check the plugin settings and save again."));
        return false;
      }
      return true;
    } catch (failure) {
      setError(describeApiError({ e: failure, fallback: t("failed to save plugin settings") }));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const useSavedKey = async () => {
    if (!card?.keyId || !port.useProjectKey) return false;
    setSaving(true);
    setError(null);
    try {
      const usage = await port.useProjectKey({ keyId: card.keyId, use: true });
      const next = await port.getProviderSettings({ id: pluginId });
      const applied = { ...next, ...usage };
      setCard(applied);
      setValues(initialValues(next));
      if (applied.appliesAt === "failed") {
        setError(applied.message ?? t("Saved, but the provider could not start. Check the plugin settings and save again."));
        return false;
      }
      return true;
    } catch (failure) { setError(describeApiError({ e: failure, fallback: t("failed to save plugin settings") })); return false; }
    finally { setSaving(false); }
  };
  return { card, values, setValue: ({ name, value }, _optional = {}) => setValues((current) => ({ ...current, [name]: value })), save, useSavedKey, saving, error, t };
}
