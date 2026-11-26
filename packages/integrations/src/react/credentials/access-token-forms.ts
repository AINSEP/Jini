import type { AdminPublishConnectionInput, AdminPublishCredentialProviderId, AdminCustomCredentialCategoryId } from "@jini-ai/core/contracts/site/api-security-api-types";
import type { SourceControlConnectionInput as AdminSourceControlConnectionInput } from "@jini-ai/core/contracts/site/source-control-credentials";
import type { AdminHttpError } from "@jini-ai/core/admin-runtime";
import type { trimChars } from "@jini-ai/core/primitives";

type AccessTokenFormFields = {
  readonly worksFor?: string[]; readonly ref: { readonly kind: "publish" | "source-control" | "custom"; readonly providerId: string };
  readonly name: string; readonly token: string; readonly values: Readonly<Record<string, string>>; readonly username: string;
};
type AccessTokenProviderInfo = {
  readonly kind: "publish" | "source-control" | "custom"; readonly providerId: string; readonly label: string;
  readonly vendorLabel: string; readonly purposeLabel: string; readonly category: AdminCustomCredentialCategoryId; readonly tokenPageUrl: string;
  readonly scopeGuidanceKey: string; readonly tokenLabel?: string; readonly username?: "optional"; readonly unlisted?: true;
  readonly publishCredential?: { help?: string; userHelp?: string; vendorLabel?: string; tokenField: string; tokenPageUrl?: string; fields: { name: string; label: string; required?: boolean; help?: string; userHelp?: string; secret?: true }[] };
  readonly extraFields: readonly { name: string; label: string; required?: boolean; help?: string; userHelp?: string; secret?: true }[];
};
type AccessTokenRow = { readonly kind: "publish" | "source-control" | "custom"; readonly name: string; readonly username?: string; readonly worksFor?: string[] };

/** Whether the provider's required extra fields are filled. @complexity O(f). */
function accessTokenRequiredFieldsFilled(fields: AccessTokenFormFields, info: AccessTokenProviderInfo, deps: Parameters<typeof accessTokenRowReadyToSave>[0]["deps"]): boolean {
  return deps.requiredFieldsFilled({ fields: info.extraFields, values: fields.values });
}

/** Whether a token form has enough typed to save — a non-empty Name (new here; neither origin store's
 *  own form ever asked for one) PLUS whatever `info` says this provider cannot function without
 *  (`token`, always; a host descriptor's required fields). Does not check name uniqueness — that is {@link accessTokenNameTaken}'s job, surfaced
 *  as its own inline error rather than folded into the Save button's disabled state, so a collision
 *  reads as a specific, fixable reason rather than an unexplained disabled button.
 *  @complexity O(k) in this provider's own required-field count (at most one). */
export function accessTokenRowReadyToSave({ fields, info, deps }: { fields: AccessTokenFormFields; info: AccessTokenProviderInfo; deps: { requiredFieldsFilled: (required: { fields: AccessTokenProviderInfo["extraFields"]; values: Readonly<Record<string, string>> }) => boolean } }, _optional: Record<string, never> = {}): boolean {
  if (fields.name.trim() === "") return false;
  if (fields.token.trim() === "") return false;
  return accessTokenRequiredFieldsFilled(fields, info, deps);
}

/**
 * The Replace-flow variant of {@link accessTokenRowReadyToSave} — an EXISTING row's Save button,
 * which this page can enable in one more case neither `StaticSiteTab.tsx` nor `ProvidersTab.tsx`
 * supports today: a rename with no new token typed. Both origin pages require a fresh token on every
 * save regardless of connected state (`credentialFormReadyToSave`/
 * `sourceControlCredentialRowReadyToSave` both unconditionally check `token.trim() !== ""`) — this
 * page's own new Name field makes "I just want to rename this, not rotate it" a real, common action
 * (the brief's own "give it whatever name you want" framing), so gating it behind a mandatory token
 * retype would make the rename feature it introduces effectively unusable for that case.
 *
 * Three cases: nothing typed at all → not ready (there is no diff to send). A new name only (token
 * blank) → ready, sent as a label-only `PUT` (no `connection` field, so the stored secret is
 * untouched — same "omitting `connection` keeps the secret" contract `updatePublishCredential`'s own
 * doc states). A new token (rename or not) → ready only once this provider's required extra fields
 * are ALSO filled, same as create — a token replace still needs its extra fields/`username` alongside it
 * because a fresh `connection` object is a full replacement, not a per-field patch.
 * @complexity O(k) in this provider's own required-field count (at most one).
 */
