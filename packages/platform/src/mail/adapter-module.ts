import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { MailerPort } from "./ports.js";

export interface MailAdapterCredential {
  readonly token: string;
  readonly baseUrl?: string;
  readonly username?: string;
}

export interface MailAdapterKit {
  
  /** Provider requests must use the guarded outbound HTTP seam so its egress policy applies. */
  readonly httpClient: HttpClientPort;
}

export interface MailAdapterCreateContext {
  readonly credential: MailAdapterCredential;
  readonly kit: MailAdapterKit;
  /** Sample at the point of use. Hosts normalize this to the real clock when omitted. */
  readonly now?: () => Date;
  /** Per-install configuration; only the provider module owns its schema and validation. */
  readonly settings?: unknown;
}

/**
 * Normalize a host's module context without inspecting settings or replacing its guarded ports.
 * The optional fields on {@link MailAdapterCreateContext} preserve legacy direct create calls;
 * hosts use this boundary to supply both defaults before invoking a provider module.
 * @param required Sending credential and guarded adapter kit, passed through unchanged.
 * @param optional Clock and opaque per-install settings. Only undefined selects a default.
 * @returns A context with a live clock and settings (a fresh empty object when omitted).
 * @complexity O(1) time and space; does not sample the clock or perform I/O.
 * @example provider.create(createMailAdapterContext({ credential, kit }, { now, settings }));
 */
export function createMailAdapterContext(
  required: { credential: MailAdapterCredential; kit: MailAdapterKit },
  { now = () => new Date(), settings = {} }: Pick<MailAdapterCreateContext, "now" | "settings"> = {},
): Required<MailAdapterCreateContext> {
  return { credential: required.credential, kit: required.kit, now, settings };
}

/** Provider modules return the ordinary mail port; the shared contract names no vendor. */
export interface MailAdapterModule {
  /** Optional host-resolved account connection for domain reads only. The host validates the
   * HTTPS origin and plugin ownership; this credential must never replace the sending key. */
  readonly domainReadConnection?: { readonly serverId: string; readonly baseUrl: string };
  create(context: MailAdapterCreateContext): MailerPort;
}
