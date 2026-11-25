import { createPluginRules, type PluginsLocaleTranslate } from "../rules.js";

/** The stand-in for a host's `ApiError`: any thrown value carrying a string `code` the host recognises. */
export class FakeApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

/** A host binding with an identity translator, so assertions read the English source text. */
export function makeRules(productName = "Acme", translate: PluginsLocaleTranslate = ({ key }) => key) {
  return createPluginRules({
    productName,
    translate,
    isApiError: (e): e is Error & { code?: string } => e instanceof FakeApiError,
    describeApiError: ({ e, fallback }) => (e instanceof Error && e.message !== "" ? e.message : fallback),
    isProviderSettingRequired: ({ field }) => field.required === true,
  });
}
