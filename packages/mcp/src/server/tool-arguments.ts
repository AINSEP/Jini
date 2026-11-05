/**
 * @module @jini-ai/mcp/server/tool-arguments
 *
 * The argument-shape half of `tools/call` dispatch, split out of `./tool-protocol.js`: copying
 * caller arguments into a tool's canonical wrapper shape before schema validation, and turning
 * validator errors into one field-specific recovery instruction. Pure functions, no I/O. Not
 * re-exported by the `./index.js` barrel — {@link handleToolCall} in `./tool-protocol.js` is the
 * only production caller.
 * See docs/decisions/DR-005-proxy-argument-shapes.md.
 */
import type { OutputUnit } from '@cfworker/json-schema';
import { decodeToolInputObject, unwrapToolInputEnvelope } from '@jini-ai/core';
import type { Tool } from './adapters/protocol.js';

/** Argument normalization's input contract, shared with the dispatcher without a reverse import. */
export interface McpToolArgumentContract {
  readonly inputSchema: Tool['inputSchema'];
  /** Compatibility rules applied once before strict schema validation; never sent on the wire. */
  readonly argumentNormalization?: {
    readonly aliases?: Readonly<Record<string, string>>;
    readonly foldIntoInput?: true;
    /** Concrete registry tools reuse the core schema normalizer before MCP validation. */
    readonly schemaInput?: true;
  };
}

/** Resolve this host's CLI decoration, preserving exact registered names and other servers.
 * @param required - Model-visible name, possibly prefixed by the Jini MCP client.
 * @param options - Exact-name lookup when a local tool index is available.
 * @returns The exact name when registered, otherwise the undecorated Jini name.
 * @complexity O(n) for n name characters; pure, no execution authority.
 */
export function resolveMcpToolName(
  { name }: { name: string },
  { isRegistered }: { isRegistered?: (name: string) => boolean } = {},
): string {
  if (isRegistered?.(name)) return name;
  return name.startsWith('mcp__jini__') ? name.slice('mcp__jini__'.length) : name;
}

/** True for a plain JSON object (not `null`, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Renames each alias present in `args` to its canonical key, in place. An alias whose canonical key
 * already holds a different value is ambiguous and refused; an identical value collapses silently.
 * @throws Error naming the alias to rename.
 */
function applyAliases({ args, aliases }: { args: Record<string, unknown>; aliases: Readonly<Record<string, string>> }): void {
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (!Object.hasOwn(args, alias)) continue;
    if (Object.hasOwn(args, canonical) && args[canonical] !== args[alias]) {
      throw new Error(`rename \`${alias}\` to \`${canonical}\` and supply only one value for \`${canonical}\``);
    }
    args[canonical] = args[alias];
    delete args[alias];
  }
}

/** A canonical base-10 integer spelling: no sign, padding, leading zero, fraction or exponent. */
const CANONICAL_INTEGER = /^(?:0|[1-9]\d{0,14})$/;

/**
 * Replaces each top-level argument that the schema types `integer` and the caller sent as a
 * canonical integer string (`"8"`) with that number, in place. Models do send numbers as strings
 * (Claude Code sent `search_tools {max_results: "8"}` and lost a turn to the refusal); anything
 * else, including `"1.5"` or `"08"`, is left for schema validation to refuse.
 * @complexity O(k) for k argument keys.
 */
function coerceIntegerStrings({ args, properties }: { args: Record<string, unknown>; properties: Record<string, unknown> }): void {
  for (const [key, value] of Object.entries(args)) {
    const property = properties[key];
    if (typeof value !== 'string' || !isRecord(property) || property.type !== 'integer') continue;
    if (CANONICAL_INTEGER.test(value)) args[key] = Number(value);
  }
}

/**
 * Moves `extraKeys` from the top level of `args` into its `input` object (created when absent), in place.
 * @throws Error when `input` is not a JSON object, or already holds one of the keys being folded.
 */
