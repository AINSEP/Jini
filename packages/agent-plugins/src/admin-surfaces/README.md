# Admin surfaces (`@jini-ai/agent-plugins/admin-surfaces`)

A plugin can ship its own small admin UI (a settings screen, a resource chooser, a mapping editor)
without getting any access to the host's pages, cookies or server. The host renders the plugin's
static files in a sandboxed iframe, and the plugin asks the host to do things through a small
`postMessage` protocol. The host decides what runs: only actions the plugin declared, only with
input that matches the declared schema, and only through handlers the host provides or the
plugin's own handler module admitted through the executable trust gate (see below).

## How it fits

```
plugin package (bundled, trusted)          host page (admin)                    host server
  <host-named surfaces file>.json  ──load──▶ loadPluginContributions ─────────▶ (registry of surfaces)
  surface/index.html, app.mjs      ◀─serve── readAdminSurfaceFile + headers
                                             <iframe sandbox="allow-scripts">
  surface client ── action-request ────────▶ validateAdminSurfaceMessage ──POST──▶ dispatcher.dispatch
                 ◀─ action-response ──────── adminSurfaceActionResponse ◀──────── host handler
```

- Loading reuses the plugin contribution loader (`../lifecycle/contribution-loader.ts`) and its trust
  gate (`../lifecycle/trusted-plugin-files.ts`): the plugin must be active and be the build's own
  shipped digest. Surfaces themselves are a **data** contribution; only an optional `handlerModule`
  is imported, through the separate executable contribution described below.
- File reads reuse the lifecycle's `readTrustedPluginFile`, which resolves symlinks and refuses any
  path outside the package root.
- The host owns routes, authentication and the action handlers. Jini owns the values that form the
  security boundary, so every host applies the same ones.

## Contribution file

The **host** chooses the filename (for example `<product>-admin-surfaces.json`) and passes it to
`defineAdminSurfaceContribution({ filename })`. Jini never hardcodes a product prefix.

```json
{
  "schemaVersion": 1,
  "surfaces": [
    {
      "id": "connection-settings",
      "title": "Connection settings",
      "entry": "surface/index.html",
      "files": ["surface/app.mjs", "surface/app.css"],
      "actions": [
        {
          "name": "save-selection",
          "input":  { "type": "object", "properties": { "resourceId": { "type": "string", "maxLength": 128 } }, "required": ["resourceId"] },
          "result": { "type": "object", "properties": { "saved": { "type": "boolean" } }, "required": ["saved"] }
        }
      ],
      "csp": { "connect-src": ["https://api.example.com"], "script-src": ["https://cdn.example.com"] }
    }
  ]
}
```

