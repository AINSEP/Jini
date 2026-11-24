/**
 * Credential-field metadata for the provider tabs already exposed by the Authentication screen.
 * This is UI metadata only: it deliberately contains no callback URL, secret value, SDK object,
 * persistence state, or claim that the host can complete an OAuth flow. The provider catalog
 * itself is host policy and arrives as the screen's `providers` prop.
 */

export type AuthenticationProviderId = "google" | "facebook" | "linkedin";

export interface AuthenticationCredentialFieldSchema {
  readonly key: string;
  readonly label: string;
  readonly kind: "text" | "password";
  readonly placeholder: string;
  readonly hint: string;
  readonly required: true;
}

export interface AuthenticationProviderSchema {
  readonly id: AuthenticationProviderId;
  readonly label: string;
  readonly subtitle: string;
  readonly fields: readonly AuthenticationCredentialFieldSchema[];
}
