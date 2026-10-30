/** Descriptor-only projections. Execution and current authorization remain with ToolExecutor. */
import type { ToolDescriptor, ToolRegistry } from './tool-registry.js';

const SAFE_NAME = /^[A-Za-z_]\w{0,63}$/;
const MAX_NAME_LENGTH = 64;

export interface ToolNameMap {
  wireNameFor(required: { toolId: string }, optional?: Record<string, never>): string | undefined;
  toolIdFor(required: { wireName: string }, optional?: Record<string, never>): string | undefined;
}

interface NameIndex {
  readonly forward: Map<string, string>;
  readonly reverse: Map<string, string>;
  readonly occupied: Set<string>;
}

/** A stable, non-security hash keeps transformed names independent of discovery order.
 * Collisions are still checked against the entire namespace, never trusted as unique. */
function nameHash(id: string): string {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function nameBase(id: string): string {
  if (SAFE_NAME.test(id)) return id;
  const readable = id.replace(/\W/g, '_');
  return `tool_${readable.slice(0, 49)}_${nameHash(id)}`;
}

/** O(c) collision probes for c occupied alternatives; suffix space stays inside the wire limit. */
function assignName(index: NameIndex, id: string): void {
  if (index.forward.has(id)) return;
  const base = nameBase(id);
  let candidate = base;
  let counter = 1;
  while (index.occupied.has(candidate)) {
    const suffix = `_${counter}`;
    counter += 1;
    candidate = `${base.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
  }
  index.forward.set(id, candidate);
  index.reverse.set(candidate, id);
  index.occupied.add(candidate);
}

/** Reserve native spellings first so a transformed ID cannot steal an existing safe name. */
function indexNames(index: NameIndex, toolIds: readonly string[]): void {
  const sorted = [...new Set(toolIds)].sort();
  for (const id of sorted) if (SAFE_NAME.test(id)) assignName(index, id);
  for (const id of sorted) if (!SAFE_NAME.test(id)) assignName(index, id);
}

/**
 * Build a deterministic, collision-checked mapping to conservative 64-character wire names.
 * @param required - Registry IDs; duplicates share one mapping.
 * @param optional - Names already occupied by transport-owned tools.
 * @returns Read-only forward/reverse lookups, with no descriptors or execution authority.
 * @complexity O(n log n + l + c) time, O(n + l) space for n IDs, l characters and c collision probes.
 */
export function createToolNameMap(
  { toolIds }: { toolIds: readonly string[] },
  { reservedNames = [] }: { reservedNames?: readonly string[] } = {},
): ToolNameMap {
  const index: NameIndex = { forward: new Map(), reverse: new Map(), occupied: new Set(reservedNames) };
  indexNames(index, toolIds);
  return Object.freeze({
    wireNameFor: ({ toolId }: { toolId: string }, _optional = {}) => index.forward.get(toolId),
    toolIdFor: ({ wireName }: { wireName: string }, _optional = {}) => index.reverse.get(wireName),
  });
}

export interface ExposedToolDescriptor {
  readonly wireName: string;
  readonly descriptor: ToolDescriptor;
}

export interface ToolExposureSnapshot {
  readonly revision: number;
  readonly tools: readonly ExposedToolDescriptor[];
  /** UTF-8 bytes of JSON-serialized input schemas, excluding absent schemas. */
  readonly schemaBytes: number;
}

export interface ToolExposureSkipped {
  readonly toolId: string;
  readonly reason: 'not-found' | 'tool-limit' | 'schema-byte-limit';
}

export interface ToolExposurePromotion {
  readonly snapshot: ToolExposureSnapshot;
  readonly added: readonly string[];
  readonly skipped: readonly ToolExposureSkipped[];
}

export interface ToolExposure {
  /** Synchronous and idempotent; successful promotions are never evicted within this scope. */
  promote(required: { toolIds: readonly string[] }, optional?: Record<string, never>): ToolExposurePromotion;
  getSnapshot(required: Record<string, never>, optional?: Record<string, never>): ToolExposureSnapshot;
  /** Resolves published names only. Callers must still invoke the authoritative executor. */
  resolveToolId(required: { wireName: string }, optional?: Record<string, never>): string | undefined;
}

export class ToolExposureError extends Error {
  readonly code: 'invalid-limit' | 'invalid-descriptor';
  constructor({ code }: { code: 'invalid-limit' | 'invalid-descriptor' }, options: { cause?: unknown } = {}) {
    super(`ToolExposure: ${code}`, options);
    this.name = 'ToolExposureError';
    this.code = code;
  }
}

function assertLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new ToolExposureError({ code: 'invalid-limit' });
}

/** Freeze detached data only; registry-owned descriptors are never frozen or mutated. */
function freezeData(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value) || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) freezeData(child, seen);
  Object.freeze(value);
}

/** Clone and measure before publication. Invalid data cannot partially change exposure state. */
function pinDescriptor(descriptor: ToolDescriptor): { descriptor: ToolDescriptor; bytes: number } {
  try {
    const pinned = structuredClone(descriptor);
    const json = JSON.stringify(pinned.inputSchema);
    const bytes = json === undefined ? 0 : new TextEncoder().encode(json).byteLength;
    freezeData(pinned);
    return { descriptor: pinned, bytes };
  } catch (cause) {
    throw new ToolExposureError({ code: 'invalid-descriptor' }, { cause });
  }
}

interface ExposureLimits { readonly maxTools: number; readonly maxSchemaBytes: number }

/** Count and byte caps reject new entries without evicting any previously callable definition. */
/** A tool that can join the snapshot (pinned), or why it is skipped. */
function promotionCandidate(
  descriptor: ToolDescriptor | undefined, snapshot: ToolExposureSnapshot, limits: ExposureLimits,
): { reason: ToolExposureSkipped['reason'] } | { pinned: { descriptor: ToolDescriptor; bytes: number } } {
  if (!descriptor) return { reason: 'not-found' };
  const pinned = pinDescriptor(descriptor);
  const reason = limitReason(snapshot, pinned.bytes, limits);
  return reason ? { reason } : { pinned };
}

function limitReason(snapshot: ToolExposureSnapshot, bytes: number, limits: ExposureLimits): ToolExposureSkipped['reason'] | undefined {
  if (snapshot.tools.length >= limits.maxTools) return 'tool-limit';
  if (snapshot.schemaBytes + bytes > limits.maxSchemaBytes) return 'schema-byte-limit';
  return undefined;
}

/** Stage all changes locally so malformed descriptors leave the last published revision intact. */
function promoteDescriptors(
  snapshot: ToolExposureSnapshot, toolIds: readonly string[], descriptors: readonly ToolDescriptor[],
  names: NameIndex, limits: ExposureLimits,
): ToolExposurePromotion {
  const available = new Map(descriptors.map(descriptor => [descriptor.id, descriptor]));
  const published = new Set(snapshot.tools.map(tool => tool.descriptor.id));
  const tools = [...snapshot.tools];
  const added: string[] = [];
  const skipped: ToolExposureSkipped[] = [];
  let schemaBytes = snapshot.schemaBytes;
  for (const toolId of new Set(toolIds)) {
    if (published.has(toolId)) continue;
    const candidate = promotionCandidate(available.get(toolId), { tools, schemaBytes, revision: snapshot.revision }, limits);
    if ('reason' in candidate) {
      skipped.push({ toolId, reason: candidate.reason });
    } else {
      assignName(names, toolId);
      tools.push({ wireName: names.forward.get(toolId)!, descriptor: candidate.pinned.descriptor });
      schemaBytes += candidate.pinned.bytes;
      added.push(toolId);
    }
  }
  let next = snapshot;
  if (added.length > 0) next = { revision: snapshot.revision + 1, tools, schemaBytes };
  const result = { snapshot: next, added, skipped };
  freezeData(result);
  return result;
}

/**
 * Create one run's bounded, append-only descriptor exposure over the existing registry.
 * @param required - Descriptor source; a filtered registry view may enforce host visibility.
 * @param optional - Count/schema-byte budgets and transport-owned reserved wire names.
 * @returns Immutable snapshots and promotion deltas; no handlers, policies or execution path.
 * @throws ToolExposureError for invalid limits or non-cloneable/non-serializable descriptors.
 * @complexity Promotion O(r log r + s + b + c) time and O(r + s + b) space for r registry IDs,
 * s exposed entries, b promoted descriptor bytes and c name collision probes. No I/O.
 * @remarks Scope mutation is synchronous, so concurrent promise continuations cannot lose updates.
 * Definitions stay pinned until this object is released; execution must recheck current registry policy.
 */
export function createToolExposure(
  { registry }: { registry: Pick<ToolRegistry, 'list'> },
  { maxTools = 64, maxSchemaBytes = 262_144, reservedNames = [] }: {
    maxTools?: number; maxSchemaBytes?: number; reservedNames?: readonly string[];
  } = {},
): ToolExposure {
  assertLimit(maxTools);
  assertLimit(maxSchemaBytes);
  const names: NameIndex = { forward: new Map(), reverse: new Map(), occupied: new Set(reservedNames) };
  let snapshot: ToolExposureSnapshot = Object.freeze({ revision: 0, tools: Object.freeze([]), schemaBytes: 0 });
  return Object.freeze({
    promote({ toolIds }: { toolIds: readonly string[] }, _optional = {}): ToolExposurePromotion {
      const descriptors = registry.list({});
      indexNames(names, descriptors.map(descriptor => descriptor.id));
      const result = promoteDescriptors(snapshot, toolIds, descriptors, names, { maxTools, maxSchemaBytes });
      snapshot = result.snapshot;
      return result;
    },
    getSnapshot(_required: Record<string, never>, _optional = {}): ToolExposureSnapshot { return snapshot; },
    resolveToolId({ wireName }: { wireName: string }, _optional = {}): string | undefined {
      return snapshot.tools.find(tool => tool.wireName === wireName)?.descriptor.id;
    },
  });
}
