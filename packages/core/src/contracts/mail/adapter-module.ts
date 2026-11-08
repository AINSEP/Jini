import type { HttpClientPort } from '../../primitives/index.js';
import type { MailerPort } from './ports.js';
/** @agent-note Types only. The runtime parts come from the host; this area usually from `@jini-ai/platform`. */



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


/** Provider modules return the ordinary mail port; the shared contract names no vendor. */
export interface MailAdapterModule {
  /** Optional host-resolved account connection for domain reads only. The host validates the
   * HTTPS origin and plugin ownership; this credential must never replace the sending key. */
  readonly domainReadConnection?: { readonly serverId: string; readonly baseUrl: string };
  create(context: MailAdapterCreateContext): MailerPort;
}
