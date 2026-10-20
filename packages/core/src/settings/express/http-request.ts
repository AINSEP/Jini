import type { Request, Response } from "express";
import type { SettingScope } from "../index.js";
import type { SettingsHttpOptions, SettingsHttpRequired } from "./contracts.js";
import { respondToSettingsError, type SettingsErrorMapping } from "./shared.js";

/**
 * @file Request-level steps of the settings HTTP registrar (`http.ts`): the
 * authentication gate, the failure envelope and value-write body parsing.
 * Pure or response-only; no service, authorization or storage effects.
 */

export const SETTING_SCOPES: readonly string[] = ["global", "workspace", "user"];
export function unauthenticated(res: Response): void {
  res.status(401).json({ error: "unauthenticated", code: "UNAUTHENTICATED" });
}
/** Readiness/principal failures preserve the authentication boundary's existing 401 envelope, so both collapse to null. */
export async function resolvePrincipal(
  required: Pick<SettingsHttpRequired, "ready" | "principalResolver">, context: { request: Request; response: Response },
): Promise<{ id: string } | null> {
  try {
    await required.ready;
    return await required.principalResolver(context);
  } catch {
    return null;
  }
}
/** Map a handler failure to its envelope, or end a response whose headers have already been sent. */
export function failRequest(
  required: { response: Response; error: unknown; mappings: readonly SettingsErrorMapping[] }, optional: SettingsHttpOptions,
): void {
  const { response, error, mappings } = required;
  if (!response.headersSent) { respondToSettingsError({ response, error, mappings }); return; }
  // Reporting cannot prevent ending a response whose headers have already been sent.
  try { optional.onError?.({ operation: "settings-request", error }); }
  catch { /* Host diagnostics are best-effort. */ }
  finally { response.end(); }
}
export type ValueMutationOperation = "set" | "clear";
export const VALUE_MUTATION_REQUIRED: Record<ValueMutationOperation, string> = {
  set: "namespace, key, scope (global|workspace|user), and valueJson are required",
  clear: "namespace, key, and scope (global|workspace|user) are required",
};
/** The fields a value write needs, or null when one is missing or the scope is unknown. Pure, O(1). */
export function readValueMutation(
  body: Record<string, unknown>, operation: ValueMutationOperation,
): { namespace: string; key: string; scope: SettingScope } | null {
  const namespace = String(body.namespace ?? "");
  const key = String(body.key ?? "");
  const scope = body.scope as SettingScope;
  const complete = namespace && key && SETTING_SCOPES.includes(scope) && (operation === "clear" || "valueJson" in body);
  return complete ? { namespace, key, scope } : null;
}
