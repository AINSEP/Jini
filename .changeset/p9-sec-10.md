---
"@jini-ai/admin": minor
---

SEC-10 (P9-SEC plan v2): vendor token forms, default indicator, removal consequences.

- **Breaking (security module only):** `security({ ui, ChipField }, options)` now takes a REQUIRED `ChipField`, a
  feature-owned render slot typed by `SecurityChipFieldProps` (`{ multiple: true, label, options, value, onChange }`,
  exported from `@jini-ai/admin/security/react`). No kit name was added (coordinator decision replacing the
  A-K2-0a.chip prerequisite). `loadAccessTokensTab({ ChipField })`, `AccessTokensTab` and `CredentialEditor` take it
  as a required input. Tovu binds its own chip field at cutover.
- Exact W2/W3 bodies: `buildCredentialPatch({ draft, providers }, { saved? })`. A create sends the whole body; an
  edit sends only what changed: a rename without a token is `{ label }` alone, `connection` only with a typed token
  (extra fields inside it, never top level), `worksFor` only when membership changed (`[]` clears; never for
  source control). An unchanged edit sends no write; the controller's new `hasChanges({})` disables Save until something changed.
- "Works for" chips for publish (and custom) credentials; a saved id whose plugin is disabled stays as its own chip.
  `CredentialDraft.worksFor?`, `CredentialInput.worksFor?`, `CredentialPatch.worksFor?`.
- Vendor form: extra fields declared before the token render above it (`fieldsAroundToken`), field help below each
  field, provider help in a "Which permissions to grant" disclosure. Secret extra fields are masked and agent-private.
- Default indicator and "Make default — {name}" show only once a provider has two saved tokens.
- Remove dialog: "deletes the saved copy … does NOT revoke on {vendor}", a revoke link to the vendor's token page,
  and a last-saved-token note. The confirm label is the translator key `removeCredentialConfirm` (a host supplies
  its own product wording through `t`).
- New rules (`credential-forms.rules.ts`): `isValidHttpUrl`, `parseAdditionalHosts`, `invalidAdditionalHosts`,
  `worksForChanged`, `fieldsAroundToken`, `worksForChoices`, `worksForPart`, `customCreateFields`,
  `customUpdateFields`, type `SavedCredentialFacts`. New message keys: `worksFor`, `tokenScopeGuidance`,
  `credentialDefault`, `makeDefault`, `removeCredentialConfirm`, `removeRevokeOn`, `removeCredentialBody`,
  `removeLastRowNote`, `additionalHostsInvalid`.
