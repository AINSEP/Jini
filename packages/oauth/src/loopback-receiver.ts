/**
 * @file Installed-app loopback receiver (RFC 8252 §7.3): a one-shot HTTP listener on 127.0.0.1
 * and an ephemeral port that catches a single authorization redirect from the system browser.
 *
 * It exists because a desktop host cannot register a fixed HTTPS callback; the authorization
 * server sends the browser back to `http://127.0.0.1:<port>/callback` instead. The listener is the
 * only part of the grant that faces other local processes and web pages, so it is deliberately
 * narrow: one bound address, a pinned Host, one consumed callback, bounded headers, no body,
 * a declared-field allowlist and a static close page that never echoes the request.
 *
 * Starting is separate from arming because the state is minted by `beginAuthorizationCode`,
 * which itself needs this listener's redirect URI first.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OAuthError } from './errors.js';
import { assertLoopbackConfiguration, readLoopbackCallback, routeLoopbackRequest, type LoopbackAuthorizationResult } from './loopback-callback.js';
import { MAX_AUTHORIZATION_STATE_LENGTH } from './sealed-state.js';
import type { OAuthEmptyArgs } from './args.js';

export type { LoopbackAuthorizationResult } from './loopback-callback.js';
export { MAX_CALLBACK_FIELDS, MAX_CALLBACK_FIELD_LENGTH } from './loopback-callback.js';

const LOOPBACK_HOST = '127.0.0.1';
/** Fixed: the redirect URI is `http://127.0.0.1:<port>/callback`, so no caller-supplied path is ever routed. */
const CALLBACK_PATH = '/callback';
/** Matches the pending-authorization TTL: long enough for consent and MFA, short for an abandoned tab. */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_HEADER_COUNT = 64;

/** Timer port so tests drive expiry without sleeping; `after` returns its own cancellation. */
export interface LoopbackReceiverTimers {
    after(requiredArgs: { readonly ms: number; readonly run: () => void }): () => void;
}

export interface LoopbackReceiverOptions {
    /** Extra query parameters the provider returns that the caller needs (e.g. a picked resource id). */
    readonly callbackFields?: readonly string[];
    readonly timeoutMs?: number;
    /** Aborting cancels the attempt and closes the listener. */
    readonly signal?: AbortSignal;
    readonly timers?: LoopbackReceiverTimers;
}

export interface LoopbackAuthorizationReceiver {
    readonly redirectUri: string;
    /** Arms the listener for the state `beginAuthorizationCode` returned. Call once, before opening the browser. */
    receive(requiredArgs: { readonly expectedState: string }): Promise<LoopbackAuthorizationResult>;
}

const nodeTimers: LoopbackReceiverTimers = {
    after: ({ ms, run }) => {
        const handle = setTimeout(run, ms);
        handle.unref();
        return () => clearTimeout(handle);
    },
};

const CLOSE_PAGE_HEADERS = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    connection: 'close',
} as const;
// Static on purpose: nothing from the request (error text, codes, fields) is ever rendered.
const DONE_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign-in complete</title></head><body><h1>Sign-in complete</h1><p>You can close this tab and return to the application.</p></body></html>';
const FAILED_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign-in did not finish</title></head><body><h1>Sign-in did not finish</h1><p>Close this tab and return to the application to see what to do next.</p></body></html>';

function terminal(code: 'OAUTH_AUTHORIZATION_CANCELLED' | 'OAUTH_AUTHORIZATION_EXPIRED'): OAuthError {
    return code === 'OAUTH_AUTHORIZATION_CANCELLED'
        ? new OAuthError({ code, message: 'the sign-in was cancelled before the browser returned', operatorAction: 'Start the connection again when you are ready.' })
        : new OAuthError({ code, message: 'the sign-in window expired before the browser returned', operatorAction: 'Start the connection again and finish it in the browser.' });
}

function assertTimeout(timeoutMs: number): void {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60 * 60 * 1000)
        throw new OAuthError({ code: 'OAUTH_INVALID_REQUEST', message: 'the loopback timeout must be a whole number of milliseconds up to one hour', operatorAction: 'Fix the configured sign-in timeout.' });
}