export function accessTokenReplaceReadyToSave(
  { fields, currentName, info, deps }: {
    fields: AccessTokenFormFields;
    currentName: string;
    deps: Parameters<typeof accessTokenRowReadyToSave>[0]["deps"];
    info: AccessTokenProviderInfo;
  },
  _options = {},
): boolean {
  if (fields.name.trim() === "") return false;
  const nameChanged = fields.name.trim() !== currentName.trim();
  const hasToken = fields.token.trim() !== "";
  if (!hasToken) return nameChanged;
  return accessTokenRequiredFieldsFilled(fields, info, deps);
}

/**
 * Builds the wire connection input for a create/update call — dispatches to
 * `buildCredentialConnectionInput` (a host's descriptor fields, the typed token under its
 * `tokenField`) / `buildSourceControlConnectionInput` by `fields.ref.kind` rather than re-deriving
 * either provider's shape (this file's own header). A publish provider without a credential spec
 * (only the bare fallback entry {@link accessTokenProviderInfo} makes) sends the token as `token`.
 * @complexity O(f).
 */
export function buildAccessTokenConnectionInput(
  { fields, info, deps }: { fields: AccessTokenFormFields; info: AccessTokenProviderInfo; deps: {
    buildCredentialConnectionInput: (required: { providerId: string; spec: NonNullable<AccessTokenProviderInfo["publishCredential"]>; values: Readonly<Record<string, string>> }) => AdminPublishConnectionInput;
    buildSourceControlConnectionInput: (required: { fields: { providerId: string; token: string; values: Readonly<Record<string, string>> }; declaredFields: AccessTokenProviderInfo["extraFields"] }) => AdminSourceControlConnectionInput;
  } },
  _optional: Record<string, never> = {}
): AdminPublishConnectionInput | AdminSourceControlConnectionInput {
  if (fields.ref.kind === "publish") {
    const spec = info.publishCredential ?? { tokenField: "token", fields: [{ name: "token", label: "Access token", required: true }] };
    const providerId: AdminPublishCredentialProviderId = fields.ref.providerId;
    return deps.buildCredentialConnectionInput({ providerId, spec, values: { ...fields.values, [spec.tokenField]: fields.token } });
  }
  return deps.buildSourceControlConnectionInput({ fields: { providerId: fields.ref.providerId, token: fields.token, values: fields.values }, declaredFields: info.extraFields });
}

/** The DOM/agent id suffix of one extra field's input. `accountId` keeps its old `account` suffix
 *  (pinned by agent tooling); every other field uses its own name, hyphenated. @complexity O(n). */
export function accessTokenExtraFieldIdSuffix({ fieldName, deps }: { fieldName: string; deps: {
  asciiSlug: (required: { text: string; trimChars: typeof trimChars }) => string;
  fieldNameHandleSegment: (required: { fieldName: string; asciiSlug: (required: { text: string; trimChars: typeof trimChars }) => string }) => string;
} }, _options = {}): string {
  return fieldName === "accountId" ? "account" : deps.fieldNameHandleSegment({ asciiSlug: deps.asciiSlug, fieldName });
}

/** Builds an update patch's non-secret/secret halves independently — split out of the hook's own
 *  `replaceToken` purely so that function's own branch count (readiness guard, uniqueness guard,
 *  try/catch, kind dispatch) stays under this repo's complexity gate. `label` is included only when
 *  the operator actually changed the name (a same-value PUT is a no-op write neither store needs to
 *  see); `connection` is included only when a new token was typed — see
 *  {@link accessTokenReplaceReadyToSave}'s own doc for why either can be true alone.
 *  @complexity O(1). */
