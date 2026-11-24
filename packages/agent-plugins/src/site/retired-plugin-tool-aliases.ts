import type { ToolRegistration } from "@jini-ai/core";

/**
 * @file Keeps a retired plugin's tool name callable (Phase B7, 2026-10-12): `agent_plugin_deploy`
 * answers with its successor's registration (the host's `replacements` catalog) — the same handler and the
 * same policy, so the successor's activation/digest/revocation gate decides every call; switching the
 * successor off or uninstalling it silences the alias too. An agent, a saved conversation or a skill that still names the old tool
 * then reaches the guidance that replaced it instead of an unknown-tool error.
 *
 * Aliases are registered only AFTER the family's own registrations, and only for an id nothing
 * registered: while retirement keeps an old `deploy` package (a successor not yet usable), that
 * package's own `agent_plugin_deploy` wins, and the registry's duplicate-id refusal can never take
 * the whole agent-plugin family down.
 */

type Registrar = { readonly register: (registration: ToolRegistration) => void };

/**
 * Wraps `registry` for one registration pass and collects the aliases owed to it.
 *
 * @param required.registry - The registrar the family's registrations pass through.
 * @param required.replacements - The host's retired plugin id -> successor plugin id catalog.
 * @param required.toToolId - The host's plugin id -> tool id rule (the same one its registrar mints ids with).
 * @returns `registry`, the pass-through to hand the family's registrar; `registerAliases`, called
 * once that registrar has finished, registers each owed alias whose id is still free.
 * @complexity O(1) per registration; O(a) for `registerAliases` over the a retired names.
 */
export function createRetiredPluginToolAliases(
  required: { readonly registry: Registrar; readonly replacements: ReadonlyMap<string, string>; readonly toToolId: (input: { readonly pluginId: string }) => string },
  _optional: Record<string, never> = {},
) {
  const { toToolId } = required;
  const aliasIdByToolId = new Map([...required.replacements].map(([retired, successor]) => [toToolId({ pluginId: successor }), toToolId({ pluginId: retired })]));
  const registered = new Set<string>();
  const owed: ToolRegistration[] = [];
  return {
    registry: {
      register(registration: ToolRegistration): void {
        required.registry.register(registration);
        registered.add(registration.descriptor.id);
        const aliasId = aliasIdByToolId.get(registration.descriptor.id);
        if (aliasId === undefined) return;
        owed.push({
          ...registration,
          descriptor: {
            ...registration.descriptor,
            id: aliasId,
            description: `Former name of ${registration.descriptor.id}; returns the same guidance. ${registration.descriptor.description ?? ""}`.trimEnd(),
          },
        });
      },
    } satisfies Registrar,
    registerAliases(): void {
      for (const alias of owed) if (!registered.has(alias.descriptor.id)) required.registry.register(alias);
    },
  };
}
