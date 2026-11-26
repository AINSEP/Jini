import type { SecretCardForm } from "@jini-ai/core/contracts/cards";
import type { PluginCredentialCard } from "@jini-ai/core/contracts/credentials";
type LoadPluginCredentialCards = (workspaceId: string) => Promise<readonly PluginCredentialCard[]>;
declare const findPluginCredentialCard: (required: { loadCards?: LoadPluginCredentialCards | undefined; workspaceId: string; saveKind: PluginCredentialCard["saveKind"]; target: string }, optional?: Record<string, never>) => Promise<PluginCredentialCard | undefined>;


import type { CredentialTokenHint, CredentialConnection } from "@jini-ai/core/contracts/site/secrets-credential-token";

import { resolveOperatorLocale } from '@jini-ai/core/operator-locale';
import type { OperatorLocaleDeps } from '@jini-ai/core/contracts/headless/plugin-host';
import { adaptLegacyAuthorize } from "@jini-ai/core";
import { optionalString, requireInputRecord, requireString } from "@jini-ai/core";
import { requireToolPermission } from "@jini-ai/core";
import { ToolInputError, type ToolExecutionOptions, type ToolExecutionContext } from '@jini-ai/core';
import type { SurfaceCardsPort, SurfaceCardSecretRun as SecretCardRun } from "@jini-ai/core/contracts/cards";
declare const defineSecretCardTool: SurfaceCardsPort["defineSecretCardTool"];
import type { SecretCardField } from '@jini-ai/core/contracts/cards';
import type { SurfaceAskThenReport } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { SourceControlCredentialDuplicateLabelError, createSourceControlCredential, type SourceControlCredentialWriteDeps } from './store.js';
import type { LoadSourceControlProviders, SourceControlProviderDescriptor } from './store.js';
import type { AuthorizeFn } from '@jini-ai/core/contracts/events';

/** Narrow save dependencies; independent of the registration module to avoid a type-import cycle.
 * `loadSourceControlProviders` is required: the composition root (`tool-registrations.ts`) resolves the
 * installed-plugins default, so this module never reads a workspace it was not handed. */
export interface SourceControlCredentialSetupDeps extends OperatorLocaleDeps {
  deps: SourceControlCredentialWriteDeps["deps"] & {
    CREDENTIAL_MESSAGES: Readonly<Record<"showSecret" | "hideSecret" | "generationUnavailable" | "secretValue" | "saveSecret" | "cancel" | "secretForm" | "env" | "url" | "set" | "storage" | "savedTitle" | "blank" | "limit" | "ascii" | "control" | "plain" | "saved" | "connected" | "auth" | "timeout" | "unreachable" | "chars", string>>;
    abortGuardedCredentialRepo<T extends { readonly vault?: import("@jini-ai/core/contracts/vault").VaultRepoPort }>(required: { store: T; signal: AbortSignal }, optional?: Record<string, never>): T;
  };
  defineSecretCardTool: typeof defineSecretCardTool;
  applyPluginCredentialCard: (required: { card?: PluginCredentialCard; form: SecretCardForm }) => SecretCardForm;
  findPluginCredentialCard: typeof findPluginCredentialCard;
  askThenReport: SurfaceAskThenReport;
  credentialSaveToolId: string;
  credentialFormUriHost: string;
  backupRepositoryRules: string;
  credentialText: (required: { id: keyof SourceControlCredentialSetupDeps["deps"]["CREDENTIAL_MESSAGES"]; locale: string }) => string;
  formatCredentialHint: (required: { hint: CredentialTokenHint | null | undefined; locale: string }) => string;
  reportCredentialFailure: (message: string) => void;
  assertCredentialFreeField: SourceControlCredentialWriteDeps["assertCredentialFreeField"];
  buildSourceControlProvider: SourceControlCredentialWriteDeps["buildSourceControlProvider"];
  isProjectKeyCreateConflictError: SourceControlCredentialWriteDeps["isProjectKeyCreateConflictError"];
  readonly loadPluginCredentialCards?: LoadPluginCredentialCards;
  workspaceId: string;
  authorize: AuthorizeFn;
  sourceControlCredentialSetRepo: SourceControlCredentialWriteDeps['repo'];
  siteAssistantSecretSealer: SourceControlCredentialWriteDeps['sealer'];
  siteAssistantSecretKeyring: SourceControlCredentialWriteDeps['keyring'];
  clock: SourceControlCredentialWriteDeps['clock'];
  idGen: SourceControlCredentialWriteDeps['idGen'];
  /** `RouteDeps.customCredentialsHttpClient`: the guarded client the save-time identity probe goes through. */
  customCredentialsHttpClient?: SourceControlCredentialWriteDeps['httpClient'];
  loadSourceControlProviders: LoadSourceControlProviders;
}

