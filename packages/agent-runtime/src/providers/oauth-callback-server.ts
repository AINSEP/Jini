/**
 * @module providers/oauth-callback-server
 *
 * One-shot HTTP listener for an OAuth PKCE redirect callback — opens a
 * loopback listener, accepts a single `GET <path>?code=...&state=...`,
 * validates `state` against the in-flight dance, invokes `onCallback`, then
 * closes itself (or times out after a configurable window).
 *
 * Ported from OD's `integrations/xai-oauth-server.ts`, de-branded: the
 * origin hardcoded xAI's fixed callback port/host/path as module constants
 * and had the origin product's own name baked into the result-page HTML
 * (see `archived provenance ledger` for the exact original strings). Both are now
 * caller-supplied — `host`/`port`/
 * `path` are required input fields instead of defaulted constants (a
 * provider whose OAuth client_id is locked to a specific redirect URI, like
 * xAI's, supplies that provider's fixed port via
 * `oauth-provider.ts`'s preset), and the result page uses generic "the host
 * application" copy with no product name. Listener mechanics are otherwise
 * unchanged.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

export type OAuthCallbackOutcome =
  | { kind: 'ok'; code: string; state: string }
  | { kind: 'error'; error: string; state?: string };

export interface StartOAuthCallbackListenerInput {
  host: string;
  port: number;
  path: string;
  expectedState: string;
  onCallback: (outcome: OAuthCallbackOutcome) => Promise<void> | void;
  timeoutMs?: number;
}

export interface OAuthCallbackListener {
  /** Where the listener is actually bound (informational, esp. for tests). */
  readonly address: { host: string; port: number };
  /** Stops the listener early (e.g. the user cancelled OAuth in the UI). */
  stop(): Promise<void>;
}

/**
 * Opens a one-shot HTTP listener for an OAuth redirect callback.
 *
 * Resolves once the listener is bound; callback handling is asynchronous
 * via `onCallback`. The listener self-closes after the first matching
 * callback OR after `timeoutMs` (default 30 min), whichever comes first.
 */
