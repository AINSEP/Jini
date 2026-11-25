import { useEffect, useMemo, useRef, useState } from "react";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import type { AdminSourceControlCredentialSummary, AdminSourceControlProviderId, AdminSourceControlProviderDescriptor, AdminSourceControlProvidersSnapshot, AdminSourceControlConnectionInput, SourceControlCredentialSubmitFailure } from "../rules.js";

import {
  SOURCE_CONTROL_CREDENTIAL_ROW_LABEL,
  buildSourceControlConnectionInput,
  defaultSourceControlCredentialForProvider,
  sourceControlCredentialRowReadyToSave,
  sourceControlProviders,
  type SourceControlCredentialFormFields,
  type SourceControlProviderInfo,
} from "../rules.js";

import { type Translate } from '@jini-ai/core/text';
import { sourceControlProvidersNotice, type SourceControlProvidersNotice } from "../rules.js";
/**
 * @file The Source Control page's credential-management hook — one always-visible row per host
 * (the hosts come from plugins, `GET .../system/source-control/providers`), each with its own token
 * (plus any other declared field) input, save action, and connected/not status. Mirrors `deployment/hooks/use-publish-credentials.hooks.ts` closely — same flat-row shape,
 * same optimistic local-state-after-write pattern, same create-vs-update-by-looking-at-what-exists
 * decision — with two differences: no `executionMode` (this page has no CLI-first alternative path
 * to branch on, unlike static publish), and `username` in place of `accountId` as the one provider
 * (a source-control host, not a static host) that needs a field beyond the universal token.
 *
 * ## A stored credential is NEVER read back — this is why every row's inputs start blank
 *
 * `AdminSourceControlCredentialSummary` carries no token, no ciphertext, and no masked suffix. So a
 * row's `token`/`username` draft state can only ever start blank, connected or not — a blank token
 * at save time therefore means "nothing to change" on an already-connected row, not "the operator
 * left it empty by mistake" (`sourceControlCredentialRowReadyToSave`, `rules.ts`, disables Save in
 * that case rather than sending a no-op write).
 *
 * ## Save decides CREATE vs. UPDATE by looking at what is already there, not at UI mode
 *
 * {@link save} reads the provider's current DEFAULT connection via `rules.ts`'s
 * `defaultSourceControlCredentialForProvider`. If one exists, save PUTs to its id, replacing the
 * connection but leaving its own label untouched. If none exists, save POSTs a brand-new one
 * labeled {@link SOURCE_CONTROL_CREDENTIAL_ROW_LABEL} — the one fixed label this flat-list UI ever
 * writes.
 *
 * ## The row list is optimistically maintained locally, not refetched after every write
 *
 * `save` splices its own result into the local `credentials` array rather than re-running
 * `listCredentials()` — one round trip per write. Draft `token`/`username` are cleared back to
 * blank on a successful save.
 */
export interface SourceControlCredentialRowState {
  readonly providerId: AdminSourceControlProviderId;
  /** The host's label, guidance and declared fields; `listed: false` for a saved connection whose
   *  plugin is off or missing (shown, but no form). */
  readonly info: SourceControlProviderInfo;
  /** This provider's saved DEFAULT connection, if any — `undefined` means "not connected yet". */
  readonly saved: AdminSourceControlCredentialSummary | undefined;
  readonly token: string;
  /** The host's other declared fields, keyed by field name. */
  readonly values: Readonly<Record<string, string>>;
  /** Whether Save may be pressed, from `rules.ts`'s readiness gate. */
  readonly readyToSave: boolean;
  readonly saving: boolean;
  readonly error: string | null;
}

export interface SourceControlCredentialsController {
  /** One entry per listed host, then one per saved connection's unlisted host — `undefined` until
   *  both the hosts and the saved connections first load. */
  rows: readonly SourceControlCredentialRowState[] | undefined;
  loadError: string | null;
  /** Why a host is missing (load failure, plugin refusals, switched-off plugins); `null` when none is. */
  providersNotice: SourceControlProvidersNotice | null;

