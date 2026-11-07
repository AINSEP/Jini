import path from 'node:path';

import { parseDescriptorI18n } from '@jini-ai/core/text';

import type { DeployTargetCredentialSpec, DeployTargetDescriptor, DeployTargetEnvFallback, DeployTargetFieldSpec, DeployTargetProjectNameCopy, PluginDeployTargetModule } from './target-contracts.js';

/**
 * @file The pure parser for a plugin's `deploy-targets` contribution file, and the module contract
 * each declared target's default export must meet. No filesystem access, no import: the host reads
 * the file, imports the module through its own trust gates, and hands both here.
 */

/** Same shape as today's provider ids: lowercase, hyphenated (e.g. `s3-compatible`). */
const TARGET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TARGET_ID_LENGTH = 64;
const MAX_LABEL_LENGTH = 100;

type ParseResult = { readonly ok: true; readonly descriptors: readonly DeployTargetDescriptor[] } | { readonly ok: false; readonly reason: string };

/** Validate the default export after Jini's contained import. @complexity O(1). */
export function asDeployTargetModule<TForm = unknown, TFormSubmissions = unknown>({ exported: candidate }: { readonly exported: unknown }, _optional: Record<string, never> = {}): PluginDeployTargetModule<TForm, TFormSubmissions> | string {
  if (!isPlainObject(candidate) || typeof candidate.create !== "function") return "its module has no create() function";
  return candidate as unknown as PluginDeployTargetModule<TForm, TFormSubmissions>;
}

/**
 * Parses a plugin's {@link DEPLOY_TARGETS_FILENAME}. Pure (exported for its own tests). Unknown keys are ignored so later slices
 * can add credential/config field specs without breaking an older host.
 *
 * @complexity O(t) in the declared target count.
 */
export function parseDeployTargetsFile({ raw }: { readonly raw: string }, _optional: Record<string, never> = {}): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (!isPlainObject(value) || value.schemaVersion !== 1) return { ok: false, reason: "schemaVersion must be 1" };
  if (!Array.isArray(value.targets)) return { ok: false, reason: "targets must be an array" };

  const descriptors: DeployTargetDescriptor[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.targets.entries()) {
    const result = parseDescriptor(entry, `targets[${index}]`);
    if (typeof result === "string") return { ok: false, reason: result };
    if (seen.has(result.id)) return { ok: false, reason: `targets[${index}].id '${result.id}' is declared twice` };
    seen.add(result.id);
    descriptors.push(result);
  }
  return { ok: true, descriptors };
}

/** One descriptor entry, or the reason it is invalid. @complexity O(f) declared fields. */
function parseDescriptor(entry: unknown, at: string): DeployTargetDescriptor | string {
  if (!isPlainObject(entry)) return `${at} must be an object`;
  const { id, label, module } = entry;
  if (!isTargetId({ value: id })) return `${at}.id must be a lowercase hyphenated id`;
  if (!isLabel(label)) return `${at}.label must be a non-empty string`;
  if (!isRelativeModulePath({ value: module })) return `${at}.module must be a relative path ending in .mjs`;
  const settings = parseDescriptorSettings({ entry, at });
  if (typeof settings === "string") return settings;
  const projectName = parseProjectNameCopy(entry.projectName, `${at}.projectName`);
  if (typeof projectName === "string") return projectName;
  const i18n = parseDescriptorI18n({ value: entry.i18n, at: `${at}.i18n` });
  if (typeof i18n === "string") return i18n;
  const { configFields, ...optionalSettings } = settings;
  return {
    id: id as string,
    label,
    module: module as string,
    configFields,
    ...(projectName !== undefined ? { projectName } : {}),
    ...optionalSettings,
    ...(i18n !== undefined ? { i18n } : {}),
  };
}

/** A target's `projectName` copy (absent = the generic "Project name"), or the reason it is invalid. @complexity O(1). */
function parseProjectNameCopy(value: unknown, at: string): DeployTargetProjectNameCopy | undefined | string {
  if (value === undefined) return undefined;
  if (!isPlainObject(value) || !isLabel(value.label)) return `${at}.label must be a non-empty string`;
  const { label, help } = value;
  if (help !== undefined && (typeof help !== "string" || help.length > MAX_HELP_LENGTH)) return `${at}.help must be a string of at most ${MAX_HELP_LENGTH} characters`;
  return { label, ...(help !== undefined ? { help } : {}) };
}

