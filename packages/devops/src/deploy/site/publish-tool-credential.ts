import { deployTargetsLoader, requireStaticPublishTarget } from './publish-tool-execution.js';
import { ToolInputError, requireInputRecord, type ToolHandler, type ToolRegistration } from '@jini-ai/core';
import { adaptLegacyAuthorize } from '@jini-ai/core';
import { nowIso as clockNowIso } from '@jini-ai/core/primitives';
import type { StaticPublishToolDeps } from './publish-tool-deps.js';
import type { AssistantSurfaceDeps } from '@jini-ai/core/contracts/site/daemon-surface-exchanges';
import type { SecretCardField, SecretCardForm } from '@jini-ai/core/contracts/cards';
import type { CredentialTokenHint } from '@jini-ai/core/contracts/site/secrets-credential-token';
import type { DeployTargetCredentialSpec, DeployTargetDescriptor, DeployTargetRegistry } from './deploy-targets/types.js';
import { PublishCredentialDuplicateLabelError, PublishCredentialValidationError, listPublishCredentials, createPublishCredential, updatePublishCredential, type PublishCredentialWriteDeps } from './publish-credentials/store.js';
import { verifyPublishCredentialById, verifySubmittedPublishCredential } from './static-publish/verify.js';

const SITE_PUBLISH_ENTITY = "site-publish";

/** The host whose credential the propose-credential tool saves: it must be loaded and declare one.
 *  @throws {ToolInputError} unknown host, or a host that takes no saved credential.
 *  @complexity O(1) — one registry lookup. */
function requireCredentialTarget(raw: Record<string, unknown>, registry: DeployTargetRegistry): { readonly descriptor: DeployTargetDescriptor; readonly credential: DeployTargetCredentialSpec } {
  const { descriptor } = requireStaticPublishTarget(raw, registry);
  if (descriptor.credential === undefined) throw new ToolInputError({ message: `${descriptor.id} takes no saved credential.` });
  return { descriptor, credential: descriptor.credential };
}

/**
 * The agent's non-secret credential-field values (form pre-fill, or hosting-setup input). Refuses a
 * secret field, so a secret can never come from the chat, and a field the host does not declare. A
 * blank value is left out.
 *
 * @throws {ToolInputError} naming the first refused key.
 * @complexity O(k·f) input keys by credential fields.
 */
export function readCredentialHints(raw: Record<string, unknown>, descriptor: DeployTargetDescriptor, deps: StaticPublishToolDeps): Record<string, string> {
  const fields = descriptor.credential?.fields ?? [];
  const hints: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "target") continue;
    const field = fields.find((candidate) => candidate.name === key);
    if (field === undefined) {
      const takes = fields.length > 0 ? `It takes: ${fields.map((candidate) => candidate.name).join(", ")}.` : "It takes none.";
      throw new ToolInputError({ message: `'${key}' is not a credential field of ${descriptor.id}. ${takes}` });
    }
    const hint = readCredentialHint({ deps, key, value, field, tokenField: descriptor.credential?.tokenField });
    if (hint.trim() !== "") hints[key] = hint;
  }
  return hints;
}

/** Validate a declared chat hint before allowing it into a credential form. */
function readCredentialHint({ deps, key, value, field, tokenField }: {
  deps: StaticPublishToolDeps;
  key: string; value: unknown; field: DeployTargetCredentialSpec["fields"][number]; tokenField: string | undefined;
}, _options = {}): string {
  if (field.secret === true || key === tokenField) throw new ToolInputError({ message: `'${key}' is secret: the person types it into the form, never into the chat.` });
  if (typeof value !== "string") throw new ToolInputError({ message: `'${key}' must be a string.` });
  deps.assertCredentialFreeField({ value, field: key });
  return value;
}

/** The propose-credential form, built from the host's credential spec. Posts back on cancel rather
 *  than closing silently: with the call parked, a silent close would strand the handler for the full
 *  TTL. */
