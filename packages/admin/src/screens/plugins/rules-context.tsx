import { createContext, useContext, type ReactNode } from "react";

import type { PluginRules } from "./rules.js";

/**
 * @file The plugins screens' rule functions, delivered by context. The rows and panels call many of
 * them from nested components, so threading a `rules` prop through each level would only carry it;
 * the host builds `createPluginRules` once (it owns the product name, the translator and the error
 * class) and mounts one provider at the top of each plugins screen.
 */

const PluginRulesContext = createContext<PluginRules | null>(null);

/** Mounted by the host at the top of a plugins screen. */
export function PluginRulesProvider({ rules, children }: { rules: PluginRules; children: ReactNode }, _optional = {}) {
  return <PluginRulesContext.Provider value={rules}>{children}</PluginRulesContext.Provider>;
}

/** The host's bound rule functions. Throws outside a {@link PluginRulesProvider}: there is no neutral default. */
export function usePluginRules(): PluginRules {
  const rules = useContext(PluginRulesContext);
  if (rules === null) throw new Error("usePluginRules needs a PluginRulesProvider above it: the host binds the plugins rule functions.");
  return rules;
}
