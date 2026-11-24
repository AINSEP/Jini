import type { AdminPublishTargetCredentialSpec, AdminPublishTargetDescriptor, AdminPublishTargetField } from "../deployment/api/deployment-api.types.js";
import type { AdminSourceControlProviderDescriptor } from "../source-control/api/source-control-api.types.js";
import { accessTokenCategoryLabel, type AccessTokenCategoryInfo } from "./access-token-categories.js";
import type { AccessTokenKind, AccessTokenProviderRef, AccessTokenRow, AccessTokenRowCategoryId } from "./access-token-rows.js";

/** The one id shared by the source-control token kind and its category. */
const SOURCE_CONTROL = "source-control";

/** The host's product copy for the provider list, injected REQUIRED because every string here is
 *  something a person reads: the two purpose subtitles (kept letter-for-letter equal to the host's
 *  own category chip labels so a row's subtitle and the chip that filters it always agree), the
 *  category table (labels and chip order), the guidance a custom row shows, and the subtitle key
 *  that marks a custom credential. */
export interface AccessTokenProviderCopy {
  readonly categories: readonly AccessTokenCategoryInfo[];
  /** Subtitle of every deploy-host provider ("Hosting"). */
  readonly publishPurposeLabel: string;
  /** Subtitle of every source-control provider ("Source control"). */
  readonly sourceControlPurposeLabel: string;
  /** Guidance key a custom row shows in place of a descriptor's own help. */
  readonly customScopeGuidanceKey: string;
  /** The dictionary key `providerGroupSubtitleKeys` prepends for a custom credential. */
  readonly customCredentialSubtitleKey: string;
}

/** What {@link accessTokenProviders} needs from one source-control host, as the host's own
 *  descriptor shaper returns it (the host owns how a plugin descriptor becomes a token form). */
export interface AccessTokenSourceControlHostInfo {
  readonly id: string;
  readonly label: string;
  readonly tokenPageUrl: string;
  readonly scopeGuidanceKey: string;
  readonly tokenLabel?: string;
  readonly fields: readonly AdminPublishTargetField[];
}

/** One token form's fields, kept together as one shape so the connection-input builder and the
 *  readiness gates share a single parameter type — plus `name` and `values`, the draft of the
 *  provider's {@link AccessTokenProviderInfo.extraFields} keyed by field name. */
export interface AccessTokenFormFields {
  readonly worksFor?: string[];
  readonly ref: AccessTokenProviderRef;
  readonly name: string;
  readonly token: string;
  readonly values: Readonly<Record<string, string>>;
  readonly username: string;
}

/** One provider row this page can render — a `kind`-tagged merge of a deploy host's descriptor /
 *  a source-control host's info, plus `purposeLabel` (new here): the subtitle that keeps `github-pages`
 *  and `github` from reading as the same credential (the two-store GitHub trap: `github-pages` is a deploy host,
 *  `github` a source-control identity, two tables and two tokens). Omitted (undefined) for a provider whose brand name is not shared with any other store
 *  today — showing a purpose subtitle only when a name actually needs disambiguating avoids the
 *  visual-spec's own "never merge into one card" rule reading as "always show extra chrome". */
export interface AccessTokenProviderInfo {
  readonly kind: AccessTokenKind;
  readonly providerId: string;
  /** Proper noun — rendered verbatim, never translated, same treatment every provider label in this
   *  app gets. */
  readonly label: string;
  /** The company an operator actually authenticates to when creating or revoking this token —
   *  deliberately a SEPARATE field from {@link label}. For most providers the two are the same
   *  string, but `github-pages` and `cloudflare-pages` name a PLACE the credential publishes to, not
   *  the company running the token console: there is no revoke page "at GitHub Pages" or "at
   *  Cloudflare Pages", only at github.com / cloudflare.com. Copy that tells an operator where to
   *  create or revoke a token must read this field; copy that says what a saved credential is FOR
   *  (row/group headings, "Add another X token" affordances) keeps reading {@link label} — collapsing
   *  the two into one field is exactly the bug this one exists to prevent. See
   *  For a deploy host this is its descriptor's `credential.vendorLabel` (falling back to its label). */
  readonly vendorLabel: string;
  /** Set for every provider today: `github-pages`/`github` need it to disambiguate, and the other
   *  five get it anyway rather than making disambiguation conditional on which OTHER providers this
   *  workspace happens to have connected — a static fact per provider is simpler to reason about
   *  than one that depends on the rest of the list. */
  readonly purposeLabel: string;
  /** The category-filter bucket this provider lands in — see the host's category table ({@link AccessTokenProviderCopy.categories}). All
   *  four publish providers are `"hosting"` (they publish a static export TO a host); all three
   *  source-control providers are `"source-control"` (they read/write a repository, never a
   *  deploy target) — the same axis {@link AccessTokenProviderInfo.purposeLabel} already names in
   *  prose for the one provider pair that needs disambiguating (github-pages vs github). */
  readonly category: AccessTokenRowCategoryId;
  /** Where to create (and revoke) a token; `""` when the provider names no page (the link is then
   *  not rendered). */
  readonly tokenPageUrl: string;
  /** What kind of token the provider needs, passed through the translator; `""` when none. */
  readonly scopeGuidanceKey: string;
  /** The secret input's label, a host term from its descriptor ("API token"); absent means the
   *  generic "Access token". */
  readonly tokenLabel?: string;
  /** Publish hosts only: the descriptor's credential spec — the token field's wire name and every
   *  field the host's connection-input builder sends. */
  readonly publishCredential?: AdminPublishTargetCredentialSpec;
  /** Descriptor fields shown besides Name and the token (a host's non-token credential fields); a
   *  `required` one gates Save. Empty for custom rows. */
  readonly extraFields: readonly AdminPublishTargetField[];
  /** Custom rows only: the form shows an optional Username (brief's own requirement). */
  readonly username?: "optional";
  /** Set on the bare entry for a saved row whose provider is not listed (its plugin switched off or
   *  missing). The row stays visible and removable, but nothing new can be added for it. */
  readonly unlisted?: true;
}

