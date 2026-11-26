import type { AdminCustomConnectionInput } from "./api/security-api.types.js";
import type { AccessTokenFormFields } from "./access-token-providers.js";
import type { AccessTokenRow, AccessTokenRowCategoryId } from "./access-token-rows.js";
/** One "Add custom provider" form's fields — the dedicated dialog's own shape, kept separate from
 *  {@link AccessTokenFormFields} (used by the seven catalog providers' Create/Replace) rather than
 *  widened onto it: a custom row collects `category`/`baseUrl`, which no catalog provider's form
 *  ever asks for, and has no `ref`/`values` to carry. */
export interface CustomCredentialFormFields {
  readonly worksFor?: string[];
  readonly name: string;
  readonly category: AccessTokenRowCategoryId;
  readonly baseUrl: string;
  /** Raw textarea input for extra allowed hosts beyond `baseUrl` (e.g. a provider whose
   *  API spans two hosts for one account) — one URL per line or comma-separated, operator's
   *  choice; see {@link parseAdditionalHostsInput}. Always optional: a blank value means "no
   *  extra hosts", matching the server's `allowedOriginsFor`/`validateAdditionalHosts`
   *  omitted-is-not-an-error contract. */
  readonly additionalHosts: string;
  readonly token: string;
  readonly username: string;
}

/** Whether `value` parses as an absolute `http`/`https` URL — the client-side twin of
 *  the server's own `validateBaseUrl` (same accept/reject rule,
 *  duplicated rather than shared since server code never imports from the admin client). Checked
 *  explicitly rather than trusting "`new URL()` did not throw" — that constructor accepts far more
 *  schemes than this field should (`javascript:`, `mailto:`, a bare `file:`).
 *  @complexity O(1). */
