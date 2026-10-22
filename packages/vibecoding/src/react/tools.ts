/**
 * @module react/tools
 *
 * Turns one `VibecodingSession` (`./session.js`) into the chat-callable control surface the user's
 * vision describes: "tools in the vibecoding package that let us control everything from chat."
 * Every tool here is declared as an `@jini-ai/core` `ToolDescriptor` — the kernel's own
 * discoverable-tool shape (`id`, `description`, `inputSchema`, `readOnly`, ...) — so a host wires
 * these into a real `ToolRegistry` and a chat surface enumerates them via `registry.list({})` rather
 * than importing a hardcoded list of vibecoding-specific function names.
 *
 * ## Two ways to run these tools, because `@jini-ai/core`'s registry deliberately hides handlers
 *
 * `ToolRegistry` (`@jini-ai/core`) never lets a caller retrieve a registered handler directly —
 * only `authorizeToolInvocation` can, and that function is exported from `@jini-ai/core/composition`
 * for `@jini-ai/daemon`'s `ToolExecutor` alone (see that file's own module doc: "the one and only
 * intended caller"). That is the right boundary for a real backend, but it means a browser host
 * with no daemon in front of it — the common case for `./react`, a chat surface running client-side
 * — has no way to actually invoke a tool it just registered.
 *
 * So this module exposes two views over the same underlying definitions:
 *
 * - {@link createVibecodingToolRegistrations} — real `ToolRegistration`s, ready for
 *   `registry.register(...)` on any `@jini-ai/core` `ToolRegistry`. This is what makes the tools
 *   genuinely discoverable and, once a real daemon sits in front of this session, genuinely
 *   executable through `ToolExecutor`'s authorized path.
 * - {@link createVibecodingToolRunner} — the same tool ids and descriptors, plus a `run({ toolId, input })`
 *   a host without a daemon calls directly. This is not a bypass of the registry's authorization
 *   design: these tools have no principal/run/authorization concept of their own to bypass — every
 *   one of them acts on a single in-process `VibecodingSession` the host itself already holds, and
 *   the actual security boundary (which parts are addressable, and whether a proposed edit may
 *   land) is enforced by `EditTarget.validate` inside `session.applyEdits` regardless of which of
 *   these two paths reached it. A host that DOES have a daemon and wants centralized authorization
 *   registers through the first path instead and never calls `run` at all.
 */
import {
  ToolInputError,
  type ToolDescriptor,
  type ToolPolicy,
  type ToolRegistration,
} from '@jini-ai/core';
import type { ProposedEdit } from '../core/apply.js';
import type { PartId } from '../core/types.js';
import type { VibecodingSession } from './session.js';

/** Stable tool ids, exported so a host building a catalog (composer menu, MCP tool list, ...) from
 *  `ToolRegistry.list({})` can still branch on a known id where it needs to (e.g. to route
 *  `propose_edits`'s result into a "corrections" UI) without restating the string literal. */
export const VIBECODING_TOOL_IDS = {
  LIST_PARTS: 'vibecoding.list_parts',
  READ_PART: 'vibecoding.read_part',
  PROPOSE_EDITS: 'vibecoding.propose_edits',
  UNDO: 'vibecoding.undo',
  REDO: 'vibecoding.redo',
} as const;

/** A proposed edit in one `vibecoding.propose_edits` call is capped so a single model turn cannot
 *  ask this session to rewrite an unbounded number of parts in one transaction — see the
 *  Programmer pre-check on service-backed collections this module was written against. Chosen
 *  generously above any realistic single-turn edit count rather than tuned to one; a host needing
 *  fewer or more can still bound its own model prompt independently. */
const MAX_EDITS_PER_INVOCATION = 50;

/** No-argument tools still declare an (empty) object schema rather than omitting `inputSchema`, so
 *  a model sees explicitly that `{}` is the correct call shape instead of guessing. */
const EMPTY_INPUT_SCHEMA = { type: 'object', additionalProperties: false } as const;

const READ_PART_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'A part id from a prior vibecoding.list_parts call.' },
  },
  required: ['id'],
  additionalProperties: false,
} as const;

const PROPOSE_EDITS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    edits: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_EDITS_PER_INVOCATION,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'A part id from a prior vibecoding.list_parts call.' },
          content: { type: 'string', description: "The part's full replacement content." },
        },
        required: ['id', 'content'],
        additionalProperties: false,
      },
    },
    label: {
      type: 'string',
      description: 'Optional human-facing description of this turn, shown in undo history.',
    },
  },
  required: ['edits'],
  additionalProperties: false,
} as const;