/** One deploy host's Access Tokens entry, built from its descriptor. @complexity O(f). */
function publishTargetProviderInfo({ target, credential, copy }: { target: AdminPublishTargetDescriptor; credential: AdminPublishTargetCredentialSpec; copy: AccessTokenProviderCopy }): AccessTokenProviderInfo {
  const tokenField = credential.fields.find((field) => field.name === credential.tokenField);
  return {
    kind: "publish",
    providerId: target.id,
    label: target.label,
    vendorLabel: credential.vendorLabel ?? target.label,
    purposeLabel: copy.publishPurposeLabel,
    category: "hosting",
    tokenPageUrl: credential.tokenPageUrl ?? "",
    scopeGuidanceKey: credential.userHelp ?? credential.help ?? "",
    ...(tokenField !== undefined ? { tokenLabel: tokenField.label } : {}),
    publishCredential: credential,
    extraFields: credential.fields.filter((field) => field.name !== credential.tokenField),
  };
}

/** One source-control host's Access Tokens entry, built from its plugin's descriptor. @complexity O(f). */
function sourceControlTargetProviderInfo({ info, copy }: { info: AccessTokenSourceControlHostInfo; copy: AccessTokenProviderCopy }): AccessTokenProviderInfo {
  return {
    kind: SOURCE_CONTROL,
    providerId: info.id,
    label: info.label,
    vendorLabel: info.label,
    purposeLabel: copy.sourceControlPurposeLabel,
    category: SOURCE_CONTROL,
    tokenPageUrl: info.tokenPageUrl,
    scopeGuidanceKey: info.scopeGuidanceKey,
    ...(info.tokenLabel !== undefined ? { tokenLabel: info.tokenLabel } : {}),
    extraFields: info.fields,
  };
}

/**
 * The providers this page can save a named token for: every deploy host whose descriptor takes a
 * credential (`publishTargets`, in registry order), then every source-control host plugins declare
 * (`sourceControlProviders`); none of either while it loads. Concatenated rather than interleaved
 * so a reader scanning top-to-bottom sees "deploy targets, then source identities" as two blocks.
 * @complexity O(t + s) in the host and source-control provider counts.
 */
export function accessTokenProviders(
  { publishTargets, copy, sourceControlProviderInfo }: {
    publishTargets: readonly AdminPublishTargetDescriptor[] | undefined;
    copy: AccessTokenProviderCopy;
    /** The host's shaper from a plugin's descriptor to its token-form facts. */
    sourceControlProviderInfo: (descriptor: AdminSourceControlProviderDescriptor) => AccessTokenSourceControlHostInfo;
  },
  { sourceControlProviders }: { sourceControlProviders?: readonly AdminSourceControlProviderDescriptor[] } = {},
): AccessTokenProviderInfo[] {
  return [
    ...(publishTargets ?? []).flatMap((target) => (target.credential === undefined ? [] : [publishTargetProviderInfo({ target, credential: target.credential, copy })])),
    ...(sourceControlProviders ?? []).map((descriptor) => sourceControlTargetProviderInfo({ info: sourceControlProviderInfo(descriptor), copy })),
  ];
}

/** Looks up one provider's entry in `providers` ({@link accessTokenProviders}). A saved row whose
 *  provider is not listed (its plugin switched off, or the host list still loading) gets a bare
 *  entry named by its own id — never another provider's label, guidance or token page.
 *  @complexity O(n) in the (small) provider count. */
