/** The environment names each shipped Jini process entry may read (HW13-env-undeclared-entry).
 *
 * Keyed by the entry's normalized repo-relative path. An entry is a file the env-access scan
 * classifies as one: everything under a package's `src/bin/`, and the source of each manifest
 * `bin` target. Plugin payload sources and example roots are scanned as library code, not as
 * entries, so they have no row here; an example root becomes an entry only by an explicit row.
 *
 * Each list is traced from the code, not from the debt file: the names the entry reads itself,
 * plus every key its helpers read from the environment map the entry hands them. Forwarding the
 * whole map is not a key read; the reads it enables are the names below. Only Jini's own names
 * belong here; a host adds its names to its own entries' declarations.
 */

/** Read-only by construction: the scan and any entry using `readDeclaredEnvKey` share these rows. */
export const JINI_ENTRY_ENV_NAMES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // `main()` forwards the map to `dispatchArgv` -> `buildResolveBaseUrl` -> `resolveDaemonUrl`,
  // whose env step reads only the name it is given. Local discovery receives the map and reads no key.
  'packages/cli/src/main.ts': Object.freeze(['JINI_DAEMON_URL']),
  // `serve()` reads the run, daemon and credential names; the launch tool lists through
  // `parseLaunchToolIds`; the delegated-gateway options through `buildDelegatedGatewayOptions`;
  // the relay pair through `resolveMessageRelay`; the daemon URL again through `resolveDaemonUrlDefault`.
  'packages/mcp/src/bin/serve.ts': Object.freeze([
    'JINI_RUN_ID',
    'JINI_DAEMON_URL',
    'JINI_DAEMON_TOKEN',
    'JINI_STARTUP_TOOL_IDS',
    'JINI_DIAGNOSTIC_TOOL_IDS',
    'JINI_DELEGATED_TOOL_TIMEOUT_MS',
    'JINI_DELEGATED_RESULT_MARKERS',
    'JINI_MESSAGE_RELAY',
    'JINI_MESSAGE_RELAY_NONCE',
  ]),
});

/** The declared names of one entry; an entry without a row has none. */
export function declaredEnvNamesFor(
  { entry }: { entry: string },
  { schema = JINI_ENTRY_ENV_NAMES }: { schema?: Readonly<Record<string, readonly string[]>> } = {},
): ReadonlySet<string> {
  // Handing a map into an entry does not grant its readers access to every ambient name.
  return new Set(Object.hasOwn(schema, entry) ? schema[entry] : []);
}
