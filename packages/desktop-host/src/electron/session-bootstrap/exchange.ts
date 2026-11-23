/**
 * @file The cookie exchange: one request bound to a partition's `Session`, so whatever cookie the
 * server answers with lands in that partition's own jar.
 *
 * `useSessionCookies: true` is what makes this work without any manual `Set-Cookie` parsing or
 * `cookies.set()` call: the request goes through Chromium's network stack bound to that session, so
 * the response's cookie is stored exactly as it would be for a real navigation, including the
 * `Secure` attribute, which Chromium accepts over loopback because `127.0.0.1` is a trustworthy
 * origin. Dropping it makes the whole mechanism a silent no-op while every other signal still looks
 * healthy, so a test is pinned to it.
 *
 * Never rejects for an auth or transport outcome: a non-`200` and a transport error both resolve
 * `{ok: false}`, so the host falls through to its ordinary login screen. The host owns the URL (and
 * must guard it, e.g. loopback-only, BEFORE calling), the body, the outcome label, and the text a
 * transport error becomes (`describeError`): the caught error goes to the host raw.
 */
import type { SessionBodyRequest, SessionNet, SessionOutcome, SessionRequest, SessionResponse } from './types.js';

/** The host's text for a transport error, stored as the outcome's `reason`. */
type DescribeTransportError = (args: { error: Error }) => string;

/** Attach the outcome listeners. Resolves only on `end`: headers and a partial body are not a
 *  completed exchange. */
function settle({ request, label, describeError, resolve }: {
  request: SessionRequest;
  label: string;
  describeError: DescribeTransportError;
  resolve: (outcome: SessionOutcome) => void;
}, _optional: Record<string, never> = {}): void {
  request.on('response', (response: SessionResponse) => {
    // Drained rather than parsed: nothing here needs the body, and an undrained response holds the
    // socket open.
    response.on('data', () => {});
    response.on('end', () =>
      resolve(
        response.statusCode === 200
          ? { ok: true, status: 200 }
          : { ok: false, status: response.statusCode, reason: `${label} responded ${response.statusCode}` },
      ),
    );
  });
  request.on('error', (error: Error) => resolve({ ok: false, reason: describeError({ error }) }));
}

/**
 * Send a body-less request through `required.session`'s cookie jar and report its outcome.
 * @param required.label names the exchange in a non-`200` reason (`"<label> responded <status>"`).
 * @param required.describeError the host's `reason` text for a transport error.
 * @complexity O(1) — one request.
 */
export function exchangeSessionRequest<TSession>(required: {
  net: SessionNet<TSession>;
  session: TSession;
  method: 'GET' | 'POST';
  url: string;
  label: string;
  describeError: DescribeTransportError;
}, _optional: Record<string, never> = {}): Promise<SessionOutcome> {
  return new Promise((resolve) => {
    const request = required.net.request({ method: required.method, url: required.url, session: required.session, useSessionCookies: true });
    settle({ request, label: required.label, describeError: required.describeError, resolve });
    request.end();
  });
}

/**
 * POST an already-serialised JSON `body` through `required.session`'s cookie jar and report its
 * outcome — the exchange that redeems a credential for a session cookie.
 * @complexity O(1) — one request.
 */
export function exchangeSessionJson<TSession>(required: {
  net: SessionNet<TSession, SessionBodyRequest>;
  session: TSession;
  url: string;
  body: string;
  label: string;
  describeError: DescribeTransportError;
}, _optional: Record<string, never> = {}): Promise<SessionOutcome> {
  return new Promise((resolve) => {
    const request = required.net.request({ method: 'POST', url: required.url, session: required.session, useSessionCookies: true });
    request.setHeader('Content-Type', 'application/json');
    settle({ request, label: required.label, describeError: required.describeError, resolve });
    request.write(required.body);
    request.end();
  });
}