function foldExtraKeysIntoInput({ args, extraKeys }: { args: Record<string, unknown>; extraKeys: readonly string[] }): void {
  const input = Object.hasOwn(args, 'input') ? args.input : {};
  if (!isRecord(input)) {
    throw new Error("put the tool's own arguments inside `input`; replace `input` with a JSON object");
  }
  if (extraKeys.some((key) => Object.hasOwn(input, key))) {
    throw new Error("put the tool's own arguments inside `input`");
  }
  args.input = { ...input, ...Object.fromEntries(extraKeys.map((key) => [key, args[key]])) };
  for (const key of extraKeys) delete args[key];
}

/**
 * For a strict flat schema (no additional or pattern properties, no declared `input`), refuses a
 * nested `input` object carrying a key the schema declares at the top level, with a move instruction.
 * Any other shape is left for schema validation to report.
 * @throws Error naming the nested key to move.
 */
function assertNoMisplacedInputKey({ args, schema }: { args: Record<string, unknown>; schema: McpToolArgumentContract['inputSchema'] }): void {
  if (schema.additionalProperties !== false || schema.patternProperties) return;
  const properties = schema.properties ?? {};
  if (!isRecord(args.input) || Object.hasOwn(properties, 'input')) return;
  const misplaced = Object.keys(args.input).find((key) => Object.hasOwn(properties, key));
  if (misplaced !== undefined) throw new Error(`move \`input.${misplaced}\` to top-level \`${misplaced}\``);
}

/**
 * Copy the tool's transport arguments, decoding only schema-directed delegated envelopes.
 * @returns Detached arguments; declared tool-owned `input` fields retain their meaning.
 * @throws ToolInputError for JSON strings that do not encode objects.
 * @complexity O(k + n) time/space for k keys and n JSON characters; no I/O.
 */
function argumentSource({ tool, rawArgs }: { tool: McpToolArgumentContract; rawArgs: Record<string, unknown> }): Record<string, unknown> {
  const source = tool.argumentNormalization?.schemaInput
    ? unwrapToolInputEnvelope({ input: rawArgs, schema: tool.inputSchema }) : rawArgs;
  const args = { ...(source as Record<string, unknown>) };
  // The gateway owns an object-valued `input`; clients sometimes JSON-encode that field.
  // Decode before folding/validation so every delegated tool receives the same object contract.
  if (tool.argumentNormalization?.foldIntoInput && Object.hasOwn(args, 'input')) {
    args.input = decodeToolInputObject({ input: args.input });
  }
  return args;
}

/** Normalize the transport envelope, then existing aliases, integer fields and gateway input.
 * @returns A detached argument object; malformed or ambiguous input throws a repair instruction.
 * @complexity O(k + a + i + n) for argument/alias/input keys and encoded JSON characters.
 */
export function normalizeToolArguments(
  { tool, rawArgs }: { tool: McpToolArgumentContract; rawArgs: unknown },
  _options: Record<string, never> = {},
): Record<string, unknown> {
  if (!isRecord(rawArgs)) throw new Error('replace `arguments` with a JSON object');
  const args = argumentSource({ tool, rawArgs });
  const properties = tool.inputSchema.properties ?? {};
  applyAliases({ args, aliases: tool.argumentNormalization?.aliases ?? {} });
  coerceIntegerStrings({ args, properties });
  const extraKeys = Object.keys(args).filter((key) => !Object.hasOwn(properties, key));
  if (tool.argumentNormalization?.foldIntoInput && extraKeys.length > 0) {
    foldExtraKeysIntoInput({ args, extraKeys });
  } else {
    assertNoMisplacedInputKey({ args, schema: tool.inputSchema });
  }
  const undefinedKey = Object.keys(args).find((key) => args[key] === undefined);
  if (undefinedKey !== undefined) throw new Error(`remove \`${undefinedKey}\` or supply a JSON value instead of undefined`);
  return args;
}