  setToken: (required: { providerId: AdminSourceControlProviderId; value: string }, optional?: Record<string, never>) => void;
  /** Sets one of the host's other declared fields. */
  setField: (required: { providerId: AdminSourceControlProviderId; name: string; value: string }, optional?: Record<string, never>) => void;
  /** Creates or replaces one provider's saved connection from its own row's current draft — see
   *  this file's header for the create-vs-update decision. A no-op when the row is not ready.
   *  Resolves either way — a failure is surfaced through that row's own `error`. */
  save: (providerId: AdminSourceControlProviderId) => Promise<void>;

  t: Translate;
}

/** One row's draft input + busy/error state — kept in a map keyed by provider id so each row's own
 *  typing and in-flight save are fully independent of every other row's. */
interface RowFormState {
  token: string;
  values: Record<string, string>;
  saving: boolean;
  error: string | null;
}

function blankRowFormState(): RowFormState {
  return { token: "", values: {}, saving: false, error: null };
}

/** Translates a rejected create/update into the exact string {@link useSourceControlCredentials}'s
 *  `save` stores as that row's `error` — pulled out of `save` for the same complexity-budget reason
 *  `use-publish-credentials.hooks.ts`'s own `publishCredentialSubmitErrorMessage` documents.
 *  @complexity O(1). */
function sourceControlCredentialSubmitErrorMessage({ err, t, locale, classifyCredentialSubmitError, translateCredentialMessage, describeApiError, sourceControlCredentialSaveErrorMessage }: Pick<Parameters<typeof useSourceControlCredentials>[0], "classifyCredentialSubmitError" | "translateCredentialMessage" | "describeApiError" | "sourceControlCredentialSaveErrorMessage"> & { err: unknown; t: Translate; locale: string }, _optional = {}): string {
  const classified = classifyCredentialSubmitError({ error: err });
  if (classified.kind === "duplicate-label") return t("This connection was already saved — reload the page and try again.");
  if (classified.kind === "validation") return sourceControlCredentialSaveErrorMessage({ locale: locale, error: translateCredentialMessage({ message: classified.detail, locale }) });
  return sourceControlCredentialSaveErrorMessage({ locale: locale, error: describeApiError({ e: err, fallback: t("unknown error") }) });
}

