# Executable Agent Plugin tools (`@jini-ai/agent-plugins/lifecycle/tools`)

An installed Agent Plugin can contribute assistant tools whose code ships inside the plugin as
plain-JS `.mjs` modules. This folder admits them through the lifecycle's existing trust gate and
projects them into the existing plugin tool contract in `@jini-ai/plugins/host`, so they reach the
assistant like every other plugin tool. Nothing here names a product, provider or file prefix, and nothing imports `@jini-ai/plugins`:
the host passes that contract's registry and `pluginToolIdFor` in as ports (packages at the same
layer communicate through host ports).

## How it fits

```
plugin package ──► loadPluginContributions(definition)      (contribution-loader.ts)
                     gates: ACTIVE, bundled digest, contained .mjs path   (trusted-plugin-files.ts)
               ──► projection.sync({ loaded, refusals })     (projection.ts)
                     refuses: ambiguous ids, undisclosed write/destructive, unusable schema
               ──► PluginContributionRegistry ──► attachPluginContributionTools ──► ToolRegistry
                     (namespaced id p_<plugin>__<local>, enablement + auth recheck, confirmation)
```

Executable contributions always require activation, and only packages whose installed digest is the
one this build shipped may contribute. A refused package or tool is reported as a refusal line, never
thrown.

## Public API

| export | what it is |
|---|---|
| `defineAgentPluginToolContribution({ filename })` | the contribution definition; the host chooses the filename |
| `parseAgentPluginToolsFile({ raw })` | the pure parser behind it |
| `createAgentPluginToolProjection({ registry, toolIdFor, capabilities, issuedTokens })` | `sync({ loaded, refusals })` and `describeAffectedResources({ toolId, input })` |
| `createIssuedTokenMemories()` / `IssuedTokenMemories` | the per-plugin token memory; one per host, passed to the projection and the admin-surface host |
| `AgentPluginToolCapabilities` / `AgentPluginToolCapabilitiesPort` | the host capability ports |
| `WITHHELD_OUTPUT_MESSAGE` | the text a withheld result is replaced with, for hosts that recognize it |
| `AgentPluginStateReader` / `AgentPluginStateValue` | the read-only view of a plugin's own state (`get` only) |

## The contribution file

The host picks the filename (for example `<product>-agent-tools.json`) and passes it to
`defineAgentPluginToolContribution`. The plugin ships that file at its package root:

```json
{
  "schemaVersion": 1,
  "tools": [
    {
      "name": "append_rows",
      "description": "Append rows to a table the user picked.",
      "effect": "write",
      "module": "tools/append-rows.mjs",
      "inputSchema": {
        "type": "object",
        "required": ["connectionRef", "table", "values"],
        "additionalProperties": false,
        "properties": {
          "connectionRef": { "type": "string" },
          "table": { "type": "string" },
          "values": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  ]
}
```

Rules (a file breaking any of them is refused whole):

- `name`: lower snake case, at most 64 characters, unique in the file. The assistant sees it as
  `p_<plugin id with - as _>__<name>`; two plugins whose ids collide are both refused.
- `description`: non-empty, at most 8000 characters.
- `effect`: `read`, `write` or `destructive`. `destructive` always requires confirmation, whatever
  the host's approval metadata says; `read` never marks a tool read-only (the host still decides).
- `module`: a `.mjs` path inside the plugin; a path that escapes the package root is refused.
- `inputSchema`: JSON Schema 2020-12 describing an object, at most 64 KiB. Input that fails it is
  refused before the module runs; the error names locations, never values.
- 1 to 128 tools per file. Unknown keys are ignored.

## The module

Each `module` default-exports one tool:

```js
export default {
  // input already passed inputSchema; capabilities are the host's, scoped to this call.
  async invoke({ input, capabilities, signal }) {
    const token = await capabilities.connections.getAccessToken({ connectionRef: input.connectionRef });
    const response = await capabilities.http.fetch({ url: '…' }, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '…' });
    return { appended: input.values.length };          // JSON-serializable, never the token
  },
  // Required for write and destructive tools: what the call would change, shown before confirmation.
  describeAffectedResources({ input }) { return [`table ${input.table}`]; },
};
```

