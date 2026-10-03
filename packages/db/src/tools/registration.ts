/** Tool registration contracts; the host retains its independent derived-risk tripwire. */
import type { AgentToolDefinition, ToolHandler, ToolRegistration } from "@jini-ai/core";
export interface InputReaders {
  inputRecord(input: unknown): Record<string, unknown>;
  string(input: Record<string, unknown>, key: string): string;
  noInput(input: unknown): void;
  isRecord(input: unknown): input is Record<string, unknown>;
  optionalString(input: Record<string, unknown>, key: string): string | undefined;
  optionalNumber(input: Record<string, unknown>, key: string): number | undefined;
  optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined;
}
/** Descriptors keep the catalog bytes. Read-only follows the supplied independently classified handler map. */
export function registrations({ catalog, handlers, risks }: { catalog: readonly AgentToolDefinition[]; handlers: Record<string, ToolHandler>; risks: ReadonlyMap<string, string> }, _optional = {}): ToolRegistration[] {
  return Object.entries(handlers).map(([id, handler]) => {
    const entry = catalog.find(entry => entry.name === id);
    if (!entry?.inputSchema || risks.get(id) !== entry.sideEffects) throw new Error(`database tool contract/risk mismatch: ${id}`);
    return { descriptor: { id, description: entry.description, inputSchema: entry.inputSchema, readOnly: risks.get(id) === "none" }, handler, policy: { authorize: () => "allow" } };
  });
}
