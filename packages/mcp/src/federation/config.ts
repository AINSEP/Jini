import type { FederatedMcpConnectionConfig, McpLaunchSpec } from "./ports.js";

/**
 * @file GENERIC configuration-resolution scaffolding for federated MCP connections — the parts every
 * vendor preset needs and none of which names a vendor.
 *
 * What this file deliberately does NOT contain, as of 2026-07-30: any specific vendor's preset. The
 * Supabase preset this capability was designed and verified against used to live here; it moved to
 * `src/features/plugins/supabase-mcp/` on 2026-07-30 and was retired on 2026-09-29 (Supabase is now
 * the `content/agent-plugins/supabase` Agent Plugin). The reasoning is the same one that keeps `store-plugin.ts` and `deploy-plugin.ts` out
 * of `src/server` proper: a concrete vendor integration that ships by default is still an OPTIONAL
 * module, and a reader who finds it inside `src/assistant/` reasonably concludes the assistant
 * REQUIRES it. Nothing in `mcp-federation/` should be readable as "host app's assistant needs Supabase".
 *
 * What stays here is the scaffolding a SECOND preset would otherwise have to duplicate: the
 * resolved-connection shape, the shared timeout/size ceilings, and the three env-parsing helpers
 * (enabled-flag, comma list, positive int). Their semantics are the load-bearing part — see each
 * one's own comment — and having exactly one implementation of them is what makes two presets behave
 * the same way about the same kind of setting.
 *
 * Architectural role:
 * Configuration resolution. Pure apart from reading an injected env bag. No I/O.
 */

/**
 * One fully-resolved federated connection: how to reach it, and the policy to hold it to.
 *
 * This is the whole contract between a vendor preset and core federation. A preset's entire job is
 * to produce one of these (or `null`); everything downstream — `presets.ts`, `bootstrap.ts`,
 * `trust.ts`, `registrations.ts` — is vendor-blind and works off this shape alone.
 *
 * `launch` is TRANSPORT-BLIND too: a local command or a hosted endpoint, and every policy field
 * beside it applies identically to both. That is what lets an operator move a connection from a
 * locally-launched server to the vendor's hosted one without any of the trust machinery noticing.
 */
export interface ResolvedFederatedConnection {
  readonly config: FederatedMcpConnectionConfig;
  readonly launch: McpLaunchSpec;
}

/**
 * Shared ceilings, so two presets do not disagree about what a reasonable bound is.
 *
 * A preset may override any of them when it has a vendor-specific reason (and should say why); the
 * point of a shared default is that "no particular reason" resolves to the same number everywhere.
 */
export const FEDERATED_CONNECTION_DEFAULTS = {
  connectTimeoutMs: 60_000,
  callTimeoutMs: 30_000,
  maxResultBytes: 64 * 1024,
  maxTools: 32,
} as const;

/** `1`/`true`/`yes`/`on`, case-insensitive. Anything else — including unset — is off, because the
 * default for connecting an assistant to a third party must be "no". */
export function isFederationEnabled({ value }: { value: string | undefined }): boolean {
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/** `undefined` (use the preset's default) is distinguished from `""` (an operator explicitly
 * allowing nothing), so setting the variable empty is a working way to disable every tool without
 * unsetting the connection. */
export function parseAllowedToolNames({ value }: { value: string | undefined }): string[] | null {
  if (typeof value !== "string") return null;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Malformed and non-positive values fall back rather than throw: a mistyped timeout should not be
 * the difference between having federation and not, whereas a mistyped credential or project scope
 * (which a preset validates itself) should be. */
export function positiveIntOrDefault({ value, fallback }: { value: string | undefined; fallback: number }): number {
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