/** An absolute https URL, the only kind a credential form links out to. @complexity O(n) in its length. */
function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** A saved connection's own discriminant, so a credential field of that name would be ambiguous. */
const RESERVED_CREDENTIAL_FIELD_NAMES: ReadonlySet<string> = new Set(["providerId"]);

/** A target's `credential` block (absent = no saved credential), or the reason it is invalid. @complexity O(f). */
function parseCredentialSpec(value: unknown, at: string): DeployTargetCredentialSpec | undefined | string {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return `${at} must be an object`;
  const { vendorId, vendorLabel, yieldsAccountLabel } = value;
  if (!isTargetId({ value: vendorId })) return `${at}.vendorId must be a lowercase hyphenated id`;
  if (vendorLabel !== undefined && !isLabel(vendorLabel)) return `${at}.vendorLabel must be a non-empty string`;
  if (!isOptionalBoolean({ value: yieldsAccountLabel })) return `${at}.yieldsAccountLabel must be a boolean`;
  const details = parseCredentialDetails({ value, at });
  if (typeof details === "string") return details;
  return {
    vendorId: vendorId as string,
    ...(vendorLabel !== undefined ? { vendorLabel } : {}),
    ...(yieldsAccountLabel === true ? { yieldsAccountLabel: true as const } : {}),
    ...details,
  };
}

/** Keys a publish request already uses for itself, so a config field of that name would be ambiguous. */
const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set(["target", "projectName", "credentialId"]);
const FIELD_NAME_PATTERN = /^[a-z][A-Za-z0-9]{0,63}$/;
const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const MAX_FIELDS = 16;
const MAX_HELP_LENGTH = 500;

/** A target's `config` list (absent = none), or the reason it is invalid. @complexity O(f). */
function parseConfigFields(value: unknown, at: string): DeployTargetFieldSpec[] | string {
  if (value === undefined) return [];
  const fields = parseFieldList(value, at, RESERVED_FIELD_NAMES);
  if (typeof fields === "string") return fields;
  const secretAt = fields.findIndex((field) => field.secret === true);
  return secretAt === -1 ? fields : `${at}[${secretAt}] is marked secret; config is passed in the clear, so declare it under credential.fields`;
}

/** A list of uniquely named field specs, or the reason it is invalid. @complexity O(f²), f <= {@link MAX_FIELDS}. */
function parseFieldList(value: unknown, at: string, reserved: ReadonlySet<string>): DeployTargetFieldSpec[] | string {
  if (!Array.isArray(value) || value.length > MAX_FIELDS) return `${at} must be an array of at most ${MAX_FIELDS} fields`;
  const fields: DeployTargetFieldSpec[] = [];
  for (const [index, entry] of value.entries()) {
    const field = parseFieldSpec(entry, `${at}[${index}]`, reserved);
    if (typeof field === "string") return field;
    if (fields.some((seen) => seen.name === field.name)) return `${at}[${index}].name '${field.name}' is declared twice`;
    fields.push(field);
  }
  return fields;
}

/** One field spec, or the reason it is invalid. @complexity O(1). */
function parseFieldSpec(entry: unknown, at: string, reserved: ReadonlySet<string>): DeployTargetFieldSpec | string {
  if (!isPlainObject(entry)) return `${at} must be an object`;
  const { name, label, required, secret } = entry;
  if (typeof name !== "string" || !FIELD_NAME_PATTERN.test(name)) return `${at}.name must be a camelCase identifier`;
  if (reserved.has(name)) return `${at}.name '${name}' is reserved`;
  if (!isLabel(label)) return `${at}.label must be a non-empty string`;
  if (!isOptionalBoolean({ value: required })) return `${at}.required must be a boolean`;
  if (!isOptionalBoolean({ value: secret })) return `${at}.secret must be a boolean`;
  const copy = parseHelpCopy({ value: entry, at });
  if (typeof copy === "string") return copy;
  return {
    name,
    label,
    required: required === true,
    ...copy,
    ...(secret === true ? { secret: true as const } : {}),
  };
}

/** A target's `env` block (absent = no env fallback), or the reason it is invalid. @complexity O(v). */
function parseEnvFallback(value: unknown, at: string): DeployTargetEnvFallback | undefined | string {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return `${at} must be an object`;
  const { tokenVars, fields } = value;
  if (!Array.isArray(tokenVars) || tokenVars.length === 0 || tokenVars.length > MAX_FIELDS || !tokenVars.every(isEnvVarName)) {
    return `${at}.tokenVars must be a non-empty array of env var names`;
  }
  if (fields === undefined) return { tokenVars };
  const parsedFields = parseEnvFields({ fields, at });
  if (typeof parsedFields === "string") return parsedFields;
  return { tokenVars, fields: parsedFields };
}

function isLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= MAX_LABEL_LENGTH;
}

function isEnvVarName(value: unknown): value is string {
  return typeof value === "string" && ENV_VAR_PATTERN.test(value);
}


function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The same deploy-target id contract applies to the target and its credential vendor. */
function isTargetId({ value }: { readonly value: unknown }, _optional: Record<string, never> = {}): boolean {
  return typeof value === "string" && value.length <= MAX_TARGET_ID_LENGTH && TARGET_ID_PATTERN.test(value);
}

/** Lexical module validation; the contribution loader still enforces containment on disk. */
function isRelativeModulePath({ value }: { readonly value: unknown }, _optional: Record<string, never> = {}): boolean {
  return typeof value === "string" && value.endsWith(".mjs") && !path.posix.isAbsolute(value);
}

function isOptionalBoolean({ value }: { readonly value: unknown }, _optional: Record<string, never> = {}): boolean {
  return value === undefined || typeof value === "boolean";
}

/** Shared descriptor help bounds and omission semantics for fields and credentials. */
function parseHelpCopy({ value, at }: { readonly value: Readonly<Record<string, unknown>>; readonly at: string }, _optional: Record<string, never> = {}): Pick<DeployTargetFieldSpec, "help" | "userHelp"> | string {
  const { help, userHelp } = value;
  if (help !== undefined && (typeof help !== "string" || help.length > MAX_HELP_LENGTH)) return `${at}.help must be a string of at most ${MAX_HELP_LENGTH} characters`;
  if (userHelp !== undefined && (typeof userHelp !== "string" || userHelp.length > MAX_HELP_LENGTH)) return `${at}.userHelp must be a string of at most ${MAX_HELP_LENGTH} characters`;
  return {
    ...(help !== undefined ? { help } : {}),
    ...(userHelp !== undefined ? { userHelp } : {}),
  };
}

/** Credential guidance and fields, validated after vendor identity in the original refusal order. */
function parseCredentialDetails({ value, at }: { readonly value: Readonly<Record<string, unknown>>; readonly at: string }, _optional: Record<string, never> = {}): Omit<DeployTargetCredentialSpec, "vendorId" | "vendorLabel" | "yieldsAccountLabel"> | string {
  const copy = parseHelpCopy({ value, at });
  if (typeof copy === "string") return copy;
  const { tokenPageUrl, tokenField = "token" } = value;
  if (tokenPageUrl !== undefined && !isHttpsUrl(tokenPageUrl)) return `${at}.tokenPageUrl must be an https URL`;
  const fields = parseFieldList(value.fields, `${at}.fields`, RESERVED_CREDENTIAL_FIELD_NAMES);
  if (typeof fields === "string") return fields;
  if (typeof tokenField !== "string" || !fields.some((field) => field.name === tokenField && field.required)) return `${at}.tokenField '${String(tokenField)}' must name a required field`;
  return { ...copy, ...(tokenPageUrl !== undefined ? { tokenPageUrl } : {}), tokenField, fields };
}

/** The bounded field-to-environment mapping, separate from the ordered token fallback list. */
function parseEnvFields({ fields, at }: { readonly fields: unknown; readonly at: string }, _optional: Record<string, never> = {}): Record<string, string> | string {
  const entries = isPlainObject(fields) ? Object.entries(fields) : [];
  if (!isPlainObject(fields) || entries.length > MAX_FIELDS || !entries.every(([name, envVar]) => FIELD_NAME_PATTERN.test(name) && isEnvVarName(envVar))) {
    return `${at}.fields must map field names to env var names`;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

/** Publish inputs share their validation order, while presentation copy is parsed afterwards. */
function parseDescriptorSettings({ entry, at }: { readonly entry: Readonly<Record<string, unknown>>; readonly at: string }, _optional: Record<string, never> = {}): Pick<DeployTargetDescriptor, "configFields" | "env" | "credential"> | string {
  const configFields = parseConfigFields(entry.config, `${at}.config`);
  if (typeof configFields === "string") return configFields;
  const env = parseEnvFallback(entry.env, `${at}.env`);
  if (typeof env === "string") return env;
  const credential = parseCredentialSpec(entry.credential, `${at}.credential`);
  if (typeof credential === "string") return credential;
  return {
    configFields,
    ...(env !== undefined ? { env } : {}),
    ...(credential !== undefined ? { credential } : {}),
  };
}
