/**
 * @file Structural slices of Electron's `net`, `ClientRequest`, `IncomingMessage` and `Session`
 * that the session bootstrap reads. Declared here rather than imported from `electron` so the
 * mechanics are testable against fakes and this entry never loads the Electron runtime.
 */

/** What an exchange resolves with: `ok` only for a `200`; a transport error carries no status. */
export interface SessionOutcome {
  ok: boolean;
  status?: number;
  reason?: string;
}

/** The slice of a `Session` read here: its cookie jar's lookup. */
export interface CookieJarSession {
  cookies: { get(filter: { name: string }): Promise<unknown[]> };
}

/** What `net.request` is given, a subset of Electron's `ClientRequestConstructorOptions`. The
 *  session is only handed through to the request, so its type is whatever the caller's is. */
export interface SessionRequestOptions<TSession> {
  method: 'GET' | 'POST';
  url: string;
  session: TSession;
  useSessionCookies: boolean;
}

/** The slice of an `IncomingMessage` read here. */
export interface SessionResponse {
  statusCode: number;
  on(event: 'data', listener: () => void): unknown;
  on(event: 'end', listener: () => void): unknown;
}

/** The slice of a `ClientRequest` every request here uses. */
export interface SessionRequest {
  on(event: 'response', listener: (response: SessionResponse) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  end(): void;
}

/** A request that also sends a JSON body. */
export interface SessionBodyRequest extends SessionRequest {
  setHeader(name: string, value: string): void;
  write(chunk: string): void;
}

/** The slice of Electron's `net` module used here, answering with `TRequest`. */
export interface SessionNet<TSession, TRequest extends SessionRequest = SessionRequest> {
  request(options: SessionRequestOptions<TSession>): TRequest;
}

/** The slice of a `Session`'s `webRequest` that header arming registers on. */
export interface HeaderArmingSession {
  webRequest: {
    onBeforeSendHeaders(
      filter: { urls: string[] },
      listener: (
        details: { url: string; requestHeaders: Record<string, string> },
        callback: (response: { requestHeaders: Record<string, string> }) => void,
      ) => void,
    ): void;
  };
}
