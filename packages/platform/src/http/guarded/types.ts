export interface PinnedPeer {
  ip: string;
  port: number;
  authority: string;

  /** RFC 6066 permits hostnames in SNI, never IP literals. Undefined means omit the extension. */
  tlsServerName: string | undefined;
}

