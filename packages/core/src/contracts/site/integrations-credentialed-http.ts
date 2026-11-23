/**
 * @file Credential-scheme rule shapes: a self-describing token prefix mapped to the HTTP
 * authentication scheme it is sent with, and the parsed registry a host assembles from plugin
 * declarations. Parsing and detection live in `@jini-ai/integrations/credentialed-http`; these types
 * sit in core so a host can carry a registry without depending on the integrations package.
 */

export interface CredentialSchemeRule {
  readonly id: string;
  readonly prefix: string;
  readonly scheme: string;
}

export interface CredentialSchemeRegistry {
  readonly rules: readonly CredentialSchemeRule[];
  readonly refusals: readonly string[];
}
