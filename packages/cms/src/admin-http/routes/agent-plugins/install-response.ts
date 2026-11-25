import { agentPluginLifecycleFields, type AgentPluginLifecycleFields, type AgentPluginRowCandidate } from "../../http/agent-plugins.js";
import type { AgentPluginInstallRefusal } from "./install.js";
import type { AgentPluginSetEnabledErrorPredicates } from "./shared.js";

/**
 * @file Pure response builders for the install upload (`./install`'s raw spec, mounted by the host):
 * which status and body each install refusal answers, and the row a successful install reports.
 * Error bodies carry a code and a plain message; no host path ever reaches them.
 *
 * The error classes are injected, not imported: the lifecycle classes live in the agent-plugins
 * package (which depends on this one) and the upload/install classes live in the host. The same
 * predicate shape `set-enabled` already takes (`AgentPluginSetEnabledErrorPredicates`) is reused.
 */

/** One refusal: the HTTP status and the `{ code, error }` body sent with it. */
export interface InstallRefusal extends AgentPluginInstallRefusal {
  /** Operator-side log line; only for refusals whose real cause must not reach the client. */
  readonly warning?: string;
}

/** The host's classification of one of its own upload/install error classes. */
export interface InstallHostErrorClass {
  readonly kind: "upload" | "install";
  readonly code: string;
  readonly message: string;
}

/** The lifecycle-owner predicates the install refusal ladder asks (bound from the real classes). */
export type InstallLifecycleErrorPredicates = Pick<AgentPluginSetEnabledErrorPredicates, "update" | "hostIncompatible" | "activationsUnreadable" | "activationsBusy">;

const TOO_LARGE_MESSAGE = "The .zip is larger than the 32 MiB limit.";
const UNPACKED_TOO_LARGE_MESSAGE = "The .zip is too big once unpacked: at most 4096 files, 16 MiB per file, 64 MiB in all.";

/** Plain-language text for each refusal the operator can fix by choosing a different file. */
const INSTALL_ERROR_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  ARCHIVE_TOO_LARGE: TOO_LARGE_MESSAGE,
  DIGEST_MISMATCH: "The upload arrived damaged. Try again.",
  MANIFEST_MISSING: "No plugin.json found. Put plugin.json at the top of the .zip, or inside one folder.",
  MANIFEST_INVALID: "plugin.json is not a valid Agent Plugin manifest.",
  TOO_MANY_ENTRIES: UNPACKED_TOO_LARGE_MESSAGE,
  FILE_TOO_LARGE: UNPACKED_TOO_LARGE_MESSAGE,
  DECOMPRESSION_BOMB: UNPACKED_TOO_LARGE_MESSAGE,
  TOTAL_SIZE_EXCEEDED: UNPACKED_TOO_LARGE_MESSAGE,
};
const INSTALL_ERROR_FALLBACK_MESSAGE = "This .zip contains files or links that plugins may not include.";
/** Every other install refusal is the file's fault (400). */
const INSTALL_ERROR_STATUSES: Readonly<Partial<Record<string, number>>> = { ARCHIVE_TOO_LARGE: 413, PUBLISH_FAILED: 500 };

/** Upload refusals with their own text; any other upload code answers with its own message. */
const UPLOAD_ERROR_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  PLUGIN_ID_TAKEN: "This plugin ID is already installed. Choose Replace existing version to upgrade it.",
  ARCHIVE_UNREADABLE: "This file is not a readable .zip.",
};

const ARCHIVE_TOO_LARGE_REFUSAL: InstallRefusal = { status: 413, body: { code: "AGENT_PLUGIN_ARCHIVE_TOO_LARGE", error: TOO_LARGE_MESSAGE } };
const ARCHIVE_UNREADABLE_REFUSAL: InstallRefusal = { status: 400, body: { code: "AGENT_PLUGIN_ARCHIVE_UNREADABLE", error: "The upload could not be read." } };

/**
 * Maps the raw body parser's error to its refusal: over the size cap is 413, anything else (a
 * compressed or truncated body) is unreadable. A nullish parser error is unreadable, never a throw.
 * @complexity O(1).
 */
