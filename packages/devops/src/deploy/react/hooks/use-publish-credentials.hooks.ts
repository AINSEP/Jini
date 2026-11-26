import { useEffect, useRef, useState } from "react";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import type { AdminPublishCredentialProviderId, AdminPublishCredentialSummary, AdminPublishCredentialVerification, AdminPublishExecutionMode, AdminPublishConnectionInput } from "@jini-ai/core/contracts/site/api-security-api-types";
import type { AdminPublishTargetCredentialSpec, AdminPublishTargetDescriptor } from "../rules.js";
import type { Translate } from "@jini-ai/core/text";
import { credentialsForProvider } from "../rules.js";
import * as draft from "./publish-credential-draft.js";
import * as writes from "./publish-credential-writes.js";
import * as selection from "./publish-credential-selection.js";

/**
 * @file The Static Site tab's credential-management section — one always-visible row per provider,
 * each with its own token input, save action, and connected/not-connected status. See
 * `StaticSiteTab.tsx`'s `PublishCredentialsSection` header for the UI half of this story.
 *
 * ## 2026-08-15 redesign — a settings form, not a collection to manage
 *
 * This hook used to model credentials the way a CRUD screen models any collection: a list, an
 * "Add credential" button, a provider `<select>`, a user-invented `label`, and per-row
 * edit/delete/make-default actions. The owner's own read: "'Add credential' should be gone. Just
 * list the providers, labels, and access token space, and that's it" — the whole point of an
 * "Add" flow is asking the operator to create and name an object before they can type a token, and
 * there is nothing here to name: the deploy registry's descriptors (the `targets` this hook is
 * given) already name every host a token can be saved for, and each host's credential fields.
 * So this hook now exposes {@link PublishCredentialRowState}
 * per provider instead of a form's worth of shared state — no `providerId`/`label` picker, no
 * isFormOpen/editingId mode split, no delete or default-promotion affordance (the data model still
 * supports more than one saved connection per provider and un-defaulting one via delete — see
 * `rules.ts`'s `PUBLISH_CREDENTIAL_ROW_LABEL` doc — this UI just never exposes that).
 *
 * ## A stored credential is NEVER read back — this is why every row's inputs start blank
 *
 * `AdminPublishCredentialSummary` carries no token, no ciphertext, and deliberately no masked suffix
 * (see that type's own doc in `lib/api.ts`). So a row's field draft state (`values`) can only ever
 * start blank, connected or not — a blank `token` at save time is therefore not "the operator left it
 * empty by mistake"; on an already-connected row it is the ONLY way to express "nothing to change
 * here" (`credentialFormReadyToSave`, `rules.ts`, disables Save in that case rather than
 * sending a no-op write).
 *
 * ## Save decides CREATE vs. UPDATE by looking at what is already there, not at UI mode
 *
 * {@link save} reads the provider's current DEFAULT connection via `rules.ts`'s
 * `defaultCredentialForProvider` (the exact row a real publish would use). If one exists, save PUTs
 * to its id, replacing the connection but leaving its own label untouched. If none exists, save
 * POSTs a brand-new one labeled {@link PUBLISH_CREDENTIAL_ROW_LABEL} — the one fixed label this whole
 * flat-list UI ever writes, which satisfies the server's still-live `(workspace_id, provider_id,
 * label)` UNIQUE constraint without ever asking an operator to type one. Neither branch sends
 * `isDefault`: a brand-new connection auto-defaults server-side as a provider's first-ever saved
 * connection (`publish-credentials/store.ts`'s `decideCreateDefault`), and replacing an existing
 * default's connection never changes which row is default.
 *
 * ## `verify` — the "hit verify on the token" button the assistant's own guidance already assumed existed
 *
 * 2026-08-16 (see `ADS-memory/reports/verification/2026-08-16-live-publish-through-assistant.md`):
 * the assistant's own capability tool told a human to "go verify the GitHub token" through this admin
 * whenever the in-process verification cache went cold (e.g. right after a restart), but no control
 * ever called `POST .../credentials/:id/verify` — the backend route worked, nothing in this hook or
 * `StaticSiteTab.tsx` reached it. {@link verify} closes that gap: same optimistic-local-update
 * philosophy as {@link save} above (no unconditional refetch), but it can only ever update a row that
 * is ALREADY connected — there is no credential id to verify before one exists.
 *
 * ## The row list is optimistically maintained locally, not refetched after every write
 *
 * `save` splices its own result into the local `credentials` array rather than re-running
 * `listCredentials()` — one round trip per write instead of two, matching the CRUD hook this
 * replaces. Draft field values are cleared back to blank on a successful save (there is
 * nothing left to keep typed — the row now reads its "Connected" status from the fresh summary).
 */
