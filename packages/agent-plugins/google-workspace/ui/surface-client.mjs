// Verbatim copy of @jini-ai/agent-plugins dist/admin-surfaces/surface-client.js (Jini db1e99fb + host theme tokens + frame height).
// The surface is plain static files served without credentials, so it carries its own copy of the
// self-contained protocol client instead of importing the package; refresh it when the protocol changes.
/**
 * @file The surface-side half of the admin-surface message protocol, for a plugin's own UI.
 *
 * Self-contained on purpose (no imports): a plugin's surface is plain static files, so it may import
 * this module from the package or copy the compiled file next to its entry. The constants repeat
 * `./protocol.ts`; the vertical-slice test proves the two still agree.
 *
 * Trust rules it applies: it accepts init only from its parent window (once), learns the host's
 * origin from that init and posts only to that origin (never "*"), and accepts a response only from
 * the parent, from that origin, for this mount, for a request it still has pending, in a valid shape.
 *
 * Theme: the host may send its design tokens with init and again in `theme` messages (`./theme.ts`).
 * The client applies the `--jini-*` ones with a safe value as custom properties on the surface's root
 * element (CSSOM `setProperty`, which a CSP without 'unsafe-inline' allows), plus `color-scheme` and
 * `data-jini-scheme`, so the surface's own stylesheet can follow the admin's look and light/dark mode.
 */
