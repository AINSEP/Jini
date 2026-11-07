/**
 * @file The pure half of the mail-adapters Agent Plugin contribution: descriptor types, the file
 * parser (schemaVersion 1 and 2, optional `setup` and `credentialCard`) and the module rule. The host
 * names the file, supplies its default credential label, and loads each contained `.mjs` module
 * through its own lifecycle; nothing here reads the disk.
 */
import path from "node:path";

import { PROVIDER_ID_PATTERN } from "@jini-ai/core/provider-registry";
import { parseMailProviderSetupProperty, type MailAdapterModule, type MailProviderSetup } from "@jini-ai/platform/mail";

import { parseCredentialCardUsedFor } from "../credential-card-metadata.js";

const MAX_LABEL_LENGTH = 100;

export interface MailAdapterDescriptor {
  /** 1 or 2; v1 descriptors carry neither `credentialKeys` nor `feedback`. */
  readonly schemaVersion?: 1 | 2;
  readonly id: string;
  readonly label: string;
  /** Plugin-relative path of the `.mjs` module. */
  readonly module: string;
  /** Exact `custom_credential_sets.label` the provider's key is saved under. */
  readonly credentialLabel: string;
  /** v2: credential fields the provider reads (`token`, `baseUrl`, `username`). */
  readonly credentialKeys?: readonly string[];
  /** v2: whether the module ships a delivery-feedback parser. */
  readonly feedback?: boolean;
  /** v2, optional: declarative setup-form metadata (`@jini-ai/platform/mail`'s `parseMailProviderSetup`). */
  readonly setup?: MailProviderSetup;
  /** v2: the plugin's own key card copy; core fills in the saved label and category. */
  readonly credentialCard?: MailCredentialCard;
  /** Why a declared `credentialCard` was ignored; surfaced in the registry's `refusals`. */
  readonly credentialCardRefusal?: string;
}

/** Plugin-declared key card copy (https URLs only; the base URL is where the saved key is used). */
export interface MailCredentialCard {
  readonly title: string;
  readonly intro?: string;
  readonly helpUrl?: string;
  readonly helpLabel?: string;
  readonly keyHint?: string;
  /** Display-only purpose copy, validated by the same parser as manifest credential cards. */
  readonly usedFor?: readonly string[];
  readonly baseUrl: string;
}

export type MailAdaptersParseResult = { readonly ok: true; readonly descriptors: readonly MailAdapterDescriptor[] } | { readonly ok: false; readonly reason: string };


/** Validate the default export after the host's contained import. @complexity O(1). */
export function asMailAdapterModule<M extends object = MailAdapterModule>(required: { readonly exported: unknown }, _optional: Record<string, never> = {}): M | string {
  const candidate = required.exported;
  if (!isPlainObject(candidate) || typeof candidate.create !== "function") return "its module has no create() function";
  return candidate as unknown as M;
}

/**
 * Parses a plugin's mail-adapters file. Pure. Unknown keys are ignored.
 *
 * @param optional.defaultCredentialLabel - The label a v2 descriptor without one is saved under;
 *   host text. Absent, {@link defaultMailCredentialLabel}.
 *
 * @complexity O(a) in the declared adapter count.
 */
