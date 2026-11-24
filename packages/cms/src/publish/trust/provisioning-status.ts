import { isGrantActive } from "./grant.js";
import {
  findGrantForSource, MS_PER_DAY, RENEWAL_WARNING_DAYS, type PublishTrustResolution,
} from "./provisioning.js";

/**
 * @file What the destination and the source tell an operator about publish trust, in plain
 * sentences — split out of `provisioning.ts` (publish-engine P0.8), which keeps the document parse,
 * the resolution of what this install accepts, and the provisioning port.
 */

/**
 * One plain sentence describing what this site currently accepts — the destination-side empty
 * state, and the reason a fresh install shows a sentence instead of an error code.
 *
 * `settingName` is the host's name for the environment setting that overrides the committed file
 * (the host owns that name; this module never assumes one). It is named only in the env-revoked
 * sentence, so an operator can find the switch they flipped.
 *
 * @complexity O(1).
 */
export function describePublishTrustState({ res, settingName }: { res: PublishTrustResolution; settingName: string }, _optional = {}): string {
  switch (res.state) {
    case "configured": {
      const n = res.grants.length;
      return `${n} ${n === 1 ? "computer" : "computers"} can publish to this site.`;
    }
    case "revoked":
      return res.origin === "env"
        ? `Publishing to this site is switched off in this deployment's own settings (${settingName}), which overrides whatever the repository carries.`
        : "Publishing to this site is switched off. No computer is connected.";
    case "invalid":
      return `This site's publishing settings could not be read, so nobody can publish to it. ${res.reason ?? ""}`.trim();
    case "absent":
      return "No computer is connected to this site for publishing yet. Connect one, then deploy — the connection travels with the deploy, and there is nothing to copy.";
    default:
      return undefined as never;
  }
}

// ---------------------------------------------------------------------------
// The source's question: is this computer connected to that site?
// ---------------------------------------------------------------------------

export type ConnectionVerdict =
  | "connected"
  | "expiring-soon"
  | "expired"
  | "superseded-key"
  | "not-connected"
  | "unavailable";

export interface ConnectionStatus {
  readonly verdict: ConnectionVerdict;
  /** Plain language, naming the site and the next action. Never an error code. */
  readonly message: string;
}

/** @complexity O(1). */
function daysUntil({ iso, nowIso }: { iso: string; nowIso: string }, _optional = {}): number {
  return Math.floor((Date.parse(iso) - Date.parse(nowIso)) / MS_PER_DAY);
}

/**
 * Whether the destination described by `resolution` currently accepts publishes signed by
 * `publicKeyB64u` from `sourceInstallationId`.
 *
 * MATCHES ON THE PUBLIC KEY, NOT THE GENERATION, and that distinction is the whole point. Rotation
 * bumps the generation, but regenerating the site key changes the derived key while leaving the
 * generation alone (`keys.ts`: the key is HKDF over the site key). A grant naming the right
 * generation and the previous key is therefore DEAD, and a generation comparison would report it
 * as current — publishing would fail with the destination insisting it was connected.
 *
 * @complexity O(n) in the grant's public-key count (at most four, per `grant.ts`).
 */
export function describeConnection(input: {
  readonly resolution: PublishTrustResolution;
  readonly sourceInstallationId: string;
  readonly publicKeyB64u: string;
  readonly siteLabel: string;
  readonly nowIso: string;
  /** The host's override setting name, forwarded to {@link describePublishTrustState}. */
  readonly settingName: string;
}, _optional = {}): ConnectionStatus {
  const { resolution: res, siteLabel, nowIso } = input;
  if (res.state !== "configured") {
    return { verdict: "unavailable", message: `${siteLabel}: ${describePublishTrustState({ res, settingName: input.settingName })}` };
  }

  const grant = findGrantForSource({ res, sourceInstallationId: input.sourceInstallationId });
  if (grant === null) {
    return {
      verdict: "not-connected",
      message: `${siteLabel} does not recognise this computer yet. Connect it and deploy once — nothing to copy, and no key to keep.`,
    };
  }
  if (!isGrantActive({ grant, nowIso })) {
    return {
      verdict: "expired",
      message: `This computer's connection to ${siteLabel} expired on ${grant.notAfter}. Reconnect and deploy to restore it.`,
    };
  }
  if (!grant.publicKeys.some((k) => k.publicKeyB64u === input.publicKeyB64u)) {
    return {
      verdict: "superseded-key",
      message: `${siteLabel} is still carrying an older key for this computer, so it will refuse a publish. This happens after the Site key is regenerated. Reconnect and deploy to finish the change.`,
    };
  }

  const remaining = daysUntil({ iso: grant.notAfter, nowIso });
  if (remaining <= RENEWAL_WARNING_DAYS) {
    return {
      verdict: "expiring-soon",
      message: `This computer can publish to ${siteLabel} for ${remaining} more ${remaining === 1 ? "day" : "days"}. Reconnecting and deploying renews it.`,
    };
  }
  return { verdict: "connected", message: `This computer can publish to ${siteLabel}.` };
}