const PROTOCOL = 'jini.admin-surface';
const VERSION = 1;
const DEFAULT_TIMEOUT_MS = 30_000;
const THEME_TOKEN = /^--jini-[a-z0-9-]{1,60}$/;
const UNSAFE_THEME_VALUE = /url\(|image\(|image-set\(|[;{}<>\\@]/i;
const MAX_THEME_TOKENS = 100;
/** Rejection value of `call` when the host refused the action or the request timed out. */
export class AdminSurfaceCallError extends Error {
    code;
    retryable;
    constructor(required) {
        super(required.message);
        this.name = 'AdminSurfaceCallError';
        this.code = required.code;
        this.retryable = required.retryable;
    }
}
function isMessage(data, kind) {
    if (typeof data !== 'object' || data === null)
        return false;
    const message = data;
    return message.protocol === PROTOCOL && message.version === VERSION && message.kind === kind;
}
function isFailure(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const error = value;
    return typeof error.code === 'string' && typeof error.message === 'string' && typeof error.retryable === 'boolean';
}
/** The host's theme with every unknown name or unsafe value dropped; undefined when it is not a theme. */
function acceptedTheme(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const { scheme, tokens } = value;
    if ((scheme !== 'light' && scheme !== 'dark') || typeof tokens !== 'object' || tokens === null)
        return undefined;
    const safe = Object.entries(tokens).slice(0, MAX_THEME_TOKENS).filter(([name, token]) => {
        if (!THEME_TOKEN.test(name) || typeof token !== 'string') return false;
        return token.length > 0 && token.length <= 200 && !UNSAFE_THEME_VALUE.test(token);
    });
    return { scheme, tokens: Object.fromEntries(safe) };
}
/** The browser root when there is a document (none in a server-side test). */
function documentRoot() {
    const doc = globalThis.document;
    return doc?.documentElement ?? null;
}
/**
 * The browser's size source: the body's height including what overflows it (an open toggletip), re-read
 * on resize, DOM changes, hover and focus (hover/focus can show a CSS-only tooltip). Null without a DOM.
 */
function documentSize() {
    const scope = globalThis;
    const body = scope.document?.body;
    if (!body || !scope.ResizeObserver || !scope.MutationObserver)
        return null;
    const { ResizeObserver: Resize, MutationObserver: Mutation } = scope;
    return (onHeight) => {
        const measure = () => {
            const style = getComputedStyle(body);
            // scrollHeight is rounded to whole pixels; the box height keeps the fraction, which would
            // otherwise leave a 1px inner scrollbar.
            const content = Math.max(body.scrollHeight, body.getBoundingClientRect().height);
            onHeight(Math.ceil(content + parseFloat(style.marginTop || '0') + parseFloat(style.marginBottom || '0')));
        };
        const resize = new Resize(measure);
        const mutation = new Mutation(measure);
        resize.observe(body);
        mutation.observe(body, { subtree: true, childList: true, attributes: true, characterData: true });
        body.addEventListener('mouseover', measure);
        body.addEventListener('focusin', measure);
        measure();
        return () => { resize.disconnect(); mutation.disconnect(); body.removeEventListener('mouseover', measure); body.removeEventListener('focusin', measure); };
    };
}
/** A response has `ok: true` with a result, or `ok: false` with a well-formed failure. */
function isWellFormedResponse(message) {
    return message.ok === true ? Object.hasOwn(message, 'result') : message.ok === false && isFailure(message.error);
}
/**
 * Connects a surface to its host. In a browser:
 * `createAdminSurfaceClient({ parent: window.parent, listen: (h) => { addEventListener('message', h); return () => removeEventListener('message', h); } })`.
 * @param optional.timeoutMs - How long `call` waits for a response before rejecting with `timeout`.
 * @complexity O(1) per message.
 */
export function createAdminSurfaceClient(required, optional = {}) {
    const timeoutMs = optional.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const nowMs = optional.nowMs ?? Date.now;
    const pending = new Map();
    let init;
    let nextRequest = 0;
    // The Promise executor runs synchronously, so `resolveReady` is assigned before anything can call it.
    let resolveReady;
    const ready = new Promise((resolve) => { resolveReady = resolve; });
    const themeRoot = optional.themeRoot === undefined ? documentRoot() : optional.themeRoot;
    let currentTheme;
    const size = optional.size === undefined ? documentSize() : optional.size;
    let stopSize;
    let lastHeight = -1;
    /** Tells the host this surface's height (only when it changed), so the frame fits its content. */
    function reportHeight(height) {
        if (init === undefined || !Number.isFinite(height) || height === lastHeight)
            return;
        lastHeight = height;
        required.parent.postMessage({ protocol: PROTOCOL, version: VERSION, kind: 'resize', mountId: init.mountId, height }, init.origin);
    }
    /** Replaces the applied tokens: a token the new theme no longer sends falls back to the surface's CSS. */
    function applyTheme(value) {
        const next = acceptedTheme(value);
        if (next === undefined)
            return;
        if (themeRoot !== null) {
            for (const name of Object.keys(currentTheme?.tokens ?? {}))
                if (!(name in next.tokens))
                    themeRoot.style.removeProperty(name);
            for (const [name, token] of Object.entries(next.tokens))
                themeRoot.style.setProperty(name, token);
            themeRoot.style.setProperty('color-scheme', next.scheme);
            themeRoot.setAttribute('data-jini-scheme', next.scheme);
        }
        currentTheme = next;
    }
    function onInit(event, data) {
        if (init !== undefined || typeof data.mountId !== 'string')
            return;
        init = { mountId: data.mountId, origin: event.origin, bootstrap: data.bootstrap };
        applyTheme(data.theme);
        stopSize = size?.(reportHeight);
        resolveReady();
    }
    function onResponse(event, data) {
        if (event.origin !== init?.origin || data.mountId !== init.mountId || typeof data.requestId !== 'string')
            return;
        const waiting = pending.get(data.requestId);
        if (waiting === undefined || !isWellFormedResponse(data))
            return;
        pending.delete(data.requestId);
        clearTimeout(waiting.timer);
        if (data.ok === true)
            waiting.resolve(data.result);
        else
            waiting.reject(new AdminSurfaceCallError(data.error));
    }
    const unsubscribe = required.listen((event) => {
        if (event.source !== required.parent)
            return;
        if (isMessage(event.data, 'init'))
            onInit(event, event.data);
        else if (isMessage(event.data, 'theme')) {
            if (event.origin === init?.origin && event.data.mountId === init.mountId)
                applyTheme(event.data.theme);
        }
        else if (isMessage(event.data, 'action-response'))
            onResponse(event, event.data);
        else {
            // Ignore message kinds outside the admin-surface protocol.
        }
    });
    /** Posts one request of `kind` to the host origin and waits for its `action-response`. */
    async function send(kind, fields) {
        if (init === undefined)
            await ready;
        const { mountId, origin } = init;
        nextRequest += 1;
        const requestId = `r${nextRequest}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(requestId);
                reject(new AdminSurfaceCallError({ code: 'timeout', message: 'The host did not answer in time. Try again.', retryable: true }));
            }, timeoutMs);
            pending.set(requestId, { resolve, reject, timer });
            required.parent.postMessage({ protocol: PROTOCOL, version: VERSION, kind, mountId, requestId, ...fields }, origin);
        });
    }
    /** Asks the host to run one declared action; resolves with its result. */
    function call(input) {
        return send('action-request', { action: input.action, payload: input.payload });
    }
    /** Asks the host to open `url` outside the sandbox; only https links on the surface's declared
     * `linkOrigins` open, and the host decides how (new tab, system browser). Rejects with the host's refusal. */
    async function openLink(input) {
        await send('open-link', { url: input.url });
    }
    /** The bootstrap `data` the host sent with init, or `undefined` once it has expired (or none was sent). */
    function bootstrap() {
        const envelope = init?.bootstrap;
        if (typeof envelope !== 'object' || envelope === null)
            return undefined;
        const { expiresAt, data } = envelope;
        return typeof expiresAt === 'number' && nowMs() < expiresAt ? data : undefined;
    }
    /** The host's theme as applied, or `undefined` when the host sent none. */
    function theme() {
        return currentTheme;
    }
    /** Stops listening and rejects every pending call. */
    function close() {
        unsubscribe();
        stopSize?.();
        for (const [requestId, waiting] of pending) {
            clearTimeout(waiting.timer);
            waiting.reject(new AdminSurfaceCallError({ code: 'closed', message: 'The surface was closed before the host answered.', retryable: false }));
            pending.delete(requestId);
        }
    }
    return { ready, call, openLink, bootstrap, theme, close };
}
//# sourceMappingURL=surface-client.js.map