export function buildAccessTokenUpdatePatch(
  { fields, nameChanged, hasToken, info, deps }: {
    fields: AccessTokenFormFields;
    deps: Parameters<typeof buildAccessTokenConnectionInput>[0]["deps"] & {
      accessTokenWorksForChanged: (required: { draft: string[] | undefined; saved: readonly string[] | undefined }) => boolean;
    };
    nameChanged: boolean;
    hasToken: boolean;
    info: AccessTokenProviderInfo;
  },
  { currentWorksFor = [] }: { currentWorksFor?: readonly string[] } = {},
): { label?: string; connection?: AdminPublishConnectionInput | AdminSourceControlConnectionInput; worksFor?: string[] } {
  return {
    ...(fields.ref.kind === "publish" && deps.accessTokenWorksForChanged({ draft: fields.worksFor, saved: currentWorksFor }) ? { worksFor: fields.worksFor! } : {}),
    ...(nameChanged ? { label: fields.name.trim() } : {}),
    ...(hasToken ? { connection: buildAccessTokenConnectionInput({ fields, info, deps }) } : {}),
  };
}

/** What a rejected credential create/update means for the FORM — a dictionary-key-shaped result to
 *  translate and apply. Mirrors `PublishCredentialSubmitFailure`/`SourceControlCredentialSubmitFailure`
 *  exactly (both stores' routes share the identical `409 -> DUPLICATE_LABEL` / `400 -> VALIDATION`
 *  wire shape — `publish-credentials.ts`'s own header says the source-control route "mirrors" it
 *  verbatim), reimplemented here rather than imported from either feature so this page owns no code
 *  dependency on `deployment/`/`source-control/` beyond their shared, provider-agnostic `rules.ts`
 *  data tables — same boundary `ProvidersTab.tsx`'s own header draws for the identical reason (two
 *  different agents building two different features in the same session). */
export type AccessTokenSubmitFailure = { kind: "duplicate-label" } | { kind: "validation"; detail: string } | { kind: "generic" };

/**
 * Classifies a rejected create/update/delete call. Reads `e.code`, falling back to `e.message`, for
 * the two known markers, same reasoning `classifyCredentialSubmitError` in
 * `@jini-ai/admin/shell/lib/credential-submit-error` documents.
 * @complexity O(1).
 */
export function classifyAccessTokenSubmitError({ e, isApiError }: { e: unknown; isApiError: (error: unknown) => error is AdminHttpError }, _options = {}): AccessTokenSubmitFailure {
  if (!isApiError(e)) return { kind: "generic" };
  const marker = e.code ?? e.message;
  if (marker === "DUPLICATE_LABEL") return { kind: "duplicate-label" };
  if (marker === "VALIDATION") {
    const detail = typeof e.body?.detail === "string" ? e.body.detail : e.message;
    return { kind: "validation", detail };
  }
  return { kind: "generic" };
}

/** The Save-readiness gate for a SAVED row's Replace form, picked by row kind — the same split
 *  `use-access-tokens.hooks.ts`'s `replaceToken` makes before writing: a custom row uses
 *  {@link customCredentialReplaceReadyToSave} (a username-only change is a real edit), every catalog
 *  row keeps {@link accessTokenReplaceReadyToSave}. `ExistingTokenFields` used to call the catalog
 *  gate for every row, so a custom row's username-only fix left Save disabled even though the
 *  controller would have sent it. Works-for-only edits also enable Save without a token.
 *  @complexity O(draft + saved) time/space for compatibility membership. */
export function accessTokenExistingRowReadyToSave(
  { fields, row, info, SOURCE_CONTROL, deps }: {
    SOURCE_CONTROL: "source-control";
    deps: Parameters<typeof accessTokenRowReadyToSave>[0]["deps"] & {
      accessTokenWorksForChanged: (required: { draft: string[] | undefined; saved: readonly string[] | undefined }) => boolean;
      customCredentialReplaceReadyToSave: (required: { fields: AccessTokenFormFields; currentName: string; currentUsername: string | undefined }) => boolean;
    };
    fields: AccessTokenFormFields;
    row: Pick<AccessTokenRow, "kind" | "name" | "username" | "worksFor">;
    info: AccessTokenProviderInfo;
  },
  _options = {},
): boolean {
  // Metadata edits use the same secret-preserving update path as a rename. A supplied token
  // still requires the provider's complete connection fields.
  if (row.kind !== SOURCE_CONTROL && fields.name.trim() && !fields.token.trim() && deps.accessTokenWorksForChanged({ draft: fields.worksFor, saved: row.worksFor })) return true;
  if (row.kind === "custom") return deps.customCredentialReplaceReadyToSave({ fields, currentName: row.name, currentUsername: row.username });
  return accessTokenReplaceReadyToSave({ fields, currentName: row.name, info, deps });
}