export function bodyParseRefusal({ parseError }: { parseError: unknown }, _optional = {}): InstallRefusal {
  return (parseError as { type?: string } | null | undefined)?.type === "entity.too.large" ? ARCHIVE_TOO_LARGE_REFUSAL : ARCHIVE_UNREADABLE_REFUSAL;
}

/** @complexity O(1). */
function uploadErrorRefusal({ code, message }: InstallHostErrorClass): InstallRefusal {
  return {
    status: code === "ARCHIVE_UNREADABLE" ? 400 : 409,
    body: { code: `AGENT_PLUGIN_${code}`, error: UPLOAD_ERROR_MESSAGES[code] ?? message },
  };
}

/** @complexity O(1). */
function installErrorRefusal({ code }: InstallHostErrorClass): InstallRefusal {
  return {
    status: INSTALL_ERROR_STATUSES[code] ?? 400,
    body: { code: `AGENT_PLUGIN_${code}`, error: INSTALL_ERROR_MESSAGES[code] ?? INSTALL_ERROR_FALLBACK_MESSAGE },
  };
}

/**
 * The refusal for a recognised install error, or `undefined` for anything else (the caller's redacted
 * 500; the install spec's mount answers that with this same operation).
 * Every update refusal (changed since the operator looked, bundled, downgrade, a pending recovery,
 * another plugin's package) and an incompatible host are conflicts with the installed state: 409
 * with the lifecycle owner's own code and plain message, which never carries a host path.
 * The activation-record faults may name host paths, so their cause goes only to the operator
 * `warning`, never into `body`.
 * @complexity O(1).
 */
export function knownInstallRefusal(
  { error, classifyHostError, lifecycleErrors }: {
    error: unknown;
    classifyHostError: (required: { error: unknown }) => InstallHostErrorClass | undefined;
    lifecycleErrors: InstallLifecycleErrorPredicates;
  },
  _optional: Record<string, never> = {},
): InstallRefusal | undefined {
  if (lifecycleErrors.update(error) || lifecycleErrors.hostIncompatible(error)) return { status: 409, body: { code: error.code, error: error.message } };
  const hostError = classifyHostError({ error });
  if (hostError) return hostError.kind === "upload" ? uploadErrorRefusal(hostError) : installErrorRefusal(hostError);
  if (lifecycleErrors.activationsUnreadable(error) || lifecycleErrors.activationsBusy(error)) {
    return {
      status: 409,
      body: { code: "AGENT_PLUGIN_ACTIVATIONS_BUSY", error: "Could not install the plugin. Try again." },
      warning: `[agent-plugins] upload refused — ${error.message}`,
    };
  }
  return undefined;
}

/** The installed plugin's row, as the list route reports it. */
export type InstalledAgentPluginRow<C extends AgentPluginRowCandidate> = AgentPluginLifecycleFields<C> & {
  readonly pluginId: string;
  readonly displayName: string | null;
  readonly summary: string | null;
  readonly version: string | null;
  readonly description: string | null;
  readonly keywords: C["keywords"];
  readonly enabled: boolean;
  readonly skills: C["skills"];
  readonly mcpServerIds: C["mcpServerIds"];
};

/**
 * Builds the response row for a just-installed plugin, or null when the read model does not list it;
 * omitted display metadata becomes explicit nulls. Named fields only: the candidate is never spread,
 * so no host path or internal field reaches the wire.
 * @complexity O(1).
 */
export function installedAgentPluginRow<C extends AgentPluginRowCandidate>({ candidate }: { candidate: C | undefined }, _optional = {}): InstalledAgentPluginRow<C> | null {
  if (!candidate) return null;
  return {
    pluginId: candidate.pluginId,
    displayName: candidate.displayName ?? null,
    summary: candidate.summary ?? null,
    version: candidate.version ?? null,
    description: candidate.description ?? null,
    keywords: candidate.keywords,
    enabled: candidate.enabled,
    ...agentPluginLifecycleFields({ candidate }),
    skills: candidate.skills,
    mcpServerIds: candidate.mcpServerIds,
  };
}