export interface PublishCredentialRowState {
  readonly providerId: AdminPublishCredentialProviderId;
  /** The host's display label, from its descriptor — a proper noun, never translated. */
  readonly label: string;
  /** The host's credential form: its fields (in display order), help and token field. */
  readonly credential: AdminPublishTargetCredentialSpec;
  /** This provider's saved DEFAULT connection, if any (`rules.ts`'s `defaultCredentialForProvider`)
   *  — `undefined` means "not connected yet". Never carries a token or `accountId`; see this file's
   *  header for why every row's connection fields always start blank regardless of this value. */
  readonly saved: AdminPublishCredentialSummary | undefined;
  /** Draft values typed into {@link credential}'s fields, keyed by field name. */
  readonly values: Readonly<Record<string, string>>;
  readonly saving: boolean;
  readonly error: string | null;
  /** True while {@link PublishCredentialsController.verify} has an in-flight request for THIS
   *  provider's saved row. A no-op button click while already `true` is guarded the same way
   *  `save`'s own `row.saving` disables its button — see `CredentialStepDone`'s Verify button. */
  readonly verifying: boolean;
  /** The most recent explicit re-verify's result for this row, `undefined` until {@link verify} has
   *  resolved at least once this session — deliberately session-only, never seeded from the initial
   *  load: the server has no "last verification" to hand back on `GET`, only the durable
   *  `saved.accountLabel` half of it (see that field's own doc). Distinct from `error` below: a
   *  `"invalid"`/`"unreachable"` `status` here is the provider's own answer, not a failure of this
   *  UI's request — {@link error} is reserved for a genuine transport/request failure instead. */
  readonly verification: AdminPublishCredentialVerification | undefined;
  /** A transport/request failure from {@link verify} itself (network down, 5xx) — NOT a
   *  `"invalid"`/`"unreachable"` provider answer, which is a normal {@link verification} result, not
   *  an error. See this file's `publishCredentialVerifyErrorMessage` import for the translated text. */
  readonly verifyError: string | null;
  /** The credential id the picker is promoting to this provider's default right now, `null` when no
   *  promotion is in flight. The picker shows this id (not {@link saved}'s) while it is set, so the
   *  choice doesn't appear to snap back before the server has answered. */
  readonly selectingCredentialId: string | null;
  /** Why the last promotion for this provider failed, `null` otherwise. Cleared by the next pick. */
  readonly selectError: string | null;
}

export interface PublishCredentialsController {
  /** One entry per deploy target that takes a saved credential, in the registry's order —
   *  `undefined` until both the credentials and the targets have loaded, same "no data yet" convention every other hook in
   *  this panel uses (`StaticExportController.run`, `StaticPublishController.run`). */
  rows: readonly PublishCredentialRowState[] | undefined;
  /** The server's own execution capability for this instance — `undefined` until the same first
   *  load resolves. Never derived any other way; see `AdminPublishExecutionMode`'s doc. */
  executionMode: AdminPublishExecutionMode | undefined;
  loadError: string | null;
  /** True while ANY write that changes which token a publish uses is in flight — a default-promotion
   *  ({@link selectCredential}) or a connection replacement ({@link save}). The server picks a
   *  publish's credential as whichever row is default when the publish request lands
   *  (`static-publish/adapter.ts`'s `resolvePublishCredentialForSite`; the request carries no
   *  credential id), so a Publish sent inside this window would go out on the OLD token. The Static
   *  Site tab's Publish button is disabled on this. (terra review 2026-09-20, finding 1.) */
  credentialChangePending: boolean;