export function useSourceControlCredentials(
  { port, t, locale, useFetchQueryHook, localizeSourceControlProviders, credentialDraftError, translateCredentialMessage, describeApiError, sourceControlCredentialsLoadErrorMessage, sourceControlCredentialSaveErrorMessage, classifyCredentialSubmitError }: {
    port: {
      listProviders(): Promise<AdminSourceControlProvidersSnapshot>;
      listCredentials(): Promise<{ credentials: AdminSourceControlCredentialSummary[] }>;
      createCredential(input: { label: string; connection: AdminSourceControlConnectionInput; isDefault?: boolean }): Promise<AdminSourceControlCredentialSummary>;
      updateCredential(required: { id: string; input: { label?: string; connection?: AdminSourceControlConnectionInput; isDefault?: boolean } }, optional?: Record<string, never>): Promise<AdminSourceControlCredentialSummary>;
    };
    t: Translate; locale: string;
    useFetchQueryHook: FetchQueryAdapter["useFetchQuery"];
    localizeSourceControlProviders(required: { providers: AdminSourceControlProviderDescriptor[]; locale: string }): AdminSourceControlProviderDescriptor[];
    credentialDraftError(required: { value: string }, optional: { locale: string; required?: boolean }): string | null;
    translateCredentialMessage(required: { message: string; locale: string }): string;
    describeApiError(required: { e: unknown; fallback: string }): string;
    sourceControlCredentialsLoadErrorMessage(required: { locale: string; error: string }): string;
    sourceControlCredentialSaveErrorMessage(required: { locale: string; error: string }): string;
    classifyCredentialSubmitError(required: { error: unknown }): SourceControlCredentialSubmitFailure;
  }, _optional: Record<string, never> = {}
): SourceControlCredentialsController {
  const query = useFetchQueryHook({ key: ["source-control", "credentials"], fetch: () => port.listCredentials() });
  // The hosts come from plugins. A failed load lists none; saved connections still show, unlisted.
  const providersQuery = useFetchQueryHook({ key: ["source-control", "providers"], fetch: () => port.listProviders() });
  const [credentials, setCredentials] = useState<AdminSourceControlCredentialSummary[] | undefined>(undefined);

  // Seeds local state from the query's first successful load, exactly once — same shape
  // `use-publish-credentials.hooks.ts`'s own `seededRef` uses. Later changes flow through `save`
  // below, not through the query re-resolving.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || query.status === "loading" || !query.data) return;
    seededRef.current = true;
    setCredentials(query.data.credentials);
  }, [query.status, query.data]);

  const loadError = query.error ? sourceControlCredentialsLoadErrorMessage({ locale: locale, error: describeApiError({ e: query.error, fallback: t("unknown error") }) }) : null;

  const providers = useMemo(
    // Each host's own text (label, guidance, field labels) in the viewer's locale.
    () => {
      const descriptors = providersQuery.data?.providers;
      return sourceControlProviders({ descriptors: descriptors === undefined ? undefined : localizeSourceControlProviders({ providers: descriptors, locale }), credentials: credentials ?? [] });
    },
    [providersQuery.data, credentials, locale, localizeSourceControlProviders]
  );

  const [formStates, setFormStates] = useState<Record<string, RowFormState>>({});

  function patchForm({ providerId, patch }: { providerId: AdminSourceControlProviderId; patch: (prev: RowFormState) => Partial<RowFormState> }, _optional = {}) {
    setFormStates((prev) => {
      const current = prev[providerId] ?? blankRowFormState();
      return { ...prev, [providerId]: { ...current, ...patch(current) } };
    });
  }

  function setToken({ providerId, value }: { providerId: AdminSourceControlProviderId; value: string }, _optional = {}) {
    const error = credentialDraftError({ value }, { locale });
    patchForm({ providerId: providerId, patch: () => ({ token: value, error }) });
  }

  function setField({ providerId, name, value }: { providerId: AdminSourceControlProviderId; name: string; value: string }, _optional = {}) {
    patchForm({ providerId: providerId, patch: (current) => ({ values: { ...current.values, [name]: value } }) });
  }

  async function save(providerId: AdminSourceControlProviderId) {
    const formState = formStates[providerId] ?? blankRowFormState();
    const info = providers.find((provider) => provider.id === providerId);
    const fields: SourceControlCredentialFormFields = { providerId, token: formState.token, values: formState.values };
    const error = credentialDraftError({ value: fields.token }, { locale, required: !defaultSourceControlCredentialForProvider({ credentials: credentials ?? [], providerId }) });
    if (error) { patchForm({ providerId: providerId, patch: () => ({ error }) }); return; }
    if (info === undefined || !sourceControlCredentialRowReadyToSave({ fields, info })) return;

    const existing = defaultSourceControlCredentialForProvider({ credentials: credentials ?? [], providerId });
    patchForm({ providerId: providerId, patch: () => ({ saving: true, error: null }) });
    try {
      const connection = buildSourceControlConnectionInput({ fields, declaredFields: info.fields });
      const result = existing
        ? await port.updateCredential({ id: existing.id, input: { connection } })
        : await port.createCredential({ label: SOURCE_CONTROL_CREDENTIAL_ROW_LABEL, connection });
      setCredentials((prev) => {
        const base = prev ?? [];
        return existing ? base.map((current) => (current.id === result.id ? result : current)) : [...base, result];
      });
      setFormStates((prev) => ({ ...prev, [providerId]: blankRowFormState() }));
    } catch (err) {
      patchForm({ providerId: providerId, patch: () => ({ saving: false, error: sourceControlCredentialSubmitErrorMessage({ err: err, t: t, locale: locale, classifyCredentialSubmitError, translateCredentialMessage, describeApiError, sourceControlCredentialSaveErrorMessage }) }) });
    }
  }

  const rows: readonly SourceControlCredentialRowState[] | undefined =
    credentials === undefined || providersQuery.status === "loading"
      ? undefined
      : providers.map((info) => {
          const formState = formStates[info.id] ?? blankRowFormState();
          return {
            providerId: info.id,
            info,
            saved: defaultSourceControlCredentialForProvider({ credentials, providerId: info.id }),
            token: formState.token,
            values: formState.values,
            readyToSave: sourceControlCredentialRowReadyToSave({ fields: { providerId: info.id, token: formState.token, values: formState.values }, info }),
            saving: formState.saving,
            error: formState.error,
          };
        });

  const providersNotice = sourceControlProvidersNotice({ snapshot: providersQuery.data, failed: Boolean(providersQuery.error), t });

  return { rows, loadError, providersNotice, setToken, setField, save, t };
}