function buildProposeCredentialForm(required: {
  deps: StaticPublishToolDeps; descriptor: DeployTargetDescriptor; credential: DeployTargetCredentialSpec; prefill: Record<string, string>; updating: boolean;
}, _optional = {}): SecretCardForm & { preferredFrameSize: readonly [string, string] } {
  const { deps, descriptor, credential, prefill, updating } = required;
  return {
    title: `Connect ${descriptor.label}`,
    ...(credential.help !== undefined ? { description: credential.help } : {}),
    submitLabel: "Save connection",
    fields: credential.fields.flatMap((field): SecretCardField[] => {
      const base = { kind: "string" as const, name: field.name, label: field.label,
        ...(field.help !== undefined ? { hint: field.help } : {}), required: field.required };
      if (field.secret === true || field.name === credential.tokenField) {
        // The store keeps exact blank secrets on update; the form must permit that submission too.
        const secret: SecretCardField = { ...base, secret: true, required: updating ? false : field.required, allowBlank: updating || !field.required };
        if (updating && !field.required && field.name !== credential.tokenField) {
          return [secret, { kind: "boolean", name: `clear-${field.name}`, label: `Remove ${field.label}`, value: false,
            hint: "Remove the saved value when this connection is saved. Leave unchecked to keep or replace it." }];
        }
        return [secret];
      }
      return [{ ...base, ...(prefill[field.name] !== undefined ? { value: prefill[field.name] } : {}) }];
    }),
    ...(deps.credentialFormApp === undefined ? {} : { app: deps.credentialFormApp }),
    preferredFrameSize: ["100%", "560px"],
  };
}

/** Only declared host fields enter the persisted connection; blank secrets keep their prior value. */
function publishConnectionValues({ targetId, credential, values }: {
  targetId: string; credential: DeployTargetCredentialSpec; values: Readonly<Record<string, unknown>>;
}, _optional = {}): Record<string, unknown> {
  const connection: Record<string, unknown> = { providerId: targetId };
  for (const field of credential.fields) {
    // The form submits a blank optional secret as ""; omitted, the store reads it as not provided
    // on create and keeps the stored one on update.
    const blankOptionalSecret = values[field.name] === "" && field.secret === true && !field.required;
    // The explicit remove choice wins over typed text; blank alone still keeps the saved secret.
    if (values[`clear-${field.name}`] === true) {
      connection[field.name] = null;
      continue;
    }
    if (typeof values[field.name] === "string" && !blankOptionalSecret) connection[field.name] = values[field.name];
  }
  return connection;
}

/** An explicit default wins; a sole visible row is also an unambiguous update target. */
function publishCredentialToUpdate({ rows, targetId }: { rows: Awaited<ReturnType<typeof listPublishCredentials>>; targetId: string }, _optional = {}) {
  const candidates = rows.filter(row => row.providerId === targetId);
  return candidates.find(row => row.isDefault) ?? (candidates.length === 1 ? candidates[0] : undefined);
}

/**
 * Saves the submitted form as the host's connection: updates its default or sole visible row,
 * otherwise creates a distinct project key. Only the host's declared
 * fields are forwarded; `publish-credentials/store.ts` is the one place that decides what is valid
 * (the form ships `novalidate`, so this is the real enforcement point). Its messages name fields,
 * never values.
 *
 * @complexity O(n) in the workspace's saved credential count.
 */
