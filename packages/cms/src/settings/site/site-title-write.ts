import type { JsonValue } from "@jini-ai/core/primitives";
import {
  clear as clearSettingValue, resetNamespace as resetSettingNamespace, ForbiddenError, resolveDefinitionRaw, set as setSettingValue, ValueValidationFailedError,
  type ClearValueRequired, type ResetNamespaceRequired, type SettingsRepoPort, type SetValueRequired, type SettingsValueWriteOptions,
} from "@jini-ai/core/settings";

import { enforceFormDeliveryBindingsWrite } from "./form-delivery.js";
import { normalizeSiteTitle, SITE_TITLE_KEY, SITE_TITLE_MAX_LENGTH, SITE_TITLE_NAMESPACE } from "./site-title.js";

/**
 * @file SPEC-050 REQ-08: this host's settings write chokepoint. The package's `set` checks a string
 * definition by `typeof` only and leaves length rules to the registering feature, so the `set` this
 * directory's barrel exports is the wrapper below. Every host write that names a setting by namespace
 * and key binds it: the admin settings route, and `RouteDeps.set` in both composition roots (which the
 * agent daemon builds its deps from).
 *
 * Deliberately not routed through here: the package's `settings_set_ui_preference` tool calls the
 * package's own `set`, and its allowlist has no `core.site.title`; the system pin in `site-title.ts`
 * writes the fixed legacy literal.
 *
 * Host-owned dedicated writers (beyond the comments provider below) arrive on the required
 * `writePolicies` field of every entry point; the host binds that value once where it builds `set`.
 */

/** One setting only its owner's dedicated path may write; generic writes and clears are refused. */
export type DedicatedSettingsWriter = {
  readonly namespace: string; readonly key: string; readonly permissionOverride: string; readonly reason: string;
  readonly normalize?: (required: { required: SetValueRequired }, optional?: Record<string, never>) => SetValueRequired;
};

/** The host's write policy, bound once by the host at the place it builds its `set`. */
export type SiteSettingsWritePolicies = {
  /** Host dedicated writers, checked after the built-in comments-provider writer. */
  readonly dedicatedWriters: readonly DedicatedSettingsWriter[];
};

/** Per-call host policies of the chokepoint `set`. */
export type SiteSettingsSetOptions = SettingsValueWriteOptions & {
  /** Host policy: a public visitor surface requires its own saved, decryptable key and model. */
  canEnablePublicAssistant?: (required: { workspaceId: string }, optional?: Record<string, never>) => Promise<boolean>;
  /** Injected by the theme owner; generic settings has no dependency on theme discovery. */
  preparePreviewSwitcherWrite?: (required: SetValueRequired) => Promise<SetValueRequired>;
};

/** The chokepoint `set` after the host bound its {@link SiteSettingsWritePolicies}. */
export type SiteSettingsSetFn = (required: SetValueRequired, optional?: SiteSettingsSetOptions) => Promise<{ value: JsonValue; revisionSeq: number }>;

/** REQ-08's rejection text. The settings route surfaces it as `VALUE_VALIDATION_FAILED`. */
const SITE_TITLE_REJECTION = `value for '${SITE_TITLE_NAMESPACE}.${SITE_TITLE_KEY}' must be 1..${SITE_TITLE_MAX_LENGTH} characters after trimming`;

/**
 * REQ-08 for one write: a string `core.site.title` value becomes its trimmed form, or is rejected
 * when that form is empty or longer than {@link SITE_TITLE_MAX_LENGTH}. Any other setting, and a
 * non-string title (the definition schema rejects that itself), passes through unchanged. Pure.
 *
 * @throws {ValueValidationFailedError} For a string title outside 1..200 characters after trimming.
 * @complexity O(n) in the value's length.
 */
export function enforceSiteTitleWriteBounds(input: SetValueRequired["input"]): SetValueRequired["input"] {
  if (input.namespace !== SITE_TITLE_NAMESPACE || input.key !== SITE_TITLE_KEY || typeof input.value !== "string") {
    return input;
  }
  const title = normalizeSiteTitle({ value: input.value });
  if (title === undefined) throw new ValueValidationFailedError(SITE_TITLE_REJECTION);
  return { ...input, value: title };
}

/**
 * The package's `set` with {@link enforceSiteTitleWriteBounds} applied first, so a rejected title
 * never reaches the ledger. Visitor enable writes additionally require the host's saved-credential
 * policy. Canonical definition resolution prevents an alias from bypassing that policy.
 * The optional revision guard is forwarded to the ledger after host validation.
 * @throws {SettingsRevisionConflictError} If the addressed layer changed since the supplied revision.
 *
 * @complexity O(n) in the value's length, plus the package `set`'s own cost.
 */
