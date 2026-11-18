/**
 * @module @jini-ai/core/text/diagnostic-vocabulary
 * The names an error text may keep: tool ids, property names the caller could already read in a schema,
 * identifiers the server put in named envelope fields, and (when the host allows it) values the caller sent
 * in this same call. The list is built before the first lossy pass over an error and handed to
 * `sanitizeUntrustedText` as exact whole-token exemptions; credentials are masked before an exemption is
 * looked at, and nothing is ever learned from the error text itself.
 */
import { redactSecrets } from '../redact.js';

const MAX_SCHEMA_DEPTH = 6;
const MAX_SCHEMA_NAMES = 512;
const MAX_INPUT_NAMES = 64;
const MAX_ECHOED_VALUES = 64;
const PROPERTY_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const TOOL_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
/** A correlation id: a UUID, an `ERR-` id or a short opaque id. Anything of 49+ characters is not an id. */
const CORRELATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{5,47}$/;
const ECHOED_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const SECRET_NAME_RE = /key|token|secret|passw|credential|auth|cookie|session/i;
const SCHEMA_BRANCHES = ['anyOf', 'oneOf', 'allOf'] as const;

export interface DiagnosticVocabularyOptions {
  /** The called tool's input schema (typed call) or the schema of the descriptor this run holds (gateway call). */
  readonly inputSchema?: unknown;
  /** A daemon error's `details` object, with the envelope's own `requestId` / `errorId` added by the caller. */
  readonly envelopeDetails?: unknown;
  /** The scalar string arguments of this same call. Only the host that allows echoing the caller's own words passes it. */
  readonly echoed?: { readonly input: unknown; readonly schema?: unknown };
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** True for a schema property that holds a secret: `writeOnly`, `format: "password"`, or a name that reads as a credential. */
function isSecretProperty({ name, schema }: { name: string; schema: unknown }): boolean {
  return SECRET_NAME_RE.test(name) || (isRecord(schema) && (schema.writeOnly === true || schema.format === 'password'));
}

/** The property names declared directly on a schema node, and the child schemas to walk next. */
function schemaChildren({ node }: { node: Record<string, unknown> }): { names: string[]; children: unknown[] } {
  const properties = isRecord(node.properties) ? Object.entries(node.properties) : [];
  const branches = SCHEMA_BRANCHES.flatMap(branch => (Array.isArray(node[branch]) ? node[branch] as unknown[] : []));
  return {
    names: properties.map(([name]) => name).filter(name => PROPERTY_NAME_RE.test(name)),
    children: [...properties.map(([, child]) => child), node.items, ...branches],
  };
}

/**
 * Property names of a schema, depth-bounded and count-bounded; names outside the identifier shape are skipped.
 * Exported so a server that names a tool's input in an error envelope (`details.inputNames`) reads the schema the
 * same way the client's vocabulary does.
 */
export function schemaPropertyNames({ schema }: { schema: unknown }): string[] {
  const names = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (!isRecord(node) || depth > MAX_SCHEMA_DEPTH || names.size >= MAX_SCHEMA_NAMES) return;
    const found = schemaChildren({ node });
    for (const name of found.names) if (names.size < MAX_SCHEMA_NAMES) names.add(name);
    for (const child of found.children) walk(child, depth + 1);
  };
  walk(schema, 0);
  return [...names];
}

/** The string values of `fields` in `record` that have the shape `shape`. */
function shapedStrings({ record, fields, shape }: { record: Record<string, unknown>; fields: readonly string[]; shape: RegExp }): string[] {
  return fields.flatMap(field => { const value = record[field]; return typeof value === 'string' && shape.test(value) ? [value] : []; });
}

/** Identifiers from the envelope's fixed fields, each kept only when it has the shape that field has. */
function envelopeTokens({ details }: { details: unknown }): string[] {
  if (!isRecord(details)) return [];
  const inputNames = Array.isArray(details.inputNames) ? details.inputNames.slice(0, MAX_INPUT_NAMES) as unknown[] : [];
  return [
    ...shapedStrings({ record: details, fields: ['toolId', 'pendingToolId'], shape: TOOL_ID_RE }),
    ...shapedStrings({ record: details, fields: ['executionId', 'jobId', 'requestId', 'errorId'], shape: CORRELATION_ID_RE }),
    ...inputNames.filter((name): name is string => typeof name === 'string' && PROPERTY_NAME_RE.test(name)),
  ];
}

/** Slug-shaped string arguments of this call that are not secret-marked and that no secret rule would mask. */
function echoedTokens({ echoed }: { echoed: NonNullable<DiagnosticVocabularyOptions['echoed']> }): string[] {
  if (!isRecord(echoed.input)) return [];
  const properties = isRecord(echoed.schema) && isRecord(echoed.schema.properties) ? echoed.schema.properties : {};
  const tokens: string[] = [];
  for (const [name, value] of Object.entries(echoed.input)) {
    if (tokens.length >= MAX_ECHOED_VALUES) break;
    if (typeof value !== 'string' || !ECHOED_SLUG_RE.test(value)) continue;
    if (isSecretProperty({ name, schema: properties[name] }) || redactSecrets({ input: value }, { redactPii: false }) !== value) continue;
    tokens.push(value);
  }
  return tokens;
}

/**
 * Builds the exact tokens an error text may keep.
 * @param required.toolIds - Ids the host registered or this server hosts (trusted metadata, never error text).
 * @param optional - The schema, envelope fields and echoed arguments of this call, each from a trusted position.
 * @returns A de-duplicated list for `sanitizeUntrustedText`'s whole-token exemption. It is separate from the
 *   registration predicate a host keeps: adding a name here never registers a tool.
 * @complexity O(schema nodes up to depth 6 and 512 names + 64 input names + 64 echoed values).
 */
export function buildDiagnosticVocabulary(required: { toolIds: readonly string[] }, optional: DiagnosticVocabularyOptions = {}): readonly string[] {
  return [...new Set([
    ...required.toolIds,
    ...schemaPropertyNames({ schema: optional.inputSchema }),
    ...envelopeTokens({ details: optional.envelopeDetails }),
    ...(optional.echoed === undefined ? [] : echoedTokens({ echoed: optional.echoed })),
  ])];
}