  /** Sets one credential field's draft value on one provider's row. */
  setField: (required: { providerId: AdminPublishCredentialProviderId; fieldName: string; value: string }, optional?: {}) => void;
  /** Creates or replaces one provider's saved connection from its own row's current field values
   *  — see this file's header for the create-vs-update decision. A no-op if
   *  `credentialFormReadyToSave` (`rules.ts`) says this row is not ready (the same guard the row's
   *  own Save button is disabled on, kept here too so a direct call — as this file's own tests make —
   *  cannot bypass it). Resolves either way — a failure is surfaced through that row's own `error`. */
  save: (providerId: AdminPublishCredentialProviderId) => Promise<void>;
  /** Every saved connection for one provider, not just its default — `rows` above only ever carries
   *  {@link defaultCredentialForProvider}'s pick, which is enough for the always-visible credential
   *  row but not for the picker `StaticSiteTab.tsx`'s "which saved token publishes" dropdown needs
   *  once a provider has more than one (the owner's own original ask: "GitHub pages... will have a
   *  dropdown where you can choose which GitHub access tokens"). Added rather than widening `rows`
   *  itself so every existing caller of `rows` keeps reading exactly the one row it always has. */
  credentialsForProvider: (providerId: AdminPublishCredentialProviderId) => readonly AdminPublishCredentialSummary[];
  /** Promotes one already-saved connection to this provider's default — the same `isDefault`
   *  mechanic the Security page's own "Make default" already writes through
   *  (`use-access-tokens.hooks.ts`'s `makeDefault`), reused here rather than reinvented. Never
   *  splices optimistically: promoting one row un-defaults whichever OTHER row held it server-side,
   *  so the local list changes only once the write has resolved (`rules.ts`'s `withPromotedDefault`),
   *  then re-fetches to reconcile. A failed re-fetch keeps that confirmed local promotion rather than
   *  leaving the old default on screen after the server has already switched.
   *
   *  A no-op if `credentialId` is already this provider's default, or while a promotion for this
   *  provider is still in flight. Never rejects — a failure lands in that row's
   *  {@link PublishCredentialRowState.selectError}. */
  selectCredential: (required: { providerId: AdminPublishCredentialProviderId; credentialId: string }, optional?: {}) => Promise<void>;
  /** Re-checks the provider's currently connected (default) row against its real provider right now
   *  — the UI half of `POST .../credentials/:id/verify` (`publish-credentials.ts`'s route doc), for
   *  when the automatic verify-on-save result is stale (a rotated token) or was lost (an in-memory
   *  cache that a server restart clears — see `AdminPublishCredentialSummary.accountLabel`'s doc for
   *  why `saved.accountLabel` survives that even though a single verify RESPONSE does not). A no-op,
   *  resolving immediately, if this provider has no saved (connected) row yet — there is nothing to
   *  verify. Never throws; a failure is surfaced through that row's own {@link
   *  PublishCredentialRowState.verifyError}. */
  verify: (providerId: AdminPublishCredentialProviderId) => Promise<void>;

  t: Translate;
}

/** One row's draft input + busy/error state — kept in a map keyed by provider id so each row's own
 *  typing and in-flight save/verify are fully independent of every other row's. */
export interface RowFormState {
  values: Record<string, string>;
  saving: boolean;
  error: string | null;
  verifying: boolean;
  verification: AdminPublishCredentialVerification | undefined;
  verifyError: string | null;
  /** The saved credential `verification`/`verifyError` describe. The picker can make a different
   *  token the default after a verify, and a verdict about the old token must not be shown for the new. */
  verifiedCredentialId: string | null;
}

/** One provider's token-picker promotion — see {@link PublishCredentialRowState.selectingCredentialId}
 *  and {@link PublishCredentialRowState.selectError}. */
export interface SelectionState {
  pendingId: string | null;
  error: string | null;
}

  // Seeds local state from the query's first successful load, exactly once — same shape
  // `use-static-publish.hooks.ts`'s own `seededRef` uses. Later changes flow through `save` below,
  // not through the query re-resolving (see this file's header on why writes are optimistic rather
  // than refetch-driven).
  // The picker's promotion state, kept apart from `formStates`: a `save` that lands mid-promotion
  // resets its row's form state to blank, which must not also clear the in-flight flag Publish waits on.
  // Synchronous duplicate guard for `selectCredential` — a ref, not `selections`, for the same reason
  // `use-static-publish.hooks.ts`'s `publishingRef` documents: two calls in one tick both read the
  // same stale state, and two racing promotions would leave the default to whichever PUT lands last.
  // Same synchronous per-row guard for `save` — a doubled create collides on the fixed row label
  // (terra review 2026-09-20, finding 5's sibling).