function listen(server: Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true }, () => {
            server.removeListener('error', reject);
            resolve((server.address() as AddressInfo).port);
        });
    });
}

function hasBody(req: IncomingMessage): boolean {
    return req.headers['transfer-encoding'] !== undefined || (req.headers['content-length'] ?? '0') !== '0';
}

function reply(res: ServerResponse, status: number, page: string): Promise<void> {
    return new Promise(resolve => { res.writeHead(status, CLOSE_PAGE_HEADERS).end(page, resolve); });
}

/**
 * Opens the listener and returns its redirect URI. The single callback, an abort or the expiry
 * closes it; the promise from `receive` settles only after the port is closed.
 */
export async function startLoopbackAuthorizationReceiver(_requiredArgs: OAuthEmptyArgs, optionalArgs: LoopbackReceiverOptions = {}): Promise<LoopbackAuthorizationReceiver> {
    const callbackFields = optionalArgs.callbackFields ?? [];
    const timeoutMs = optionalArgs.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    assertLoopbackConfiguration({ callbackFields });
    assertTimeout(timeoutMs);
    const { signal } = optionalArgs;
    if (signal?.aborted)
        throw terminal('OAUTH_AUTHORIZATION_CANCELLED');

    let expectedState: string | undefined;
    let done = false;
    let consumed = false;
    let settle!: (outcome: { value: LoopbackAuthorizationResult } | { error: OAuthError }) => void;
    const result = new Promise<LoopbackAuthorizationResult>((resolve, reject) => {
        settle = outcome => ('value' in outcome ? resolve(outcome.value) : reject(outcome.error));
    });
    // Callers may cancel before awaiting; a rejection nobody awaited must not crash the host.
    result.catch(() => undefined);

    const server = createServer({ maxHeaderSize: MAX_HEADER_BYTES });
    server.maxHeadersCount = MAX_HEADER_COUNT;
    const port = await listen(server);
    const expectedHost = `${LOOPBACK_HOST}:${port}`;

    const finish = (outcome: { value: LoopbackAuthorizationResult } | { error: OAuthError }): void => {
        if (done)
            return;
        done = true;
        cancelTimer();
        signal?.removeEventListener('abort', onAbort);
        server.close(() => settle(outcome));
        server.closeAllConnections();
    };
    const onAbort = (): void => finish({ error: terminal('OAUTH_AUTHORIZATION_CANCELLED') });
    const cancelTimer = (optionalArgs.timers ?? nodeTimers).after({ ms: timeoutMs, run: () => finish({ error: terminal('OAUTH_AUTHORIZATION_EXPIRED') }) });
    signal?.addEventListener('abort', onAbort, { once: true });

    server.on('request', (req: IncomingMessage, res: ServerResponse) => {
        const route = routeLoopbackRequest({
            request: { method: req.method, rawUrl: req.url, host: req.headers.host, hasBody: hasBody(req) },
            expectedHost, path: CALLBACK_PATH, armed: expectedState !== undefined && !consumed && !done,
        });
        if (route.kind === 'ignore') {
            void reply(res, route.status, FAILED_PAGE);
            return;
        }
        // Consume before any check: whatever this request says, it is the attempt's one callback.
        consumed = true;
        let outcome: { value: LoopbackAuthorizationResult } | { error: OAuthError };
        try {
            outcome = { value: readLoopbackCallback({ query: route.query, expectedState: expectedState!, callbackFields }) };
        } catch (error) {
            outcome = { error: error as OAuthError };
        }
        void reply(res, 'value' in outcome ? 200 : 400, 'value' in outcome ? DONE_PAGE : FAILED_PAGE).then(() => finish(outcome));
    });

    return {
        redirectUri: `http://${expectedHost}${CALLBACK_PATH}`,
        receive({ expectedState: state }) {
            if (expectedState !== undefined || state === '' || state.length > MAX_AUTHORIZATION_STATE_LENGTH)
                return Promise.reject(new OAuthError({ code: 'OAUTH_INVALID_REQUEST', message: 'the loopback receiver must be armed once with a non-empty state', operatorAction: 'Start the connection again from the connection settings.' }));
            expectedState = state;
            return result;
        },
    };
}
