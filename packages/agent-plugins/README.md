# `@jini-ai/agent-plugins`

> **Leon, this is you from the past. Do not try to merge `plugins` and `agent-plugins`.**

Support for **Agent Plugins**, an open, vendor-neutral spec (v1.0.0, published 2026-08-06) for
bundling Agent Skills and MCP servers into one portable directory. Published by a Technical
Steering Committee with maintainers from Amazon, Cursor, Google, Microsoft, OpenAI, and Vercel.
Source: https://developers.googleblog.com/agent-plugins-package-your-skills-tools-and-more/

If you are an agent reading this cold: this document is written so you don't need the source
article to understand the shape of a plugin or what this package provides. `PluginManifest` and
`McpManifest` (exported from the package root) type every field confirmed against the published
schemas (`AGENT_PLUGINS_SCHEMA_URL`, `AGENT_PLUGINS_MCP_SCHEMA_URL`), not inferred — both still
carry an index signature in case a future schema revision adds a field neither type has caught up
to yet.

**Extracted 2026-08-18** from `@jini-ai/plugins`, where this content used to live nested under a
`./agent-plugins` subpath. That package now only reserves the unrelated, unimplemented `./host`
format (Jini's own host-extension plugin system — a different concept entirely, see "Not this
package" below) — everything Agent-Plugins-shaped moved here, one level up, since there was no
longer a second format sharing the namespace to disambiguate against.

## The problem this solves

Before this spec, shipping the same skill or MCP server to multiple agent clients meant
maintaining incompatible copies — every client used a different manifest format and directory
layout ("fork and drift"). Agent Plugins standardizes the packaging format only; each client still
decides its own install mechanism, permission model, and sandboxing.

## What a plugin looks like on disk

A plugin is a directory. Example (this package's own bundled plugin, `ui-ux-design/`):

```
ui-ux-design/
├── plugin.json                       # manifest — minimally { "$schema": ..., "name": "ui-ux-design" }
├── mcp.json                          # MCP server declarations (empty here — example only)
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md                  # Agent Skills format: frontmatter (name, description) + body
│       ├── references/               # optional supporting docs the skill body links out to
│       ├── examples/                 # optional
│       └── scripts/                  # optional
└── com.anthropic.claude-code/        # client extension directory (§8.2) — example only
    └── hooks/
        └── hooks.json
```

`plugin.json` optional fields beyond `$schema`/`name`: `version`, `description`, `author`
(`{name, email, url}`), `homepage`, `repository`, `license`, `keywords` (string array), and
`extensions` — an object keyed by reverse-domain client namespace (e.g. `com.example.client`) for
client-specific data the schema assigns no semantics to.

`mcp.json` declares MCP servers under `mcpServers`, one of three explicit transport shapes — no
guessing which one a client should assume:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "local-validator": {
      "type": "stdio",
      "command": "./bin/validator",
      "args": ["--data", "${PLUGIN_DATA}/validator"],
      "env": { "CONFIG": "${PLUGIN_ROOT}/config.json" },
      "cwd": "${PLUGIN_ROOT}"
    },
    "deployment-api": {
      "type": "streamable-http",
      "url": "https://deploy.example.com/mcp",
      "headers": { "X-Tenant": "public-tenant" }
    },
    "legacy-events": {
      "type": "sse",
      "url": "https://legacy.example.com/sse"
    }
  }
}
```

`ui-ux-design/mcp.json` ships with an empty `mcpServers: {}` — a valid, working
example of the file's shape, not a real server declaration. Replace it (or delete it — `mcp.json`
is optional) the moment this plugin actually needs one.

A plugin can also have reverse-domain-namespaced directories at its root — §8.2 of the
specification: "the extension directory for a namespace is the top-level directory named after
it," contents entirely client-defined, and clients that don't recognize a namespace simply ignore
it. The spec's own example is `com.example.client/hooks/hooks.json` — using `example.com` the same
way an RFC does, since the spec assigns no real namespace to any actual client and publishes no
namespace registry. `ui-ux-design/com.anthropic.claude-code/hooks/hooks.json`
follows the same shape with a real client substituted in: `com.anthropic.claude-code` is a
plausible reverse-DNS guess (Anthropic controls `anthropic.com`; Claude Code is the client this
whole package was built inside), **not** a confirmed or registered identifier — nothing publishes
one. Content is illustrative only, per the same "no portable semantics" rule.

Discovery (how a client finds/installs a plugin in the first place) is explicitly out of scope for
the packaging spec itself — it lives in separate layers (Agentic Resource Discovery, an AI
Catalog format) that this package does not implement.

## What's in this package

| export | runtime | contents |
|---|---|---|
| `.` (root) | universal | `PluginManifest`/`McpManifest` types, `validatePluginManifest({ value })`/`validateMcpManifest({ value })` structural validators (plus compatible `isPluginManifest(value)`/`isMcpManifest(value)` wrappers), and the known path constants (`PLUGIN_MANIFEST_FILENAME`, `PLUGIN_SKILLS_DIRNAME`, `PLUGIN_MCP_MANIFEST_FILENAME`). No filesystem access, no DOM. |
| `./manifest` | universal | Strict manifest/MCP parsing and typed namespace readers; object structural validators are also re-exported here. |
| `./lifecycle` | node | Host-injected installation, activation, locks, digests, bundles, trusted files, reference resolution, ranking and MCP provisioning helpers. |
| `./lifecycle/node` | node | `createNodeAgentPluginEffects({})` opt-in native effects. |
| `./lifecycle/yauzl` | node | `createYauzlAgentPluginArchiveReader({ yauzl })`; the host supplies the optional peer library. |
| `./ui-ux-design/*` | — | Raw files of the bundled `ui-ux-design` plugin — static JSON/Markdown, not run through the TS build. |

The universal root handles structural validation. The separate Node lifecycle entry implements
local archive installation and host-owned activation policy; it does not implement remote catalog discovery.

## Not this package: `@jini-ai/plugins` (`./host`)

`@jini-ai/plugins` is a **different, sibling package** — Jini's own host-extension plugin format
(manifest + `setup()` + hooks + activation), unrelated to the third-party Agent Plugins spec this
package supports. Do not confuse the two — "agent plugins" (this package, a
public spec) and "Jini plugins" (`@jini-ai/plugins`'s `./host`, Jini's own unbuilt format) share
the word "plugin" and nothing else.

## Bundled plugins

Real, install-ready plugin directories shipped alongside the code — not illustrative examples.
Each lives at the package root under **its own name** (`ui-ux-design/`).
Plugins live at the package root rather than inside `src/` because `src/` is the TypeScript
compile root (`rootDir: "src"`, `include: ["src"]`) — a plugin's skill trees can carry files
(`.tsx` examples, etc.) that are illustrative content, not package code, and putting them under
`src/` makes `tsc` try to compile them (measured, on `ui-ux-design`: 207 errors from the three
`shadcn-ui/examples/*.tsx` files alone). Static content and compiler input are kept in separate
trees on purpose.

### `ui-ux-design/`

Bundles the AI-Dev-Shop Web Design agent's full skill set (per its `agents/web-design/skills.md`
persona and the `framework/routing/skills-registry.md` ownership mapping) into one portable plugin:

- `ui-ux-design` — design-foundations (tokens, typography, spacing, breakpoints, component state
  matrix) *and* first-impression polish, scanning hierarchy, conversion-focused visual signals —
  one skill, not two. AI-Dev-Shop merged its former separate `ux-design` and `premium-ui` skills
  into this single `ui-ux-design` skill; this sample tracks that merge instead of carrying the two
  predecessor skills as stale copies (see git history for the 2026-08-12 consolidation).
- `interface-design` — repeatable, memory-consistent visual systems for dashboards/admin panels/apps
- `gstack-design` — manual four-mode workflow (consultation, shotgun, html, review)
- `frontend-accessibility` — WCAG 2.1 AA checklist
- `vercel-web-design-guidelines` — Vercel Web Interface Guidelines auditor
- `shadcn-ui` — shadcn/ui (Radix + Tailwind) component discovery/integration guidance
- `web-compliance` — legal/compliance checkpoints for public-facing UX flows

Each skill directory is a verbatim copy of the corresponding `AI-Dev-Shop/skills/<name>/` tree —
copied rather than referenced, because the whole point of a plugin is that it is self-contained and
portable to a host that has never heard of AI-Dev-Shop. `AI-Dev-Shop/agents/web-design/skills.md`
itself (the persona that composes these skills into one role) is not bundled — it is ADS-specific
routing glue, not a portable skill.

Consumers may read bundled raw assets through the public wildcard subpath. Product-specific
plugin assets are owned and shipped by their product, outside this library.

## Scripts

```bash
pnpm --filter @jini-ai/agent-plugins build
pnpm --filter @jini-ai/agent-plugins typecheck
pnpm --filter @jini-ai/agent-plugins test
```

The build and typecheck include lifecycle test sources. Copied Node test options are
translated to Vitest registration, preserving per-test timeouts and platform skip conditions.

## Adding another bundled plugin

1. Create `<plugin-name>/plugin.json` at the package root with at least
   `{ "$schema": AGENT_PLUGINS_SCHEMA_URL, "name": "<plugin-name>" }`. Do **not** put it under
   `src/` — see "Bundled plugins" above for why.
2. Add `<plugin-name>/skills/<skill-name>/SKILL.md` per skill (plus any `references/`,
   `examples/`, `scripts/` the skill needs).
3. Register it in `package.json`: an `exports` key `"./<plugin-name>/*": "./<plugin-name>/*"`, a
   matching `jini.entries` key (the R8 guard requires every export to have one), and a
   `files` entry.
4. Add coverage in `src/__tests__/manifest.test.ts` following the `ui-ux-design plugin` block — assert the manifest validates and the expected skill
   directories exist.

## Lifecycle API and ports

New public callables use `(requiredArgs, optionalArgs)`, with effects supplied as ports.
Create and retain one lifecycle per host context:

```ts
import { createAgentPluginLifecycle, createAgentPluginLayout } from '@jini-ai/agent-plugins/lifecycle';
import { createNodeAgentPluginEffects } from '@jini-ai/agent-plugins/lifecycle/node';

const layout = createAgentPluginLayout({ root: pluginRoot });
const lifecycle = createAgentPluginLifecycle({
  ...createNodeAgentPluginEffects({}),
  layout,
  productName,
  extensionNamespace,
  bundledArchiveMagic,
  deliveryMode,
  seededEnabledPluginIds,
  retiredBundledPlugins,
  formatPluginToolPointer,
  mcpProvisioning,
  outboundGuard,
  fetch: ({ url }, options) => fetch(url, options),
}, { onEvent, readServerMetadata });

const downloaded = await lifecycle.fetchAgentPluginArchive({ url }, { signal });
const installed = await lifecycle.installAgentPlugin({
  archive: downloaded.archive,
  expectedSha256: downloaded.sha256,
  archiveReader,
  layout,
  workspaceId,
});
```

All names in the example are supplied by the host. There is no default storage root,
namespace, product name, bundle policy or archive framing. Preserve your existing framing
when adopting the package. Prefer pinned hashes for remote installations; trust-on-first-use
is an explicit choice in `installAgentPluginFromUrl`.

Filesystem effects use native `node:fs/promises` signatures and native FileHandles. Inject
instrumented native effects directly through `filesystem`; `createNodeAgentPluginEffects({})`
provides the default. Clocks extend core `Clock` with `monotonicMs()` and `sleep({ ms })`;
IDs extend core `IdGenerator` with `random()`.

Generic locks are imported directly from `@jini-ai/platform/fs/file-lock`. Lifecycle activation
uses `withFileLock({ lockPath, run }, { timeoutMs: 15000, staleMs: 10000, pollMs: 10, ...effects })`.
Lock helpers, errors and constants are no longer members/exports of the lifecycle API.

Archive readers implement `entries({ archive })`; file entries expose `openReadStream({})`.
`createYauzlAgentPluginArchiveReader({ yauzl })` accepts the native library protocol explicitly;
no peer library is imported by the core. Fetch ports implement `fetch({ url }, requestOptions)`.
The outbound guard runs before every request and redirect. The host's fetch adapter must
pin DNS if its security policy requires protection against DNS rebinding.

Public callbacks also receive objects: `pluginIdOf({ item })`, `run({ lock })`,
`isProcessAlive({ pid })`, `onStaleLockRemoved({ holder })`, `onInactive({ plugin })`
and `now({})`. Lock ownership checks use `lock.assertHeld({})`. Constructors receive
named fields, for example `new AgentPluginInstallError({ code, message }, { cause })`.
`recordBundledAgentPluginDigests` accepts the clock override in its second object;
`findTrustedPluginPackages` accepts `orderByPluginId` and `onInactive` in its second object.

`parseAgentPluginMcpConfig({ value, extensionNamespace }, { pluginManifest, readServerMetadata })`
accepts optional namespace metadata separately. Strict parsing preserves standard object
shaped authors and older string authors. Inline transport fields never become reviewed-read
metadata. MCP provisioning helpers delegate to the host and notify only after success;
filesystem installation and federation remain separate operations with host-owned recovery.

The legacy root validators keep their positional shape and behavior. New code can use the
object-shaped `validatePluginManifest` and `validateMcpManifest` facades. Internal composition
factories are implementation details and are not package exports.

See [integration-extraction.md](integration-extraction.md) for the reconciliation, source mapping,
rewire ledger and verification commands. All verification is deferred by owner directive.
