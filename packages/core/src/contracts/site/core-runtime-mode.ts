/**
 * @file The host runtime-mode signal, as a type-only contract: `"production"` only when the
 * operator explicitly opted in, else `"local"`. Hosts resolve it (from their own env) and pass it
 * to the helpers that branch on it, so engine code never reads env to find out. Types only — no runtime.
 */

/** `"production"` only when the operator opted in; every other launch is `"local"`. */
export type RuntimeMode = "production" | "local";