/** Turns a validator JSON Pointer (`#/a/b~1c`) into a dotted field path (`a.b/c`); the root becomes `''`. */
function pointerToFieldPath({ instanceLocation }: { instanceLocation: string }): string {
  return instanceLocation.replace(/^#\/?/, '').split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~')).join('.');
}

/**
 * The supply/remove instruction for a `required` or `additionalProperties` error, whose message
 * quotes the offending property name; `undefined` for any other error, or when no name is quoted.
 */
function namedFieldMessage({ error, path }: { error: OutputUnit; path: string }): string | undefined {
  if (error.keyword !== 'required' && error.keyword !== 'additionalProperties') return undefined;
  const field = error.error.match(/"(.*)"/)?.[1];
  if (field === undefined) return undefined;
  const key = path ? `${path}.${field}` : field;
  return error.keyword === 'required' ? `supply required argument \`${key}\`` : `remove unknown argument \`${key}\``;
}

/** A complete small contract for repair diagnostics. Never truncate a schema into a misleading
 * partial contract, including nested choices, batches and local refs. (Search hits carry only a
 * compact signature; the full schema is paid for here, once a call has actually failed.)
 * @returns The original schema up to 4 KiB, or an explicit describe instruction; absent stays absent.
 * @complexity O(s) time/space for serialized schema bytes; pure, no input mutation.
 */
function boundedToolInputSchema(
  { inputSchema }: { inputSchema: unknown }, _options: Record<string, never> = {},
): { inputSchema?: unknown; schemaNotice?: string } {
  if (inputSchema == null) return {};
  if (Buffer.byteLength(JSON.stringify(inputSchema), 'utf8') > 4096) {
    return { schemaNotice: 'Input schema exceeds 4096 bytes. Call describe_tool before execution.' };
  }
  return { inputSchema };
}

/** Attach the complete bounded contract to a repair instruction without echoing input values.
 * @returns The instruction plus schema, or a describe_tool instruction for a large schema.
 * @complexity O(s) serialization time/space for s schema bytes; pure.
 */
export function withArgumentContract(
  { message, inputSchema }: { message: string; inputSchema?: unknown }, _options: Record<string, never> = {},
): string {
  const hint = boundedToolInputSchema({ inputSchema });
  const contract = hint.inputSchema === undefined ? hint.schemaNotice : `Input schema: ${JSON.stringify(hint.inputSchema)}`;
  return contract ? `${message}; ${contract}` : message;
}

/**
 * Formats structured validation errors as field-specific recovery instructions.
 * @param requiredArgs - Validator errors and, when available, the tool's complete wire input schema.
 * @param options.includeContract - Include the contract for every registry-tool shape error.
 * @returns A field instruction plus a bounded contract when requested or needed for missing fields/items.
 * @complexity O(e + p + s) for e errors, p path characters and s serialized schema bytes.
 */
export function argumentShapeMessage(
  { errors, inputSchema }: { errors: readonly OutputUnit[]; inputSchema?: unknown },
  { includeContract = false }: { includeContract?: boolean } = {},
): string {
  // Keep the additionalProperties diagnostic ahead of its generic false-schema child.
  const error = errors.find((entry) => entry.keyword === 'required' || entry.keyword === 'additionalProperties' || entry.instanceLocation !== '#') ?? errors[0];
  if (error === undefined) return 'supply arguments matching the declared input schema';
  const path = pointerToFieldPath({ instanceLocation: error.instanceLocation });
  const message = namedFieldMessage({ error, path }) ?? `change \`${path || 'arguments'}\`: ${error.error}`;
  // Wrong keys also need the accepted names and units, not a sequence of remove/retry guesses.
  if (!includeContract && !errors.some(entry => ['required', 'items'].includes(entry.keyword))) return message;
  return withArgumentContract({ message, inputSchema });
}