/** Human-only credential setup; model inputs/results never carry connection fields or raw errors. */

interface ProposalResult { saved: boolean; credentialId: string | null; provider: string; label: string; cancelled?: boolean; message?: string; tokenHint?: CredentialTokenHint | null; connection?: CredentialConnection }

/** Why nothing was saved, one per cause. Demo dry run 2026-10-05: all three used to return the same
 *  `{saved: false}`, so a person's Cancel was reported as "Either it was closed or the save failed". */
export const PROPOSE_CREDENTIAL_CANCELLED = 'The person cancelled the form. Nothing was saved.';
export const PROPOSE_CREDENTIAL_CLOSED = 'The form closed without an answer (it timed out or the chat run ended). Nothing was saved.';
export const PROPOSE_CREDENTIAL_ABORTED = 'The chat run ended before the form opened. Nothing was saved.';
export const PROPOSE_CREDENTIAL_SAVE_FAILED = 'The person submitted the form but the token could not be saved; the form told them why. Nothing was saved.';

/** Repository rules a site backup enforces (`site_backup_plan`), shown on the form beside the provider's token help. */


    
function sourceControlCredentialForm({ deps, pluginCard }: { deps: SourceControlCredentialSetupDeps; pluginCard: Awaited<ReturnType<typeof findPluginCredentialCard>> }, _optional = {}): Parameters<typeof defineSecretCardTool<{
    descriptor: SourceControlProviderDescriptor | undefined; provider: string; label: string; locale: string;
  }, Awaited<ReturnType<typeof createSourceControlCredential>>, ProposalResult>>[0]['form'] {
  return ({ prep }) => {
      const descriptor = prep.descriptor;
      if (!descriptor?.credential) throw new ToolInputError({ message: 'Source control credential form has no provider configuration.' });
      const credential = descriptor.credential;
      return deps.applyPluginCredentialCard({ card: pluginCard, form: {
        title: `Connect ${descriptor.label}`,
        description: `${credential.help ?? 'Type the secret here. The assistant never sees it.'} ${deps.backupRepositoryRules}`,
        submitLabel: 'Save credential',
        fields: [{ kind: 'string', name: 'label', label: 'Label', required: true, value: prep.label },
          ...credential.fields.map((field): SecretCardField => {
            const base = { kind: 'string' as const, name: field.name, label: field.label, required: field.required };
            return field.secret || field.name === credential.tokenField
              ? { ...base, secret: true, allowBlank: !field.required } : base;
          })],
      } });
    };
}


    // Saves only provider-declared fields through the admin POST's existing store function.
    // Returns an explicit safe projection; errors may quote secrets and are never forwarded.
    