export function isValidHttpUrl({ value }: { value: string }, _options = {}): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Splits {@link CustomCredentialFormFields.additionalHosts}'s raw textarea text into individual
 *  candidate host strings — one per line OR comma-separated (operator's choice, so pasting a
 *  provider's own docs either way just works), trimmed, with blank entries dropped. Does NOT
 *  validate each entry as a URL — see {@link invalidAdditionalHostsEntries} for that, kept
 *  separate so a caller that only needs the parsed list (e.g. building the wire payload) does not
 *  pay for a validation pass it does not need.
 *  @complexity O(n) in the raw text's own length. */
export function parseAdditionalHostsInput({ raw }: { raw: string }, _options = {}): string[] {
  return raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/** The parsed entries that fail {@link isValidHttpUrl} — surfaced as the "Additional hosts" field's
 *  own inline field error, the same pattern `baseUrlInvalid` already uses for Base URL. An empty
 *  field parses to zero entries and is never invalid (this field is entirely optional).
 *  @complexity O(n) in the number of parsed entries. */
export function invalidAdditionalHostsEntries({ raw }: { raw: string }, _options = {}): string[] {
  return parseAdditionalHostsInput({ raw }).filter((entry) => !isValidHttpUrl({ value: entry }));
}

/** Whether the "Add custom provider" dialog has enough typed to save — Name, a valid `http(s)`
 *  Base URL, and a non-blank Access token are all required; Category always has a value (the select
 *  defaults to one, never blank); Username stays optional (it can
 *  never gate readiness the way the catalog gate's per-provider required fields
 *  do); Additional hosts stays optional too, but every entry typed (if any) must itself be a valid
 *  `http(s)` URL — a half-typed host list should not silently save with the bad entry dropped.
 *  @complexity O(n) in the number of typed additional-host entries. */
export function customCredentialReadyToSave(fields: CustomCredentialFormFields, _optional: Record<string, never> = {}): boolean {
  if (fields.name.trim() === "") return false;
  if (fields.token.trim() === "") return false;
  if (!isValidHttpUrl({ value: fields.baseUrl.trim() })) return false;
  return invalidAdditionalHostsEntries({ raw: fields.additionalHosts }).length === 0;
}

/** Whether `name` collides with another saved custom credential — workspace-wide (unlike
 *  `accessTokenNameTaken`, which scopes by `providerId`): the server's own
 *  `(workspaceId, label)` UNIQUE constraint has no provider dimension for this table at all (every
 *  custom row's `providerId` is already unique — see {@link buildCustomCredentialRows}'s doc — so
 *  scoping by it the way `accessTokenNameTaken` does would never find a real collision). Same
 *  client-side-pre-check-not-a-replacement-for-the-server's-409 posture as that function.
 *  @complexity O(n) in this workspace's own (small) custom-credential count. */
export function customCredentialNameTaken({ rows, name }: { rows: readonly AccessTokenRow[]; name: string }, { excludeId }: { excludeId?: string } = {}): boolean {
  const trimmed = name.trim().toLowerCase();
  return rows.some((row) => row.kind === "custom" && row.id !== excludeId && row.name.trim().toLowerCase() === trimmed);
}

/**
 * the host's catalog replace gate's counterpart for a saved CUSTOM credential row — a separate
 * function rather than a widening of that shared one, because the two gates diverge on a case the
 * shared one must never allow: a bare, no-token Username edit. For the seven catalog providers,
 * `fields.username` is never shown (only custom rows carry a Username)
 * (`replaceToken`'s own header note: `row.username` is always `undefined` for a non-custom row, so
 * there is no persisted value a lone Username edit could even be a change FROM); folding a
 * bare-username check into the shared gate would make a stray character typed into that field on a
 * rename-only Save incorrectly enable a `PUT` with nothing else to send. A custom row is the opposite:
 * `AccessTokenRow.username` (2026-09-01) is a REAL persisted, independently-editable fact, and
 * the host's `replaceCustomCredential` needs a Save button that lights up for
 * "operator only fixed the username" the exact way it already does for "operator only renamed it" —
 * the live incident this whole field exists for (a saved credential with a wrong/missing username,
 * token already correct).
 *
 * Same three-way shape as the host's catalog replace gate otherwise: nothing typed/changed →
 * not ready. A name change, a username change (typed OR cleared — see
 * {@link buildCustomCredentialUpdatePatch}'s own doc for how a cleared field becomes the server's
 * `null` clear sentinel), or both, with no token → ready. A new token → always ready; unlike the
 * catalog gate there is no required-field completeness check left to run here, since a custom
 * row's synthetic info (`accessTokenRowProviderInfo`) declares none.
 *
 * @complexity O(1).
 */
export function customCredentialReplaceReadyToSave(
  { fields, currentName, currentUsername }: {
    fields: AccessTokenFormFields;
    currentName: string;
    currentUsername: string | undefined;
  },
  _options = {},
): boolean {
  if (fields.name.trim() === "") return false;
  if (fields.token.trim() !== "") return true;
  const nameChanged = fields.name.trim() !== currentName.trim();
  const usernameChanged = fields.username.trim() !== (currentUsername ?? "").trim();
  return nameChanged || usernameChanged;
}

/** Whether a draft changes compatibility membership. O(draft + saved) time/space.
 * Omission preserves metadata; an explicit empty array clears it.
 */
export function accessTokenWorksForChanged({ draft, saved = [] }: { draft?: string[] | undefined; saved?: readonly string[] | undefined }, _options = {}): boolean {
  if (draft === undefined) return false;
  const savedIds = new Set(saved);
  return draft.length !== saved.length || draft.some(id => !savedIds.has(id));
}

/** Builds the wire connection input for a custom-provider create/update call — just
 *  `{token, username?}`, no provider dispatch (this table has none — see the server's own types header). `username` is omitted entirely when blank, never sent as `""` (mirrors every
 *  other optional-field builder in this file). @complexity O(1). */
export function buildCustomProviderConnectionInput(fields: Pick<CustomCredentialFormFields, "token" | "username">): AdminCustomConnectionInput {
  const username = fields.username.trim();
  return { token: fields.token, ...(username !== "" ? { username } : {}) };
}

/**
 * the host's catalog update-patch builder's counterpart for a saved CUSTOM credential row — same "send
 * only what actually changed" shape, plus the one field a custom row's Replace form can now change
 * independently of a token retype: `username` (2026-09-01). `label`/`connection` inclusion follows
 * the shared builder's own rules verbatim (see that function's doc). `username` is included whenever
 * the draft's trimmed value differs from what this row currently has saved — a non-blank value sends
 * the new string, a blank value sends the server's documented clear sentinel (`null`, NOT `""` — see
 * the server store's `UpdateCustomCredentialInput.username` doc for why a blank string is
 * rejected rather than treated as either "clear" or "leave alone"). Included even when `hasToken` is
 * also true and `connection` therefore already carries its own `username` member: the server's own
 * precedence rule makes the top-level field win in that case, and since both are built from the same
 * `fields.username` here, they always agree — see the server store's `updateCustomCredential` doc for the
 * full precedence writeup.
 *
 * @complexity O(1).
 */
export function buildCustomCredentialUpdatePatch(
  { fields, nameChanged, hasToken, currentUsername }: {
    fields: AccessTokenFormFields;
    nameChanged: boolean;
    hasToken: boolean;
    currentUsername: string | undefined;
  },
  { currentWorksFor = [] }: { currentWorksFor?: readonly string[] | undefined } = {},
): { label?: string; connection?: AdminCustomConnectionInput; username?: string | null; worksFor?: string[] } {
  const trimmedUsername = fields.username.trim();
  const usernameChanged = trimmedUsername !== (currentUsername ?? "").trim();
  return {
    ...(accessTokenWorksForChanged({ draft: fields.worksFor, saved: currentWorksFor }) ? { worksFor: fields.worksFor } : {}),
    ...(nameChanged ? { label: fields.name.trim() } : {}),
    ...(hasToken ? { connection: buildCustomProviderConnectionInput(fields) } : {}),
    ...(usernameChanged ? { username: trimmedUsername === "" ? null : trimmedUsername } : {}),
  };
}

/** Builds the wire `additionalHosts` value for a custom-provider create/update call —
 *  `undefined` when the field parses to no entries, so the request omits it entirely rather than
 *  sending `[]` (matches `buildCustomProviderConnectionInput`'s own "omit rather than send an
 *  empty/blank value" convention, and the server's own "omitted = no extra hosts" contract).
 *  @complexity O(n) in the raw text's own length. */
export function buildAdditionalHostsInput({ raw }: { raw: string }, _options = {}): readonly string[] | undefined {
  const parsed = parseAdditionalHostsInput({ raw });
  return parsed.length > 0 ? parsed : undefined;
}
