import { useSyncExternalStore } from "react";

/** What the host's reconnect store reports about its API server. */
export type ServerConnectionStatus = "online" | "reconnecting" | "unreachable";

/** The slice of the host's reconnect store the banner reads (a `useSyncExternalStore` source). */
export interface ServerConnectionStatusPort {
  subscribe(listener: () => void): () => void;
  getStatus(): ServerConnectionStatus;
}

/** What the banner shows for each status; `null` = nothing (the server is answering). Host copy: it may
 *  name the product and its server. */
export type ServerConnectionBannerText = Readonly<Record<ServerConnectionStatus, string | null>>;

/**
 * The live server-connection status from the host's reconnect store and the banner line for it.
 * @param required.reconnect - The host's reconnect store; no default, the host owns the one instance.
 * @param required.text - The host's banner copy per status.
 */
export function useServerConnectionBanner(
  required: { reconnect: ServerConnectionStatusPort; text: ServerConnectionBannerText },
  _optional: Record<string, never> = {},
): { status: ServerConnectionStatus; text: string | null } {
  const { reconnect } = required;
  const status = useSyncExternalStore(reconnect.subscribe, reconnect.getStatus, reconnect.getStatus);
  return { status, text: required.text[status] };
}