function sourceControlCredentialSaver(deps: SourceControlCredentialSetupDeps, _optional = {}): Parameters<typeof defineSecretCardTool<{
    descriptor: SourceControlProviderDescriptor | undefined; provider: string; label: string; locale: string;
  }, Awaited<ReturnType<typeof createSourceControlCredential>>, ProposalResult>>[0]['save'] {
  return ({ values, prep, signal }) => {
      if (!prep.descriptor) throw new ToolInputError({ message: 'Source control credential save has no provider configuration.' });
      const connection = connectionFromForm({ descriptor: prep.descriptor, values });
      const store = deps.sourceControlCredentialSetRepo;
      const repo = abortGuardedSourceControlRepo({ store, signal, deps: deps.deps });
      // New project keys stay non-default while the shared save-result path attaches them to this site.
      return createSourceControlCredential({ deps: {
        deps: deps.deps, repo, sealer: deps.siteAssistantSecretSealer,
        keyring: deps.siteAssistantSecretKeyring, clock: deps.clock, idGen: deps.idGen,
        loadSourceControlProviders: deps.loadSourceControlProviders,
        assertCredentialFreeField: deps.assertCredentialFreeField, buildSourceControlProvider: deps.buildSourceControlProvider, isProjectKeyCreateConflictError: deps.isProjectKeyCreateConflictError,
        ...(deps.customCredentialsHttpClient ? { httpClient: deps.customCredentialsHttpClient } : {}),
      }, input: { workspaceId: deps.workspaceId, label: values.label, connection, ...(store.project ? { isDefault: false } : {}) } });
    };
}


    
function sourceControlCredentialResult(deps: SourceControlCredentialSetupDeps, _optional = {}): Parameters<typeof defineSecretCardTool<{
    descriptor: SourceControlProviderDescriptor | undefined; provider: string; label: string; locale: string;
  }, Awaited<ReturnType<typeof createSourceControlCredential>>, ProposalResult>>[0]['result'] { return ({ prep, run }): ProposalResult => {
      const declined = { saved: false, credentialId: null, provider: prep.provider, label: prep.label, cancelled: run.status === 'cancelled' };
      if (run.status !== 'saved') {
        const message = declinedMessage({ prep, run, deps });
        return { ...declined, message };
      }
      const credential = run.saved;
      const connection = credential.connection ?? 'saved';
      return { saved: true, credentialId: credential.id, provider: prep.provider, label: credential.label, tokenHint: credential.tokenHint, connection,
        message: savedMessage({ credential, locale: prep.locale, deps }) };
    };
}


    // Renders a value-free save outcome on the form's URI, supplied by the engine.
    
function sourceControlCredentialOutcome(deps: SourceControlCredentialSetupDeps, _optional = {}): Parameters<typeof defineSecretCardTool<{
    descriptor: SourceControlProviderDescriptor | undefined; provider: string; label: string; locale: string;
  }, Awaited<ReturnType<typeof createSourceControlCredential>>, ProposalResult>>[0]['outcome'] { return ({ prep, run }) => {
      if (run.status === 'cancelled' || run.status === 'expired' || run.status === 'abandoned') return undefined;
      const saved = run.status === 'saved';
      let message = PROPOSE_CREDENTIAL_SAVE_FAILED;
      switch (run.status) {
        case 'saved': message = savedMessage({ credential: run.saved, locale: prep.locale, deps }); break;
        case 'blank': message = deps.credentialText({ id: 'blank', locale: prep.locale }); break;
        case 'failed': message = run.safeMessage; break;
      }
      return { title: saved ? 'Credential saved' : 'Credential not saved', state: saved ? 'success' : 'failure', message };
    };
}


/** Opens the registry-defined human form and parks this tool call until answered or aborted.
 * @param spec - Tool context, explicit store dependencies and the shared exchange store.
 * @example await proposeSourceControlCredential({ ctx, deps, surfaces });
 * @returns Safe save status; throws ToolInputError for invalid model input or absent form channel.
 * @complexity Time O(p + f) provider/field count before one existing credential save; space O(f).
 */
