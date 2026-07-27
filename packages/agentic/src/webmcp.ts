/**
 * @module webmcp
 *
 * Projection: {@link CapabilityDef} → a WebMCP tool registration.
 *
 * WebMCP (`document.modelContext.registerTool`) is the browser API by which a *page* offers
 * tools to an agent running inside the browser. It is a W3C Community Group draft, not a
 * standards-track spec, and it moves: the API relocated from `navigator.modelContext` to
 * `document.modelContext` on 2026-07-21, Chrome 150 deprecated the `navigator` location while
 * still serving it during the origin trial (Chrome 149–156), Edge ships it behind a flag, and
 * Firefox and Safari have made no commitment. Feature detection must therefore check `document`
 * first and fall back to `navigator`.
 *
 * That detection is deliberately NOT here: it touches browser globals, and this package holds
 * none. Framework bindings own host access; this file owns only the shape translation, so when
 * the registration shape changes again there is exactly one place to change it.
 */
import type { CapabilityDef, CapabilityInputSchema } from './capability.js';

/** The registration object `registerTool` accepts. WebMCP names the schema field `inputSchema`. */
export interface WebMcpToolRegistration {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: CapabilityInputSchema;
  readonly execute: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Projects one capability into a WebMCP registration.
 *
 * @param capability - The capability to expose.
 * @param execute - Runs the capability. Receives the raw argument object; the caller is
 * responsible for validating it against `capability.inputSchema` — WebMCP does not.
 * @returns The registration object to hand to `registerTool`.
 */
export function toWebMcpTool(
  capability: CapabilityDef,
  execute: (id: string, args: Record<string, unknown>) => Promise<unknown>,
): WebMcpToolRegistration {
  return {
    name: capability.id,
    description: capability.description,
    inputSchema: capability.inputSchema,
    execute: (args) => execute(capability.id, args ?? {}),
  };
}

/**
 * Projects a whole manifest.
 *
 * @param capabilities - Capabilities to expose, already filtered by whatever policy applies.
 * @param execute - Shared dispatcher, keyed by capability id.
 * @returns One registration per capability, in manifest order.
 */
export function toWebMcpTools(
  capabilities: readonly CapabilityDef[],
  execute: (id: string, args: Record<string, unknown>) => Promise<unknown>,
): readonly WebMcpToolRegistration[] {
  return capabilities.map((capability) => toWebMcpTool(capability, execute));
}
