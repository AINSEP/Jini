Spec ID: SPEC-JINI-CLI-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:5294dff8017fb8e301c63e8fad4ce04428afff283df5ab1f9b17c2ccf0788914
spec_mode: reverse_spec


# CLI API contract

## Entry points and dependencies

| Entry | Public surface | Runtime |
|---|---|---|
| `@jini-ai/cli` (`.`) | Flags, URL discovery, error/HTTP handling, text intake, redaction, usage, CommandRegistry, run/daemon/version commands, DI token, introspection | Node; core and sidecar dependencies |
| `@jini-ai/cli/introspection` | `introspectProgram`, `toMcpTools` and their structural types | Universal; no Commander runtime import |
| `jini` binary | Runs `src/main.ts`; `main` is not a package-exported library function | Node |

Signatures below preserve current source: required object first and optional object second where implemented. A one-object or zero-argument API is not documented as accepting another object. Optional callbacks still include some zero-argument ports before the architecture wave.

## Parsing, rendering and redaction (`.`)

| Signature | Return and supplied dependencies |
|---|---|
| `parseFlags({argv}, optional: ParseFlagsOptions = {})` | `ParsedFlags = Record<string,string\|boolean>`; optional string/boolean name sets |
| `positionalArgs({argv}, optional: PositionalArgsOptions = {})` | `string[]`; string name set, stopAtDoubleDash? |
| `coerceCliValue({raw})` | `CoercedCliValue = boolean\|number\|string` |
| `renderUsage({usage}, optional: UsageOptions = {})` | `string`; usage lines, optional description and `{flag,description}[]` |
| `@jini-ai/core/text.stripControlSequences({text})` | `string` |
| `@jini-ai/core.redactSecrets({input}, {policy})` | `string`; explicit aggressive policy for former direct opaque masking |
| `@jini-ai/core/text.sanitizeUntrustedText({text}, optional: SanitizeTextOptions = {})` | `string`; maxLength? |
| `sanitizeUnknownDeep({value}, optional: {depth?:number} = {})` | `unknown` |

`argv` and usage lines are readonly string arrays; raw/text are strings; value is unknown. Exported data types: `FlagValue`, `ParsedFlags`, `ParseFlagsOptions`, `PositionalArgsOptions`, `CoercedCliValue`, `UsageOption`, `UsageSpec`, `UsageOptions`, `SanitizeTextOptions`.

## Discovery and input (`.`)

```ts
resolveDaemonUrl(_requiredArgs: Record<string, never>, options: ResolveDaemonUrlOptions = {}): Promise<string>;
sanitizeDaemonUrlForDisplay({ url }: { url: string }): string;
daemonUrlPolicyWarning({ url }: { url: string }): string | null;
createLocalDaemonDiscovery(options: LocalDaemonDiscoveryOptions): NonNullable<ResolveDaemonUrlOptions['discover']>;
readPromptFromFlags({ flags }: { flags: PromptFlags }, options: ReadPromptFromFlagsOptions = {}): Promise<string | null>;
readBodyFromFlags({ flags }: { flags: BodyFlags }, options: ReadBodyFromFlagsOptions = {}): Promise<string | undefined>;
new PayloadTooLargeError(required: {message:string});
```

Discovery options: flagUrl?, env? (process.env), envVarName?, discover? `({env},{timeoutMs}) => Promise<string|null>`, timeoutMs? (800), defaultUrl?, warn? `({message})=>void`. The resolver itself has no default env-var name or URL. `LocalDaemonDiscoveryOptions` is `{registryPath:string} | {dataDir:string}` and uses the sidecar registry reader; no filesystem/liveness port is injectable here.

PromptFlags is `{prompt?, 'prompt-file'?}`; BodyFlags is `{body?, 'body-file'?}`. Both text-reader option types expose `readFile?({path})=>Promise<string>`, `readStdin?()=>Promise<string>`, maxBytes?, signal?. Default readers use Node filesystem/stdin. Reader limits and cancellation do not apply to injected readers or inline strings.

## HTTP and error handling (`.`)

```ts
surfaceFetchError({ err, daemonUrl }: { err: unknown; daemonUrl: string }, options: SurfaceFetchErrorOptions = {}): void;
postJsonToDaemon({ base, route, body }: { base: string; route: string; body: unknown }, options: PostJsonToDaemonOptions = {}): Promise<unknown>;
getJsonFromDaemon({ base, route }: { base: string; route: string }, options: GetJsonFromDaemonOptions = {}): Promise<unknown>;
exitWithStructuredError(input: ExitWithStructuredErrorInput, options: StructuredErrorOptions = {}): never;
structuredErrorData({ error }: { error: DaemonErrorBody | undefined }): Record<string,unknown> | undefined;
structuredHttpFailure({ resp }: { resp: HttpFailureLike }, { fallbackCode = 'daemon-not-running', ...options }: StructuredErrorOptions & { fallbackCode?: string } = {}): Promise<never>;
```

HTTP options: headers?, exitCodes?, fetchImpl? (global fetch), write? `({text})=>void` (stderr), exit? `({code})=>never` (process.exit), signal?, timeoutMs? (15000), maxResponseBytes? (10 MiB). `GetJsonFromDaemonOptions` aliases the POST options. URLs concatenate base and route literally. There is no base-URL allowlist or authentication policy; hosts supply headers or fetch behavior.

