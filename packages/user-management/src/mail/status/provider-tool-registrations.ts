import { toolMetadata } from "@jini-ai/core/tool-metadata/mail-status";
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, ToolInputError, type AgentToolSideEffect, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";
import { adaptLegacyAuthorize, ToolPermissionDeniedError as ForbiddenError, requireToolPermission } from "@jini-ai/core";
import { describeErrorForLog, forbiddenRule, withModelFacingErrors } from "@jini-ai/core/model-facing-tool-errors";
import type { ToolContributor } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { ToolFailureDiagnostic } from "@jini-ai/core/contracts/site/daemon-tool-recovery";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { MailProviderControl } from "./provider-operations.js";
import type { MailProviderConfigurationReport } from "@jini-ai/core/contracts/mail";
import { mailProviderAgentToolCatalog } from "@jini-ai/user-management/mail/status/provider-agent-tools";
import { MailProviderOperationError, planMailProviderCredential, readMailProviderConfigurations, type MailProviderCredentialPlan } from "./provider-operations.js";

import type { PluginCredentialCard } from "@jini-ai/core/contracts/credentials";

/**
 * @file Assistant adapters for the shared provider operations (`./provider-operations.ts`), the
 * same ones the admin `system/mail-providers` routes call. Kept apart from `./tool-registrations.ts`
 * so the provider configuration slice and the status/test-send slice evolve independently.
 */

export interface MailProviderToolDeps {
  authorize: AuthorizeFn; workspaceId: string;
  /** Absent in hermetic roots: both tools refuse and change nothing. */
  mailProviderControl?: MailProviderControl;
  category: string;
  loadAgentPluginSearchCandidates?: (required: { workspaceId: string }) => Promise<readonly { pluginId: string; description: string; enabled: boolean; mcpServerIds: readonly string[]; provides: readonly string[] }[]>;
  loadPluginCredentialCardsSafely: (required: { workspaceId: string }) => Promise<readonly PluginCredentialCard[]>;
  issueCredentialSetup: (required: { setupToolId: string; prefill: Readonly<Record<string, string>> }, optional: Record<string, never>) => ToolFailureDiagnostic;
}

export const mailProviderDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // -> mailProviderControl.describe: one catalog load and one credential-row list; no decrypt.
  ["mail_list_providers", "none"],
  // -> the same read; the key itself is written later by credential_save's human form.
  ["mail_configure_provider", "none"],
]);

/** Runs a shared operation; its refusal reaches the model as a plain input error. */
export async function asToolInputError<T>({ run }: { run: () => Promise<T> }, _options: Record<string, never> = {}): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof MailProviderOperationError) throw new ToolInputError({ message: err.message });
    throw err;
  }
}

/** The lanes before a switch, when this root can describe them; a describe fault hides only this detail. */
export async function readCurrentLanes(required: { control: MailProviderControl }, _options: Record<string, never> = {}): Promise<MailProviderConfigurationReport["setting"] | undefined> {
  if (!required.control.describe) return undefined;
  return (await required.control.describe().catch((error: unknown) => {
    console.error("[mail] Could not read the current provider lanes", describeErrorForLog({ err: error }));
    return undefined;
  }))?.setting;
}

/** A split-lane setup is shown before it is flattened, never silently. */
export function currentLanesDetail(required: { current?: MailProviderConfigurationReport["setting"] }, _options: Record<string, never> = {}): { label: string; value: string }[] {
  const current = required.current;
  if (!current || current.transactional === current.bulk) return [];
  return [{ label: "Currently", value: `Transactional: ${current.transactional ?? "none"}; bulk: ${current.bulk ?? "none"}. Both lanes will use the new provider.` }];
}

/** credential_save's non-secret prefill: create with the exact label/category, or rotate by label. */
function credentialPrefill(plan: MailProviderCredentialPlan, _options: Record<string, never> = {}): Record<string, string> {
  const { action, label, category, baseUrl } = plan.credential;
  if (action === "rotate") return { kind: "api", target: label };
  return { kind: "api", label, category, ...(baseUrl ? { baseUrl } : {}) };
}

/**
 * What the secure form cannot collect: credential_save's API form takes the secret and the origin
 * only, so a provider whose setup declares a `username` field (an SMTP login, for one) names the
 * non-secret follow-up. Keyed on the field, never on a provider id; a rotation keeps the username.
 */
