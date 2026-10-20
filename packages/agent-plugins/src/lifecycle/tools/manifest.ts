/**
 * @file Parses an Agent Plugin's tool contribution file: the data half of an executable tool.
 * Name, description, effect class and input schema are declared as reviewable data so the host can
 * list, namespace and validate a tool without running plugin code; only `module` points at code.
 * Pure: no I/O. A file that fails any rule is refused whole, so a plugin never ships half its tools.
 */
import type { PluginContributionParseResult } from '../contribution-loader.js';

/** Declared change class; `write` and `destructive` tools must also disclose affected resources. */
export type AgentPluginToolEffect = 'read' | 'write' | 'destructive';

/** One declared tool. `name` is local; the host namespaces it as `p_<plugin>__<name>`. */
export interface AgentPluginToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly effect: AgentPluginToolEffect;
  /** Plain-JS module inside the plugin root (`.mjs`); containment is checked on disk at import. */
  readonly module: string;
  /** JSON Schema (2020-12) for the tool input; must describe an object. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

// Bounds mirror the existing tier-3 tool capture (`@jini-ai/plugins/host` contributions.ts) so one
// plugin tool contract has one set of limits, whichever loader admitted it.
const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_TOOLS = 128;
const MAX_DESCRIPTION = 8000;
const MAX_MODULE_PATH = 256;
const MAX_SCHEMA_BYTES = 65536;
const EFFECTS: ReadonlySet<unknown> = new Set(['read', 'write', 'destructive']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Why the input schema is unusable, or undefined. Detaches nothing; the caller copies. @complexity O(s) schema size. */
function schemaProblem(schema: unknown): string | undefined {
  if (!isRecord(schema) || schema.type !== 'object') return 'inputSchema must be a JSON Schema describing an object';
  if (new TextEncoder().encode(JSON.stringify(schema)).byteLength > MAX_SCHEMA_BYTES) return 'inputSchema is larger than 64 KiB';
  return undefined;
}

/** Why a description is unusable, or undefined. @complexity O(1). */
function descriptionProblem(name: string, description: unknown): string | undefined {
  if (typeof description === 'string' && description.trim() && description.length <= MAX_DESCRIPTION) return undefined;
  return `tool '${name}' needs a description of at most ${MAX_DESCRIPTION} characters`;
}

/** Why a module path is unusable here, or undefined; containment is checked on disk at import. @complexity O(1). */
function moduleProblem(name: string, module: unknown): string | undefined {
  if (typeof module === 'string' && module.endsWith('.mjs') && module.length <= MAX_MODULE_PATH) return undefined;
  return `tool '${name}' module must be a .mjs path inside the plugin`;
}

/** Why one declaration's scalar fields are invalid, or undefined. @complexity O(1). */
function fieldProblem(entry: Record<string, unknown>): string | undefined {
  const { name } = entry;
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) return 'a tool name must be lower snake case, at most 64 characters';
  const effectProblem = EFFECTS.has(entry.effect) ? undefined : `tool '${name}' effect must be read, write or destructive`;
  return descriptionProblem(name, entry.description) ?? effectProblem ?? moduleProblem(name, entry.module);
}

/** One declaration, or why it is refused. Unknown keys are ignored. @complexity O(s) schema size. */
function parseEntry(entry: unknown): AgentPluginToolDescriptor | string {
  if (!isRecord(entry)) return 'every tool declaration must be an object';
  const problem = fieldProblem(entry) ?? schemaProblem(entry.inputSchema);
  if (problem) return problem;
  return Object.freeze({
    name: entry.name as string, description: entry.description as string, effect: entry.effect as AgentPluginToolEffect,
    module: entry.module as string, inputSchema: JSON.parse(JSON.stringify(entry.inputSchema)) as Record<string, unknown>,
  });
}

/** The declaration list from the raw file, or why the file is refused. @complexity O(n) file size. */
function declarations(raw: string): readonly unknown[] | string {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return 'not valid JSON'; }
  if (!isRecord(value) || value.schemaVersion !== 1) return 'schemaVersion must be 1';
  const { tools } = value;
  if (!Array.isArray(tools) || tools.length === 0 || tools.length > MAX_TOOLS) return `tools must list 1 to ${MAX_TOOLS} declarations`;
  return tools;
}

/**
 * Parses the raw contribution file. A local name declared twice is refused (duplicate id).
 * @param required.raw - The file text as read from a trusted package.
 * @returns Descriptors in declaration order, or the reason the whole file is refused.
 * @complexity O(t^2 + s) for t declarations (t <= 128) and s total schema size.
 */
export function parseAgentPluginToolsFile(required: { readonly raw: string }, _optional: Record<string, never> = {}): PluginContributionParseResult<AgentPluginToolDescriptor> {
  const tools = declarations(required.raw);
  if (typeof tools === 'string') return { ok: false, reason: tools };
  const descriptors: AgentPluginToolDescriptor[] = [];
  for (const entry of tools) {
    const parsed = parseEntry(entry);
    if (typeof parsed === 'string') return { ok: false, reason: parsed };
    if (descriptors.some(existing => existing.name === parsed.name)) return { ok: false, reason: `tool '${parsed.name}' is declared more than once` };
    descriptors.push(parsed);
  }
  return { ok: true, descriptors };
}
