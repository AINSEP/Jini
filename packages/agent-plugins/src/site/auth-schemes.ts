import type { CredentialSchemeRule, CredentialSchemeRegistry } from "@jini-ai/core/contracts/site/integrations-credentialed-http";
import type {
  LoadPluginContributionsOptional, PluginContributionDefinition, PluginContributionResult, TrustedPluginPackage,
} from "@jini-ai/agent-plugins/lifecycle";

import type { BundledContributionSources } from "@jini-ai/agent-plugins/site/bundled-contribution-sources";

// Token-prefix rationale: Jini/packages/integrations/src/credentialed-http/auth-schemes.ts; plugin trust stays here.

/**
 * @file Self-describing token schemes: tokens that carry their own `Authorization` scheme word as a
 * leading prefix (a vendor token such as `<Scheme><rest>` must be sent as `Authorization: <Scheme>
 * <rest>`, and is rejected when sent as `Bearer <whole token>`). Core names no vendor: the rules are
 * DATA that Agent Plugins ship in {@link CREDENTIAL_SCHEMES_FILENAME}, and Jini applies them.
 * A bundled hosting plugin ships the one rule known today, with its live-verification
 * evidence in the file's `note`.
 *
 * Recognition is by the token's own content, never by the credential's saved host: a
 * `custom_credential_sets` row has no provider id (only an operator-typed label, base URL and token),
 * and a credential saved with a proxied base URL still carries the same self-describing token.
 * Dispatch is try-each-in-turn, first match wins, so rules should keep their prefixes disjoint.
 *
 * TRUST GATES (`Jini packages/agent-plugins/src/lifecycle/trusted-plugin-files.ts`). The bundled-digest gate applies:
 * only a plugin package this build shipped may add a rule, since a rule decides how a saved secret is
 * sent. The activation gate deliberately does NOT apply: a rule is inert data (no code runs), and a
 * saved credential that already works must keep working unchanged when an operator switches the
 * contributing plugin off. Switching that plugin off hides its deploy tools; it must not silently turn a
 * working credential's header into one its provider rejects.
 *
 * Architectural role: read by the host's credentialed-request capability. The host injects its
 * lifecycle owner's contribution loaders, its bundled-source policy (`sources`) and the integrations
 * package's `parseCredentialSchemesFile`; see `README.md` `## Wiring`.
 *
 * Contract rationale for the Jini implementation and this host boundary:
 *
 * One scheme rule: a token starting with `prefix` (case-sensitive, with at least one character after
 *  it) is sent as `Authorization: <scheme> <rest of the token>`. `id` is bookkeeping only.
 *
 * One recognized self-describing token: the `scheme` word to send, and the `value` that follows it
 *  in the token (everything after the prefix, unmodified).
 *
 * The rules a workspace's trusted plugins contribute, plus every file or rule that was dropped.
 *
 * An HTTP auth-scheme name is an RFC 9110 `token`.
 *
 * Returns the first rule whose `prefix` is a genuine leading prefix of `token` (case-sensitive) with
 * at least one character left after it, or `null`. A token that IS exactly the prefix has no
 * credential value left to send and falls through to ordinary Bearer/Basic handling, as does a token
 * that merely contains a prefix later in the string. Pure.
 *
 * @complexity O(r) rules, each one `startsWith`.
 *
 * Parses a plugin's {@link CREDENTIAL_SCHEMES_FILENAME}. Pure; the parser is exported by Jini for direct tests. Unknown
 * keys (such as a rule's `note`) are ignored.
 *
 * @complexity O(r) in the declared rule count.
 *
 * One rule entry, or the reason it is invalid. @complexity O(1).
 */

/** The file a plugin ships at its root to contribute self-describing token scheme rules. */
export const CREDENTIAL_SCHEMES_FILENAME = "jini-credential-schemes.json";

/** The integrations package's scheme-file parser (`@jini-ai/integrations/credentialed-http`), injected. */
export type ParseCredentialSchemesFile = (required: { raw: string }) => { readonly ok: true; readonly rules: readonly CredentialSchemeRule[] } | { readonly ok: false; readonly reason: string };

/** The lifecycle owner's trust-gated (installed) contribution loader. */
export type LoadCredentialSchemeContributions = <D, T>(
  input: { readonly workspaceId: string; readonly definition: PluginContributionDefinition<D, T> }, options?: LoadPluginContributionsOptional,
) => Promise<PluginContributionResult<T>>;