export function parseMailAdaptersFile(
  required: { readonly raw: string },
  optional: { readonly defaultCredentialLabel?: (input: { label: string }) => string } = {},
): MailAdaptersParseResult {
  let value: unknown;
  try {
    value = JSON.parse(required.raw);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (!isPlainObject(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2)) return { ok: false, reason: "schemaVersion must be 1 or 2" };
  if (!Array.isArray(value.adapters)) return { ok: false, reason: "adapters must be an array" };
  return parseAdapterDescriptors({ adapters: value.adapters, version: value.schemaVersion, defaultLabel: optional.defaultCredentialLabel ?? defaultMailCredentialLabel });
}

function parseAdapterDescriptors({ adapters, version, defaultLabel }: { adapters: unknown[]; version: number; defaultLabel: DefaultLabel }, _options = {}): MailAdaptersParseResult {
  const descriptors: MailAdapterDescriptor[] = [];
  for (const [index, entry] of adapters.entries()) {
    const result = version === 1 ? parseDescriptor(entry, `adapters[${index}]`) : parseDescriptorV2({ entry, at: `adapters[${index}]`, defaultLabel });
    if (typeof result === "string") return { ok: false, reason: result };
    if (descriptors.some((seen) => seen.id === result.id)) return { ok: false, reason: `adapters[${index}].id '${result.id}' is declared twice` };
    descriptors.push(result);
  }
  return { ok: true, descriptors };
}

/** One descriptor entry, or the reason it is invalid. @complexity O(1). */
function parseDescriptor(entry: unknown, at: string): MailAdapterDescriptor | string {
  if (!isPlainObject(entry)) return `${at} must be an object`;
  const { id, label, module, credentialLabel } = entry;
  // IDs pass unchanged into the keyed registry; accepting a different grammar loads unusable adapters.
  if (typeof id !== "string" || !PROVIDER_ID_PATTERN.test(id)) return `${at}.id must match ${PROVIDER_ID_PATTERN.source}`;
  if (!isLabel(label)) return `${at}.label must be a non-empty string`;
  if (typeof module !== "string" || !module.endsWith(".mjs") || path.posix.isAbsolute(module)) return `${at}.module must be a relative path ending in .mjs`;
  if (!isLabel(credentialLabel)) return `${at}.credentialLabel must be a non-empty string`;
  return { id, label, module, credentialLabel };
}

type DefaultLabel = (input: { label: string }) => string;

/** The neutral credential label a v2 descriptor without one uses when the host names none. */
export function defaultMailCredentialLabel({ label }: { label: string }, _optional: Record<string, never> = {}): string {
  return `Mail — ${label} API`;
}

/** One v2 entry, or why it is invalid; a bad optional card only adds a note. @complexity O(k + f) credential keys and setup fields. */
function parseDescriptorV2({ entry, at, defaultLabel }: { entry: unknown; at: string; defaultLabel: DefaultLabel }, _options: Record<string, never> = {}): MailAdapterDescriptor | string {
  if (!isPlainObject(entry)) return `${at} must be an object`;
  const { id, label, module, credentialLabel, credentialKeys, feedback, setup } = entry;
  if (typeof id !== "string" || !PROVIDER_ID_PATTERN.test(id)) return `${at}.id must match ${PROVIDER_ID_PATTERN.source}`;
  const base = parseDescriptor({ id: "v2", label, module, credentialLabel: credentialLabel ?? "v2" }, at);
  if (typeof base === "string") return base;
  if (!isCredentialKeys(credentialKeys)) return `${at}.credentialKeys must be an array of field names`;
  if (typeof feedback !== "boolean") return `${at}.feedback must be true or false`;
  const savedUnder = typeof credentialLabel === "string" ? base.credentialLabel : defaultLabel({ label: base.label });
  const card = parseCredentialCardProperty({ value: entry.credentialCard, at: `${at}.credentialCard` });
  return withSetup({ descriptor: { schemaVersion: 2, id, label: base.label, module: base.module, credentialLabel: savedUnder, credentialKeys, feedback, ...card }, setup, at });
}

/** Narrow credential keys before passing them to setup validation. @complexity O(k) keys. */
function isCredentialKeys(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((key) => typeof key === "string" && key !== "");
}

/** Keep absent cards absent; validate declared cards through the live parser. @complexity O(1). */
function parseCredentialCardProperty({ value, at }: { value: unknown; at: string }, _options: Record<string, never> = {}): Pick<MailAdapterDescriptor, "credentialCard" | "credentialCardRefusal"> {
  return value === undefined ? {} : parseCredentialCard(value, at);
}

const MAX_CARD_TEXT_LENGTH = 500;
const MAX_URL_LENGTH = 500;

/** A declared key card, or the note saying why it is ignored. Unknown keys are ignored. @complexity O(1). */
function parseCredentialCard(value: unknown, at: string): { credentialCard: MailCredentialCard } | { credentialCardRefusal: string } {
  if (!isPlainObject(value)) return { credentialCardRefusal: `${at} must be an object` };
  const card: Record<string, string | readonly string[]> = {};
  for (const [key, required, valid, rule] of [
    ["title", true, isLabel, "a non-empty string"],
    ["intro", false, isCardText, "a non-empty string"],
    ["helpUrl", false, isHttpsUrl, "an https URL"],
    ["helpLabel", false, isLabel, "a non-empty string"],
    ["keyHint", false, isCardText, "a non-empty string"],
    ["baseUrl", true, isHttpsUrl, "an https URL"],
  ] as const) {
    const field = value[key];
    if (field === undefined && !required) continue;
    if (!valid(field)) return { credentialCardRefusal: `${at}.${key} must be ${rule}` };
    card[key] = field;
  }
  try {
    const usedFor = parseCredentialCardUsedFor({ value: value.usedFor });
    if (usedFor !== undefined) card.usedFor = usedFor;
  } catch {
    // Bad optional copy must not disable a provider that can still send mail.
    return { credentialCardRefusal: `${at}.usedFor must be an array of at most 8 non-empty strings (at most 120 characters each)` };
  }
  return { credentialCard: card as unknown as MailCredentialCard };
}

function isCardText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= MAX_CARD_TEXT_LENGTH;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH || !URL.canParse(value)) return false;
  return new URL(value).protocol === "https:";
}

/** Parse optional setup without losing the card or its refusal note. @complexity O(f) setup fields. */
function withSetup({ descriptor, setup, at }: { descriptor: MailAdapterDescriptor; setup: unknown; at: string }, _options = {}): MailAdapterDescriptor | string {
  const declared = parseMailProviderSetupProperty({ value: setup, at, credentialKeys: descriptor.credentialKeys! });
  return typeof declared === "string" ? declared : { ...descriptor, ...declared };
}

function isLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= MAX_LABEL_LENGTH;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