/** Narrows `input` to a plain record, the same first check every handler below needs before
 *  reading a named field out of a value that arrived as `unknown` model-authored JSON. */
function requireInputRecord(input: unknown, toolId: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ToolInputError({ message: `${toolId}: expected an input object` });
  }
  return input as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string, toolId: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ToolInputError({ message: `${toolId}: "${key}" must be a non-empty string` });
  }
  return value;
}

/** Validates the `edits` array's shape without trusting any of it — `content` may legitimately be
 *  an empty string (clearing a part), so only `edits` itself and each entry's `id` are non-empty
 *  checked. */
function requireProposedEdits(record: Record<string, unknown>, toolId: string): ProposedEdit[] {
  const raw = record.edits;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError({ message: `${toolId}: "edits" must be a non-empty array` });
  }
  if (raw.length > MAX_EDITS_PER_INVOCATION) {
    throw new ToolInputError({ message: `${toolId}: "edits" carries ${raw.length} entries, over the ${MAX_EDITS_PER_INVOCATION}-entry limit per call` });
  }
  return raw.map((entry, index) => {
    const entryRecord = requireInputRecord(entry, `${toolId}.edits[${index}]`);
    const id: PartId = requireString(entryRecord, 'id', `${toolId}.edits[${index}]`);
    const content = entryRecord.content;
    if (typeof content !== 'string') {
      throw new ToolInputError({ message: `${toolId}.edits[${index}]: "content" must be a string` });
    }
    return { id, content };
  });
}

/** One tool's declarative shape plus its session-bound implementation. `handler` deliberately takes
 *  raw `input` only — none of these tools has a daemon-level principal/run/signal concept, so a
 *  `ToolExecutionContext` would carry fields no handler here would ever read. See this module's doc
 *  for how each of the two exported factories adapts this shape to its own caller. */
interface VibecodingToolDefinition {
  readonly descriptor: ToolDescriptor;
  readonly handler: (input: unknown) => Promise<unknown>;
}

/**
 * Builds the five tool definitions bound to `session`. Package-private: hosts reach these only
 * through {@link createVibecodingToolRegistrations} or {@link createVibecodingToolRunner}, which is
 * what keeps "how a definition is invoked" a single decision made in one of those two places rather
 * than duplicated per tool.
 *
 * @complexity O(1) to build the array; each handler's own cost is documented on its descriptor.
 */
function buildVibecodingToolDefinitions(session: VibecodingSession): readonly VibecodingToolDefinition[] {
  return [
    {
      descriptor: {
        id: VIBECODING_TOOL_IDS.LIST_PARTS,
        description: 'List every editable part of the artifact currently being authored.',
        inputSchema: EMPTY_INPUT_SCHEMA,
        readOnly: true,
        timeoutMs: 10_000,
      },
      handler: async () => {
        await session.refresh();
        return session.getSnapshot().parts;
      },
    },
    {
      descriptor: {
        id: VIBECODING_TOOL_IDS.READ_PART,
        description: "Read one part's current content by id.",
        inputSchema: READ_PART_INPUT_SCHEMA,
        readOnly: true,
        timeoutMs: 10_000,
      },
      handler: async (input) => {
        const record = requireInputRecord(input, VIBECODING_TOOL_IDS.READ_PART);
        const id = requireString(record, 'id', VIBECODING_TOOL_IDS.READ_PART);
        return { id, content: await session.readPart({ id }) };
      },
    },
    {
      descriptor: {
        id: VIBECODING_TOOL_IDS.PROPOSE_EDITS,
        description:
          'Propose replacement content for one or more parts, as a single undoable turn. Each edit ' +
          'is validated before anything is written; a rejected edit leaves the artifact untouched ' +
          'and its reason is returned for the next turn.',
        inputSchema: PROPOSE_EDITS_INPUT_SCHEMA,
        readOnly: false,
        timeoutMs: 15_000,
      },
      handler: async (input) => {
        const record = requireInputRecord(input, VIBECODING_TOOL_IDS.PROPOSE_EDITS);
        const edits = requireProposedEdits(record, VIBECODING_TOOL_IDS.PROPOSE_EDITS);
        const label = record.label === undefined ? undefined : requireString(record, 'label', VIBECODING_TOOL_IDS.PROPOSE_EDITS);
        return session.applyEdits({ edits }, label === undefined ? {} : { label });
      },
    },
    {
      descriptor: {
        id: VIBECODING_TOOL_IDS.UNDO,
        description: 'Revert the most recent proposed-edits turn.',
        inputSchema: EMPTY_INPUT_SCHEMA,
        readOnly: false,
        timeoutMs: 10_000,
      },
      handler: async () => ({ entry: await session.undo() }),
    },
    {
      descriptor: {
        id: VIBECODING_TOOL_IDS.REDO,
        description: 'Re-apply the most recently undone turn.',
        inputSchema: EMPTY_INPUT_SCHEMA,
        readOnly: false,
        timeoutMs: 10_000,
      },
      handler: async () => ({ entry: await session.redo() }),
    },
  ];
}