export function accessTokenProviderInfo({ providers, ref, copy }: { providers: readonly AccessTokenProviderInfo[]; ref: AccessTokenProviderRef; copy: AccessTokenProviderCopy }, _optional = {}): AccessTokenProviderInfo {
  return (
    providers.find((p) => p.kind === ref.kind && p.providerId === ref.providerId) ?? {
      kind: ref.kind,
      providerId: ref.providerId,
      label: ref.providerId,
      vendorLabel: ref.providerId,
      purposeLabel: ref.kind === SOURCE_CONTROL ? copy.sourceControlPurposeLabel : copy.publishPurposeLabel,
      category: ref.kind === SOURCE_CONTROL ? SOURCE_CONTROL : "hosting",
      tokenPageUrl: "",
      scopeGuidanceKey: "",
      extraFields: [],
      unlisted: true,
    }
  );
}

/** `providers` plus a bare {@link accessTokenProviderInfo} entry for every saved publish or
 *  source-control row whose provider is not listed, so no saved credential ever drops off the page
 *  (IRON RULE: it must stay visible and removable). Custom rows group on their own.
 *  @complexity O(r * p) in the saved-row and provider counts (both small). */
export function accessTokenProvidersWithSavedRows({ providers, rows, copy }: { providers: readonly AccessTokenProviderInfo[]; rows: readonly AccessTokenRow[]; copy: AccessTokenProviderCopy }, _optional = {}): AccessTokenProviderInfo[] {
  const all = [...providers];
  for (const row of rows) {
    if (row.kind === "custom" || all.some((p) => p.kind === row.kind && p.providerId === row.providerId)) continue;
    all.push(accessTokenProviderInfo({ providers, ref: row, copy }));
  }
  return all;
}

/** {@link accessTokenProviderInfo}'s row-aware counterpart — the one host's token-row call site actually needs, since a `kind: "custom"` row has no catalog entry
 *  {@link accessTokenProviderInfo} could look up (its `providerId` is the row's own id, never
 *  reused by any other row). Every other kind delegates straight through, unchanged. Builds a
 *  SYNTHETIC info from the row's own {@link AccessTokenRow.category}/{@link AccessTokenRow.baseUrl}/
 *  `name` for `"custom"`: `label`/`vendorLabel` both read `row.name` (a custom row has no
 *  destination-vs-vendor split — see {@link AccessTokenProviderInfo.vendorLabel}'s own doc, which
 *  only applies to the two catalog providers it names), `purposeLabel` is the category's own
 *  display label, `tokenPageUrl` is the operator's own base URL (the closest analog this row has to
 *  "where would I go to get/revoke this token"), no extra fields and an optional `username` — a custom row's Replace form asks for Name + Token + an always-optional Username,
 *  never re-collects the base URL (its base URL is create-only).
 *  @complexity O(1). */
export function accessTokenRowProviderInfo({ providers, row, copy }: { providers: readonly AccessTokenProviderInfo[]; row: AccessTokenRow; copy: AccessTokenProviderCopy }, _optional = {}): AccessTokenProviderInfo {
  if (row.kind !== "custom") return accessTokenProviderInfo({ providers, ref: row, copy });
  const category = row.category ?? "general";
  return {
    kind: "custom",
    providerId: row.providerId,
    label: row.name,
    vendorLabel: row.name,
    purposeLabel: accessTokenCategoryLabel({ id: category, categories: copy.categories }),
    category,
    tokenPageUrl: row.baseUrl ?? "",
    scopeGuidanceKey: copy.customScopeGuidanceKey,
    extraFields: [],
    username: "optional",
  };
}

/** The dictionary keys a provider group shows after its name, joined with " · ". A custom
 *  credential gets the host's custom-credential key first, so one the operator named after a listed host
 *  ("github") never reads as that host's own group. @complexity O(1). */
export function providerGroupSubtitleKeys({ info, copy }: { info: AccessTokenProviderInfo; copy: AccessTokenProviderCopy }, _optional = {}): string[] {
  return info.kind === "custom" ? [copy.customCredentialSubtitleKey, info.purposeLabel] : [info.purposeLabel];
}

/** A provider's extra fields split around the secret input, keeping the host's declared order: a
 *  deploy host's fields declared before its token field (S3's Access key ID before its Secret access
 *  key) render above it, the rest below. Other kinds declare no token position, so every extra field
 *  goes below. @complexity O(f) in the field count. */
export function extraFieldsAroundToken({ info }: { info: AccessTokenProviderInfo }, _optional = {}): {
  before: readonly AdminPublishTargetField[];
  after: readonly AdminPublishTargetField[];
} {
  const declared = info.publishCredential?.fields ?? [];
  const tokenIndex = declared.findIndex((field) => field.name === info.publishCredential?.tokenField);
  const beforeNames = new Set(declared.slice(0, Math.max(tokenIndex, 0)).map((field) => field.name));
  return {
    before: info.extraFields.filter((field) => beforeNames.has(field.name)),
    after: info.extraFields.filter((field) => !beforeNames.has(field.name)),
  };
}
