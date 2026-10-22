import { hasForbiddenRawUrlCharacter } from "./origin.js";
import { createVerifiedOrigin, type VerifiedOrigin } from "./types.js";
type ISODateTime = string;

/**
 * Loopback (including *.localhost and 127.0.0.0/8) cannot represent a public deployment. Rejecting
 * it also prevents a shared public-URL setting from overriding development TLS-derived schemes
 * with a workspace-setting HTTPS origin on a server that only answers HTTP.
 * Private network ranges remain valid: intranet deployments can legitimately use private hosts.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "0.0.0.0", "::1", "[::1]", "::", "[::]"]);

const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function isLoopbackHost(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost")) return true;
  return LOOPBACK_IPV4.test(host);
}

// Match candidate-origin normalization so a trailing DNS dot has one meaning across decisions.
function normalizeHost(hostname: string): string {
  const lowered = hostname.toLowerCase();
  return lowered.endsWith(".") ? lowered.slice(0, -1) : lowered;
}

// Reject ambiguous raw characters before parsing can erase them; use the redirect predicate
// rather than introducing a second URL acceptance rule.
function parseConfiguredUrl(raw: string): URL | null {
  if (hasForbiddenRawUrlCharacter({ raw })) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

// Workspace-setting evidence permits HTTPS only. Refuse HTTP before constructing evidence so
// an invalid operator setting cannot make origin construction throw during boot.
function refusalReason(url: URL): string | null {
  if (url.protocol !== "https:") return "its scheme must be https";
  if (url.username !== "" || url.password !== "") return "it carries a userinfo component";
  if (url.search !== "" || url.hash !== "") return "it carries a query string or fragment";

  const host = normalizeHost(url.hostname);
  if (host === "") return "its host is empty";
  if (isLoopbackHost(host)) return `'${host}' is a loopback host, not a public origin`;
  return null;
}

// Omit absent port/basePath keys entirely: explicit undefined differs from an omitted optional
// property under strict equality, and storage adapters preserve that distinction.
function buildConfiguredOrigin(url: URL, now: ISODateTime): VerifiedOrigin {
  const candidate: VerifiedOrigin = {
    scheme: "https",
    host: normalizeHost(url.hostname),
    verifiedAt: now,
    source: "workspace-setting",
  };
  if (url.port !== "") candidate.port = Number(url.port);
  const basePath = url.pathname.replace(/\/+$/, "");
  if (basePath !== "") candidate.basePath = basePath;
  return createVerifiedOrigin(candidate);
}

/** Operator declaration is evidence of configured trust, not DNS or ownership proof. */
export interface ConfiguredOriginRequired {
  env: Readonly<Record<string, string | undefined>>;
  envVarName: string;
  clock: { nowIso(): string };
  warn: (message: string) => void;
}

// Environment authority already controls deployed code; accepting an operator declaration adds
// no request-derived authority. Never feed a request-host fallback into this durable trust root.
// Malformed values leave no evidence, with one diagnostic warning; unset/blank local settings stay
// quiet. Use the host's boot clock so this evidence and other boot rows carry the same timestamp.
/** Accept a caller-named operator declaration or return undefined with a refusal warning.
 * No ambient environment lookup. The injected clock stamps accepted evidence only.
 * @complexity O(configured URL length) time/space; no network or storage effects.
 * @example resolveConfiguredOrigin({ env, envVarName: "APP_PUBLIC_URL", clock, warn });
 */
export function resolveConfiguredOrigin(required: ConfiguredOriginRequired): VerifiedOrigin | undefined {
  const { env, envVarName, clock, warn } = required;
  const raw = env[envVarName]?.trim();
  if (!raw) return undefined;
  const refuse = (reason: string): undefined => {
    warn(`${envVarName} is set but was refused as this deployment's public origin (${reason}); ` +
      `no origin was registered from it. Value: ${raw}`);
    return undefined;
  };
  const url = parseConfiguredUrl(raw);
  if (!url) return refuse("it is not a parseable URL");
  const reason = refusalReason(url);
  if (reason) return refuse(reason);
  return buildConfiguredOrigin(url, clock.nowIso());
}

export type OriginBootPlan =
  | { kind: "configured"; origin: VerifiedOrigin }
  | { kind: "dev-seed" }
  | { kind: "none" };

export interface OriginBootRequired extends ConfiguredOriginRequired {
  /** The host decides whether this runtime may seed a development capability. */
  allowDevSeed: () => boolean;
  missingOriginWarning: string;
}

// A disallowed development seed must produce no registration: persisting localhost in a public
// deployment poisons generated links, and find-or-create storage can preserve the row forever.
// Avoiding new seeds does not repair old rows; registering accepted configured evidence does.
/** Pure boot decision; registration effects and runtime selection stay in the host. */
/** Choose configured evidence, an allowed development seed, or no registration.
 * Warnings use caller-supplied policy; registration effects remain host-owned.
 * @complexity O(configured URL length) time/space.
 * @example planOriginBoot({ env, envVarName, clock, warn, allowDevSeed, missingOriginWarning });
 */
export function planOriginBoot(required: OriginBootRequired): OriginBootPlan {
  const origin = resolveConfiguredOrigin(required);
  if (origin) return { kind: "configured", origin };
  if (required.allowDevSeed()) return { kind: "dev-seed" };
  required.warn(required.missingOriginWarning);
  return { kind: "none" };
}