/** Grants every call — see this module's doc for why tool-level authorization has nothing to add
 *  beyond `EditTarget.validate`'s own allowlist check for a session with no principal concept of
 *  its own. A host with per-principal restrictions passes its own `ToolPolicy` via
 *  `createVibecodingToolRegistrations`'s `options.policy` instead of relying on this default. */
const ALLOW_ALWAYS: ToolPolicy = { authorize: () => 'allow' };

export interface CreateVibecodingToolRegistrationsOptions {
  /** Overrides {@link ALLOW_ALWAYS} for every registration this call produces. */
  readonly policy?: ToolPolicy;
}

/** Required port shared by the registration and direct-runner factories. */
export interface VibecodingToolArgs {
  readonly session: VibecodingSession;
}

/**
 * Builds `ToolRegistration`s ready for `registry.register(...)` on any `@jini-ai/core`
 * `ToolRegistry`. This is the "must register there, not be bespoke" seam: a chat surface backed by
 * a real daemon enumerates these through `registry.list({})` and runs them through
 * `ToolExecutor`/`authorizeToolInvocation`, never through a hardcoded switch on tool name.
 *
 * @param requiredArgs - the artifact session port every tool call acts on.
 * @param options - see {@link CreateVibecodingToolRegistrationsOptions}.
 * @returns one `ToolRegistration` per tool in `VIBECODING_TOOL_IDS`, in that constant's order.
 * @complexity O(1) — five fixed registrations.
 */
export function createVibecodingToolRegistrations(
  { session }: VibecodingToolArgs,
  options: CreateVibecodingToolRegistrationsOptions = {},
): ToolRegistration[] {
  const policy = options.policy ?? ALLOW_ALWAYS;
  return buildVibecodingToolDefinitions(session).map(({ descriptor, handler }) => ({
    descriptor,
    policy,
    handler: (ctx) => handler(ctx.input),
  }));
}

export interface VibecodingToolRunner {
  /** The same descriptors {@link createVibecodingToolRegistrations} would register — a host with no
   *  `ToolRegistry` in play yet (e.g. building a composer catalog directly) reads this instead of
   *  standing up a registry purely to call `.list({})` once. */
  readonly descriptors: readonly ToolDescriptor[];
  /** Runs one tool by id directly against the bound session. Rejects with `ToolInputError` for a
   *  malformed `input`, with `RangeError` for an unknown `toolId`, or with whatever `session`'s own
   *  operation rejects with (see `./session.js`). */
  run(args: { readonly toolId: string; readonly input: unknown }): Promise<unknown>;
}

/**
 * The no-daemon path — see this module's doc for why one is needed at all. Builds one runner over
 * `session` that a browser-only host (no `@jini-ai/daemon` in front of it) can call directly from,
 * e.g., a composer's `onDiscoverySelect` or a mock chat transport.
 *
 * @param requiredArgs - the artifact session port every tool call acts on.
 * @returns descriptors plus a `run` dispatcher — see {@link VibecodingToolRunner}.
 * @complexity `run` is O(n) in tool count (currently 5) to resolve `toolId`, then whatever the
 *  resolved handler costs.
 */
export function createVibecodingToolRunner({ session }: VibecodingToolArgs): VibecodingToolRunner {
  const definitions = buildVibecodingToolDefinitions(session);
  return {
    descriptors: definitions.map((d) => d.descriptor),
    async run({ toolId, input }) {
      const definition = definitions.find((d) => d.descriptor.id === toolId);
      if (!definition) throw new RangeError(`no vibecoding tool registered with id "${toolId}"`);
      return definition.handler(input);
    },
  };
}