function followUps(plan: MailProviderCredentialPlan, _options: Record<string, never> = {}): { tool: string; args: Record<string, string>; note: string }[] {
  const needsUsername = plan.credential.action === "create" && plan.provider.setup.fields.some((field) => field.key === "username");
  return needsUsername
    ? [{ tool: "custom_credential_set_username", args: { label: plan.credential.label }, note: "This provider signs in with a username plus the secret. After the secure form, ask the person for the username (not a secret) and save it with this tool." }]
    : [];
}

function permission({ deps, ctx, name }: { deps: MailProviderToolDeps; ctx: ToolExecutionContext; name: string }, _options: Record<string, never> = {}): Promise<unknown> {
  return requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: name }, { entityType: "mail" });
}

function readProviderId({ input }: { input: unknown }, _options: Record<string, never> = {}): string {
  const record = requireInputRecord({ input });
  const providerId = typeof record.providerId === "string" ? record.providerId.trim() : "";
  if (!providerId) throw new ToolInputError({ message: "providerId must be an installed provider id from mail_list_providers." });
  return providerId;
}

/**
 * `mail_list_providers` and `mail_configure_provider`.
 * @param deps - Site scope, authorization and the provider control seam.
 * @returns The two registrations.
 * @throws {ToolInputError} For malformed input, a refusal or a denied permission.
 * @complexity One catalog load and one credential list per call.
 */
export function buildMailProviderRegistrations(deps: MailProviderToolDeps, _options: import("@jini-ai/core/contracts/site/daemon-surface-exchanges").AssistantSurfaceDeps | Record<string, never> = {}): ToolRegistration[] {
  return buildDomainRegistrations({ metadata: toolMetadata, domain: "system-mail-providers", catalogModule: "features/mail-status/provider-agent-tools.ts", catalog: indexCatalogById({ catalog: mailProviderAgentToolCatalog }), derivedRisk: mailProviderDerivedRisk, handlers: withModelFacingErrors({ handlers: {
    mail_list_providers: async (ctx) => {
      requireInputRecord({ input: ctx.input });
      await permission({ deps: deps, ctx: ctx, name: "admin.forms.manage" });
      const report = await asToolInputError({ run: () => readMailProviderConfigurations({ control: deps.mailProviderControl }) });
      if (!deps.loadAgentPluginSearchCandidates) return report;
      // Discovery must include disabled plugins without loading their executable adapters.
      const candidates = await deps.loadAgentPluginSearchCandidates({ workspaceId: deps.workspaceId });
      const availablePlugins = candidates.filter(plugin => plugin.provides.includes("outbound-mail")).map(plugin => ({
        pluginId: plugin.pluginId, description: plugin.description, enabled: plugin.enabled, mcpServers: plugin.mcpServerIds,
      }));
      return { ...report, availablePlugins };
    },
    mail_configure_provider: async (ctx) => {
      const providerId = readProviderId({ input: ctx.input });
      await permission({ deps: deps, ctx: ctx, name: "custom-credentials.write" });
      const plan = await asToolInputError({ run: () => planMailProviderCredential({ control: deps.mailProviderControl, providerId, category: deps.category }) });
      // A saved key is not a request to replace it. Keep setup from suggesting an overwrite.
      if (plan.credential.action === "rotate") return { activated: false, ...plan, note: `A key is already saved. Reuse it. Only if the person explicitly asks to replace it, call credential_save {kind:"api",target:"${plan.credential.label}"}.`, followUps: [] };
      const cards = await deps.loadPluginCredentialCardsSafely({ workspaceId: deps.workspaceId });
      const card = cards.find(card => card.providerId === providerId && card.label === plan.credential.label);
      const prefill = card ? { kind: "plugin-provider", target: card.providerId } : credentialPrefill(plan);
      return { activated: false, ...plan, credentialSetup: deps.issueCredentialSetup({ setupToolId: "credential_save", prefill }, {}), followUps: followUps(plan) };
    },
  }, rules: [forbiddenRule({ domainPrefix: "MAIL_PROVIDERS", error: ForbiddenError })] }) });
}

/** Registers the provider configuration tools under their own contributor domain. */
export function contributeMailProviderTools(): ToolContributor<MailProviderToolDeps, AssistantSurfaceDeps> {
  return { domain: "system-mail-providers", build: buildMailProviderRegistrations, risk: mailProviderDerivedRisk };
}
