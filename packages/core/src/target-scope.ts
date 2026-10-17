/**
 * Keep the same tool ids plus one optional target input instead of a tool per resource:
 * each tool keeps one permission, approval class, search entry and card. Hosts own target
 * resolution; core knows nothing about their sites, registries or files.
 *
 * Writes refuse foreign targets rather than silently ignoring the unknown key. A handler
 * that ignores unknown keys would otherwise write to the CURRENT target under the wrong label.
 */
import type { Principal } from './principal.js';
import { isNonArrayRecord } from './records.js';
import { isReadOnlyTool, ToolInputError, type ToolHandler, type ToolRegistration } from './tool-registry.js';

/** A host either keeps the current handler and principal or supplies both for a peer. */
export type TargetResolution =
  | 'current'
  | { readonly handler: ToolHandler; readonly principal: Principal };

/** Narrow the shared record predicate to ordinary or null-prototype objects, excluding instances. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isNonArrayRecord({ value })) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Add an optional input only to supported object schemas; preserve other dialects unchanged. */
function withTargetParam(schema: unknown, param: string, description: string): unknown {
  if (schema === undefined) return { type: 'object', properties: { [param]: { type: 'string', description } } };
  if (!isPlainObject(schema)) return schema;
  if (!isPlainObject(schema.properties) && schema.type !== 'object') return schema;
  return { ...schema, properties: { ...(isPlainObject(schema.properties) ? schema.properties : {}), [param]: { type: 'string', description } } };
}

/**
 * Scope read-only registrations through host-supplied target ports and guard other tools
 * against accidentally executing on the current target under a foreign target's name.
 * @param required.registrations - Ordered tool catalog; registrations and schemas are never mutated.
 * @param required.resolveTarget - Resolve a scoped read to the current handler or a peer handler and principal.
 * @param required.isCurrentTarget - Check whether an unscoped tool names the current target.
 * @param optional - Target input name, schema description, refusal text and a narrowing scope predicate.
 * @returns A new array in the same order, preserving tools that already own the target input.
 * @throws ToolInputError from a wrapped handler for a non-string target or a refused foreign target.
 * Host port errors propagate unchanged from the wrapped handler.
 * @complexity O(n) over registrations, plus copying supported schemas' top-level properties.
 * @example applyTargetScope({ registrations, resolveTarget, isCurrentTarget }, { param: 'workspace' });
 */
export function applyTargetScope(
  required: {
    readonly registrations: readonly ToolRegistration[];
    /** Called only for scoped tools with a named target. Throw to refuse with the host's message unchanged. */
    resolveTarget(required: { target: string; toolId: string; principal: Principal }): Promise<TargetResolution>;
    /** Called only for unscoped tools (writes and host-excluded reads) with a named target. */
    isCurrentTarget(required: { target: string }): boolean | Promise<boolean>;
  },
  optional: {
    readonly param?: string;
    readonly describeParam?: string;
    readonly refuseMessage?: string;
    /** Narrows read-only tools; returning true can never scope a tool that is not read-only. */
    readonly scoped?: (required: { registration: ToolRegistration }) => boolean;
  } = {},
): ToolRegistration[] {
  const { param = 'site', describeParam = 'Optional target name. Omit to use the current target.', refuseMessage = 'This tool runs only on the current target.' } = optional;
  return required.registrations.map<ToolRegistration>(registration => {
    const { descriptor } = registration;
    const schema = { value: descriptor.inputSchema };
    const properties = { value: isNonArrayRecord(schema) ? schema.value.properties : undefined };
    if (isNonArrayRecord(properties) && Object.hasOwn(properties.value, param)) return registration;

    const scoped = isReadOnlyTool({ descriptor }) && (optional.scoped?.({ registration }) ?? true);
    const inputSchema = scoped ? withTargetParam(descriptor.inputSchema, param, describeParam) : descriptor.inputSchema;
    return {
      ...registration,
      descriptor: inputSchema === descriptor.inputSchema ? descriptor : { ...descriptor, inputSchema },
      handler: async (ctx, options) => {
        if (!isPlainObject(ctx.input) || !Object.hasOwn(ctx.input, param)) return registration.handler(ctx, options);
        const target = ctx.input[param];
        if (typeof target !== 'string') throw new ToolInputError({ message: `${param} must be a string` });
        const { [param]: _target, ...input } = ctx.input;
        if (!scoped) {
          if (!await required.isCurrentTarget({ target })) throw new ToolInputError({ message: refuseMessage });
          return registration.handler({ ...ctx, input }, options);
        }
        const peer = await required.resolveTarget({ target, toolId: descriptor.id, principal: ctx.principal });
        if (peer === 'current') return registration.handler({ ...ctx, input }, options);
        return peer.handler({ ...ctx, input, principal: peer.principal }, options);
      },
    };
  });
}
