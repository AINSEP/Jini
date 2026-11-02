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
import type { Tool } from './adapters/protocol.js';

/** Argument normalization's input contract, shared with the dispatcher without a reverse import. */
export interface McpToolArgumentContract {
  readonly inputSchema: Tool['inputSchema'];
  /** Compatibility rules applied once before strict schema validation; never sent on the wire. */
  readonly argumentNormalization?: {
    readonly aliases?: Readonly<Record<string, string>>;
    readonly foldIntoInput?: true;
  };
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
 * Copies caller arguments into their canonical wrapper shape before schema validation, reading a
 * canonical integer string as the integer a top-level `integer` property declares.
 * @param requiredArgs - Tool contract and untrusted arguments; neither is mutated.
 * @param _options - Reserved normalization options.
 * @returns Canonical arguments; nested tool input is copied only when fields are folded.
 * @throws Error naming an ambiguous alias, duplicate input key, or invalid wrapper field.
 * @complexity O(k + a + i) time and space for k argument keys, a aliases, and i input keys.
 */
export function normalizeToolArguments(
  { tool, rawArgs }: { tool: McpToolArgumentContract; rawArgs: unknown },
  _options: Record<string, never> = {},
): Record<string, unknown> {
  if (!isRecord(rawArgs)) throw new Error('replace `arguments` with a JSON object');
  const args = { ...rawArgs };
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

/**
 * Formats structured validation errors as field-specific recovery instructions.
 * @param requiredArgs - Validator errors and, when available, the tool's complete wire input schema.
 * @param _options - Reserved formatting options.
 * @returns A field instruction plus a bounded contract for missing fields or malformed array items.
 * @complexity O(e + p + s) for e errors, p path characters and s serialized schema bytes.
 */
export function argumentShapeMessage(
  { errors, inputSchema }: { errors: readonly OutputUnit[]; inputSchema?: unknown },
  _options: Record<string, never> = {},
): string {
  // Keep the additionalProperties diagnostic ahead of its generic false-schema child.
  const error = errors.find((entry) => entry.keyword === 'required' || entry.keyword === 'additionalProperties' || entry.instanceLocation !== '#') ?? errors[0];
  if (error === undefined) return 'supply arguments matching the declared input schema';
  const path = pointerToFieldPath({ instanceLocation: error.instanceLocation });
  const message = namedFieldMessage({ error, path }) ?? `change \`${path || 'arguments'}\`: ${error.error}`;
  // Missing fields and generic array-item errors otherwise force one guess per retry.
  if (!errors.some(entry => ['required', 'items'].includes(entry.keyword))) return message;
  const hint = boundedToolInputSchema({ inputSchema });
  const contract = hint.inputSchema === undefined ? hint.schemaNotice : `Input schema: ${JSON.stringify(hint.inputSchema)}`;
  return contract ? `${message}; ${contract}` : message;
}
