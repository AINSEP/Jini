/**
 * @file The pure half of the form-destinations Agent Plugin contribution: the descriptor parser and
 * the module rules a loaded destination must meet. The host names the file, loads the contained
 * `.mjs` module through its own lifecycle, and builds the registry; nothing here reads the disk.
 */
import type { FormDestinationDescriptor, FormDestinationModule, LoadedFormDestination } from "./destination-contracts.js";

const DESTINATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 64;
const MAX_LABEL_LENGTH = 100;
const RECEIVE_MODES: ReadonlySet<unknown> = new Set(["co-hosted", "external"]);

export type FormDestinationParseResult = { readonly ok: true; readonly descriptors: readonly FormDestinationDescriptor[] } | { readonly ok: false; readonly reason: string };

/** Validates a destination module's default export after the host's contained import. @complexity O(1). */
export function asFormDestinationModule(required: { readonly exported: unknown }, _optional: Record<string, never> = {}): FormDestinationModule | string {
  return isPlainObject(required.exported) ? required.exported as FormDestinationModule : "its module's default export is not an object";
}

/** The methods the descriptor's receive mode needs that the module lacks, as a reason, or nothing. @complexity O(1). */
export function formDestinationMissingMethods({ entry }: { readonly entry: Pick<LoadedFormDestination, "descriptor" | "module"> }, _optional: Record<string, never> = {}): string | undefined {
  const { descriptor: { receive }, module } = entry;
  if (receive && (typeof module.pull !== "function" || typeof module.ack !== "function")) return "a destination that receives submissions needs pull() and ack()";
  if (receive === "external" && typeof module.prepare !== "function") return "an external receiver needs prepare()";
  if (!receive && typeof module.deliver !== "function") return "a destination that does not receive submissions needs deliver()";
  return undefined;
}

/**
 * Parses a plugin's form-destinations file. Pure. Unknown keys are ignored.
 *
 * @complexity O(d) in the declared destination count.
 */
export function parseFormDestinationsFile(required: { readonly raw: string }, _optional: Record<string, never> = {}): FormDestinationParseResult {
  let value: unknown;
  try {
    value = JSON.parse(required.raw);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (!isPlainObject(value) || value.schemaVersion !== 1) return { ok: false, reason: "schemaVersion must be 1" };
  if (!Array.isArray(value.destinations)) return { ok: false, reason: "destinations must be an array" };

  const descriptors: FormDestinationDescriptor[] = [];
  for (const [index, entry] of value.destinations.entries()) {
    const result = parseDescriptor(entry, `destinations[${index}]`);
    if (typeof result === "string") return { ok: false, reason: result };
    if (descriptors.some((seen) => seen.id === result.id)) return { ok: false, reason: `destinations[${index}].id '${result.id}' is declared twice` };
    descriptors.push(result);
  }
  return { ok: true, descriptors };
}

/** One descriptor entry, or the reason it is invalid. @complexity O(h) in the declared hosts. */
function parseDescriptor(entry: unknown, at: string): FormDestinationDescriptor | string {
  if (!isPlainObject(entry)) return `${at} must be an object`;
  const { id, label, module } = entry;
  if (!isId(id)) return `${at}.id must be a lowercase hyphenated id`;
  if (!isLabel(label)) return `${at}.label must be a non-empty string`;
  // POSIX `isAbsolute` is exactly a leading "/"; this entry is universal, so it reads no `node:path`.
  if (typeof module !== "string" || !module.endsWith(".mjs") || module.startsWith("/")) return `${at}.module must be a relative path ending in .mjs`;
  const options = parseReceiveOptions(entry, at);
  return typeof options === "string" ? options : { id, label, module, ...options };
}

/** The optional receive fields: mode, co-hosting targets and vendor credential label. @complexity O(h). */
function parseReceiveOptions(entry: Readonly<Record<string, unknown>>, at: string): Pick<FormDestinationDescriptor, "receive" | "hosts" | "credentialLabel"> | string {
  const reason = receiveOptionsReason(entry, at);
  if (reason) return reason;
  const { receive, hosts, credentialLabel } = entry as Pick<FormDestinationDescriptor, "receive" | "hosts" | "credentialLabel">;
  return { ...(receive ? { receive } : {}), ...(hosts ? { hosts } : {}), ...(credentialLabel ? { credentialLabel } : {}) };
}

/** Why the optional receive fields are invalid, or nothing. @complexity O(h). */
function receiveOptionsReason({ receive, hosts, credentialLabel }: Readonly<Record<string, unknown>>, at: string): string | undefined {
  if (receive !== undefined && !RECEIVE_MODES.has(receive)) return `${at}.receive must be "co-hosted" or "external"`;
  if (hosts !== undefined && !isHostList(hosts)) return `${at}.hosts must be an array of hosting target ids`;
  if (receive === "co-hosted" && !(hosts as string[] | undefined)?.length) return `${at}.hosts must name at least one hosting target for a co-hosted receiver`;
  if (credentialLabel !== undefined && !isLabel(credentialLabel)) return `${at}.credentialLabel must be a non-empty string`;
  return undefined;
}

function isHostList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isId);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_ID_LENGTH && DESTINATION_ID_PATTERN.test(value);
}

function isLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= MAX_LABEL_LENGTH;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