export async function set(required: SetValueRequired & { writePolicies: SiteSettingsWritePolicies }, optional: SiteSettingsSetOptions = {}): Promise<{ value: JsonValue; revisionSeq: number }> {
  const { writePolicies, ...write } = required;
  let next: SetValueRequired = write;
  const definition = await resolveDefinitionRaw({ repo: next.deps.repo }, {
    namespace: next.input.namespace, key: next.input.key,
    workspaceId: next.input.scope === "global" ? null : next.input.workspaceId ?? null,
  });
  if (next.input.value === true && definition?.namespace === "site.assistant" && definition.key === "public_enabled") {
    await requirePublicAssistantReadiness({ workspaceId: next.input.workspaceId }, optional);
  }
  next = refuseDedicatedSettingWrite({ required: next, definition, writePolicies });
  next = await applyPreviewSwitcherPolicy({ required: next, definition, prepare: optional.preparePreviewSwitcherWrite });
  // Form delivery bindings are validated here too, so no host write path can store a list that
  // planning would refuse or a secret in a binding's config (`form-delivery.ts`).
  return setSettingValue({ ...next, input: enforceFormDeliveryBindingsWrite(enforceSiteTitleWriteBounds(next.input)) }, optional);
}

/** `core.comments/provider` hides or shows every stored comment, so it is written only by the comments
 * selection store (`features/comments/provider-selection.ts`: confirmation card, revision CAS,
 * `comments.configure`). The generic settings route would otherwise reach it with the workspace-settings
 * permission alone. Resolved by canonical definition, so an alias cannot bypass it. */
export const COMMENTS_PROVIDER_SETTING = { namespace: "core.comments", key: "provider" } as const;

/** Why every generic path refuses the provider; the agent's settings tools quote it too. */
export const COMMENTS_PROVIDER_WRITE_REASON = "Change the comments provider with comments_set_provider; it confirms first and keeps stored comments.";

/** The built-in dedicated writer every host gets, ahead of its own `writePolicies.dedicatedWriters`. */
export const COMMENTS_PROVIDER_DEDICATED_WRITER: DedicatedSettingsWriter = {
  ...COMMENTS_PROVIDER_SETTING, permissionOverride: "comments.configure", reason: COMMENTS_PROVIDER_WRITE_REASON,
};

/** Every generic path uses the same canonical coordinates, including aliases and namespace reset.
 * MOVE: Clearing restores defaults, so dedicated writers make explicit choices instead of clearing.
 * @complexity O(w) in the host's dedicated writers.
 */
export function dedicatedSettingsWriters({ writePolicies }: { writePolicies: SiteSettingsWritePolicies }, _optional = {}): readonly DedicatedSettingsWriter[] {
  return [COMMENTS_PROVIDER_DEDICATED_WRITER, ...writePolicies.dedicatedWriters];
}

type ResolvedDefinition = Awaited<ReturnType<typeof resolveDefinitionRaw>>;

/** Match only canonical definitions; settings resolution owns alias traversal. @complexity O(w). */
function dedicatedWriter({ definition, writePolicies }: { definition: ResolvedDefinition; writePolicies: SiteSettingsWritePolicies }, _options = {}) {
  return dedicatedSettingsWriters({ writePolicies }).find(rule => rule.namespace === definition?.namespace && rule.key === definition.key);
}

/** Refuse writes without the dedicated permission, then apply the owner's normalization hook.
 * @throws ForbiddenError or the owner's validation error. @complexity O(1) plus normalization.
 */
function refuseDedicatedSettingWrite({ required, definition, writePolicies }: {
  required: SetValueRequired; definition: ResolvedDefinition; writePolicies: SiteSettingsWritePolicies;
}, _options = {}): SetValueRequired {
  const writer = dedicatedWriter({ definition, writePolicies });
  if (writer && required.input.requiredPermissionOverride !== writer.permissionOverride) {
    throw new ForbiddenError(writer.reason);
  }
  return writer?.normalize?.({ required }) ?? required;
}

/**
 * Clearing a dedicated setting restores defaults: it can re-enable comments or visitor tools
 * the owner switched Off. Dedicated writers store explicit choices. Resolved through aliases.
 *
 * @throws {ForbiddenError} When the coordinate resolves to a dedicated writer's setting.
 * @complexity O(1) definition lookups (one alias hop).
 */