async function saveProposedCredential(required: {
  deps: StaticPublishToolDeps; targetId: string; credential: DeployTargetCredentialSpec;
  values: Readonly<Record<string, unknown>>; signal: AbortSignal;
}, _optional = {}): Promise<{ credentialId: string; tokenHint: CredentialTokenHint | null; usedByThisSite: boolean }> {
  const { deps, targetId, credential, values, signal } = required;
  const connection = publishConnectionValues({ targetId, credential, values });
  const repo = deps.abortGuardedCredentialRepo({ store: deps.vendorCredentialSetRepo, signal });
  const writeDeps: PublishCredentialWriteDeps = {
    ...deps.credentialStorePorts,
    repo,
    // Only this submitted secret card receives the trusted, grant-checked replacement port.
    allowSharedKeyReplacement: true,
    loadDeployTargets: deployTargetsLoader(deps),
    sealer: deps.siteAssistantSecretSealer,
    keyring: deps.siteAssistantSecretKeyring,
    clock: deps.clock,
    idGen: deps.idGen,
  };
  const saved = await listPublishCredentials(writeDeps, { workspaceId: deps.workspaceId });
  const existing = publishCredentialToUpdate({ rows: saved, targetId });
  // A failed replacement check must leave the working default key intact, before any seal/write.
  if (existing) await checkPublishReplacement({ deps, targetId, credential, connection });
  // Cancellation may arrive during the metadata read or probe; refuse before invoking persistence.
  signal.throwIfAborted();
  const stored = existing
    ? await updatePublishCredential(writeDeps, { workspaceId: deps.workspaceId, id: existing.id, connection })
    : await createPublishCredential(writeDeps, { workspaceId: deps.workspaceId, label: `${deps.credentialRowLabel}-${deps.idGen.newId()}`, connection,
      // New project keys stay non-default while the shared save-result path attaches them to this site.
      ...(deps.vendorCredentialSetRepo.project ? { isDefault: false } : {}) });
  return { credentialId: stored.id, tokenHint: stored.tokenHint ?? null, usedByThisSite: existing !== undefined || stored.scope !== "project" };
}

/** Reuse the provider-owned verifier only where replacement would destroy an existing key.
 * @throws PublishCredentialValidationError with fixed copy on refusal/unavailability; preserves legacy hosts without checks.
 * @complexity One registry lookup/load plus one bounded provider check, no persistence.
 */
async function checkPublishReplacement({ deps, targetId, credential, connection }: {
  deps: StaticPublishToolDeps; targetId: string; credential: DeployTargetCredentialSpec; connection: Record<string, unknown>;
}, _options = {}): Promise<void> {
  // A blank secret keeps the stored one (store.ts updatedConnection), so no working key is replaced.
  // A blank OPTIONAL secret is no reason to skip checking a replaced token.
  if (credential.fields.some(field => (field.secret === true && field.required || field.name === credential.tokenField) && !connection[field.name])) return;
  const registry = await deployTargetsLoader(deps)({ workspaceId: deps.workspaceId });
  if (!registry.get(targetId)?.module.verifyCredential) return;
  const verification = await verifySubmittedPublishCredential({
    deps: { ...deps.verificationPorts, loadDeployTargets: async () => registry, clock: { nowIso: () => clockNowIso({ clock: deps.clock }) },
      ...(deps.fetchFn === undefined ? {} : { fetchFn: deps.fetchFn }), ...(deps.observability === undefined ? {} : { observability: deps.observability }) },
    workspaceId: deps.workspaceId, target: targetId, spec: credential,
    connection: connection as Parameters<typeof verifySubmittedPublishCredential>[0]['connection'],
  });
  if (verification.status === 'valid') return;
  throw new PublishCredentialValidationError(verification.status === 'invalid'
    ? 'This key was refused for this purpose. Nothing was saved. The previous key was kept.'
    : "The service couldn't be reached. Nothing was saved. The previous key was kept.");
}

/**
 * `deployment_propose_custom_provider_credential`'s domain save and post-save probe — kept separate
 * so their cost is measured independently of the engine's exchange lifecycle.
 * @complexity One existing credential write plus an optional provider verification.
 */
