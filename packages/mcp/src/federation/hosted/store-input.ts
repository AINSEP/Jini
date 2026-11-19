import { ExternalMcpValidationError } from "./validation-error.js";
import { assertExternalMcpPlainField } from "./store.save.js";
import type { CredentialPorts } from "./store.save.js";
import { SUPPORTED_EXTERNAL_MCP_TRANSPORTS } from "./vocabulary.js";
import { assertValidConnectionId } from "../trust.js";
import type { ExternalMcpTransport, SaveExternalMcpServerInput } from "@jini-ai/core/contracts/hosted-mcp";

const MAX_ENV_VARS = 64;
const MAX_ARGS = 64;
/** POSIX-ish environment variable name. Deliberately stricter than what a shell tolerates: a name
 *  outside this set is far more likely a mis-pasted line than an intentional variable. */
export const ENV_NAME_PATTERN = /^[A-Za-z_]\w*$/;
/** Generous — a provider asking for more distinct scopes than this is misconfigured, not ambitious. */
const MAX_OAUTH_SCOPES = 64;

/**
 * Parses an operator's `KEY=VALUE`-per-line environment block into a map.
 *
 * Blank lines and `#` comments are skipped so an operator can annotate the block. Everything else
 * must parse: a line without `=` is rejected rather than ignored, because silently dropping what
 * looks like a credential is how a server ends up launching without the token the operator believes
 * they supplied. Only the FIRST `=` splits, so values may contain `=` (base64 padding, connection
 * strings).
 *
 * @param text - Raw textarea content.
 * @returns The parsed variables, in first-seen order.
 * @throws {ExternalMcpValidationError} On a malformed line, an invalid name, a duplicate, or more
 * than {@link MAX_ENV_VARS} variables.
 * @complexity O(n) in the number of lines.
 * @overallScore 100
 */
/** One line of {@link parseEnvBlock}'s input, parsed and name-validated but not yet checked against
 *  the running `env` map (dedup/cap are the loop's own job, since they need cross-line state). Split
 *  out purely to keep `parseEnvBlock`'s cognitive complexity under the shop ceiling — `null` means
 *  "skip this line" (blank or `#` comment), matching the original inline `continue`. */
function parseEnvLine(rawLine: string, index: number): { readonly name: string; readonly value: string } | null {
  const line = rawLine;
  if (line.trim() === "" || line.trimStart().startsWith("#")) return null;

  const separator = line.indexOf("=");
  // Validation reaches the model through the human form; never echo the credential block.
  if (separator <= 0) {
    throw new ExternalMcpValidationError(
      `line ${index + 1} of the environment block is not \`NAME=VALUE\` — correct it in the connection form`,
      "env",
    );
  }

  const name = line.slice(0, separator).trim();
  if (!ENV_NAME_PATTERN.test(name)) {
    throw new ExternalMcpValidationError(
      `line ${index + 1} of the environment block has an invalid variable name (letters, digits and underscore, not starting with a digit)`,
      "env",
    );
  }
  return { name, value: line.slice(separator + 1).trim() };
}

/** @agent-note `ports` are the host-bound credential rules (length cap, messages, secret-in-plain-field check). */
export function parseEnvBlock(text: string, ports: CredentialPorts): Record<string, string> {
  // JSON is the lossless representation for multiline values; NAME=VALUE remains compatible.
  if (text.trimStart().startsWith('{')) {
    return parseJsonEnvBlock({ text, ports });
  }
  const env: Record<string, string> = {};
  const lines = text.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const parsed = parseEnvLine(rawLine, index);
    if (!parsed) continue;
    // Rejected rather than last-write-wins: two lines setting the same variable means the operator
    // believes both are in effect, and picking one silently is the failure mode this guards.
    if (Object.hasOwn(env, parsed.name)) {
      throw new ExternalMcpValidationError(`environment variable '${parsed.name}' is set more than once`, "env");
    }
    if (Object.keys(env).length >= MAX_ENV_VARS) {
      throw new ExternalMcpValidationError(`at most ${MAX_ENV_VARS} environment variables are supported`, "env");
    }
    if (parsed.value.length > ports.credential.limit) throw new ExternalMcpValidationError("The token exceeds the 8192-character limit. Copy only the token.", "env");
    assertExternalMcpPlainField({ value: parsed.name, field: "env" }, ports);
    env[parsed.name] = parsed.value;
  }

  return env;
}

