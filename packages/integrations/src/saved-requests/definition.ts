import type { SavedRequestDefinition } from "./types.js";
import { compileInputSchema } from "./schema.js";
import { closed, dataKey, fieldPath, httpsUrl, integer, name, record, requireCondition, snapshot } from "./validation.js";

/** Validate persisted configuration at save AND invocation time. Unsupported keys refuse rather
 * than becoming a more general HTTP/template tool. Returns a detached snapshot or a safe refusal.
 * @complexity O(n) over a definition bounded to 16 KiB; no I/O. */
export function parseSavedRequestDefinition({ value }: { value: unknown }, _options: Record<string, never> = {}): SavedRequestDefinition {
  return prepareSavedRequestDefinition({ value }).definition;
}

/** Internal execution preparation: retain the validator built while checking the detached schema.
 * @complexity O(n) over the same 16 KiB definition bound; no I/O. */
export function prepareSavedRequestDefinition({ value }: { value: unknown }, _options: Record<string, never> = {}): { definition: SavedRequestDefinition; validator: ReturnType<typeof compileInputSchema> } {
  const definition = record({ value: snapshot({ value, maxBytes: 16_384, code: "invalid_definition" }) });
  closed({ value: definition, keys: ["version", "method", "url", "credential", "inputSchema", "queryBindings", "bodyBindings", "staticBody", "output"] });
  requireCondition({ valid: definition.version === 1 });
  requireCondition({ valid: ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(definition.method)) });
  const url = httpsUrl({ value: definition.url });
  checkCredential({ value: definition.credential, url });
  for (const key of url.searchParams.keys()) dataKey({ value: key });
  const schema = record({ value: definition.inputSchema });
  const validator = compileInputSchema({ schema });
  checkBindings({ definition, schema, url });
  checkProjection({ value: definition.output });
  return { definition: definition as unknown as SavedRequestDefinition, validator };
}

function checkCredential({ value, url }: { value: unknown; url: URL }, _options: Record<string, never> = {}): void {
  const credential = record({ value });
  closed({ value: credential, keys: ["id", "revision", "origin"] });
  for (const key of ["id", "revision"]) {
    const text = credential[key];
    requireCondition({ valid: typeof text === "string" && /^[\w:-]{1,128}$/.test(text) });
  }
  requireCondition({ valid: httpsUrl({ value: credential.origin }).origin === credential.origin });
  requireCondition({ valid: url.origin === credential.origin });
}

function checkBindings({ definition, schema, url }: { definition: Record<string, unknown>; schema: Record<string, unknown>; url: URL }, _options: Record<string, never> = {}): void {
  const properties = record({ value: schema.properties });
  checkBindingMap({ value: definition.queryBindings, properties, occupied: [...url.searchParams.keys()], query: true });
  const body = definition.staticBody === undefined ? {} : record({ value: definition.staticBody });
  for (const key of Object.keys(body)) dataKey({ value: key });
  checkBindingMap({ value: definition.bodyBindings, properties, occupied: Object.keys(body), query: false });
  if (definition.method === "GET") {
    requireCondition({ valid: Object.keys(record({ value: definition.bodyBindings })).length === 0 && Object.keys(body).length === 0 });
  }
}

function checkBindingMap({ value, properties, occupied, query }: { value: unknown; properties: Record<string, unknown>; occupied: readonly string[]; query: boolean }, _options: Record<string, never> = {}): void {
  const bindings = record({ value });
  integer({ value: Object.keys(bindings).length, max: 32 });
  for (const [destination, source] of Object.entries(bindings)) {
    dataKey({ value: destination });
    const sourceKey = name({ value: source });
    requireCondition({ valid: !occupied.includes(destination) && Object.hasOwn(properties, sourceKey) });
    if (query) requireCondition({ valid: !["object", "array"].includes(String(record({ value: properties[sourceKey] }).type)) });
  }
}

function checkProjection({ value }: { value: unknown }, _options: Record<string, never> = {}): void {
  const projection = record({ value });
  closed({ value: projection, keys: ["path", "maxItems", "fields"] });
  fieldPath({ value: projection.path });
  integer({ value: projection.maxItems, min: 1, max: 50 });
  const fields = record({ value: projection.fields });
  integer({ value: Object.keys(fields).length, min: 1, max: 32 });
  for (const [key, field] of Object.entries(fields)) {
    name({ value: key });
    checkOutputField({ value: field });
  }
}

function checkOutputField({ value }: { value: unknown }, _options: Record<string, never> = {}): void {
  const field = record({ value });
  closed({ value: field, keys: ["path", "type", "maxLength", "allowedOrigin"] });
  fieldPath({ value: field.path });
  requireCondition({ valid: ["string", "number", "boolean", "url"].includes(String(field.type)) });
  if (field.type === "string" || field.type === "url") integer({ value: field.maxLength, min: 1, max: 4096 });
  else requireCondition({ valid: field.maxLength === undefined });
  if (field.type === "url") requireCondition({ valid: httpsUrl({ value: field.allowedOrigin }).origin === field.allowedOrigin });
  else requireCondition({ valid: field.allowedOrigin === undefined });
}
