import path from 'node:path';

import type { DeployConfigGeneratorModule } from './config-contracts.js';

/**
 * @file The pure parser for a plugin's `deploy-configs` contribution file, and the module contract
 * each declared generator's default export must meet. No filesystem access and no import.
 */

const GENERATOR_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 64;
const MAX_LABEL_LENGTH = 100;

/** One entry of a plugin's {@link DEPLOY_CONFIGS_FILENAME}. */
export interface DeployConfigGeneratorDescriptor {
  readonly id: string;
  readonly label: string;
  readonly module: string;
  readonly candidatePaths?: readonly { readonly path: string; readonly order: number }[];
  readonly workflowFile?: string;
}

export interface LoadedDeployConfigGenerator {
  readonly descriptor: DeployConfigGeneratorDescriptor;
  readonly pluginId: string;
  readonly module: DeployConfigGeneratorModule;
}

export interface DeployConfigGeneratorRegistry {
  get(id: string): LoadedDeployConfigGenerator | undefined;
  /** Declared order. */
  list(): readonly LoadedDeployConfigGenerator[];
  readonly refusals: readonly string[];
}

/** The export as a generator module, or the refusal reason. @complexity O(1). */
export function asDeployConfigGeneratorModule({ exported: candidate }: { readonly exported: unknown }, _optional: Record<string, never> = {}): DeployConfigGeneratorModule | string {
  if (!isPlainObject(candidate) || typeof candidate.render !== "function") return "its module has no render() function";
  return candidate as unknown as DeployConfigGeneratorModule;
}

/**
 * Parses a plugin's {@link DEPLOY_CONFIGS_FILENAME}. Pure (exported for its own tests). Unknown keys
 * are ignored.
 *
 * @complexity O(g) in the declared generator count.
 */
export function parseDeployConfigsFile({ raw }: { readonly raw: string }, _optional: Record<string, never> = {}): { readonly ok: true; readonly descriptors: readonly DeployConfigGeneratorDescriptor[] } | { readonly ok: false; readonly reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (!isPlainObject(value) || value.schemaVersion !== 1) return { ok: false, reason: "schemaVersion must be 1" };
  if (!Array.isArray(value.generators)) return { ok: false, reason: "generators must be an array" };

  const descriptors: DeployConfigGeneratorDescriptor[] = [];
  for (const [index, entry] of value.generators.entries()) {
    const descriptor = parseDescriptor({ entry, at: `generators[${index}]` });
    if (typeof descriptor === "string") return { ok: false, reason: descriptor };
    if (descriptors.some((seen) => seen.id === descriptor.id)) return { ok: false, reason: `generators[${index}].id '${descriptor.id}' is declared twice` };
    descriptors.push(descriptor);
  }
  return { ok: true, descriptors };
}

/** One generator entry, or the reason it is invalid. @complexity O(1). */
function parseDescriptor({ entry, at }: { entry: unknown; at: string }, _optional = {}): DeployConfigGeneratorDescriptor | string {
  if (!isPlainObject(entry)) return `${at} must be an object`;
  const { id, module } = entry;
  if (!validGeneratorId({ id })) return `${at}.id must be a lowercase hyphenated id`;
  const label = readGeneratorLabel({ label: entry.label });
  if (label === undefined) return `${at}.label must be a non-empty string`;
  if (!validGeneratorModulePath({ module })) return `${at}.module must be a relative path ending in .mjs`;
  const metadata = readPublishMetadata({ entry });
  if (typeof metadata === "string") return `${at}.${metadata}`;
  return { id: id as string, label, module: module as string, ...metadata };
}

/** Keep label bounds and blank detection together without normalizing the stored label. */
function readGeneratorLabel({ label }: { label: unknown }, _options = {}): string | undefined {
  return typeof label === "string" && label.trim() !== "" && label.length <= MAX_LABEL_LENGTH ? label : undefined;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Repo-relative declaration paths never escape to another drive or parent directory. */
export function isContainedDeployConfigPath({ value }: { readonly value: unknown }, _optional = {}): boolean {
  return typeof value === "string" && value.length <= 512 && /^[a-zA-Z0-9_./-]+$/.test(value)
    && !value.split("/").some(segment => segment === ".." || segment === "." || segment === "");
}

/** Optional publish hints remain plain data; no generator executes during discovery. */
function readPublishMetadata({ entry }: { entry: Readonly<Record<string, unknown>> }, _optional = {}): Pick<DeployConfigGeneratorDescriptor, "candidatePaths" | "workflowFile"> | string {
  const { candidatePaths, workflowFile } = entry;
  if (candidatePaths !== undefined && (!Array.isArray(candidatePaths) || !candidatePaths.every(validCandidatePath))) return "candidatePaths must contain repo-relative paths and finite orders";
  if (workflowFile !== undefined && (typeof workflowFile !== "string" || !/^[a-zA-Z0-9_-]+\.ya?ml$/.test(workflowFile))) return "workflowFile must be a workflow filename";
  return { ...(candidatePaths === undefined ? {} : { candidatePaths: candidatePaths as NonNullable<DeployConfigGeneratorDescriptor["candidatePaths"]> }), ...(workflowFile === undefined ? {} : { workflowFile: workflowFile as string }) };
}

function validCandidatePath(value: unknown): boolean {
  return isPlainObject(value) && isContainedDeployConfigPath({ value: value.path }) && typeof value.order === "number" && Number.isFinite(value.order);
}

/** Keep identity and module path clauses separate from descriptor assembly. O(length). */
function validGeneratorId({ id }: { id: unknown }, _options = {}): boolean {
  return typeof id === "string" && id.length <= MAX_ID_LENGTH && GENERATOR_ID_PATTERN.test(id);
}
function validGeneratorModulePath({ module }: { module: unknown }, _options = {}): boolean {
  return typeof module === "string" && module.endsWith(".mjs") && !path.posix.isAbsolute(module);
}