export function usePublishCredentials({ port, t, locale, targets, hooks, deps }: {
  port: {
    listCredentials: () => Promise<{ credentials: AdminPublishCredentialSummary[]; executionMode: AdminPublishExecutionMode }>;
    createCredential: (required: { label: string; connection: AdminPublishConnectionInput; isDefault?: boolean }) => Promise<AdminPublishCredentialSummary & { verification?: AdminPublishCredentialVerification }>;
    updateCredential: (required: { id: string; input: { label?: string; connection?: AdminPublishConnectionInput; isDefault?: boolean } }) => Promise<AdminPublishCredentialSummary & { verification?: AdminPublishCredentialVerification }>;
    deleteCredential: (required: { id: string }) => Promise<void>;
    verifyCredential: (required: { id: string }) => Promise<AdminPublishCredentialVerification>;
  };
  t: Translate; locale: string; targets: readonly AdminPublishTargetDescriptor[] | undefined;
  hooks: Pick<FetchQueryAdapter, "useFetchQuery">;
  deps: {
    classifyCredentialSubmitError: (required: { error: unknown }) => { kind: "duplicate-label" } | { kind: "validation"; detail: string } | { kind: "generic" };
    credentialDraftError: (required: { value: string }, optional: { locale: string; required?: boolean }) => string | null;
    translateCredentialMessage: (required: { message: string; locale: string }) => string;
    describeApiError: (required: { e: unknown; fallback: string }) => string;
    publishCredentialSaveErrorMessage: (required: { locale: string; error: string }) => string;
    publishCredentialsLoadErrorMessage: (required: { locale: string; error: string }) => string;
    publishCredentialSelectErrorMessage: (required: { locale: string; error: string }) => string;
    publishCredentialVerifyErrorMessage: (required: { locale: string; error: string }) => string;
  };
}, _optional = {}): PublishCredentialsController {
  const query = hooks.useFetchQuery({ key: ["deployment", "publish-credentials"], fetch: () => port.listCredentials() });
  const [credentials, setCredentials] = useState<AdminPublishCredentialSummary[] | undefined>(undefined);
  const [executionMode, setExecutionMode] = useState<AdminPublishExecutionMode | undefined>(undefined);

  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || query.status === "loading" || !query.data) return;
    seededRef.current = true;
    setCredentials(query.data.credentials);
    setExecutionMode(query.data.executionMode);
  }, [query.status, query.data]);

  const loadError = query.error ? deps.publishCredentialsLoadErrorMessage({ locale, error: deps.describeApiError({ e: query.error, fallback: "unknown error" }) }) : null;

  const [formStates, setFormStates] = useState<Record<AdminPublishCredentialProviderId, RowFormState>>({});
  const [selections, setSelections] = useState<Partial<Record<AdminPublishCredentialProviderId, SelectionState>>>({});
  const selectingRef = useRef(new Set<AdminPublishCredentialProviderId>());
  const savingRef = useRef(new Set<AdminPublishCredentialProviderId>());

  const state = { port, t, locale, targets, deps, credentials, setCredentials, formStates, setFormStates, selections, setSelections, selectingRef, savingRef };
  return {
    rows: draft.rows(state), executionMode, loadError,
    credentialChangePending: Object.values(formStates).some((state) => state.saving) || Object.values(selections).some((selection) => (selection?.pendingId ?? null) !== null),
    setField: input => draft.setField({ ...state, ...input }),
    save: providerId => writes.save({ ...state, providerId }),
    credentialsForProvider: providerId => credentialsForProvider({ credentials: credentials ?? [], providerId }),
    selectCredential: input => selection.selectCredential({ ...state, ...input }),
    verify: providerId => writes.verify({ ...state, providerId }), t,
  };
}

export function bindPublishCredentials({ hooks, deps }: {
  hooks: Parameters<typeof usePublishCredentials>[0]["hooks"] & { useLocaleHook: () => string };
  deps: Parameters<typeof usePublishCredentials>[0]["deps"] & {
    port: Parameters<typeof usePublishCredentials>[0]["port"];
    translate: (required: { locale: string; key: string }) => string;
  };
}, _optional = {}) {
  return function useBoundPublishCredentials({ targets }: Pick<Parameters<typeof usePublishCredentials>[0], "targets">, _optional = {}): PublishCredentialsController {
    const locale = hooks.useLocaleHook();
    const t = (key: string): string => deps.translate({ locale: locale, key: key });
    return usePublishCredentials({ port: deps.port, t, locale, targets, hooks, deps });
  };
}