/** The lifecycle owner's explicitly trusted source-directory loader. */
export type LoadCredentialSchemeContributionsFromSource = <D, T>(
  input: { readonly plugin: TrustedPluginPackage; readonly definition: PluginContributionDefinition<D, T> },
) => Promise<PluginContributionResult<T>>;

/** What a source-directory read needs from the host. */
export interface CredentialSchemeSourcePorts {
  readonly loadFromSource: LoadCredentialSchemeContributionsFromSource;
  readonly parseCredentialSchemesFile: ParseCredentialSchemesFile;
}

/** A package without the file (possible only on the source path) contributes nothing. @complexity O(1). */
function schemeContribution(parseCredentialSchemesFile: ParseCredentialSchemesFile): PluginContributionDefinition<CredentialSchemeRule, CredentialSchemeRule> {
  return {
    filename: CREDENTIAL_SCHEMES_FILENAME, contribution: "credential schemes", kind: "data",
    parse: ({ raw }) => {
      const parsed = parseCredentialSchemesFile({ raw });
      return parsed.ok ? { ok: true, descriptors: parsed.rules } : parsed;
    },
    load: ({ descriptor }) => descriptor,
    onReadError: ({ error }) => (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : undefined,
  };
}

/**
 * This workspace's scheme rules, from installed plugins that pass the bundled-digest gate (and NOT
 * the activation gate, see this file's header). Read fresh on every call: a credentialed request is
 * agent-triggered, not a hot path.
 *
 * @throws Nothing for a plugin-level fault; only a filesystem fault listing the workspace's package
 * directory itself propagates.
 * @param required - Contribution loader from this boot's lifecycle; no site-dependent module default.
 * @complexity O(p) installed plugins, one small file read per contributing plugin.
 */
export async function loadCredentialSchemeRegistry(
  required: { readonly workspaceId: string; readonly loadContributions: LoadCredentialSchemeContributions; readonly parseCredentialSchemesFile: ParseCredentialSchemesFile },
  _optional: Record<string, never> = {},
): Promise<CredentialSchemeRegistry> {
  const load = await required.loadContributions({ workspaceId: required.workspaceId, definition: schemeContribution(required.parseCredentialSchemesFile) }, { requireActive: false });
  return dropDuplicateIds(load.items, load.refusals);
}

/**
 * Rules read straight from a plugin's SOURCE directory, with no install or digest gate. For the
 * hermetic composition root and tests only, where the directory is this product's own
 * `content/agent-plugins/<id>/`: never point it at anything an operator or a third party can write.
 *
 * @complexity O(r) declared rules.
 */
export async function loadCredentialSchemeRegistryFromSource(
  plugin: TrustedPluginPackage & CredentialSchemeSourcePorts, _optional: Record<string, never> = {},
): Promise<CredentialSchemeRegistry> {
  const load = await plugin.loadFromSource({
    plugin: { pluginId: plugin.pluginId, packageRoot: plugin.packageRoot }, definition: schemeContribution(plugin.parseCredentialSchemesFile),
  });
  return dropDuplicateIds(load.items, load.refusals);
}

/** Union of the host's bundled scheme data. Activation remains irrelevant to token recognition;
 * installed loading still uses Jini's digest gate. @complexity O(p + rules). */
export async function loadBundledCredentialSchemeRegistry(
  required: { readonly sourceRoot: string; readonly sources: BundledContributionSources } & CredentialSchemeSourcePorts, _optional: Record<string, never> = {},
): Promise<CredentialSchemeRegistry> {
  const rules: CredentialSchemeRule[] = [];
  const refusals: string[] = [];
  for (const plugin of required.sources({ sourceRoot: required.sourceRoot, filename: CREDENTIAL_SCHEMES_FILENAME })) {
    const registry = await loadCredentialSchemeRegistryFromSource({
      ...plugin, loadFromSource: required.loadFromSource, parseCredentialSchemesFile: required.parseCredentialSchemesFile,
    });
    rules.push(...registry.rules);
    refusals.push(...registry.refusals);
  }
  return dropDuplicateIds(rules, refusals);
}

/** Drops every rule id more than one plugin declares ("refusing to guess"). Order of the survivors is
 *  kept, so first-match dispatch stays deterministic. @complexity O(r). */
function dropDuplicateIds(rules: readonly CredentialSchemeRule[], refusals: readonly string[]): CredentialSchemeRegistry {
  const counts = new Map<string, number>();
  for (const rule of rules) counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1);
  const duplicated = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  return {
    rules: rules.filter((rule) => counts.get(rule.id) === 1),
    refusals: [...refusals, ...duplicated.map((id) => `credential scheme '${id}' was not loaded: more than one plugin declares it`)],
  };
}