Rules (any violation refuses the whole file, reported in the loader's `refusals`):

| field | rule |
|---|---|
| `id`, action `name` | lowercase hyphenated, at most 64 characters, unique in the file / surface |
| `entry` | plain relative path ending in `.html`; no `..`, `.`, leading `/`, `\`, `%`, empty or dot-leading segments |
| `files` | same path rule, ending in `.mjs`, `.js`, `.css` or `.json`; only `entry` and `files` are ever served |
| `input`, `result` | the closed schema subset below |
| `handlerModule` | optional; same path rule ending in `.mjs`; must not also be listed in `files` (it is server code, never served); requires every action to declare `result` |
| `bootstrap` | optional schema (same subset) the handler module's bootstrap data must match; only with `handlerModule` |
| `connections` | optional, only with `handlerModule`; at most 4 `{ id, startParams?, callbackFields? }`: the plugin's own connection ids (`[A-Za-z0-9][A-Za-z0-9._-]{0,63}`, unique) its handlers administer, the per-sign-in parameters they may set and the callback fields they may take (names `[A-Za-z0-9_.-]{1,64}`, at most 8 each) |
| `publicConfig` | optional, only with `handlerModule`; at most 16 environment-style names (`[A-Z][A-Z0-9_]{0,63}`) the host may hand the handlers; a name containing `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD`, `PRIVATE`, `CREDENTIAL`, `COOKIE`, `SESSION` or `SIGNING` is refused |
| `csp` | keys only `script-src`, `style-src`, `img-src`, `font-src`, `connect-src`, `frame-src`; values only bare `https://host[:port]` origins with a DNS name (no wildcard, path, IP, keyword, `data:`/`blob:`) |

Action schemas are a small closed subset of JSON Schema: every node declares `type` (`object`,
`array`, `string`, `number`, `integer`, `boolean`, `null`); objects use `properties`, `required` and
optionally `additionalProperties: false` (objects are always closed); arrays use `items` and
`maxItems` (default cap 1000); strings use `minLength`, `maxLength`, `enum`; numbers use `minimum`,
`maximum`; `title`/`description` are allowed annotations. Any other keyword refuses the file, so a
plugin can never rely on a constraint that would silently not be enforced. Violation messages name
a path (`$.rows[2]`), never the value.

## Rendering and serving

- `adminSurfaceFrameAttributes({ src, title })` → `{ src, title, sandbox: 'allow-scripts', referrerPolicy: 'no-referrer' }`.
  Never add `allow-same-origin`: with `allow-scripts` it lets the frame remove its own sandbox.
- `readAdminSurfaceFile({ surface, path, readFile })` → `{ ok: true, body, headers }` or `{ ok: false, reason: 'not-declared' }`.
  `headers` come from `adminSurfaceFileHeaders`: the CSP below, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Cache-Control: no-cache`, and for `.mjs`/`.js` files
  `Access-Control-Allow-Origin: *` (a module script requested by an opaque-origin document is a CORS
  fetch). Surface files are static code fetched without credentials: never put secrets in them; the
  host route that serves them must not depend on a session cookie for script files.
- `adminSurfaceContentSecurityPolicy({ descriptor })`:
  `default-src 'none'; script-src 'self' …; style-src 'self' …; img-src 'self' …; font-src 'self' …; connect-src 'none'|…; frame-src 'none'|…; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts`.
  No inline script or style, no `unsafe-*`, and no network access unless declared.

## Message protocol

Every message carries `protocol: 'jini.admin-surface'` and `version: 1`.

| kind | direction | fields |
|---|---|---|
| `init` | host page → frame, once per mount after the frame loads | `mountId`, optional `bootstrap` |
| `action-request` | frame → host page | `mountId`, `requestId` (`[A-Za-z0-9_-]{1,64}`), `action`, `payload` |
| `action-response` | host page → frame | `mountId`, `requestId`, then `ok: true, result` or `ok: false, error: { code, message, retryable }` |

1. `createAdminSurfaceMount({ surfaceId })` → `{ mountId }` (128-bit random nonce) and `expectedOrigin: 'null'`.
2. The host page renders the iframe and, on its first `load`, posts `adminSurfaceInitMessage({ mountId }, { bootstrap })`
   to `frame.contentWindow` with target `'*'` (an opaque origin cannot be targeted by name). If the
   frame fires `load` again it navigated: unmount it and do not re-send init. Because the target is
   `'*'`, whatever document the frame holds when init is posted receives it, bootstrap access token
   included: the mount nonce protects only the inbound direction. That is why init goes out exactly
   once, on the frame's FIRST `load` (when it can only hold the host-served, CSP-locked entry page),
   and why bootstrap data carries only a short-lived access token and public config.
3. The surface client accepts the first init whose `source` is its parent, remembers the host's
   origin from it, and from then on posts only to that origin.
4. The host page passes every `message` event to `validateAdminSurfaceMessage({ event, mount })`
   (mount = `{ mountId, frame: iframe.contentWindow, descriptor }`). Verdicts:
   `ignored` (wrong origin, wrong window, not a request, wrong nonce: drop silently),
   `refused` (undeclared action, payload too large or outside the schema: post the given `response` back),
   or `ok` with the request.
5. The host page forwards `{ action, payload }` to its own authenticated server route, which calls
   `createAdminSurfaceActionDispatcher({ descriptor, handlers }).dispatch({ action, payload, context })`.
   The dispatcher re-checks the action and schema (the route can be called directly), runs the
   host handler, checks a declared `result` schema, and turns any throw into a surface-safe failure
   (`AdminSurfaceActionError` keeps its code and message; anything else becomes `action-failed`
   with a generic message, and the raw error goes to `onHandlerError` for the server log).
6. The host page posts `adminSurfaceActionResponse({ request, outcome })` back to the frame.

Dispatcher error codes: `action-undeclared`, `action-unavailable` (no host handler),
`invalid-payload`, `invalid-result`, `action-failed`, or a handler's own `AdminSurfaceActionError` code.
The surface client adds `timeout` and `closed`.

### Bootstrap data

Data a surface needs to start (for example a short-lived, narrowly scoped access token plus public
config) is issued by a host server route with `createAdminSurfaceBootstrap({ surfaceId, data, nowMs }, { ttlMs })`
(default 60 s, at most 5 minutes) and served with `adminSurfaceBootstrapHeaders()`
(`Cache-Control: no-store`, `Pragma: no-cache`, `nosniff`). The host page passes it inside `init`;
the client's `bootstrap()` returns `data` only until `expiresAt`. Never put a refresh token or any
long-lived secret in bootstrap data.

## Surface side

```js
import { createAdminSurfaceClient } from '@jini-ai/agent-plugins/admin-surfaces/client';
// or copy dist/admin-surfaces/surface-client.js next to the entry: it has no imports.
const client = createAdminSurfaceClient({
  parent: window.parent,
  listen: (handler) => { addEventListener('message', handler); return () => removeEventListener('message', handler); },
});
await client.ready;
const config = client.bootstrap();
const result = await client.call({ action: 'save-selection', payload: { resourceId } });
```

`call` rejects with `AdminSurfaceCallError` (`code`, `message`, `retryable`).

## Plugin-supplied handlers (`handlerModule`)

A host can answer a surface's actions with its own code (`handlers` above), or let the plugin answer
them: a surface that names a `handlerModule` ships a server-side `.mjs` whose default export is

```js
export default {
  actions: {
    // input already matched the action's input schema; the result must match its result schema.
    async 'save-selection'({ input, capabilities, context, fail }) {
      const token = await capabilities.connections.getAccessToken({ connectionId: context.connectionIds[0] });
      const response = await capabilities.http.fetch({ url: '…' }, { headers: { authorization: `Bearer ${token}` } });
      if (response.status === 401) throw fail({ code: 'reconnect-required', message: 'Reconnect the account and retry.' });
      return { saved: true };                                  // never the token
    },
  },
  // Optional; needs a `bootstrap` schema on the surface. The one answer that may carry a short-lived access token.
  async bootstrap({ capabilities, context }) { return { accessToken: '…', appId: 'public-config' }; },
};
```

- Loading: `defineAdminSurfaceHandlerContribution({ filename })` reads the SAME surfaces file and is an
  executable contribution (`../lifecycle/contribution-loader.ts`'s `defineExecutablePluginContribution`,
  the loader executable tools use): the plugin must be active, be the build's shipped digest, and the
  module must resolve inside the package root on disk. Refusals are lines in the load's `refusals`.
- Admission: `createAdminSurfaceHandlerHost({ capabilities }).sync({ loaded, refusals })` refuses a module
  that exports a handler for an undeclared action, a `bootstrap()` the surface has no schema for, or a
  surface two loaded modules claim. Call it on boot and on every activation change; a surface missing
  from a load loses its handlers, a handler a route already holds answers `plugin-disabled`, and
  capabilities the module kept are revoked.
- Calls: `capabilities` is the admin-surface port (next section), built per call for the LOADED
  plugin id and the route's workspace/principal; `context.pluginId`/`surfaceId` are the loaded
  module's own, whatever the caller passed, and `context.connectionIds` lists the surface's declared
  connection ids (never refs). A result or error that mentions a token the surface generation obtained
  (in this call or an earlier one; the newest 64 are remembered) is withheld (`action-failed`), and
  such a token is never saved to state. `fail({ code, message }, { retryable })` builds a surface-safe
  failure; a code that is not lowercase hyphenated becomes `action-failed`, messages are cut at 300 characters.
- Bootstrap: `bootstrapData({ context })` returns the provider's data (or `null`), refused when it does not
  match the declared `bootstrap` schema. Wrap it with `createAdminSurfaceBootstrap` and serve it with
  `adminSurfaceBootstrapHeaders()`; never include a refresh token or a long-lived secret.

Host wiring:

```ts
const handlerDefinition = defineAdminSurfaceHandlerContribution({ filename: '<product>-admin-surfaces.json' });
const surfaceHandlers = createAdminSurfaceHandlerHost({ capabilities });          // same port as executable tools
const load = await lifecycle.loadPluginContributions({ workspaceId, definition: handlerDefinition });
surfaceHandlers.sync({ loaded: load.items, refusals: load.refusals });           // boot + every activation change
// action route
createAdminSurfaceActionDispatcher({ descriptor, handlers: surfaceHandlers.handlersFor({ pluginId, surfaceId }) }).dispatch({ action, payload, context });
// bootstrap route
createAdminSurfaceBootstrap({ surfaceId, data: await surfaceHandlers.bootstrapData({ context }), nowMs });
```

The host still owns authentication and the workspace and principal in `context`; it resolves a
declared `connectionId` to its own connection for the scope's plugin and workspace, so a plugin can
never name another plugin's connection.

## Capability ports (`./surface-capabilities.ts`)

`createAdminSurfaceHandlerHost({ capabilities })` takes an `AdminSurfaceCapabilitiesPort`:
`(scope: { pluginId, workspaceId, principalId? }) => AdminSurfaceCapabilities`. The host implements
it; Jini wraps each call in `openAdminSurfaceCapabilitySession`, which refuses anything the surface
did not declare before the host sees it, revokes every port once the plugin is disabled (the same
gate as executable tools, `openCapabilityGate`), and cuts host answers back to the shapes below.

| port | methods | Jini checks |
|---|---|---|
| `http`, `limiter`, `artifacts` | as for executable tools | revocation |
| `connections` | `getAccessToken({ connectionId })`, `status({ connectionId })` → `{ connectionId, status, accountLabel, grantedScopeSetIds, pendingSwitchAccountLabel }` | declared connection; token noted for the result/error scans |
| | `begin({ connectionId, action: 'connect' \| 'reconnect' \| 'switch' \| 'add-scopes' }, { scopeSetIds?, startParams? })` → `{ authorizationUrl, attemptId, expiresAt }`; the host starts the API connection with intent `ADMIN_SURFACE_ACTION_INTENTS[action]` | declared connection and start parameters, string values ≤ 2048, ≤ 16 scope-set ids, a signed-in admin (`principalId`) |
| | `confirmSwitch`, `cancelSwitch` → status; `disconnect` → status + `revocation: 'confirmed' \| 'pending' \| 'not-needed'` | declared connection, a signed-in admin |
| | `takeCallbackFields({ connectionId, attemptId })` → declared fields or `null` | declared connection, opaque attempt id, undeclared fields dropped |
| `state` | `get({ key })`, `set({ key, value })`, `delete({ key })` | key `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`; value plain JSON (depth ≤ 16, ≤ 16 KiB serialized); a value mentioning a token the call obtained is refused; the host stores a checked copy |
| `publicConfig` | `get({ name })` → string or `null` | declared name only |

Host duties: key `state` by the scope's plugin and workspace (never shared across plugins), and back
the plugin's agent tools' read-only `state.get` (`../lifecycle/tools/README.md`) with this same store
under the same keys, so a setting the surface saves (a product turned off) is what the tools honor; map
`status` scopes to the plugin's scope-set ids; `disconnect` returns `confirmed` only when the provider
confirmed (`revocation` uses the API-connection values `confirmed | pending | not-needed`, and
`status` its four lifecycle values, so the host passes both through); never return a refresh token or secret from any port; give `publicConfig` only public values.

Callback fields: when a sign-in started by `begin` completes successfully, the host's callback route
deposits the provider's extra fields into `createAdminSurfaceCallbackInbox({ now })` (in-process,
consume-once, 10-minute expiry, 256 entries) under `{ workspaceId, pluginId, connectionId, attemptId }`,
and backs `takeCallbackFields` with its `take` for the scope's workspace and plugin. The `attemptId`
is the API-connection service's own: `begin` returns `start(...).attemptId` and the callback route
deposits under `complete(...).attemptId`. Never hand the authorization `state` to the frame or the
plugin (it is the callback's CSRF binding; `start(...).state` is for the host's own routing only).
The plugin must still verify the fields through the provider's API before saving.

## Extension points

- A second provider plugin adds a surface by shipping the host's surfaces file and static files;
  no Jini change is needed.
- A host adds an action by implementing a handler for a name a plugin declared; undeclared names
  never run, even with a handler.
- A provider plugin answers its own actions by shipping a `handlerModule`; a second provider uses the
  same seam with its own module, its own declared connection ids and config names, and needs no Jini change.