export async function proposeSourceControlCredential(spec: { ctx: ToolExecutionContext; deps: SourceControlCredentialSetupDeps; surfaces: AssistantSurfaceDeps }, optional: ToolExecutionOptions = {}): Promise<ProposalResult> {
  const { ctx, deps, surfaces } = spec;
  const { provider, label } = parseProposalInput({ input: ctx.input, assertCredentialFreeField: deps.assertCredentialFreeField });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: 'source-control.credentials.write' }, { entityType: 'source-control' });
  // An ended run must not load plugins; the engine classifies abandonment without opening a card.
  const registry = ctx.signal.aborted ? undefined : await deps.loadSourceControlProviders({ workspaceId: deps.workspaceId });
  const descriptor = registry?.get({ providerId: provider })?.descriptor;
  if (!ctx.signal.aborted && !descriptor?.credential) {
    throw new ToolInputError({ message: 'No enabled source control provider declares this credential form. Call source_control_get_capabilities for available hosts.' });
  }
  const locale = await resolveOperatorLocale({ deps, workspaceId: deps.workspaceId, principalId: ctx.principal.id });
  const pluginCard = ctx.signal.aborted ? undefined : await deps.findPluginCredentialCard({ loadCards: deps.loadPluginCredentialCards, workspaceId: deps.workspaceId, saveKind: 'source-control', target: provider });
  const card = deps.defineSecretCardTool<{
    descriptor: SourceControlProviderDescriptor | undefined; provider: string; label: string; locale: string;
  }, Awaited<ReturnType<typeof createSourceControlCredential>>, ProposalResult>({
    toolId: deps.credentialSaveToolId,
    prepare: async () => ({ descriptor: ctx.signal.aborted ? undefined : descriptor, provider, label, locale }),
    form: sourceControlCredentialForm({ deps, pluginCard }),
    save: sourceControlCredentialSaver(deps),
    result: sourceControlCredentialResult(deps),
    outcome: sourceControlCredentialOutcome(deps),
  }, {
    uriHost: deps.credentialFormUriHost,
    text: { noEmitter: 'source_control_propose_credential requires an interactive form channel. Nothing was saved.', saveFailure: PROPOSE_CREDENTIAL_SAVE_FAILED },
    safeError: err => {
      if (err instanceof SourceControlCredentialDuplicateLabelError) return err.message;
      const id = Object.entries(deps.deps.CREDENTIAL_MESSAGES).find(([, text]) => err instanceof Error && text === err.message)?.[0];
      return id ? deps.credentialText({ id: id as keyof SourceControlCredentialSetupDeps["deps"]["CREDENTIAL_MESSAGES"], locale }) : undefined;
    },
    // Fixed metadata only: neither an exception's text nor a submitted value is safe to log.
    logFailure: metadata => deps.reportCredentialFailure(JSON.stringify(metadata)),
  });
  return card.handler({ surfaceExchanges: surfaces.surfaceExchanges, askThenReport: deps.askThenReport })(ctx, optional);
}

type SourceControlSetRepo = SourceControlCredentialSetupDeps['sourceControlCredentialSetRepo'];

/**
 * Guards every write of the store (insert, update, delete, account label, vault, project half) so a run
 * that ended while the async seal was pending writes nothing more. Reads pass straight through.
 * @complexity O(1) wiring; each call costs what the wrapped store's call costs.
 */
export function abortGuardedSourceControlRepo({ store, signal, deps }: { store: SourceControlSetRepo; signal: AbortSignal; deps: SourceControlCredentialSetupDeps["deps"] }, _options = {}): SourceControlSetRepo {
  // The async seal can outlive the run; the existing store must not write after abandonment.
  // Saves write through `vault`, so it must be forwarded (omitting it fails every save) with the same guard.
  const vault = store.vault;
  const canonical = store.canonical;
  const updateAccountLabel = store.updateAccountLabel?.bind(store);
  return {
    ...(canonical ? { canonical: { ...canonical, create: async (input) => {
      signal.throwIfAborted();
      if (!canonical.create) throw new ToolInputError({ message: 'Open the provider API key card to save this key.' });
      return canonical.create(input, { signal });
    } } } : {}),
    ...(vault ? { vault: sourceControlSaveVault({ vault, signal }) } : {}),
    // The host-bound vault policy opens whichever repo it is handed, so it sees this guarded vault.
    ...(store.credentialVault ? { credentialVault: store.credentialVault } : {}),
    insert: record => { signal.throwIfAborted(); return store.insert(record); },
    update: record => { signal.throwIfAborted(); return store.update(record); },
    findById: input => store.findById(input),
    findDefaultByProvider: input => store.findDefaultByProvider(input),
    listByProvider: input => store.listByProvider(input),
    listByWorkspace: input => store.listByWorkspace(input),
    delete: input => { signal.throwIfAborted(); return store.delete(input); },
    ...(updateAccountLabel ? { updateAccountLabel: (input: Parameters<NonNullable<typeof store.updateAccountLabel>>[0]) => { signal.throwIfAborted(); return updateAccountLabel(input); } } : {}),
    // The project half writes too (project-first saves): guarded alike.
    ...(store.project ? { project: { ...store.project, repo: deps.abortGuardedCredentialRepo({ store: store.project.repo, signal }), ...(store.project.createRepo ? { createRepo: deps.abortGuardedCredentialRepo({ store: store.project.createRepo, signal }) } : {}) } } : {}),
  };
}

