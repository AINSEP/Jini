import type { ProviderResult } from "@jini-ai/core/provider-registry";
import type { MailAdapterCredential } from "./adapter-module.js";
import type { MailProviderCallContext } from "./provider.js";

/** The active provider's plugin can supply a separate, read-capable account credential. */
export type MailDomainReadCredentialPort = (required: { id: string }, options?: Record<string, never>) => Promise<MailAdapterCredential | null>;

/** Only permission refusals justify asking for a more capable account connection. */
export function isDomainReadPermissionRefused(required: { result: ProviderResult<unknown> }, _options: Record<string, never> = {}): boolean {
  const { result } = required;
  return result.status === "rejected" && result.error.code === "forbidden";
}

/** Read with the sending key first, then the plugin's account key on a permission refusal.
 * The replacement context is read-only and never reaches the sending mailer.
 * @complexity At most two provider reads and one account-credential lookup. */
export async function readMailDomain<T>(required: {
  ctx: MailProviderCallContext; providerId: string;
  read: (ctx: MailProviderCallContext) => Promise<ProviderResult<T>>;
  resolveDomainReadCredential?: MailDomainReadCredentialPort;
}, _options: Record<string, never> = {}): Promise<ProviderResult<T>> {
  const { ctx, providerId, read, resolveDomainReadCredential } = required;
  const result = await read(ctx);
  if (!isDomainReadPermissionRefused({ result }) || !resolveDomainReadCredential) return result;
  const credential = await resolveDomainReadCredential({ id: providerId }).catch(() => null);
  return credential ? read({ ...ctx, credential }) : result;
}
