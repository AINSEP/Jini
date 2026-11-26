import { useCallback } from "react";
import type { Translate } from "@jini-ai/core/text";
import type { AdminHttpError } from "@jini-ai/core/admin-runtime";
import type { AdminPublishConnectionInput, AdminPublishCredentialSummary } from "../../api/security-api.types.js";
import type { AdminSourceControlConnectionInput, AdminSourceControlCredentialSummary, AdminSourceControlProviderDescriptor } from "../../../source-control/api/source-control-api.types.js";
import type { AdminPublishTargetField } from "../../../deployment/api/deployment-api.types.js";
import type { localizePublishTargets, localizeSourceControlProviders } from "../../../shell/lib/descriptor-i18n.js";
import { customCredentialReplaceReadyToSave, accessTokenWorksForChanged } from "../../custom-credential-forms.js";
import { type AccessTokenCategoryId, type AccessTokenCategoryInfo } from "../../access-token-categories.js";
import { type AccessTokenRowCategoryId, type AccessTokenRow, type AccessTokenProviderRef } from "../../access-token-rows.js";
import { type AccessTokenFormFields as CredentialAccessTokenFormFields, type AccessTokenProviderInfo, type AccessTokenProviderCopy, type AccessTokenSourceControlHostInfo } from "../../access-token-providers.js";
import type { AccessTokensPort } from "./access-tokens-port.hooks.js";
import { useAccessTokenQueries } from "./access-token-queries.hooks.js";
import { useAccessTokenStores } from "./access-token-stores.hooks.js";
import { useAccessTokenRefresh } from "./access-token-refresh.hooks.js";
import { useAccessTokenRows } from "./access-token-rows.hooks.js";
import { useAccessTokenDrafts } from "./access-token-drafts.hooks.js";
import { useAccessTokenGroups } from "./access-token-groups.hooks.js";
import * as actions from "./access-token-actions.js";
import * as addActions from "./access-token-add-actions.js";
import { replaceToken } from "./access-token-replace-actions.js";

/**
 * @file The Access Tokens tab's controller — the ONE place that reads and writes BOTH
 * `publish_credential_sets` and `source_control_credential_sets`, merges them into one
 * `kind`-tagged row list, and exposes the multi-row Create/Replace/Remove/default-selection surface
 * neither origin store's own page ever built (`rules.ts`'s own header explains why: both origin
 * pages only ever created ONE — the default — row per provider; this hook is where "a second, third,
 * differently-scoped token" and "which saved token does a publish actually use" get a UI for the
 * first time).
 *
 * ## Two independent fetches, two independent seed-once effects
 *
 * Same `useFetchQuery` + one-time `seededRef` shape `usePublishCredentials`/
 * `useSourceControlCredentials` each already use — duplicated here (not factored into a shared
 * helper) because the two queries have different keys, different snapshot shapes
 * (`AdminPublishCredentialsSnapshot` carries `executionMode`, the source-control one does not), and
 * different failure modes to report independently in {@link AccessTokensController.loadError}.
 *
 * ## No write-on-load migration — the legacy label is display-only, computed fresh every render
 *
 * An earlier pass fired a best-effort `PUT .../:id` on load to rewrite every row still carrying the
 * sentinel label (`"default"`) either origin page ever wrote. That write was rejected before it
 * shipped, for four reasons: it mutates data on a plain page OPEN, which is a surprising thing for a
 * read to do; `(workspaceId, providerId, label)` is UNIQUE, so two tabs open at once (or a React
 * StrictMode double-invoke in dev) can race and one PUT loses to a 409 with nothing to show for it;
 * an install nobody ever opens this page on never migrates, so "v1 transfers the tokens" was never
 * actually true for every workspace; and a failed PUT during a page load has nowhere good to surface
 * an error for what the reader didn't even ask this screen to do. `rules.ts`'s `buildAccessTokenRows`
 * already computes {@link AccessTokenRow.name} correctly on every call — a legacy row reads with its
 * friendly computed name from the very first render, with zero writes, and a REAL label is only ever
 * persisted when a human renames, replaces, or creates a row through this page's own forms.
 *
 * ## The category filter narrows `groups`, not the search count
 *
 * `category`/`setCategory` gate which PROVIDERS even enter {@link groups} (a provider outside the
 * active category is dropped before the query filter ever runs, same as if it didn't exist this
 * render) — {@link AccessTokensController.totalCount}/`matchCount` stay a GLOBAL count across every
 * category on purpose: the search-count line answers "how many tokens does this install hold",
 * which should not silently change meaning depending on which category tab happens to be selected.
 *
 * ## Optimistic Create/Replace, refetch-on-write for Remove/Make-default
 *
 * Create/Replace splice their own known result into local state (one round trip), same pattern
 * `usePublishCredentials.save` uses. Remove and Make-default do NOT — both can change which OTHER row
 * in the same provider group is `isDefault` (delete promotes the most-recently-updated remaining row;
 * `store.ts`'s own invariant, not reimplemented here), so both re-fetch that ONE store's full list
 * after the write rather than duplicating the server's promotion rule client-side. This workspace's
 * saved-credential count is small (`VendorCredentialSetRepoPort.listByWorkspace`'s own doc), so the
 * extra round trip is cheap and correct beats fast-but-possibly-wrong here.
 */
