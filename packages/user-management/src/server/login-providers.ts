/** Pure parser for a plugin's member login-provider preset file. Loading, admission and pinning stay with the host. */
import { MemberLoginError, type LoginProviderPreset } from "./login-types.js";

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/;

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  return value;
}

function httpsUrl(value: unknown): string {
  const raw = text(value);
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  return raw;
}

function emailAuthority(value: Record<string, unknown>): Pick<LoginProviderPreset, "authoritativeEmailDomains" | "hostedDomainClaim"> {
  const domains = value.authoritativeEmailDomains ?? [];
  if (!Array.isArray(domains) || domains.length > 16) throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  if (!domains.every(domain => typeof domain === "string" && DOMAIN.test(domain))) throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  const claim = value.hostedDomainClaim;
  if (claim !== undefined && !/^[a-z][a-z0-9_]{0,63}$/.test(text(claim))) throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  return { authoritativeEmailDomains: domains, ...(claim === undefined ? {} : { hostedDomainClaim: claim as string }) };
}

function scopes(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length !== 3 || new Set(value).size !== 3) throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  if (!value.every(scope => ["openid", "email", "profile"].includes(scope))) throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  return value;
}

function preset(value: unknown): LoginProviderPreset {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  const row = value as Record<string, unknown>;
  const id = text(row.id);
  if (!ID.test(id)) throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  if (row.signingAlgorithm !== "RS256" || row.clientAuthentication !== "client_secret_post") throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  if (row.pkce !== "S256") throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  return { id, label: text(row.label), issuer: httpsUrl(row.issuer), authorizationEndpoint: httpsUrl(row.authorizationEndpoint),
    tokenEndpoint: httpsUrl(row.tokenEndpoint), jwksUri: httpsUrl(row.jwksUri), scopes: scopes(row.scopes),
    signingAlgorithm: "RS256", clientAuthentication: "client_secret_post", pkce: "S256", credentialLabel: text(row.credentialLabel),
    credentialCardTarget: text(row.credentialCardTarget), ...emailAuthority(row) };
}

/** Parse a bounded v1 preset file. Failure exposes a fixed code, never raw plugin JSON.
 * @complexity O(bytes + p), bounded to 32 KiB and eight providers per package.
 */
export function parseLoginProviders(required: { raw: string }, _options = {}):
  { ok: true; descriptors: readonly LoginProviderPreset[] } | { ok: false; reason: string } {
  try {
    if (required.raw.length > 32768) throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
    const file = JSON.parse(required.raw);
    if (file.schemaVersion !== 1 || !Array.isArray(file.providers) || file.providers.length > 8) throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
    return { ok: true, descriptors: file.providers.map(preset) };
  } catch {
    return { ok: false, reason: "LOGIN_PROVIDER_INVALID" };
  }
}