function assertJsonEnvEntry({ name, value, ports }: { name: string; value: unknown; ports: CredentialPorts }, _options = {}): void {
  if (!ENV_NAME_PATTERN.test(name) || typeof value !== 'string' || value.includes('\0')) throw new ExternalMcpValidationError(ports.credential.messages.env, 'env');
  assertExternalMcpPlainField({ value: name, field: 'env' }, ports);
  if (value.length > ports.credential.limit) throw new ExternalMcpValidationError('The token exceeds the 8192-character limit. Copy only the token.', 'env');
}

function parseJsonEnvBlock({ text, ports }: { text: string; ports: CredentialPorts }, _options = {}): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ExternalMcpValidationError(ports.credential.messages.env, 'env'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ExternalMcpValidationError(ports.credential.messages.env, 'env');
  const entries = Object.entries(parsed);
  if (entries.length > MAX_ENV_VARS) throw new ExternalMcpValidationError(`at most ${MAX_ENV_VARS} environment variables are supported`, 'env');
  for (const [name, value] of entries) assertJsonEnvEntry({ name, value, ports });
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * Splits an operator's space-separated argv string.
 *
 * One quoting rule, and only one: a token that STARTS with `"` runs to the next `"`, which must end
 * the token (whitespace or end of string after it), and both quotes are dropped. That is what lets a
 * path with a space in it — `"C:\\Users\\John Smith\\..."`, the desktop shell's win32
 * registration — arrive as one argument. There are no escapes (a backslash is always literal, since
 * Windows paths are full of them), and a `"` anywhere else in a token stays literal exactly as it did
 * before this rule existed, so `--name="x"` still reaches the child unchanged. This is NOT shell
 * quoting: the command is spawned WITHOUT a shell (`adapter.stdio.ts` uses `spawn` with an argv
 * array), and nothing else a shell would do happens here.
 *
 * @throws {ExternalMcpValidationError} On an unterminated quoted token, a closing quote followed by
 *   more characters, or more than `MAX_ARGS` arguments.
 * @complexity O(n) in the string length.
 */
export function parseArgs(raw: string): string[] {
  const args: string[] = [];
  let index = 0;
  while (index < raw.length) {
    if (/\s/.test(raw[index]!)) {
      index += 1;
      continue;
    }
    const token = raw[index] === '"' ? readQuotedArg(raw, index) : readBareArg(raw, index);
    args.push(token.value);
    index = token.end;
  }
  if (args.length > MAX_ARGS) {
    throw new ExternalMcpValidationError(`at most ${MAX_ARGS} arguments are supported`, "args");
  }
  return args;
}

/** {@link parseArgs}'s unquoted token: everything up to the next whitespace, quotes included. */
function readBareArg(raw: string, start: number): { readonly value: string; readonly end: number } {
  const match = /\s/.exec(raw.slice(start));
  const end = match === null ? raw.length : start + match.index;
  return { value: raw.slice(start, end), end };
}

/** {@link parseArgs}'s quoted token, `start` pointing at its opening `"`.
 *  @throws {ExternalMcpValidationError} When the quote never closes, or does not end the token. */
function readQuotedArg(raw: string, start: number): { readonly value: string; readonly end: number } {
  const close = raw.indexOf('"', start + 1);
  if (close === -1) {
    throw new ExternalMcpValidationError("an argument opens a double quote that never closes", "args");
  }
  const end = close + 1;
  if (end < raw.length && !/\s/.test(raw[end]!)) {
    throw new ExternalMcpValidationError("a closing double quote must be followed by a space or the end of the arguments", "args");
  }
  return { value: raw.slice(start + 1, close), end };
}

/** Validates `serverId` via the trust tier's own assertion, remapped onto this store's own error
 *  type. Split out purely to keep {@link saveExternalMcpServer}'s complexity under the shop
 *  ceiling — reuses `trust.ts`'s rule rather than restating it, since this id becomes part of every
 *  federated tool id and two copies of that rule could drift. */
export function assertValidExternalMcpServerId(serverId: string): void {
  try {
    assertValidConnectionId({ connectionId: serverId });
  } catch (err) {
    throw new ExternalMcpValidationError(err instanceof Error ? err.message : String(err), "id");
  }
}

export function assertSupportedExternalMcpTransport(transport: string): void {
  if (!SUPPORTED_EXTERNAL_MCP_TRANSPORTS.includes(transport as ExternalMcpTransport)) {
    throw new ExternalMcpValidationError(
      `transport '${transport}' is not supported — only ${SUPPORTED_EXTERNAL_MCP_TRANSPORTS.join(", ")} is implemented`,
      "transport",
    );
  }
}

/**
 * Splits an operator's comma- or space-separated OAuth scope list.
 *
 * An empty result is legitimate — several providers infer scope from the client registration — so it
 * is returned rather than rejected, the same call {@link parseAllowedToolNames} makes.
 *
 * @throws {ExternalMcpValidationError} Past {@link MAX_OAUTH_SCOPES}.
 * @complexity O(n) in the number of scopes.
 */
export function parseOAuthScopes(raw: string): string[] {
  const scopes = raw.split(/[\s,]+/).filter((part) => part.length > 0);
  if (scopes.length > MAX_OAUTH_SCOPES) {
    throw new ExternalMcpValidationError(`at most ${MAX_OAUTH_SCOPES} OAuth scopes are supported`, "oauth.scopes");
  }
  return [...new Set(scopes)];
}

/** Trims and validates `rawCommand`, returning the trimmed value. Split out purely to keep
 *  {@link saveExternalMcpServer}'s complexity under the shop ceiling. */
function assertNonEmptyExternalMcpCommand(rawCommand: string): string {
  const command = rawCommand.trim();
  if (command === "") {
    throw new ExternalMcpValidationError("a stdio server needs a command to launch", "command");
  }
  return command;
}

/** Hosts for which plaintext `http` is tolerated — a local development server, and nothing else. */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Validates a remote MCP server URL.
 *
 * Same rule the OAuth endpoints follow (`oauth/endpoint-safety.ts`): https, or http only for
 * loopback. A remote MCP endpoint carries the bearer token this whole subsystem exists to obtain, so
 * a plaintext one to anywhere but a developer's own machine is a credential on the wire.
 *
 * @returns The normalized absolute URL.
 * @throws {ExternalMcpValidationError} On an empty, unparseable, or plaintext-non-loopback URL.
 * @complexity O(n) in the URL length.
 */
function assertSafeRemoteMcpUrl(rawUrl: string, transport: ExternalMcpTransport, ports: CredentialPorts): string {
  const url = rawUrl.trim();
  if (url === "") {
    throw new ExternalMcpValidationError(`a ${transport} server needs a URL`, "url");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ExternalMcpValidationError(ports.credential.messages.url, "url");
  }
  assertExternalMcpPlainField({ value: url, field: "url" }, ports);
  const loopback = LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase());
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new ExternalMcpValidationError("a remote MCP server URL must use https (http is permitted only for loopback)", "url");
  }
  return parsed.toString();
}

/** A `stdio` row needs a command; a remote row needs a URL. Split out to keep
 *  {@link saveExternalMcpServer}'s complexity under the shop ceiling.
 *  @throws {ExternalMcpValidationError} When the transport's own required field is missing or unsafe. */
export function resolveTransportTarget(
  transport: ExternalMcpTransport,
  input: SaveExternalMcpServerInput,
  ports: CredentialPorts,
): { readonly command: string | null; readonly url: string | null } {
  if (transport === "stdio") return { command: assertNonEmptyExternalMcpCommand(input.command), url: null };

  return { command: null, url: assertSafeRemoteMcpUrl(input.url ?? "", transport, ports) };
}