export async function startOAuthCallbackListener(requiredArgs: Pick<StartOAuthCallbackListenerInput, "host" | "port" | "path" | "expectedState" | "onCallback">, optionalArgs: Omit<StartOAuthCallbackListenerInput, "host" | "port" | "path" | "expectedState" | "onCallback"> = {}
): Promise<OAuthCallbackListener> {
  const input: StartOAuthCallbackListenerInput = { ...optionalArgs, ...requiredArgs };
  const { host, port, path: callbackPath } = input;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let consumed = false;
  let stopped = false;
  let serverRef: http.Server | null = null;
  let timer: NodeJS.Timeout | null = null;

  const closeServer = () =>
    new Promise<void>((resolve) => {
      // Non-null: `stop()` (this function's only caller) guards on `stopped`
      // before ever reaching here, so this runs at most once — after
      // `serverRef` was unconditionally set at listener-startup, before this
      // closure's `stop`/`address` are ever handed to a caller.
      const s = serverRef!;
      serverRef = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      s.close(() => resolve());
      // Force close after a short grace period so lingering keep-alive
      // sockets don't keep the event loop alive in tests.
      const reaper = setTimeout(() => {
        try {
          s.closeAllConnections?.();
        } catch {
          // Best-effort cleanup only: node:http's closeAllConnections()
          // doesn't document a throwing case in the supported Node range
          // this package targets — this guard exists for a future/older
          // runtime where it might, not a reachable path today.
        }
      }, 100);
      reaper.unref?.();
    });

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await closeServer();
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (consumed || !req.url) {
      res.statusCode = 410;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('Listener already consumed.');
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(req.url, `http://${host}:${port}`);
    } catch {
      res.statusCode = 400;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('Bad request.');
      return;
    }
    // Ignore favicon.ico and any other path so the browser's incidental
    // requests don't consume the slot meant for the callback path.
    if (parsed.pathname !== callbackPath) {
      res.statusCode = 404;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('Not found.');
      return;
    }

    const code = parsed.searchParams.get('code') ?? '';
    const state = parsed.searchParams.get('state') ?? '';
    const errorParam = parsed.searchParams.get('error') ?? '';

    let outcome: OAuthCallbackOutcome;
    if (errorParam) {
      outcome = state
        ? { kind: 'error', error: errorParam, state }
        : { kind: 'error', error: errorParam };
    } else if (!code || !state) {
      outcome = { kind: 'error', error: 'missing code or state' };
    } else if (state !== input.expectedState) {
      outcome = { kind: 'error', error: 'state mismatch', state };
    } else {
      outcome = { kind: 'ok', code, state };
    }

    // Decide whether this hit *consumes* the listener. A stray browser tab
    // replaying an old `?state=...` (or `?error=...&state=...`) would
    // otherwise close a shared fixed-port listener before the real redirect
    // can arrive. Keep the listener open on stale/malformed requests; the
    // real callback will still find it. Consume on:
    //   - ok callback (matched state, code present)
    //   - explicit ?error= without a state (the server rejected before
    //     issuing state, so there's nothing to match against — safe to
    //     consume)
    //   - explicit ?error= with state matching expectedState (the server
    //     told the user the dance failed; propagate now instead of waiting
    //     for the timeout)
    // An ?error= with a *mismatched* state is treated like the stale
    // success replay above: 400 the browser, leave the listener live.
    const errorConsumes =
      Boolean(errorParam) && (!state || state === input.expectedState);
    const consumesListener = outcome.kind === 'ok' || errorConsumes;
    if (consumesListener) {
      consumed = true;
    }

    res.statusCode = outcome.kind === 'ok' ? 200 : 400;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(renderResultPage(outcome));

    if (!consumesListener) {
      // Stale-tab replay or malformed request — don't surface to the
      // caller and don't tear down the listener. The browser sees the
      // 400 page; the real flow can still complete on a later hit.
      return;
    }

    try {
      await input.onCallback(outcome);
    } catch (err: unknown) {
      console.error('[oauth-callback-server] onCallback failed:', err);
    } finally {
      void stop();
    }
  };

  const server = http.createServer((req, res) => {
    void handle(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${port} is already in use — close any other process listening on ${host}:${port} (e.g. an in-flight OAuth flow) and try again`,
          ),
        );
      } else {
        reject(err);
      }
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });

  serverRef = server;
  timer = setTimeout(() => {
    Promise.resolve(
      input.onCallback({
        kind: 'error',
        error: 'OAuth timed out — sign in again',
      }),
    ).catch(() => {
      // already logging in handle(); this branch is best-effort cleanup.
    });
    void stop();
  }, timeoutMs);
  // unref so the timer doesn't keep the event loop alive in tests.
  timer.unref?.();

  const addr = server.address() as AddressInfo;
  return {
    address: { host: addr.address, port: addr.port },
    stop,
  };
}

function renderResultPage(outcome: OAuthCallbackOutcome): string {
  if (outcome.kind === 'ok') {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Authorized</title></head>
<body style="font:14px system-ui;padding:40px;max-width:480px;margin:auto;text-align:center;color:#222;">
  <h1 style="font-size:18px;margin:0 0 12px;">Authorized!</h1>
  <p style="color:#666;">The host application now has access. You can close this tab and return to it.</p>
</body></html>`;
  }
  // No `|| 'unknown error'` fallback: every 'error'-kind outcome this file
  // constructs (state/code validation, state mismatch, timeout) always sets
  // a non-empty `error` string, so the field is never falsy in practice —
  // this documents that instead of adding an unreachable fallback branch.
  const reason = escapeHtml(outcome.error);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sign-in failed</title></head>
<body style="font:14px system-ui;padding:40px;max-width:480px;margin:auto;text-align:center;color:#222;">
  <h1 style="font-size:18px;margin:0 0 12px;">Sign-in failed</h1>
  <p style="color:#c00;">${reason}</p>
  <p style="color:#666;">Close this tab and retry sign-in from the host application.</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