export interface DraftFields {
  readonly name: string;
  readonly token: string;
  /** The provider's extra descriptor fields, keyed by field name. */
  readonly values: Readonly<Record<string, string>>;
  readonly username: string;
  readonly worksFor: string[];
  /** Explicit selections, including clearing all chips, override create-time suggestions. */
  readonly worksForEdited?: boolean;
}

export interface BusyState {
  readonly saving: boolean;
  readonly error: string | null;
}

export interface AddFormEntry {
  readonly visible: boolean;
  readonly draft: DraftFields;
  readonly saving: boolean;
  readonly error: string | null;
}

/** The standalone "Add custom provider" dialog's own draft — kept separate from {@link DraftFields}
 *  (used by the seven catalog providers' per-provider add forms) since it carries `category`/
 *  `baseUrl`, which nothing else in this hook's state shapes have. */
export interface CustomDraftFields {
  /** Omitted selects the server's project-first default. */
  readonly scope?: "project" | "site";
  readonly name: string;
  readonly category: AccessTokenRowCategoryId;
  readonly baseUrl: string;
  /** Raw textarea text — see `rules.ts`'s `CustomCredentialFormFields.additionalHosts` doc. */
  readonly additionalHosts: string;
  readonly token: string;
  readonly username: string;
  readonly worksFor: string[];
  readonly worksForEdited?: boolean;
}

export interface AccessTokenFormFields {
  readonly name: string;
  readonly token: string;
  /** The provider's extra descriptor fields, keyed by field name. */
  readonly values: Readonly<Record<string, string>>;
  readonly username: string;
  readonly worksFor: string[];
  /** Whether this form's Save may be pressed, from `rules.ts`'s readiness gates. */
  readonly readyToSave: boolean;
  readonly saving: boolean;
  readonly error: string | null;
}

export interface AccessTokenExistingRowState extends AccessTokenFormFields {
  readonly row: AccessTokenRow;
}

export interface AccessTokenAddFormState extends AccessTokenFormFields {
  readonly visible: boolean;
}

export interface AccessTokenProviderGroupState {
  readonly info: AccessTokenProviderInfo;
  /** Already filtered against the active search query — see this file's header. */
  readonly rows: readonly AccessTokenExistingRowState[];
  readonly addForm: AccessTokenAddFormState;
}

/** The standalone "Add custom provider" dialog's own public state — a top-level controller field
 *  rather than a `ref`-keyed entry in {@link AccessTokenProviderGroupState.addForm}'s map, since a
 *  custom row is created with no existing provider group to attach the form to (this file's own
 *  header on why `"custom"` rows have no catalog entry at all). */
export interface AccessTokenCustomAddFormState {
  readonly scope?: "project" | "site";
  readonly name: string;
  readonly category: AccessTokenRowCategoryId;
  readonly baseUrl: string;
  readonly additionalHosts: string;
  readonly token: string;
  readonly username: string;
  readonly worksFor: string[];
  readonly saving: boolean;
  readonly error: string | null;
}

export interface AccessTokensController {
  /** One entry per {@link accessTokenProviders} provider plus one per saved custom credential,
   *  ordered by `rules.ts`'s `sortAccessTokenGroups` (saved-before-unsaved, then category-chip
   *  order, then alphabetical by label — the owner's 2026-09-21 ruling) — `undefined` until BOTH
   *  stores' first load resolves. Unlike `PublishCredentialsController.rows`, a provider's own
   *  `rows` array here can hold more than one saved connection. */
  groups: readonly AccessTokenProviderGroupState[] | undefined;
  /** Loaded deploy host and source-control vendor ids; saved unknown ids remain selectable. */
  worksForOptions: { value: string; label: string }[];
  loadError: string | null;

  query: string;
  setQuery: (value: string) => void;
  /** The active category filter — `"all"` by default. See this file's header for why this narrows
   *  {@link groups} but not {@link totalCount}/{@link matchCount}. */
  category: AccessTokenCategoryId;
  setCategory: (value: AccessTokenCategoryId) => void;
  /** Every saved row across both stores, regardless of the active query OR category — the
   *  match-count line's denominator. */
  totalCount: number;
  /** Saved rows that match the active query, regardless of category — the match-count line's
   *  numerator; equals {@link totalCount} when `query` is blank. */
  matchCount: number;