`describeAffectedResources` returns at most 50 non-empty strings of at most 300 characters each.

## Capabilities (host-supplied ports)

The host passes `capabilities: ({ pluginId, workspaceId, principalId?, signal? }) => AgentPluginToolCapabilities`:

- `connections.getAccessToken({ connectionRef })` — a fresh access token (never a refresh token). The
  host must refuse a `connectionRef` the calling plugin or workspace does not own.
- `http.fetch({ url }, { method, headers, body, signal })` — the host's guarded HTTP client.
- `limiter.check({ key })` — `{ allowed: true } | { allowed: false, retryAfterSeconds }`, the same shape
  as `@jini-ai/http-kit`'s `RateLimiter.check`.
- `artifacts.write({ name, mediaType, content })` — returns `{ artifactRef }`. Optional: absent (not a throwing stub) when the host has no artifact store, so a tool checks `capabilities.artifacts` before relying on it.
- `state.get({ key })` — the plugin's own settings, read-only (`null` when unset). The host backs it with
  the SAME store the plugin's admin-surface `state` writes, keyed by the same plugin and workspace, so a
  flag the surface saves (for example "this product is off") is what the tool reads and must honor.
  The session exposes `get` alone whatever object the host passes, checks the key with the surface's
  key shape, passes the host `{ key }` only (plugin code cannot add a scope), and revokes it with the
  other capabilities.

Per call, the projection wraps these so that every capability stops working once the plugin's tools
are withdrawn, and a result or error that contains a token the plugin obtained (in this call or an
earlier one, by a tool or by one of its admin-surface handlers; the newest 64 are remembered) is
withheld. The memory is per plugin, from `createIssuedTokenMemories()`, which the host creates once and
passes to both the projection and `createAdminSurfaceHandlerHost`: a plugin's tools and handlers can
share module scope, and Node keeps a module's scope across re-syncs.
Those two gates are `openCapabilityGate({ isLive })` in `capabilities.ts`; the admin-surface session
(`../../admin-surfaces/surface-capabilities.ts`) reuses it, so surface handlers revoke and scan the
same way. Account actions (connect, switch, disconnect), writing plugin state and public config exist
only on the admin-surface port: they are admin actions, never something an agent tool can do.

Any other context that runs a plugin's code and must honor its settings (form delivery, for example)
gets the same `AgentPluginStateReader`: the host passes an object with `get` only, never its whole
store, scoped to that plugin and workspace.

## Host wiring

```ts
const definition = defineAgentPluginToolContribution({ filename: '<product>-agent-tools.json' });
const contributions = createPluginContributionRegistry({});        // dedicated: keyed by plugin id
attachPluginContributionTools({ contributions, registry: toolRegistry, isEnabled, resolveAuth, metadata });
const issuedTokens = createIssuedTokenMemories();                   // ONE per host, shared with the admin-surface host
const projection = createAgentPluginToolProjection({ registry: contributions, toolIdFor: pluginToolIdFor, capabilities, issuedTokens });
// On boot and on every activation change:
const load = await lifecycle.loadPluginContributions({ workspaceId, definition }, { orderByPluginId: true });
const { refusals } = projection.sync({ loaded: load.items, refusals: load.refusals });
// Before confirming a call:
const disclosure = await projection.describeAffectedResources({ toolId, input });
```

Use a registry dedicated to Agent Plugin tools: the registry is keyed by plugin id, and a site plugin
with the same id would otherwise replace them. A plugin missing from a later load is detached: its
tools leave the ToolRegistry, already-authorized calls are refused, and capabilities a module kept
are revoked. A plugin whose modules and declarations are unchanged keeps its generation, so
re-syncing for another plugin never interrupts its calls.

## Extending: a second provider plugin

A second provider needs no change here: it ships its own contribution file and modules, uses its own
`connectionRef` values, and receives the same capability ports. Provider-specific endpoints, scopes
and parsing stay in the plugin.
