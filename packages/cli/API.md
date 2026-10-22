# CLI API

Public calls use `(requiredArgs, optionalArgs?)`; names are unchanged. The full helper/command migration inventory is in the archived migration inventory. This is a breaking signature change.

| Entry | Runtime | API |
| --- | --- | --- |
| `@jini-ai/cli` | Node | Parsing, discovery, transport, command registry, commands and introspection |
| `@jini-ai/cli/introspection` | Universal | `introspectProgram({ program, excludedCommands })`, `toMcpTools({ manifest, toolNamePrefix })` |

Introspection accepts a structural Commander tree; no runtime Commander dependency is required. Exclusions and tool prefixes are required host policy. Commander is a development dependency for the generalized characterization tests. The library barrel does not import the binary entrypoint.

```ts
const registry = new CommandRegistry({});
registry.add({ name: 'example', handler: ({ args }) => handleArgs(args) }, { usage: 'example' });
await registry.dispatch({ argv }, { valueFlags });
const manifest = introspectProgram({ program, excludedCommands: ['private-command'] });
const tools = toMcpTools({ manifest, toolNamePrefix: 'host_' });
```

Injected ports use object arguments too:

| Port | Signature |
| --- | --- |
| `write`, `writeErr` | `({ text }) => void` |
| `exit` | `({ code }) => never` |
| `warn` | `({ message }) => void` |
| `readFile` | `({ path }) => Promise<string>` |
| `discover` | `({ env }, { timeoutMs }) => Promise<string \| null>` |
| `resolveBaseUrl`, `readStdin` | No-argument functions |

Defaults adapt these ports to native process/file calls. Inject `fetchImpl` as the standard Fetch interface; it preserves its native signature. Host environment names, discovery paths, introspection exclusions and tool prefixes have no application-specific defaults.

For example, `readPromptFromFlags({ flags }, { readFile: ({ path }) => storage.read(path) })` delegates storage; `versionCommand({ args, resolveBaseUrl }, { write: ({ text }) => output.push(text) })` delegates output. Bounded transport deadlines, response-size limits, structured error envelopes and bounded transport sanitizer output is unchanged.


**Breaking exports:** `sanitizeUntrustedText`, `SanitizeTextOptions` and `stripControlSequences`
are removed from CLI and imported from `@jini-ai/core/text`. `redactSecretLike` is removed; use
`redactSecrets({ input }, { policy: 'aggressive' })` from `@jini-ai/core` for its former direct
opaque-token behavior. This outputs `[REDACTED:<kind>]` and adds PII masking. Diagnostics should
keep the conservative core default. The bounded transport sanitizer still outputs `[redacted]`
and does not add PII rules; `sanitizeUnknownDeep` retains its prior output and limits.

Daemon URL warnings use the platform loopback classifier: the full IPv4 127/8 range and dotted
localhost are now recognized. IPv4-mapped IPv6 remains outside that classifier's local exception.