/** Preserve this adapter's vault ABI and its write guards, including optional batch writes. */
function sourceControlSaveVault({ vault, signal }: { vault: NonNullable<SourceControlCredentialSetupDeps['sourceControlCredentialSetRepo']['vault']>; signal: AbortSignal }, _options = {}): typeof vault {
  const findDefault = vault.findDefault?.bind(vault);
  const findOne = vault.findOne?.bind(vault);
  const applyBatch = vault.applyBatch?.bind(vault);
  return {
    find: (input, options) => vault.find(input, options),
    list: (input, options) => vault.list(input, options),
    put: (input, options) => { signal.throwIfAborted(); return vault.put(input, options); },
    patchMeta: (input, options) => vault.patchMeta(input, options),
    delete: (input, options) => vault.delete(input, options),
    ...(findDefault ? { findDefault } : {}),
    ...(findOne ? { findOne } : {}),
    ...(applyBatch ? { applyBatch: (input: Parameters<NonNullable<typeof vault.applyBatch>>[0], options?: Parameters<NonNullable<typeof vault.applyBatch>>[1]) => { signal.throwIfAborted(); return applyBatch(input, options); } } : {}),
  };
}

/** Keep provider-defined names on the human form and canonical `token` on the store contract.
 * Only declared fields cross the save boundary. @complexity O(f) time/space, f <= 10. */
function connectionFromForm({ descriptor, values }: {
  descriptor: SourceControlProviderDescriptor; values: Readonly<Record<string, unknown>>;
}, _options = {}): Record<string, unknown> {
  const connection: Record<string, unknown> = { providerId: descriptor.id };
  const credential = descriptor.credential;
  if (!credential) throw new ToolInputError({ message: 'Source control provider has no credential fields.' });
  for (const field of credential.fields) {
    const name = field.name === credential.tokenField ? 'token' : field.name;
    connection[name] = values[field.name];
  }
  return connection;
}

/** Validate only public model fields before authorization or plugin lookup. @complexity O(k) input keys. */
function parseProposalInput({ input, assertCredentialFreeField }: { input: unknown; assertCredentialFreeField: SourceControlCredentialSetupDeps["assertCredentialFreeField"] }, _options = {}): { provider: string; label: string } {
  const raw = requireInputRecord({ input });
  if (Object.keys(raw).some(key => key !== 'provider' && key !== 'label')) {
    throw new ToolInputError({ message: 'source_control_propose_credential accepts only provider and label; enter secrets in the human form.' });
  }
  const provider = requireString({ input: raw, key: 'provider' });
  const label = optionalString({ input: raw, key: 'label' }) ?? 'default';
  assertCredentialFreeField({ value: label, field: "label" });
  if (label.length > 200) throw new ToolInputError({ message: 'Credential label must be at most 200 characters.' });
  return { provider, label };
}

type CredentialPrep = { descriptor: SourceControlProviderDescriptor | undefined; locale: string };
type SavedCredential = Awaited<ReturnType<typeof createSourceControlCredential>>;

/** Fixed decline copy preserves the distinction between unopened and closed forms. @complexity O(1). */
function declinedMessage({ prep, run, deps }: { deps: SourceControlCredentialSetupDeps; prep: CredentialPrep; run: Exclude<SecretCardRun<SavedCredential>, { status: 'saved' }> }, _options = {}): string {
  switch (run.status) {
    case 'cancelled': return PROPOSE_CREDENTIAL_CANCELLED;
    case 'blank': return deps.credentialText({ id: 'blank', locale: prep.locale });
    case 'failed': return run.safeMessage;
    case 'abandoned': return prep.descriptor === undefined ? PROPOSE_CREDENTIAL_ABORTED : PROPOSE_CREDENTIAL_CLOSED;
    default: return PROPOSE_CREDENTIAL_CLOSED;
  }
}

/** Both projections use the same safe hint and connection copy. @complexity O(1). */
function savedMessage({ credential, locale, deps }: { deps: SourceControlCredentialSetupDeps; credential: SavedCredential; locale: string }, _options = {}): string {
  const hint = deps.formatCredentialHint({ hint: credential.tokenHint, locale });
  return `${hint ? hint + '. ' : ''}${deps.credentialText({ id: credential.connection ?? 'saved', locale })}`;
}
