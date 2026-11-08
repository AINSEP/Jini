import { ApiConnectionError } from './errors.js';
import { createApiConnectionGenerationReader, deriveApiConnectionKey } from './keys.js';
import { waitForHostedSignIn } from './hosted-sign-in.js';
import type { ApiConnectionIntent } from './types.js';
import type { CompletedAuthorization } from './finish-authorization.js';
import type { ApiConnectionSignInLink, ApiConnectionConnectMessages, DeclaredApiConnection } from './host-ports.js';
import { ToolInputError } from "@jini-ai/core";

import type { ApiConnectionHost } from "./host.js";

/**
 * @file The plugin-declared API-connection branch of `agent_plugin_connect` (the single sign-in
 * entry point): start the generic sign-in, hand the card its link, and wait for the result.
 *
 * Hosted: the card links to the host's sign-in link (`browser-binding.ts`), which binds the browser
 * and redirects to the provider; the provider returns to the public callback route, which completes the sign-in; this call
 * watches the connection record until its credential generation moves past the one it started from
 * and it reads `connected`. Desktop: an ephemeral 127.0.0.1 loopback listener (Jini's installed-app
 * receiver) catches the redirect and this call completes it itself. The card's link opens in the
 * system browser through the desktop shell's existing external-link policy, so nothing here launches
 * a browser. Results carry a status and the opaque `connectionRef` only, never a token, code or URL. At most one desktop listener
 * per connection is pending: a newer sign-in closes the previous one.
 */

export interface ApiConnectionConnectDeps {
  readonly host: ApiConnectionHost;
}

/**
 * `connectionRef` is the opaque, plugin-scoped key the plugin's tools take as input. It is not a
 * secret: the host refuses it for any plugin that does not declare the connection in this workspace.
 * Returned in both states so a later call can use it once the person finishes signing in.
 */
export type ApiConnectionConnectStatus = { readonly status: "connected" | "waiting-for-sign-in"; readonly connectionRef: string };

interface ConnectRun {
  readonly signInLink: ApiConnectionSignInLink;
  readonly messages: ApiConnectionConnectMessages;
  readonly deps: ApiConnectionConnectDeps;
  readonly connection: DeclaredApiConnection;
  readonly actorId: string;
  readonly destination?: "site" | "shared" | undefined;
  /** Shows the waiting card with the sign-in link; returns once it is on screen. */
  readonly showSignIn: (input: { readonly signInUrl: string }) => Promise<void>;
  readonly signal: AbortSignal;
  readonly pollIntervalMs: number;
  readonly waitTimeoutMs: number;
}

/** API-connection refusals carry safe, actionable messages; surface them as caller-facing input errors. */
function asToolError({ error, messages }: { error: unknown; messages: ApiConnectionConnectMessages }): never {
  if (error instanceof ApiConnectionError) throw new ToolInputError({ message: messages.toolError({ message: error.message }) });
  throw error;
}

/** A started sign-in. Desktop also carries its own completion; hosted completes at the public callback. */
export interface ApiConnectionSignInStart {
  /** The link the person opens: desktop, the provider's URL (system browser); hosted, this host's sign-in link. */
  readonly authorizationUrl: string;
  /** The service's opaque attempt id: what plugin code and frames get, never the OAuth `state`. */
  readonly attemptId: string;
  readonly expiresAt: string;
  /** Desktop only: the redeemed sign-in, or null when the loopback callback never came (timeout, abort, refusal). */
  readonly completion?: Promise<CompletedAuthorization | null>;
}

/**
 * Starts one sign-in for a declared connection: the generic start with the caller's declared start
 * parameters (Jini refuses undeclared ones), on the runtime's redirect. Desktop arms Jini's
 * 127.0.0.1 loopback receiver first (it closes on its callback, `timeoutMs` or `signal`) and
 * redeems the callback itself, returning the plugin's declared callback fields with the result.
 * Shared by `agent_plugin_connect` and the admin-surface connection port.
 * @complexity One start; desktop adds one loopback listener and, later, one exchange.
 */