async function saveProposeCredential(required: {
  deps: StaticPublishToolDeps; targetId: string; credential: DeployTargetCredentialSpec;
  values: Readonly<Record<string, unknown>>; signal: AbortSignal; locale: string;
}, _optional = {}) {
  const { deps, targetId, locale } = required;
  const saveResult = await saveProposedCredential(required);

  // NEVER echoes a field value, secret or not. Owner 2026-10-07: the submitted human card
  // now authorizes the same post-save read-only check as the admin form. Model-only reads stay probe-free.
  let connection: 'saved' | 'connected' | 'auth' | 'timeout' | 'unreachable' = 'saved';
  try {
    const registry = await deployTargetsLoader(deps)({ workspaceId: deps.workspaceId });
    if (saveResult.usedByThisSite && registry.get(targetId)?.module.verifyCredential) {
      const verification = await verifyPublishCredentialById({
        ...deps.verificationPorts, ...deps.credentialSourceStorePorts, repo: deps.vendorCredentialSetRepo, sealer: deps.siteAssistantSecretSealer,
        cache: deps.publishCredentialVerificationCache, clock: { nowIso: () => clockNowIso({ clock: deps.clock }) },
        loadDeployTargets: deployTargetsLoader(deps),
        ...(deps.observability === undefined ? {} : { observability: deps.observability }), ...(deps.fetchFn === undefined ? {} : { fetchFn: deps.fetchFn }),
      }, { workspaceId: deps.workspaceId, id: saveResult.credentialId });
      connection = credentialConnectionStatus({ verification, deps });
    }
  } catch { connection = 'unreachable'; }
  const hint = deps.formatCredentialHint({ hint: saveResult.tokenHint, locale });
  return { saved: true as const, credentialId: saveResult.credentialId, providerId: targetId, connected: connection === 'connected', connection,
    tokenHint: saveResult.tokenHint, message: `${hint ? hint + '. ' : ''}${deps.credentialText({ id: connection, locale })}` };

}

/** Translate verification into the credential card's existing connection vocabulary. */
function credentialConnectionStatus({ verification, deps }: {
  deps: StaticPublishToolDeps;
  verification: Awaited<ReturnType<typeof verifyPublishCredentialById>>;
}, _options = {}): 'connected' | 'auth' | 'timeout' | 'unreachable' {
  if (verification?.status === 'valid') return 'connected';
  if (verification?.status === 'invalid') return 'auth';
  return verification?.message === deps.credentialText({ id: 'timeout' }) ? 'timeout' : 'unreachable';
}

/**
 * Builds this domain's `ToolRegistration[]` — the same shape every other domain's
 * `build<Domain>Registrations` produces (see e.g. `recovery/tool-registrations.ts`'s
 * `buildRecoveryRegistrations`). Called by `assistant/tool-registrations.ts`, which imports
 * `buildStaticPublishRegistrations`/`staticPublishDerivedRisk` from this file and lists them as
 * their own `"static-publish"` entry in `DOMAIN_SLICES` — see that file's own comment on that entry
 * for why static-publish stays a separate slice rather than folding into this directory's sibling
 * `deployments`/`agent-tools.ts` slice.
 *
 * @param deps - `StaticPublishToolDeps` plus this file's own test-only overrides (`credentialSource`,
 *   `buildTarget`). `credentialSource` defaults to the same DB-first, env-fallback-only-in-
 *   `"self-hosted-cli"`-mode composition `publish-site.ts`'s route constructs.
 * @param surfaces - The held-open confirmation exchange store `deployment_execute_static_publish`
 *   parks on — see this file's header. Required, matching `buildPostRegistrations`' own shape (the
 *   other domain whose gate needs this), since a domain with no store at all could never wire this
 *   tool's gate at all.
 * @complexity O(1) registration-time cost; each wired handler's own cost is documented at its call
 *   site above (preview/capabilities: O(1) plus the provider count; execute: one `exportSite` pass
 *   plus one provider API call, only after a human confirms).
 */
/** Bind publish credential saving to its existing descriptor, permission and sealed-store owner.
 * @param required - Existing publish dependencies and shared surface exchanges.
 * @returns An internal save adapter, never a retired tool registration.
 * @example buildPublishHostCredentialHandler({ deps, surfaces });
 * @complexity O(1) binding; invocation reads the provider registry and saved credential summaries.
 */