export async function refuseDedicatedSettingClear(required: {
  repo: SettingsRepoPort; input: Pick<ClearValueRequired["input"], "namespace" | "key" | "scope" | "workspaceId">;
  writePolicies: SiteSettingsWritePolicies;
}, _optional = {}): Promise<void> {
  const { repo, input, writePolicies } = required;
  const definition = await resolveDefinitionRaw({ repo }, {
    namespace: input.namespace, key: input.key, workspaceId: input.scope === "global" ? null : input.workspaceId ?? null,
  });
  const writer = dedicatedWriter({ definition, writePolicies });
  if (writer) throw new ForbiddenError(writer.reason);
}

/**
 * A namespace reset loops `clear` over every key its scope's partition lists for the namespace, alias
 * rows included, without this host's chokepoint, so the same keys are resolved here first and the
 * whole reset is refused before any write when one has a dedicated writer. The partition rule is the
 * CMS adapter's own (Jini `packages/core/src/settings/cms-adapter.ts`).
 *
 * @throws {ForbiddenError} When a key the reset would clear has a dedicated writer.
 * @complexity O(d) over the partition's definitions, plus one bounded alias resolution per namespace key.
 */
export async function refuseDedicatedSettingReset(required: {
  repo: SettingsRepoPort; input: Pick<ResetNamespaceRequired["input"], "namespace" | "scope" | "workspaceId" | "authWorkspaceId">;
  writePolicies: SiteSettingsWritePolicies;
}, _optional = {}): Promise<void> {
  const { repo, input, writePolicies } = required;
  const workspaceId = input.scope === "global" ? null : input.workspaceId ?? input.authWorkspaceId ?? null;
  const definitions = await repo.listActiveDefinitions({ workspaceId });
  for (const definition of definitions.filter((d) => d.namespace === input.namespace)) {
    await refuseDedicatedSettingClear({ repo, writePolicies, input: { namespace: definition.namespace, key: definition.key, scope: input.scope, workspaceId: workspaceId ?? undefined } });
  }
}

/**
 * The package's `clear` behind the canonical dedicated-writer guard: callers cannot restore
 * comments-provider or visitor-tool defaults through generic settings writes.
 *
 * @complexity As the package `clear`, plus one bounded alias resolution.
 */
export async function clear(required: ClearValueRequired & { writePolicies: SiteSettingsWritePolicies }, _optional = {}): Promise<{ revisionSeq: number }> {
  const { writePolicies, ...write } = required;
  await refuseDedicatedSettingClear({ repo: write.deps.repo, input: write.input, writePolicies });
  return clearSettingValue(write);
}

/** Refuse the whole reset before the ledger clears any dedicated writer's key. Keys are part of
 * the required object, which this thin host adapter hands to Jini's `resetNamespace` unchanged.
 * @complexity O(d) preflight (partition definitions), followed by the settings owner's transaction.
 */
export async function resetNamespace(required: ResetNamespaceRequired & { keysInNamespace: string[]; writePolicies: SiteSettingsWritePolicies }, _optional = {}): ReturnType<typeof resetSettingNamespace> {
  const { writePolicies, ...write } = required;
  await refuseDedicatedSettingReset({ repo: write.deps.repo, input: write.input, writePolicies });
  return resetSettingNamespace(write);
}

/** Resolve aliases before dispatching the theme-owned policy; uncomposed writers fail closed. */
async function applyPreviewSwitcherPolicy({ required, definition, prepare }: {
  required: SetValueRequired; definition: ResolvedDefinition;
  prepare: SiteSettingsSetOptions["preparePreviewSwitcherWrite"];
}, _options = {}): Promise<SetValueRequired> {
  if (definition?.namespace !== "core.theme" || definition.key !== "previewSwitcher") return required;
  if (!prepare) throw new ValueValidationFailedError("Theme preview write policy is unavailable.");
  return prepare(required);
}

/** Host readiness is independent of the generic settings writer's scope authorization. */
async function requirePublicAssistantReadiness({ workspaceId }: { workspaceId: string | undefined },
  optional: SiteSettingsSetOptions): Promise<void> {
  // Missing policy fails closed, including direct callers outside the composed HTTP server.
  if (!workspaceId || !await optional.canEnablePublicAssistant?.({ workspaceId })) {
    throw new ValueValidationFailedError("Save a usable provider key and a model in AI Assistant before enabling the public assistant.");
  }
}