export async function startApiConnectionSignIn(
  required: SignInRequest,
  optional: SignInOptions = {},
): Promise<ApiConnectionSignInStart> {
  if (required.host.runtime === "desktop") return startDesktopSignIn(required, optional);
  if (required.destination === "shared") throw new ApiConnectionError({ code: 'connection-not-found', message: required.messages.sharedUnavailable });
  const { host, connection, actorId, intent, scopeSetIds } = required;
  // The service first: its setup refusals (no client configured) come before the callback address's.
  const service = host.serviceFor({ connection });
  const callbackUrl = host.hostedCallbackUrl({ connection });
  const start = await service.start(
    { workspaceId: host.workspaceId, actorId, intent, scopeSetIds, redirectUri: callbackUrl }, startOptionsOf(optional));
  // Hosted hands out the host's own link (`browser-binding.ts`): opening it as this admin sets the
  // browser binding, then redirects to the provider. The provider URL and the binding stay here.
  const { authorizationUrl, browserBinding, expiresAt } = start;
  const handoffId = host.signInHandoffs.issue({ authorizationUrl, browserBinding, actorId, expiresAt });
  return { authorizationUrl: required.signInLink({ callbackUrl, workspaceId: host.workspaceId, handoffId }), attemptId: start.attemptId, expiresAt };
}

interface SignInRequest {
  readonly signInLink: ApiConnectionSignInLink;
  readonly messages: ApiConnectionConnectMessages;
  readonly host: ApiConnectionHost; readonly connection: DeclaredApiConnection; readonly actorId: string;
  readonly destination?: "site" | "shared" | undefined; readonly intent: ApiConnectionIntent; readonly scopeSetIds: readonly string[];
}

interface SignInOptions {
  readonly startParams?: Readonly<Record<string, string>>; readonly timeoutMs?: number; readonly signal?: AbortSignal;
}

const startOptionsOf = (optional: SignInOptions) => (optional.startParams === undefined ? {} : { startParams: optional.startParams });

/** Per host (one per workspace), the listener of each connection's pending desktop sign-in. */
const pendingDesktopSignIns = new WeakMap<ApiConnectionHost, Map<string, AbortController>>();

/**
 * One pending desktop sign-in per connection (cancel-previous): a new one closes the previous
 * listener, so repeated clicks never stack 127.0.0.1 listeners that each wait out their timeout.
 * The previous attempt could not complete anyway once a newer one started.
 * @returns Frees the slot, only while it still holds this listener. @complexity O(1).
 */
function claimLoopbackSlot(host: ApiConnectionHost, connection: DeclaredApiConnection, listening: AbortController): () => void {
  const slots = pendingDesktopSignIns.get(host) ?? new Map<string, AbortController>();
  pendingDesktopSignIns.set(host, slots);
  const key = deriveApiConnectionKey({ workspaceId: host.workspaceId, pluginId: connection.pluginId, connectionId: connection.descriptor.connectionId });
  slots.get(key)?.abort();
  slots.set(key, listening);
  return () => { if (slots.get(key) === listening) slots.delete(key); };
}

/** A desktop start always carries its own completion (the loopback callback, redeemed here). */
type DesktopSignInStart = ApiConnectionSignInStart & { readonly completion: Promise<CompletedAuthorization | null> };

async function startDesktopSignIn(required: SignInRequest, optional: SignInOptions): Promise<DesktopSignInStart> {
  const { host, connection, actorId, intent, scopeSetIds } = required;
  const listening = new AbortController();
  const stop = (): void => listening.abort();
  const free = claimLoopbackSlot(host, connection, listening);
  const release = (): void => { free(); optional.signal?.removeEventListener("abort", stop); };
  optional.signal?.addEventListener("abort", stop, { once: true });
  try {
    const receiver = await host.startLoopback({}, {
      callbackFields: connection.descriptor.callbackFields.map((field) => field.name), signal: listening.signal,
      ...(optional.timeoutMs === undefined ? {} : { timeoutMs: optional.timeoutMs }),
    });
    const target = await host.prepareSignIn({ connection, actorId, destination: required.destination, redirectUri: receiver.redirectUri });
    const service = target.service;
    const start = await service.start({ workspaceId: target.workspaceId, actorId, intent, scopeSetIds, redirectUri: receiver.redirectUri }, startOptionsOf(optional));
    // `state` and `browserBinding` stay here: the receiver that gets the callback is this process,
    // so both go straight back to `complete`, never into the result.
    const { state, browserBinding } = start;
    const completion = receiver.receive({ expectedState: state }).then(
      (callback) => service.complete({ workspaceId: target.workspaceId, actorId, redirectUri: receiver.redirectUri, callbackParams: { ...callback.fields, state, code: callback.code }, browserBinding }).then(async done => { await target.onCompleted(); return done; }),
      () => null,
    ).finally(release);
    return { authorizationUrl: start.authorizationUrl, attemptId: start.attemptId, expiresAt: start.expiresAt, completion };
  } catch (error) {
    // Nothing will arm the listener now: close it instead of leaving it to its timeout.
    stop();
    release();
    throw error;
  }
}

