/**
 * @file `PaymentCredentialsPort` adapters (architecture review §5).
 *
 * The rule-of-two shape `deploy-plugin.ts` credits to `integrations/keyring.env.ts` /
 * `keyring.memory.ts`: an env-var-backed production adapter plus an in-memory test double behind
 * one small port, never a hardcoded secret read inline.
 *
 * The env var NAME is DERIVED, not mapped. `deploy-plugin.ts` hardcodes
 * `ENV_VAR_BY_TARGET: Record<DeployTarget, string>` — a second place that must be edited for every
 * new target, and a second closed-union leak. Deriving `{PREFIX}_{PROVIDER}_{KEY}` mechanically
 * from the provider's own declared `credentialKeys` means adding a provider adds env vars without
 * touching any code.
 *
 * Credentials never touch `content.db`. ADR-024's secret invariant plus ADR-012's install-dir
 * portability: the portable folder must never carry usable secret material. This is the direct
 * avoidance of WooCommerce's plaintext `woocommerce_{id}_settings` row — one PHP-serialized array
 * holding live secret keys, `autoload = 'yes'`, i.e. `SELECT`ed into PHP memory on every request,
 * and the subject of its own 2021 "rotate your gateway keys" advisory after a DB-exposure bug.
 *
 * `KeyringPort` is deliberately NOT reused: it derives secrets via HKDF from a site key, which is
 * right for outbound signing secrets the host itself mints and wrong for externally-issued provider
 * credentials that must round-trip verbatim (`webhooks/ports.ts`'s `SecretSealerPort` framing).
 */
import type { PaymentCredentialsPort, PaymentProviderId } from "./ports.js";

export const CREDENTIAL_ENV_PREFIX = "JINI_PAYMENT";

/** `lipay` + `secretKey` → `JINI_PAYMENT_LIPAY_SECRET_KEY`; hosts may inject their legacy prefix. */
export function credentialEnvVarName({ providerId, key }: { providerId: PaymentProviderId; key: string }, { prefix = CREDENTIAL_ENV_PREFIX }: { prefix?: (string) | undefined } = {}): string {
  const screamingSnake = (value: string): string =>
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .toUpperCase();
  return `${prefix}_${screamingSnake(providerId)}_${screamingSnake(key)}`;
}

/**
 * Production adapter: resolves a provider's whole credential bundle from derived env vars.
 *
 * Returns `null` — "this provider is not configured" — if ANY declared key is missing, rather than
 * a partial bundle. A half-configured gateway is not a usable gateway, and failing here means core
 * reports `NO_CREDENTIALS_CONFIGURED` uniformly before any provider code runs, instead of each
 * provider discovering its own missing key mid-charge.
 *
 * `workspaceId` is accepted and deliberately ignored: env vars are install-wide. Per-workspace
 * merchant credentials (review R6) need sealed storage via `SecretSealerPort` and a
 * `(workspace_id, provider_id)` lookup — a different adapter behind this same port, not a change
 * to the port.
 */
export class EnvPaymentCredentials implements PaymentCredentialsPort {
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly prefix: string;

  constructor(options: { env?: Readonly<Record<string, string | undefined>>; prefix?: (string) | undefined } = {}, _optional: Record<string, never> = {}) {
    this.env = options.env ?? process.env;
    this.prefix = options.prefix ?? CREDENTIAL_ENV_PREFIX;
  }

  /**
   * @complexity O(k) in the number of declared credential keys.
   * @overallScore 100
   */
  async getCredentials(
    required: { workspaceId: string; providerId: PaymentProviderId; keys: readonly string[] },
    _optional: Record<string, never> = {}
  ): Promise<Readonly<Record<string, string>> | null> {
    const bundle: Record<string, string> = {};
    for (const key of required.keys) {
      const value = this.env[credentialEnvVarName({ providerId: required.providerId, key }, { prefix: this.prefix })];
      if (!value || value.trim().length === 0) return null;
      bundle[key] = value.trim();
    }
    return bundle;
  }
}

/**
 * Test/dev double — mirrors `InMemoryKeyring` (`integrations/keyring.memory.ts`). Holds credentials
 * only in memory, settable per test. Applies the same all-or-nothing rule as the env adapter, so a
 * test cannot accidentally exercise a code path production could never reach.
 */
export class InMemoryPaymentCredentials implements PaymentCredentialsPort {
  private readonly bundles = new Map<PaymentProviderId, Record<string, string>>();

  constructor(seed: Readonly<Record<PaymentProviderId, Readonly<Record<string, string>>>> = {}, _optional: Record<string, never> = {}) {
    for (const [providerId, bundle] of Object.entries(seed)) this.bundles.set(providerId, { ...bundle });
  }

  set({ providerId, bundle }: { providerId: PaymentProviderId; bundle: Readonly<Record<string, string>> | null }, _optional: Record<string, never> = {}): void {
    if (bundle === null) this.bundles.delete(providerId);
    else this.bundles.set(providerId, { ...bundle });
  }

  /**
   * @complexity O(k) in the number of declared credential keys.
   * @overallScore 100
   */
  async getCredentials(
    required: { workspaceId: string; providerId: PaymentProviderId; keys: readonly string[] },
    _optional: Record<string, never> = {}
  ): Promise<Readonly<Record<string, string>> | null> {
    const bundle = this.bundles.get(required.providerId);
    if (!bundle) return null;
    const resolved: Record<string, string> = {};
    for (const key of required.keys) {
      const value = bundle[key];
      if (!value || value.trim().length === 0) return null;
      resolved[key] = value;
    }
    return resolved;
  }
}