export function buildPublishHostCredentialHandler({ deps, surfaces }: { deps: StaticPublishToolDeps; surfaces: AssistantSurfaceDeps }, _optional = {}): ToolHandler {
  return async (ctx, optional = {}) => {
      const raw = requireInputRecord({ input: ctx.input });
      const { descriptor, credential } = requireCredentialTarget(raw, await deployTargetsLoader(deps)({ workspaceId: deps.workspaceId }));
      const prefill = readCredentialHints(raw, descriptor, deps);

      await deps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "deployments.credentials.write" }, { entityType: SITE_PUBLISH_ENTITY });

      // Fail closed rather than degrade — identical posture to the execute-publish guard above.
      // The engine supplies a ToolInputError so the refusal remains caller-safe through transport.
      const stored = await listPublishCredentials({ ...deps.credentialStorePorts, repo: deps.vendorCredentialSetRepo, loadDeployTargets: deployTargetsLoader(deps) }, { workspaceId: deps.workspaceId });
      const updating = publishCredentialToUpdate({ rows: stored, targetId: descriptor.id }) !== undefined;
      const locale = await deps.resolveOperatorLocale({ deps, workspaceId: deps.workspaceId, principalId: ctx.principal.id });
      const pluginCard = await deps.findPluginCredentialCard({ loadCards: deps.loadPluginCredentialCards, workspaceId: deps.workspaceId, saveKind: 'publish-host', target: descriptor.id });
      const card = deps.defineSecretCardTool<{
        descriptor: DeployTargetDescriptor; credential: DeployTargetCredentialSpec; prefill: Record<string, string>; updating: boolean; locale: string;
      }, Awaited<ReturnType<typeof saveProposeCredential>>, Awaited<ReturnType<typeof saveProposeCredential>> | {
        saved: false; cancelled: boolean; reason?: string; message?: string; note?: string;
      }>({
        toolId: deps.credentialSaveToolId,
        prepare: async () => ({ descriptor, credential, prefill, updating, locale }),
        // New project keys need explicit attachment; an update changes the saved row where it lives.
        form: ({ prep }) => deps.applyPluginCredentialCard({ ...(pluginCard === undefined ? {} : { card: pluginCard }), form: buildProposeCredentialForm({ ...prep, deps }) }),
        save: ({ values, prep, signal }) => saveProposeCredential({ deps, targetId: prep.descriptor.id, credential: prep.credential, values, signal, locale: prep.locale }),
        result: ({ prep, run }) => {
          if (run.status === 'saved') return run.saved;
          if (run.status === 'cancelled') return { saved: false, cancelled: true };
          if (run.status === 'blank' || run.status === 'failed') return { saved: false, cancelled: false, reason: 'invalid',
            message: run.status === 'blank' ? deps.credentialText({ id: 'blank', locale: prep.locale }) : run.safeMessage };
          return { saved: false, cancelled: false, reason: run.status,
            note: run.status === 'expired' ? "The user did not respond to the credential form before it expired. Nothing was saved." : "The credential form was closed because the run ended. Nothing was saved." };
        },
        outcome: ({ prep, run }) => {
          if (run.status === 'cancelled' || run.status === 'expired' || run.status === 'abandoned') return undefined;
          const saved = run.status === 'saved';
          let message: string;
          if (run.status === 'saved') message = run.saved.message;
          else if (run.status === 'blank') message = deps.credentialText({ id: 'blank', locale: prep.locale });
          else if (run.status === 'failed') message = run.safeMessage;
          else message = deps.credentialText({ id: 'unreachable', locale: prep.locale });
          return { title: deps.credentialText({ id: saved ? 'savedTitle' : 'unreachable', locale: prep.locale }), state: saved ? 'success' : 'failure', message };
        },
      }, {
        ...deps.secretCardOptions,
        text: { ...deps.secretCardOptions.text, saveFailure: deps.credentialText({ id: 'unreachable', locale }) },
        safeError: err => {
          if (err instanceof PublishCredentialDuplicateLabelError) return err.message;
          return err instanceof PublishCredentialValidationError ? deps.translateCredentialMessage({ message: err.message, locale }) : undefined;
        },
        logFailure: metadata => deps.staticPublishPorts.warn(JSON.stringify(metadata)),
      });
      return card.handler({ surfaceExchanges: surfaces.surfaceExchanges, askThenReport: deps.askThenReport })(ctx, optional);
  };
}