async function connectHosted(run: ConnectRun, scopeSetIds: readonly string[]): Promise<boolean> {
  const { host } = run.deps;
  const connectionRef = deriveApiConnectionKey({ workspaceId: host.workspaceId, pluginId: run.connection.pluginId, connectionId: run.connection.descriptor.connectionId });
  const readGeneration = createApiConnectionGenerationReader({ records: host.records });
  const startGeneration = await readGeneration({ key: connectionRef });
  const start = await startApiConnectionSignIn({ host, connection: run.connection, actorId: run.actorId, intent: "connect", scopeSetIds, signInLink: run.signInLink, messages: run.messages }).catch((error: unknown) => asToolError({ error, messages: run.messages }));
  // Built only after the start: building it first threw its setup refusals (no callback origin, no
  // client secret) raw, past the `ToolInputError` mapping above.
  const service = host.serviceFor({ connection: run.connection });
  await run.showSignIn({ signInUrl: start.authorizationUrl });
  return waitForHostedSignIn({
    workspaceId: host.workspaceId, connectionRef, startGeneration, getStatus: service.getStatus, readGeneration,
    signal: run.signal, pollIntervalMs: run.pollIntervalMs, waitTimeoutMs: run.waitTimeoutMs,
  });
}

/**
 * Desktop: loopback receiver, consent in the system browser, completion here. The listener always
 * closes: this call's own controller also closes it when the card cannot be shown or the run ends,
 * not only on `run.signal`, so a failed card never leaves a 127.0.0.1 listener up for its timeout.
 */
async function connectDesktop(run: ConnectRun, scopeSetIds: readonly string[]): Promise<boolean> {
  const { host } = run.deps;
  const listening = new AbortController();
  const stop = (): void => listening.abort();
  run.signal.addEventListener("abort", stop, { once: true });
  try {
    // `runApiConnectionConnect` takes this path only for a desktop host, so the desktop start is
    // called directly and its completion is always present (no "no completion" case to handle).
    const start = await startDesktopSignIn({ host, connection: run.connection, actorId: run.actorId, intent: "connect", scopeSetIds, destination: run.destination, signInLink: run.signInLink, messages: run.messages }, {
      timeoutMs: run.waitTimeoutMs, signal: listening.signal,
    }).catch((error: unknown) => asToolError({ error, messages: run.messages }));
    await run.showSignIn({ signInUrl: start.authorizationUrl });
    return (await start.completion.catch((error: unknown) => asToolError({ error, messages: run.messages }))) !== null;
  } finally {
    run.signal.removeEventListener("abort", stop);
    stop();
  }
}

/**
 * Connects one declared API connection. Already connected with every scope it would request:
 * returns `connected` with no sign-in, like the MCP branch does for a connected server.
 * @throws {ToolInputError} The connection refused to start or complete (safe message, next step).
 * @complexity One status read, one sign-in round trip bounded by `waitTimeoutMs`.
 */
export async function runApiConnectionConnect(
  required: ConnectRun,
  _optional: Record<string, never> = {},
): Promise<ApiConnectionConnectStatus> {
  const { host } = required.deps;
  const { connection } = required;
  // Chat connects the plugin's base scopes; products add theirs from the plugin's own panel.
  const scopeSetIds: readonly string[] = [];
  const status = await host.statusOf({ connection, local: required.destination === "site" });
  const { connectionRef } = status;
  const wanted = await host.requestedScopes({ connection, scopeSetIds });
  if (required.destination !== "shared" && status.status === "connected" && wanted.every((scope) => status.grantedScopes.includes(scope))) {
    if (required.destination === "site") await host.sharedOAuth?.selectLocal(connection);
    return { status: "connected", connectionRef };
  }
  const connected = host.runtime === "desktop" ? await connectDesktop(required, scopeSetIds) : await connectHosted(required, scopeSetIds);
  return { status: connected ? "connected" : "waiting-for-sign-in", connectionRef };
}