Error input is `{code:string,message:string}`. StructuredErrorOptions carries data?, exitCodes?, write?, exit?. `ExitCodeTable` is readonly `Record<string,number>`. `HttpFailureLike` requires status and `text():Promise<string>`. `StructuredErrorEnvelope` is `{error:{code,message,data}}`; `DEFAULT_CLI_EXIT_CODES` maps daemon-not-running to 64, missing-input to 67, invalid-flag to 2. `SurfaceFetchErrorOptions` supplies write? only.

## Command registry and built-in commands (`.`)

```ts
new CommandRegistry(required: {} = {});
registry.add(required: {name:string;handler:CommandHandler}, optional: AddCommandOptions = {}): this;
registry.has(required: {name:string}): boolean;
registry.usageFor(required: {name:string}): string | undefined;
registry.names(required: {} = {}): string[];
registry.dispatch(required: {argv:readonly string[]}, optional: CommandDispatchOptions = {}): Promise<CommandDispatchResult>;
```

CommandHandler is `({args:readonly string[]})=>void|Promise<void>`. AddCommandOptions is `{usage?,override?}`; CommandDispatchOptions is `{valueFlags?:ReadonlySet<string>}`. Result is handled, empty, or not-found with name. `CommandRegistryToken` identifies the registry in core DI as `jini.cli.commandRegistry`; the host installs the registry value in its own service composition.

| Public functions | Required object | Optional object | Return |
|---|---|---|---|
| `runStartCommand`, `runListCommand`, `runGetCommand`, `runCancelCommand`, `runWatchCommand` | `{args,resolveBaseUrl}` | `Omit<RunCommandDeps,'resolveBaseUrl'> = {}` | `Promise<void>` |
| `daemonStatusCommand`, `daemonStopCommand` | `{args,resolveBaseUrl}` | `Omit<DaemonCommandDeps,'resolveBaseUrl'> = {}` | `Promise<void>` |
| `versionCommand` | `{args,resolveBaseUrl}` | `Omit<VersionCommandDeps,'resolveBaseUrl'> = {}` | `Promise<void>` |
| `registerRunCommands`, `registerDaemonCommands`, `registerVersionCommand` | `{registry,resolveBaseUrl}` | Matching dependency type minus resolveBaseUrl, default `{}` | `void` |
| `watchRunEvents` | `{baseUrl:string,runId:string,args:readonly string[]}` | `Omit<RunCommandDeps,'resolveBaseUrl'> = {}` | `Promise<void>` |

All three dependency interfaces require `resolveBaseUrl:()=>string|Promise<string>`; optional write/writeErr `({text})=>void`, fetchImpl, exit `({code})=>never`, exitCodes. Successful commands print JSON plus newline, except version prints the version string and watch prints event data lines. See behavior for accepted flags and routes. None of these command dependencies exposes the HTTP primitives' headers/signal/timeout options.

## Introspection (`.` and `./introspection`)

```ts
introspectProgram({ program, excludedCommands }: { program: IntrospectionCommand; excludedCommands: readonly string[]; }): CliManifest;
toMcpTools({ manifest, toolNamePrefix }: { manifest: CliManifest; toolNamePrefix: string; }): McpToolDefinition[];
```

`IntrospectionCommand` is a structural port with name()/description(), child commands, registeredArguments (name(), required, description?) and options (flags, attributeName(), description?, mandatory, defaultValue?). The host supplies a live tree, such as a Commander Command. No parser execution is performed.

Exported shapes: `IntrospectedArgument` (name/required/description), `IntrospectedOption` (flags/attributeName/description/required/defaultValue?/takesValue), `IntrospectedCommand` (name/description/arguments/options), `CliManifest` (name/description/commands), `McpToolDefinition` (name/description/inputSchema with object type, string properties and required-name array).

## Minimal wiring

```ts
import { CommandRegistry, registerRunCommands, resolveDaemonUrl,
  createLocalDaemonDiscovery } from '@jini-ai/cli';
const registry = new CommandRegistry({});
const discover = createLocalDaemonDiscovery({ dataDir: '/var/lib/example' });
registerRunCommands({ registry, resolveBaseUrl: () => resolveDaemonUrl({}, { discover }) }, {
  write: ({text}) => process.stdout.write(text),
});
await registry.dispatch({ argv: ['run', 'list'] });
```

```ts
import { introspectProgram, toMcpTools, type IntrospectionCommand } from '@jini-ai/cli/introspection';
function describe(program: IntrospectionCommand) {
  const manifest = introspectProgram({ program, excludedCommands: ['help'] });
  return toMcpTools({ manifest, toolNamePrefix: 'example_' });
}
```

Binary wiring: `jini --daemon-url http://127.0.0.1:4111 run list`. Resolution uses global --daemon-url, then JINI_DAEMON_URL, then an explicitly selected registry path/data directory. `--version` or `-v` as the first token aliases the daemon version command.

Evidence: `src/index.ts`, all its re-exported modules, `src/main.ts`; static tests `flags.test.ts`, `http.test.ts`, `introspection.test.ts`, `command-registry.test.ts`, `main.test.ts`. Tests/builds were not run.


Architecture update: the moved text functions and SanitizeTextOptions are no longer CLI exports;
import them from core/text. Recursive JSON sanitization remains here and retains output/limits.
Direct core redaction uses category markers and PII rules; its default is conservative, while
former direct CLI opaque-run masking is explicit aggressive policy. platform/net supplies the
loopback hostname classifier, including full 127/8 and dotted localhost. See API.md.

## Current manifest boundary

The current `package.json` exposes `.`, `./introspection`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