  setExistingField: (required: { rowId: string; patch: Partial<DraftFields> }, optional?: Record<string, never>) => void;
  replaceToken: (row: AccessTokenRow) => Promise<void>;
  removeToken: (row: AccessTokenRow) => Promise<void>;
  makeDefault: (row: AccessTokenRow) => Promise<void>;

  openAddForm: (ref: AccessTokenProviderRef) => void;
  closeAddForm: (ref: AccessTokenProviderRef) => void;
  setAddField: (ref: AccessTokenProviderRef, patch: Partial<DraftFields>) => void;
  createToken: (ref: AccessTokenProviderRef) => Promise<void>;

  /** The "Add custom provider" dialog's own field state — see {@link AccessTokenCustomAddFormState}. */
  customAddForm: AccessTokenCustomAddFormState;
  setCustomAddField: (patch: Partial<CustomDraftFields>) => void;
  /** Clears the dialog's fields — called on Cancel and after a successful save; does not itself
   *  close the native `<dialog>` (the caller's own ref does that, same split
   *  {@link RemoveConfirmDialog} already draws between this hook's state and DOM visibility). */
  resetCustomAddForm: () => void;
  createCustomCredential: () => Promise<boolean>;
  projectKeysAvailable?: boolean;
  customKeyBusy: Readonly<Record<string, BusyState>>;
  setCustomKeyUse: (required: { row: AccessTokenRow; use: boolean }, optional?: Record<string, never>) => Promise<void>;

  t: Translate;
}

export interface AccessTokensDependencies {
  ACCESS_TOKENS_RESOURCE: string;
  ACCESS_TOKEN_CATEGORIES: readonly AccessTokenCategoryInfo[];
  ACCESS_TOKEN_PROVIDER_COPY: AccessTokenProviderCopy;
  LEGACY_SENTINEL_LABELS: { publish: string; "source-control": string };
  localizePublishTargets: typeof localizePublishTargets;
  localizeSourceControlProviders: typeof localizeSourceControlProviders;
  credentialDraftError: (required: { value: string }, optional: { locale: string; required?: boolean }) => string | null;
  describeApiError: (required: { e: unknown; fallback: string }) => string;
  isApiError: (error: unknown) => error is AdminHttpError;
  translateCredentialMessage: (required: { message: string; locale: string }) => string;
  requiredFieldsFilled: (required: { fields: readonly AdminPublishTargetField[]; values: Readonly<Record<string, string>> }) => boolean;
  suggestCredentialWorksFor: (required: { label: string; providers: { id: string; vendorId: string }[] }) => string[];
  sourceControlProviderInfoFromDescriptor: (required: { descriptor: AdminSourceControlProviderDescriptor }) => AccessTokenSourceControlHostInfo;
  buildCredentialConnectionInput: (required: { providerId: string; spec: NonNullable<AccessTokenProviderInfo["publishCredential"]>; values: Readonly<Record<string, string>> }) => AdminPublishConnectionInput;
  buildSourceControlConnectionInput: (required: { fields: { providerId: string; token: string; values: Readonly<Record<string, string>> }; declaredFields: readonly AdminPublishTargetField[] }) => AdminSourceControlConnectionInput;
  accessTokenRowReadyToSave: (required: { fields: CredentialAccessTokenFormFields; info: AccessTokenProviderInfo; deps: Pick<AccessTokensDependencies, "requiredFieldsFilled"> }) => boolean;
  accessTokenExistingRowReadyToSave: (required: { fields: CredentialAccessTokenFormFields; row: AccessTokenRow; info: AccessTokenProviderInfo; SOURCE_CONTROL: "source-control"; deps: Pick<AccessTokensDependencies, "requiredFieldsFilled"> & { accessTokenWorksForChanged: typeof accessTokenWorksForChanged; customCredentialReplaceReadyToSave: typeof customCredentialReplaceReadyToSave } }) => boolean;
  buildAccessTokenConnectionInput: (required: { fields: CredentialAccessTokenFormFields; info: AccessTokenProviderInfo; deps: Pick<AccessTokensDependencies, "buildCredentialConnectionInput" | "buildSourceControlConnectionInput"> }) => AdminPublishConnectionInput | AdminSourceControlConnectionInput;
  buildAccessTokenUpdatePatch: (required: { fields: CredentialAccessTokenFormFields; info: AccessTokenProviderInfo; nameChanged: boolean; hasToken: boolean; deps: Pick<AccessTokensDependencies, "buildCredentialConnectionInput" | "buildSourceControlConnectionInput"> & { accessTokenWorksForChanged: typeof accessTokenWorksForChanged } }, optional: { currentWorksFor: readonly string[] | undefined }) => { label?: string; connection?: AdminPublishConnectionInput | AdminSourceControlConnectionInput; worksFor?: string[] };
  classifyAccessTokenSubmitError: (required: { e: unknown; isApiError: AccessTokensDependencies["isApiError"] }) => { kind: "duplicate-label" } | { kind: "validation"; detail: string } | { kind: "generic" };
  withPromotedDefault: {
    (required: { credentials: readonly AdminPublishCredentialSummary[]; promoted: AdminPublishCredentialSummary }): AdminPublishCredentialSummary[];
    (required: { credentials: readonly AdminSourceControlCredentialSummary[]; promoted: AdminSourceControlCredentialSummary }): AdminSourceControlCredentialSummary[];
  };
}

