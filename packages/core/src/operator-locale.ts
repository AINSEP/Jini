import { getEffective as settingsGetEffective } from "./settings.js";
import { LANGUAGE_NAMESPACE } from "./ui-tab-definitions.js";
import { orFallback } from "../errors/idioms.js";

/**
 * @file The calling operator's admin language, for the Agent Plugin confirmation dialogs.
 *
 * `memory-i18n.ts` carries the note/uninstall dialog copy in every admin locale, but its callers
 * (`write-note-tool.ts`, `uninstall-confirmation-ui.ts`) never passed a locale, so the dialogs were
 * English for every operator. The operator's choice is the per-user `core.language.locale` setting
 * the admin's own Language selector writes; this reads it the same way `settings_get_effective` does.
 */

import type { OperatorLocaleDeps } from '../contracts/headless/plugin-host.js';
import type { GetEffectiveSetting } from '../contracts/headless/operator-locale.js';

const FALLBACK_LOCALE = "en";

/**
 * Resolves the operator's admin locale code ("es", "pt-BR", ...), or "en".
 * Copy must never block a safety confirmation, so a missing repo, an unset or non-string value, and
 * a failed settings read all degrade to English, exactly as the admin's own locale hook does.
 * @param required.deps Route deps carrying the settings ledger.
 * @param required.workspaceId The tool's workspace.
 * @param required.principalId The operator the dialog is shown to.
 * @param optional.getEffective Settings resolver; defaults to the ledger's real `getEffective`.
 * @returns A locale code for `memoryText`.
 * @complexity O(1): one effective-setting read (up to three layer reads).
 */
export async function resolveOperatorLocale(
  required: { deps: OperatorLocaleDeps; workspaceId: string; principalId: string },
  { getEffective = settingsGetEffective }: { getEffective?: GetEffectiveSetting } = {},
): Promise<string> {
  const { settingsRepo } = required.deps;
  if (!settingsRepo) return FALLBACK_LOCALE;
  return orFallback({ work: async () => {
    const resolved = await getEffective({
      deps: { repo: settingsRepo }, namespace: LANGUAGE_NAMESPACE, key: "locale",
      scopeContext: { workspaceId: required.workspaceId, principalId: required.principalId },
    });
    return typeof resolved?.value === "string" && resolved.value ? resolved.value : FALLBACK_LOCALE;
  }, fallback: FALLBACK_LOCALE, step: "Read operator locale" });
}
