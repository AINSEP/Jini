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
 * Copies caller arguments into their canonical wrapper shape before schema validation.
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

/**
 * Formats structured validation errors as field-specific recovery instructions.
 * @param requiredArgs - Validator errors, including JSON Pointer locations and keywords.
 * @param _options - Reserved formatting options.
 * @returns One actionable diagnostic; no schema-location trace.
 * @complexity O(e + p) for e errors and p characters in the selected field path.
 */
export function argumentShapeMessage(
  { errors }: { errors: readonly OutputUnit[] },
  _options: Record<string, never> = {},
): string {
  // Keep the additionalProperties diagnostic ahead of its generic false-schema child.
  const error = errors.find((entry) => entry.keyword === 'required' || entry.keyword === 'additionalProperties' || entry.instanceLocation !== '#') ?? errors[0];
  if (error === undefined) return 'supply arguments matching the declared input schema';
  const path = pointerToFieldPath({ instanceLocation: error.instanceLocation });
  return namedFieldMessage({ error, path }) ?? `change \`${path || 'arguments'}\`: ${error.error}`;
}