export interface AccessTokensHooks {
  useFetchQuery: <T>(required: { key: readonly string[]; fetch: () => Promise<T> }) => { data: T | undefined; status: string; error: unknown };
  useContentRefreshSubscription: (required: { resource: string; onRefresh: () => void }) => void;
  useSettlementGeneration: () => { next: () => number; isCurrent: (required: { generation: number }) => boolean };
}

export interface AccessTokensArgs {
  port: AccessTokensPort;
  t: Translate;
  locale: string;
  hooks: AccessTokensHooks;
  deps: AccessTokensDependencies;
}

export function useAccessTokens(args: AccessTokensArgs, _optional: Record<string, never> = {}): AccessTokensController {
  const queries = useAccessTokenQueries(args);
  const stores = useAccessTokenStores({ queries });
  const refresh = useAccessTokenRefresh({ args, queries, stores });
  const rows = useAccessTokenRows({ args, queries, stores });
  const drafts = useAccessTokenDrafts({});
  const context = { args, queries, stores, refresh, rows, drafts };
  const groups = useAccessTokenGroups({ context });
  return {
    ...groups, worksForOptions: queries.worksForOptions, loadError: refresh.loadError,
    query: drafts.query, setQuery: drafts.setQuery, category: drafts.category, setCategory: drafts.setCategory,
    setExistingField: required => actions.setExistingField({ ...required, context }),
    replaceToken: row => replaceToken({ context, row }),
    removeToken: row => actions.removeToken({ context, row }), makeDefault: row => actions.makeDefault({ context, row }),
    openAddForm: ref => addActions.openAddForm({ context, ref }), closeAddForm: ref => addActions.closeAddForm({ context, ref }),
    setAddField: (ref, patch) => addActions.setAddField({ context, ref, patch }), createToken: ref => addActions.createToken({ context, ref }),
    customAddForm: { ...drafts.customAddDraft, saving: drafts.customAddBusy.saving, error: drafts.customAddBusy.error },
    setCustomAddField: patch => addActions.setCustomAddField({ context, patch }), resetCustomAddForm: () => addActions.resetCustomAddForm({ context }),
    createCustomCredential: () => addActions.createCustomCredential({ context }), projectKeysAvailable: queries.customQuery.data?.projectKeysAvailable === true,
    customKeyBusy: drafts.customKeyBusy, setCustomKeyUse: required => actions.setCustomKeyUse({ ...required, context }), t: args.t,
  };
}

/**
 * Binds the real port, and a `t` bound to the real resolved locale — the zero-argument half of the
 * `useX(dependencies)` / `useWiredX()` pair, same shape `useWiredPublishCredentials`/
 * `useWiredSourceControlCredentials` document.
 *
 * `boundT` is a `useCallback` (matching `useWiredSites`'s identical `const t = useCallback(...)`),
 * not a plain arrow function recreated every render (2026-09-05 Gemini audit, CONFIRMED): `t` flows
 * into `reloadAllStores`'s own `useCallback` dependency array above, which is correct — `t` is a
 * genuine dependency there (`accessTokensLoadErrorMessage`/`describeApiError` both call it) — but a
 * dependency that changes identity every render still defeats the surrounding `useCallback` just the
 * same. That in turn gave `triggerReload` a new identity every render, and `triggerReload` is exactly
 * what `useContentRefreshSubscription`'s own header warns changes identity every render (see this
 * hook's own `triggerReload` comment): its effect deps are `[resource, onRefresh]`, so an unstable
 * `onRefresh` tore down and rebuilt the SSE subscription on every single render for no benefit. Only
 * `locale` changing should ever produce a new `boundT`.
 */
export function bindAccessTokens({ port, hooks, deps }: {
  port: AccessTokensPort;
  hooks: AccessTokensHooks & { useLocaleHook: () => string };
  deps: AccessTokensDependencies & { defaultT: (required: { locale: string; key: string }) => string };
}, _optional: Record<string, never> = {}) {
  return function useWiredAccessTokens(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): AccessTokensController {
    const locale = hooks.useLocaleHook();
    const boundT = useCallback((key: string): string => deps.defaultT({ locale: locale, key: key }), [locale]);
    return useAccessTokens({ port, t: boundT, locale, hooks, deps });
  };
}
