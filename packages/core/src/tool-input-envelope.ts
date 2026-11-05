import { ToolInputError } from './tool-input-errors.js';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Decode a transport's object-valued field without accepting arrays, scalars or invalid JSON.
 * @returns A JSON object; never includes supplied values in a refusal.
 * @throws ToolInputError when a string does not encode an object.
 * @complexity O(n) time/space for n JSON characters; no I/O or mutation.
 * @example decodeToolInputObject({ input: '{}' }); // {}
 */
export function decodeToolInputObject({ input }: { input: unknown }, _options: Record<string, never> = {}): unknown {
  if (typeof input !== 'string') return input;
  let decoded: unknown;
  try { decoded = JSON.parse(input); }
  catch { throw new ToolInputError({ message: 'The delegated input is not valid JSON. Send one JSON object containing the tool fields.' }); }
  if (!record(decoded)) throw new ToolInputError({ message: 'The delegated input must be a JSON object. Send the tool fields inside an object.' });
  return decoded;
}

/** Remove one delegated envelope only when the tool contract cannot own an `input` field.
 * Mixed fields and schemas without an explicit object contract retain ordinary validation.
 * @returns The original value or decoded inner object; never mutates caller arguments.
 * @complexity O(k + n) time/space for k keys and n encoded input characters; no I/O.
 * @example unwrapToolInputEnvelope({ input: { input: '{}' }, schema: { type: 'object', properties: {} } });
 */
export function unwrapToolInputEnvelope(
  { input, schema }: { input: unknown; schema: unknown }, _options: Record<string, never> = {},
): unknown {
  if (!record(input) || !record(schema) || schema.type !== 'object') return input;
  const properties = schema.properties ?? {};
  if (!record(properties) || Object.hasOwn(properties, 'input')) return input;
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'input')) return input;
  const decoded = decodeToolInputObject({ input: input.input });
  return record(decoded) ? decoded : input;
}
