import type { FormDeliveryBinding, FormDeliveryConnectionPort, FormDeliveryErrorCode, FormDestinationCredential } from "@jini-ai/core/contracts/site/cms-forms";
import { ConnectionBudgetExceededError } from "./budgets.js";
import { ApiConnectionError } from "./errors.js";
import type { ApiConnectionHost } from "./host.js";

/**
 * @file The OAuth implementation of the form-delivery `FormDeliveryConnectionPort`: a push
 * destination's binding stores only a `connectionRef`; each delivery attempt resolves a fresh access
 * token here, immediately before its HTTP call. Jobs never hold tokens. The site composes it ahead of
 * the saved-custom-credential port (in the host's form-delivery deliverer). The ref
 * must belong to the plugin that contributes the binding's adapter, so one plugin's destination can
 * never spend another plugin's connection.
 *
 * A job freezes the account it was set up with: an OAuth binding names it as `config.accountId`, and
 * the binding is frozen into every job at planning. After a confirmed account switch the same ref
 * holds another account, and a frozen job is refused (`authorization-required`) instead of silently
 * delivering there. A binding with no account is refused (`configuration-invalid`), so a job can
 * never "follow" whatever account the ref holds today. `getAccessToken` reads a token per provider
 * request so the connection's request budgets count every request, not one per delivery.
 *
 * Only a delivery code leaves this port on a refusal: the ledger keeps the bare code, so a refusal
 * the person must act on (reconnect, sign in again, switch back) is `authorization-required` and
 * not retried, and a refused budget charge is `rate-limited` with the host's wait.
 */

/**
 * A delivery credential plus the extra origins the push kit may reach with it (origins, like custom
 * credentials). `token` is this attempt's read (the contract's field); `getAccessToken` is one read
 * per provider request, on the same frozen account (its first call returns `token`).
 */
export type OAuthFormDeliveryCredential = FormDestinationCredential & {
  readonly additionalHosts: readonly string[];
  readonly getAccessToken: () => Promise<string>;
};

/** The forms port, answering with the OAuth credential shape. */
export type OAuthFormDeliveryConnectionPort = (
  required: Parameters<FormDeliveryConnectionPort>[0],
  optional?: Parameters<FormDeliveryConnectionPort>[1],
) => Promise<OAuthFormDeliveryCredential | null>;

/**
 * The host's forms delivery error (`FormDeliveryError` from the forms ledger), built from a bare
 * delivery code. Injected: the ledger owns the class this port's refusals must be instances of.
 */
export type OAuthFormDeliveryErrorFactory = (required: {
  readonly code: FormDeliveryErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly outcome: "not-applied";
}) => Error;

/** The two host reads this port makes: the declared connection for a ref, and a scoped token reader. */
export type OAuthFormDeliveryHost = Pick<ApiConnectionHost, "declaredFor" | "accessTokensFor">;

/** API-connection refusals no retry can fix: a person reconnects, signs in or switches back first. */
const NEEDS_A_PERSON: ReadonlySet<string> = new Set(["connection-not-found", "not-connected", "reconnect-required", "revocation-pending", "account-changed"]);

/**
 * The delivery code a token-read failure is recorded as; any other failure is returned unchanged
 * (the forms ledger turns it into a retryable `delivery-failed`, without its text).
 * @complexity O(1).
 */
function asDeliveryError({ error, deliveryError }: { error: unknown; deliveryError: OAuthFormDeliveryErrorFactory }, _optional = {}): unknown {
  if (error instanceof ConnectionBudgetExceededError) return deliveryError({ code: "rate-limited", retryable: true, retryAfterMs: error.retryAfterMs, outcome: "not-applied" });
  if (error instanceof ApiConnectionError && NEEDS_A_PERSON.has(error.code)) return deliveryError({ code: "authorization-required", retryable: false, outcome: "not-applied" });
  return error;
}

/**
 * The account the job's frozen binding was set up with.
 * @throws FormDeliveryError `configuration-invalid` when the binding names none (fail closed).
 * @complexity O(1).
 */
function frozenAccountOf({ binding, deliveryError }: { binding: FormDeliveryBinding | undefined; deliveryError: OAuthFormDeliveryErrorFactory }, _optional = {}): string {
  const accountId = binding?.config.accountId;
  if (typeof accountId !== "string" || accountId === "") throw deliveryError({ code: "configuration-invalid", retryable: false, outcome: "not-applied" });
  return accountId;
}

/** Hands out the attempt's first token once, then a fresh read per call. @complexity O(1) per call. */
function perRequestTokens({ first, read }: { first: string; read: () => Promise<string> }, _optional = {}): () => Promise<string> {
  let unused: string | undefined = first;
  return async () => {
    const token = unused;
    unused = undefined;
    return token ?? read();
  };
}

/**
 * @param required.hostFor - The workspace's API-connection host, or null when it has none.
 * @param required.adapterPluginId - Which plugin contributes a form-destination adapter id; null when none.
 * @param required.deliveryError - Builds the host's forms delivery error for a refusal code.
 * @returns null for a ref this port does not own (so a composite port can try static credentials);
 *   otherwise the access token as the credential, with the connection's declared `apiOrigins` as
 *   `baseUrl` (the first) and `additionalHosts` (the rest).
 * @throws FormDeliveryError `configuration-invalid` for an owned ref whose binding names no account;
 *   `authorization-required` when the first read needs a person (see `NEEDS_A_PERSON`); `rate-limited`
 *   when the connection's budget refuses it. Later per-request reads throw the host's own errors,
 *   which the plugin maps itself.
 * @complexity One contribution load plus one token read; each later request is one token read.
 */
export function createOAuthFormDeliveryConnectionPort(
  required: {
    readonly hostFor: (input: { readonly workspaceId: string }) => OAuthFormDeliveryHost | null;
    readonly adapterPluginId: (input: { readonly workspaceId: string; readonly adapterId: string }) => Promise<string | null>;
    readonly deliveryError: OAuthFormDeliveryErrorFactory;
  },
  _optional: Record<string, never> = {},
): OAuthFormDeliveryConnectionPort {
  /** The host and owning plugin when this port owns the ref (the adapter's plugin declares it here). */
  async function owner({ workspaceId, connectionRef, adapterId }: { workspaceId: string; connectionRef: string; adapterId: string }, _optional = {}) {
    const host = required.hostFor({ workspaceId });
    const pluginId = host ? await required.adapterPluginId({ workspaceId, adapterId }) : null;
    const declared = host && pluginId ? await host.declaredFor({ pluginId, connectionRef }) : undefined;
    return host && pluginId && declared ? { host, pluginId, declared } : null;
  }

  return async ({ workspaceId, connectionRef, adapterId }, optional = {}) => {
    const owned = await owner({ workspaceId, connectionRef, adapterId });
    if (!owned) return null;
    const { host, pluginId, declared } = owned;
    const frozen = { expectedAccountId: frozenAccountOf({ binding: optional.binding, deliveryError: required.deliveryError }) };
    const read = () => host.accessTokensFor({ pluginId }).getAccessToken({ connectionRef }, frozen);
    const token = await read().catch((error: unknown) => Promise.reject(asDeliveryError({ error, deliveryError: required.deliveryError })));
    // The push kit allows the base URL's origin plus each `additionalHosts` entry compared as an
    // exact origin; an OAuth destination reaches only the https origins its plugin declared on the
    // connection (none declared: nothing allowed).
    const [baseUrl = "", ...additionalHosts] = declared.apiOrigins;
    return { token, baseUrl, additionalHosts, getAccessToken: perRequestTokens({ first: token, read }) };
  };
}
